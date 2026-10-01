import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const BW = process.cwd();
const PORT = 4800;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const GREEN = 'rgb(220, 252, 231)';
const GREEN_BORDER = 'rgb(21, 128, 61)';
const RED = 'rgb(220, 38, 38)';
const RED_FILL = 'rgb(254, 226, 226)';
const GREY = 'rgb(100, 116, 139)';
const PLAIN = 'bindweed: use the link bindweed printed in the terminal';
const DEFAULT_LAYOUT = '{"version":1,"views":{},"settings":{"tests":false,"external":false}}';
const COUNT = (runtime: number, type: number, heritage: number) =>
  `${runtime} runtime · ${type} type-only · ${heritage} extends/implements`;

const SRC_GRAPH = {
  at: 'src',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
  ],
  nodes: [
    { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
    { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 2, row: 1, order: 0, cycle: false },
    {
      id: 'src/domain',
      kind: 'package',
      name: 'domain',
      path: 'src/domain',
      files: 2,
      row: 2,
      order: 0,
      cycle: false,
      abstract: true,
    },
  ],
  edges: [
    { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: false },
    { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
    { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
  ],
};

type BoxRect = { x: number; y: number; width: number; height: number };
type Spot = { x: number; y: number };
type LayoutDoc = {
  version: number;
  views: Record<string, Record<string, Spot>>;
  settings: { tests: boolean; external: boolean };
};
type ArrowSpec = {
  line: 'solid' | 'dashed';
  head: 'filled' | 'hollow';
  label: string | null;
  title: string;
  up: boolean;
  cycle?: boolean;
};

function exactName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function buttonName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `);
}

function waitForLines(child: ChildProcess, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let err = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      if (lines.length > count) {
        child.stdout?.off('data', onData);
        resolve(lines.slice(0, count));
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const lines = buf.split('\n').filter(Boolean);
      if (lines.length >= count) resolve(lines.slice(0, count));
      else reject(new Error(`Process exited with code ${code} before emitting ${count} lines: ${buf}${err}`));
    });
  });
}

function stopChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGINT'): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on('exit', (code) => resolve(code));
    child.kill(signal);
  });
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.NO_COLOR;
  return env;
}

function requestHttp(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout ${options.method ?? 'GET'} ${urlStr}`)));
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canon(value: Json): Json {
  if (Array.isArray(value)) return value.map((item) => canon(item));
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
}

function normalizeGraph(body: string): Json {
  const graph = JSON.parse(body) as {
    nodes: { id: string }[];
    edges: { from: string; to: string }[];
  };
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`));
  return canon(graph as unknown as Json);
}

function expectGraph(body: string, expected: unknown): void {
  expect(normalizeGraph(body)).toEqual(normalizeGraph(JSON.stringify(expected)));
}

function writeFixture(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src/app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/domain'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/infra'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}\n',
  );
  fs.writeFileSync(path.join(dir, 'notes/readme.md'), '# notes\n');
  fs.writeFileSync(
    path.join(dir, 'src/app/a.ts'),
    "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n",
  );
  fs.writeFileSync(
    path.join(dir, 'src/app/b.ts'),
    "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  );
  fs.writeFileSync(path.join(dir, 'src/app/a.test.ts'), "import { a } from './a';\n");
  fs.writeFileSync(path.join(dir, 'src/domain/model.ts'), 'export interface Model { id: number }\n');
  fs.writeFileSync(path.join(dir, 'src/domain/shape.ts'), 'export interface Shape { draw(): void }\n');
  fs.writeFileSync(
    path.join(dir, 'src/infra/db.ts'),
    "import { Model } from '../domain/model';\nexport const query = new Model();\n",
  );
  fs.writeFileSync(
    path.join(dir, 'src/infra/repo.ts'),
    "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n",
  );
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function spawnServer(cwd: string): ChildProcess {
  return spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
    cwd,
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function box(page: Page, name: string) {
  return page.locator('.box').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

async function namePoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  const rect = await box(page, name).locator('.box-name').boundingBox();
  expect(rect).not.toBeNull();
  const found = rect as BoxRect;
  return { x: found.x + found.width / 2, y: found.y + found.height / 2 };
}

function shiftInto(value: number, min: number, max: number): number {
  if (value < min) return Math.max(24, min - value);
  if (value > max) return Math.min(-24, max - value);
  return 0;
}

async function paneLimits(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const rect = await page.locator('.react-flow__pane').boundingBox();
  expect(rect).not.toBeNull();
  const pane = rect as BoxRect;
  return {
    left: pane.x + 36,
    top: pane.y + 36,
    right: pane.x + pane.width - 36,
    bottom: pane.y + pane.height - 36,
  };
}

async function bringIntoView(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const limits = await paneLimits(page);
    const point = await namePoint(page, name);
    const dx = shiftInto(point.x, limits.left, limits.right);
    const dy = shiftInto(point.y, limits.top, limits.bottom);
    if (dx === 0 && dy === 0) return;
    await panCanvas(page, dx, dy);
  }
}

async function doubleClickBox(page: Page, name: string): Promise<void> {
  const before = page.url();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await bringIntoView(page, name);
    const point = await namePoint(page, name);
    await page.mouse.dblclick(point.x, point.y, { delay: 50 });
    try {
      await expect(page).not.toHaveURL(before, { timeout: 1500 });
      return;
    } catch {
      await expect(box(page, name)).toBeVisible();
    }
  }
  throw new Error(`double-click did not leave ${before}`);
}

async function clickBox(page: Page, name: string): Promise<void> {
  await bringIntoView(page, name);
  const point = await namePoint(page, name);
  await page.mouse.click(point.x, point.y);
}

async function hoverBox(page: Page, name: string): Promise<void> {
  await bringIntoView(page, name);
  const away = await emptyCanvasPoint(page);
  await page.mouse.move(away.x, away.y);
  const point = await namePoint(page, name);
  await page.mouse.move(point.x, point.y);
}

function arrow(page: Page, from: string, to: string) {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function details(page: Page) {
  return page.locator('aside[aria-label="details"]');
}

function section(page: Page, title: string) {
  return details(page).locator('section').filter({ has: page.locator('h3', { hasText: exactName(title) }) });
}

async function centers(page: Page): Promise<Record<string, { x: number; y: number; w: number; h: number }>> {
  return page.locator('.box').evaluateAll((els) => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const el of els) {
      const name = el.querySelector('.box-name')?.textContent ?? '';
      const rect = el.getBoundingClientRect();
      out[name] = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    }
    return out;
  });
}

async function mustBox(page: Page, name: string): Promise<BoxRect> {
  const rect = await box(page, name).boundingBox();
  expect(rect).not.toBeNull();
  return rect as BoxRect;
}

async function spotOf(page: Page, name: string): Promise<Spot> {
  const spot = await box(page, name).evaluate((el) => ({
    x: Number((el as HTMLElement).dataset.x),
    y: Number((el as HTMLElement).dataset.y),
  }));
  return spot;
}

async function expectSpot(page: Page, name: string, x: number, y: number): Promise<void> {
  await expect(box(page, name)).toHaveAttribute('data-x', String(x));
  await expect(box(page, name)).toHaveAttribute('data-y', String(y));
}

async function boxText(page: Page, name: string): Promise<string> {
  const text = await box(page, name).innerText();
  return text.replace(/\s+/g, ' ').trim();
}

async function waitForBoxes(page: Page, names: string[]): Promise<void> {
  await expect(page.locator('.box-name')).toHaveCount(names.length);
  for (const name of names) await expect(box(page, name)).toBeVisible();
  await expect
    .poll(async () => {
      const placed = await centers(page);
      return names.every((name) => (placed[name]?.w ?? 0) > 30 && (placed[name]?.h ?? 0) > 10);
    })
    .toBe(true);
}

async function expectAbove(page: Page, upper: string, lower: string): Promise<void> {
  const placed = await centers(page);
  expect(placed[upper].y + placed[upper].h).toBeLessThan(placed[lower].y);
}

async function expectSideBySide(page: Page, left: string, right: string): Promise<void> {
  const placed = await centers(page);
  expect(Math.abs(placed[left].y - placed[right].y)).toBeLessThan(8);
  expect(placed[left].x).toBeLessThan(placed[right].x - 20);
}

async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (pane === null) return null;
    const paneRect = pane.getBoundingClientRect();
    const blockers = [...document.querySelectorAll('.react-flow__node, .react-flow__attribution')].map((el) =>
      el.getBoundingClientRect(),
    );
    for (let y = paneRect.top + 8; y < paneRect.bottom - 8; y += 16) {
      for (let x = paneRect.left + 8; x < paneRect.right - 8; x += 16) {
        const blocked = blockers.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
        if (!blocked) return { x, y };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  return point as { x: number; y: number };
}

async function panCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const spot = await emptyCanvasPoint(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  try {
    await page.mouse.move(spot.x + dx, spot.y + dy, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
}

async function dragBy(page: Page, name: string, dx: number, dy: number): Promise<void> {
  await bringIntoView(page, name);
  const start = await namePoint(page, name);
  const startX = start.x;
  const startY = start.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    await page.mouse.move(startX + dx, startY + dy, { steps: 30 });
  } finally {
    await page.mouse.up();
  }
}

async function dragWholeBoxAbove(page: Page, upper: string, lower: string): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const limit = viewport as { width: number; height: number };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const placed = await centers(page);
    if (placed[lower].y - placed[upper].y >= placed[upper].h) return;
    const up = await mustBox(page, upper);
    const low = await mustBox(page, lower);
    const dy = low.y - up.height - 12 - up.y;
    const endY = up.y + up.height / 2 + dy;
    if (endY < 40) {
      await panCanvas(page, 0, 40 - endY);
      continue;
    }
    if (endY > limit.height - 40 || up.y > limit.height - 8) {
      await panCanvas(page, 0, limit.height - 80 - endY);
      continue;
    }
    await dragBy(page, upper, 0, dy);
  }
  const placed = await centers(page);
  expect(placed[lower].y - placed[upper].y).toBeGreaterThanOrEqual(placed[upper].h);
}

async function setChecked(page: Page, name: string, checked: boolean): Promise<void> {
  const input = page.getByRole('checkbox', { name });
  if ((await input.isChecked()) !== checked) await input.click();
  if (checked) await expect(input).toBeChecked();
  else await expect(input).not.toBeChecked();
}

async function dragToRightOf(page: Page, name: string, other: string): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const limit = (viewport as { width: number }).width;
  const beforeOther = await spotOf(page, other);
  const beforeName = await spotOf(page, name);
  const moving = await mustBox(page, name);
  const target = await mustBox(page, other);
  const dx = target.x + target.width + 30 - moving.x;
  const endX = moving.x + moving.width / 2 + dx;
  expect(endX).toBeGreaterThan(8);
  expect(endX).toBeLessThan(limit - 8);
  await dragBy(page, name, dx, 0);
  await expect.poll(async () => (await spotOf(page, name)).x).toBeGreaterThan(beforeOther.x);
  const after = await spotOf(page, name);
  expect(after.x).toBeGreaterThan(beforeName.x);
  expect(after.y).toBe(beforeName.y);
}

async function paintOf(page: Page, name: string): Promise<{ background: string; border: string }> {
  return box(page, name).evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderRightColor };
  });
}

async function expectGreen(page: Page, name: string, green: boolean): Promise<void> {
  const paint = await paintOf(page, name);
  await expect(box(page, name)).toHaveAttribute('data-abstract', green ? 'true' : 'false');
  if (green) {
    expect(paint.background).toBe(GREEN);
    expect(paint.border).toBe(GREEN_BORDER);
    return;
  }
  expect(paint.background).not.toBe(GREEN);
  expect(paint.border).not.toBe(GREEN_BORDER);
}

async function expectRedBox(page: Page, name: string): Promise<void> {
  const paint = await box(page, name).evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  expect(paint.background).toBe(RED_FILL);
  expect(paint.border).toBe(RED);
  await expect(box(page, name)).toHaveAttribute('data-cycle', 'true');
}

async function expectArrow(page: Page, from: string, to: string, spec: ArrowSpec): Promise<void> {
  const edge = arrow(page, from, to);
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveAttribute('data-line', spec.line);
  await expect(edge).toHaveAttribute('data-head', spec.head);
  await expect(edge).toHaveAttribute('data-up', spec.up ? 'true' : 'false');
  await expect(edge).toHaveAttribute('data-cycle', spec.cycle === true ? 'true' : 'false');
  if (spec.label === null) await expect(edge.locator('text.arrow-label')).toHaveCount(0);
  else await expect(edge.locator('text.arrow-label')).toHaveText(spec.label);
  await expect(edge.locator('title')).toHaveText(spec.title);
  const path = edge.locator('path').first();
  const drawn = await path.evaluate((el) => ({
    stroke: getComputedStyle(el).stroke,
    dash: getComputedStyle(el).strokeDasharray,
    marker: el.getAttribute('marker-end') ?? '',
  }));
  expect(drawn.stroke).toBe(spec.up || spec.cycle === true ? RED : GREY);
  if (spec.line === 'dashed') expect(drawn.dash).not.toBe('none');
  else expect(drawn.dash).toBe('none');
  if (spec.head === 'hollow') {
    const id = /hollow-[0-9a-fA-F]+/.exec(drawn.marker)?.[0];
    expect(id).toBeDefined();
    await expect(page.locator(`#${id} path`)).toHaveAttribute('fill', 'none');
  } else {
    expect(drawn.marker).not.toContain('hollow');
  }
}

async function expectDim(page: Page, selector: string, dim: boolean): Promise<void> {
  const loc = page.locator(selector);
  if (dim) await expect(loc).toHaveClass(/dim/);
  else await expect(loc).not.toHaveClass(/\bdim\b/);
  await expect.poll(() => loc.evaluate((el) => getComputedStyle(el).opacity)).toBe(dim ? '0.25' : '1');
}

async function paragraphs(page: Page): Promise<string[]> {
  return details(page).locator('p').allTextContents();
}

async function buttonTexts(page: Page, title: string): Promise<string[]> {
  const texts = await section(page, title).locator('button').allTextContents();
  return texts.map((text) => text.replace(/\s+/g, ' ').trim());
}

async function expectButtons(page: Page, title: string, labels: string[]): Promise<void> {
  const wanted = labels.slice().sort();
  await expect.poll(async () => (await buttonTexts(page, title)).slice().sort()).toEqual(wanted);
}

function entry(name: string, runtime: number, type: number, heritage: number): string {
  return `${name} ${COUNT(runtime, type, heritage)}`;
}

async function expectNoFileCount(page: Page): Promise<void> {
  const lines = await paragraphs(page);
  expect(lines.some((line) => /^\d+ files?$/.test(line))).toBe(false);
}

async function expectBeside(page: Page): Promise<void> {
  const canvas = await page.locator('.arch-canvas').boundingBox();
  const aside = await details(page).boundingBox();
  expect(canvas).not.toBeNull();
  expect(aside).not.toBeNull();
  const left = canvas as BoxRect;
  const right = aside as BoxRect;
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 2);
}

async function expectNearest(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const canvas = await page.locator('.arch-canvas').boundingBox();
      if (canvas === null) return '';
      const placed = await centers(page);
      const midX = canvas.x + canvas.width / 2;
      const midY = canvas.y + canvas.height / 2;
      const distance = (boxName: string) =>
        Math.hypot(placed[boxName].x + placed[boxName].w / 2 - midX, placed[boxName].y + placed[boxName].h / 2 - midY);
      return Object.keys(placed).sort((a, b) => distance(a) - distance(b))[0];
    })
    .toBe(name);
}

async function layoutOf(token: string): Promise<LayoutDoc> {
  const res = await requestHttp(`${ORIGIN}/api/layout`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as LayoutDoc;
}

async function putLayout(token: string, doc: unknown): Promise<{ status: number; body: string }> {
  return requestHttp(`${ORIGIN}/api/layout`, {
    method: 'PUT',
    headers: jsonHeaders(token),
    body: JSON.stringify(doc),
  });
}

async function openPrinted(page: Page, token: string, hash = ''): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${ORIGIN}/?token=${token}${hash}`);
  await expect(page).toHaveURL(`${ORIGIN}/${hash}`);
}

async function freshTab(context: BrowserContext, token: string, hash: string): Promise<Page> {
  const tab = await context.newPage();
  await openPrinted(tab, token, hash);
  return tab;
}

test('qa: edge kinds, pins and toggles', async ({ page, context }) => {
  test.setTimeout(240_000);
  execSync('flock -w 180 /tmp/bindweed-qa-build.lock npm run build', { cwd: BW, stdio: 'ignore' });

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  writeFixture(layered);
  commitFixture(layered);
  const layoutPath = path.join(layered, '.bindweed', 'layout.json');

  let active: ChildProcess | null = null;
  try {
    const server = spawnServer(layered);
    active = server;
    const lines = await waitForLines(server, 2);
    const match = lines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:4800\/\?token=([0-9a-f]{32})$/);
    expect(match).not.toBeNull();
    const firstToken = match?.[1] ?? '';
    expect(lines[1]).toBe(`serving ${layered}`);
    let token = firstToken;

    await test.step('layout is empty and the src graph has the three layers', async () => {
      const layout = await requestHttp(`${ORIGIN}/api/layout`, { headers: bearer(token) });
      expect(layout.status).toBe(200);
      expect(layout.body).toBe(DEFAULT_LAYOUT);
      expect(fs.existsSync(layoutPath)).toBe(false);
      const graph = await requestHttp(`${ORIGIN}/api/graph?at=src`, { headers: bearer(token) });
      expect(graph.status).toBe(200);
      expectGraph(graph.body, SRC_GRAPH);
      expect(graph.body).not.toContain('a.test.ts');
      expect(graph.body).not.toContain('node:fs');
      expect(graph.body).not.toContain('react');
      const parsed = JSON.parse(graph.body) as { nodes: { name: string; abstract?: boolean }[]; edges: { heritage?: number }[] };
      for (const node of parsed.nodes) {
        if (node.name === 'domain') expect(node.abstract).toBe(true);
        else expect(node).not.toHaveProperty('abstract');
      }
      expect(parsed.edges.filter((edge) => edge.heritage !== undefined)).toHaveLength(1);
    });

    await test.step('bad writes and the old routes leave no layout file', async () => {
      const checks: { method?: string; url: string; headers?: Record<string, string>; body?: string; status: number; expectBody: string | string[] }[] = [
        {
          method: 'PUT',
          url: `${ORIGIN}/api/layout`,
          headers: { ...bearer(token), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'not json',
          status: 400,
          expectBody: '{"error":"bad layout"}',
        },
        {
          url: `${ORIGIN}/api/detail?id=missing&at=src`,
          headers: bearer(token),
          status: 404,
          expectBody: '{"error":"no such node"}',
        },
        {
          url: `${ORIGIN}/api/graph?at=notes`,
          headers: bearer(token),
          status: 404,
          expectBody: '{"error":"no such directory"}',
        },
        { url: `${ORIGIN}/api/layout`, status: 401, expectBody: '{"error":"missing or wrong token"}' },
        {
          method: 'POST',
          url: `${ORIGIN}/api/layout`,
          headers: bearer(token),
          status: 404,
          expectBody: '{"error":"not found"}',
        },
        {
          url: `${ORIGIN}/api/tree`,
          headers: bearer(token),
          status: 200,
          expectBody: ['notes', 'src', 'tsconfig.json'],
        },
        {
          url: `${ORIGIN}/api/file?path=src/domain/shape.ts`,
          headers: bearer(token),
          status: 200,
          expectBody: '{"path":"src/domain/shape.ts","text":"export interface Shape { draw(): void }\\n"}',
        },
      ];
      for (const check of checks) {
        const res = await requestHttp(check.url, { method: check.method, headers: check.headers, body: check.body });
        expect(res.status).toBe(check.status);
        if (Array.isArray(check.expectBody)) {
          const tree = JSON.parse(res.body) as { entries: { name: string }[] };
          expect(tree.entries.map((entry) => entry.name)).toEqual(check.expectBody);
        } else {
          expect(res.body).toBe(check.expectBody);
        }
      }
      expect(fs.existsSync(layoutPath)).toBe(false);
    });

    await test.step('the printed link opens the Files tab', async () => {
      await openPrinted(page, token);
      await expect(page).toHaveTitle('bindweed — layered');
      await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('aside nav button')).toHaveText(['layered/', 'notes/', 'src/', 'tsconfig.json']);
      await expect(page.locator('main')).toHaveText('select a file');
      await expect(page.getByRole('checkbox', { name: 'Tests' })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: 'External packages' })).toHaveCount(0);
    });

    await test.step('Architecture shows src and the toggles off', async () => {
      await page.getByRole('tab', { name: 'Architecture' }).click();
      await waitForBoxes(page, ['src']);
      expect(await boxText(page, 'src')).toBe('src 6 files');
      await expect(page.locator('g.arrow')).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: 'Tests' })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'External packages' })).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Rescan' })).toBeVisible();
    });

    await test.step('src shows a green domain, a hollow head, a solid mix and a dashed arrow', async () => {
      await doubleClickBox(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      expect(await boxText(page, 'app')).toBe('app 2 files');
      expect(await boxText(page, 'infra')).toBe('infra 2 files');
      expect(await boxText(page, 'domain')).toBe('domain 2 files');
      await expectAbove(page, 'app', 'infra');
      await expectAbove(page, 'infra', 'domain');
      await expectGreen(page, 'domain', true);
      await expectGreen(page, 'app', false);
      await expectGreen(page, 'infra', false);
      await expectArrow(page, 'src/app', 'src/infra', {
        line: 'solid',
        head: 'filled',
        label: '3',
        title: COUNT(2, 1, 0),
        up: false,
      });
      await expectArrow(page, 'src/app', 'src/domain', {
        line: 'dashed',
        head: 'filled',
        label: null,
        title: COUNT(0, 1, 0),
        up: false,
      });
      await expectArrow(page, 'src/infra', 'src/domain', {
        line: 'solid',
        head: 'hollow',
        label: '2',
        title: COUNT(2, 0, 1),
        up: false,
      });
      await expect(page.locator('[data-cycle="true"]')).toHaveCount(0);
      await expect(page.locator('[data-up="true"]')).toHaveCount(0);
    });

    await test.step('hovering infra dims everything that does not touch it', async () => {
      const address = page.url();
      await hoverBox(page, 'infra');
      await expectDim(page, '.box[data-id="src/app"]', true);
      await expectDim(page, '.box[data-id="src/domain"]', true);
      await expectDim(page, '.box[data-id="src/infra"]', false);
      await expectDim(page, 'g.arrow[data-from="src/app"][data-to="src/infra"]', false);
      await expectDim(page, 'g.arrow[data-from="src/infra"][data-to="src/domain"]', false);
      await expectDim(page, 'g.arrow[data-from="src/app"][data-to="src/domain"]', true);
      const away = await emptyCanvasPoint(page);
      await page.mouse.move(away.x, away.y);
      await expectDim(page, '.box[data-id="src/app"]', false);
      await expectDim(page, '.box[data-id="src/domain"]', false);
      await expectDim(page, 'g.arrow[data-from="src/app"][data-to="src/domain"]', false);
      expect(page.url()).toBe(address);
    });

    await test.step('clicking infra opens the panel and domain in the panel selects that box', async () => {
      await clickBox(page, 'infra');
      await expect(details(page).locator('h2')).toHaveText('infra');
      await expectBeside(page);
      expect(await paragraphs(page)).toEqual(expect.arrayContaining(['src/infra', 'package', '2 files']));
      expect(await paragraphs(page)).not.toContain('abstract');
      await expectButtons(page, 'Imports', [entry('domain', 2, 0, 1)]);
      await expectButtons(page, 'Imported by', [entry('app', 2, 1, 0)]);
      await section(page, 'Imports').locator('button', { hasText: buttonName('domain') }).click();
      await expect(box(page, 'domain')).toHaveAttribute('data-selected', 'true');
      await expect(box(page, 'app')).toHaveAttribute('data-selected', 'false');
      await expect(box(page, 'infra')).toHaveAttribute('data-selected', 'false');
      await expectNearest(page, 'domain');
      await expect(details(page).locator('h2')).toHaveText('domain');
      expect(await paragraphs(page)).toEqual(expect.arrayContaining(['src/domain', 'package', '2 files', 'abstract']));
      await expectButtons(page, 'Imports', []);
      await expectButtons(page, 'Imported by', [entry('app', 0, 1, 0), entry('infra', 2, 0, 1)]);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
    });

    await test.step('drilling to app closes the panel, and db.ts drills to infra', async () => {
      await doubleClickBox(page, 'app');
      await expect(details(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app`);
      await waitForBoxes(page, ['a.ts', 'b.ts']);
      await expectRedBox(page, 'a.ts');
      await expectRedBox(page, 'b.ts');
      await expect(page.locator('.box-name', { hasText: 'a.test.ts' })).toHaveCount(0);
      await clickBox(page, 'a.ts');
      await expect(section(page, 'Imports').locator('button', { hasText: buttonName('db.ts') })).toBeVisible();
      await section(page, 'Imports').locator('button', { hasText: buttonName('db.ts') }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/infra`);
      await expect(box(page, 'db.ts')).toHaveAttribute('data-selected', 'true');
      await expect(details(page).locator('h2')).toHaveText('db.ts');
      expect(await paragraphs(page)).toContain('src/infra/db.ts');
      await expectButtons(page, 'Imported by', [entry('a.ts', 1, 0, 0), entry('b.ts', 1, 0, 0)]);
    });

    await test.step('dragging domain above app pins it and turns the upward arrows red', async () => {
      await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      await dragWholeBoxAbove(page, 'domain', 'app');
      const placed = await centers(page);
      expect(placed.domain.y).toBeLessThanOrEqual(placed.app.y - placed.domain.h);
      await expectArrow(page, 'src/app', 'src/domain', {
        line: 'dashed',
        head: 'filled',
        label: null,
        title: 'points up: app is drawn below domain',
        up: true,
      });
      await expectArrow(page, 'src/infra', 'src/domain', {
        line: 'solid',
        head: 'hollow',
        label: '2',
        title: 'points up: infra is drawn below domain',
        up: true,
      });
      await expectArrow(page, 'src/app', 'src/infra', {
        line: 'solid',
        head: 'filled',
        label: '3',
        title: COUNT(2, 1, 0),
        up: false,
      });
      await expect
        .poll(async () => {
          const doc = await layoutOf(token);
          const pin = doc.views.src?.['src/domain'];
          return JSON.stringify({
            views: Object.keys(doc.views),
            pins: Object.keys(doc.views.src ?? {}),
            x: typeof pin?.x,
            y: typeof pin?.y,
            finite: Number.isFinite(pin?.x) && Number.isFinite(pin?.y),
            tests: doc.settings.tests,
            external: doc.settings.external,
          });
        })
        .toBe(
          JSON.stringify({
            views: ['src'],
            pins: ['src/domain'],
            x: 'number',
            y: 'number',
            finite: true,
            tests: false,
            external: false,
          }),
        );
    });

    await test.step('a new tab keeps the pin, and a token-less address is refused', async () => {
      const tab = await freshTab(context, token, '#at=src');
      await waitForBoxes(tab, ['app', 'infra', 'domain']);
      const placed = await centers(tab);
      expect(placed.domain.y).toBeLessThan(placed.app.y);
      await expect(arrow(tab, 'src/app', 'src/domain').locator('title')).toHaveText('points up: app is drawn below domain');
      await expect(arrow(tab, 'src/infra', 'src/domain').locator('title')).toHaveText('points up: infra is drawn below domain');
      await expect(arrow(tab, 'src/app', 'src/domain')).toHaveAttribute('data-up', 'true');
      await expect(arrow(tab, 'src/infra', 'src/domain')).toHaveAttribute('data-up', 'true');
      await expect(tab).toHaveURL(`${ORIGIN}/#at=src`);
      await tab.reload();
      await expect(tab.locator('body')).toHaveText(PLAIN);
      await tab.close();
    });

    await test.step('the pin survives a restart and the token changes', async () => {
      const stopped = await stopChild(server, 'SIGINT');
      active = null;
      expect(stopped).toBe(0);
      const restarted = spawnServer(layered);
      active = restarted;
      const restartedLines = await waitForLines(restarted, 2);
      const restartedMatch = restartedLines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:4800\/\?token=([0-9a-f]{32})$/);
      expect(restartedMatch).not.toBeNull();
      token = restartedMatch?.[1] ?? '';
      expect(token).not.toBe(firstToken);
      expect(restartedLines[1]).toBe(`serving ${layered}`);
      await openPrinted(page, token, '#at=src');
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      const placed = await centers(page);
      expect(placed.domain.y).toBeLessThan(placed.app.y);
    });

    await test.step('rescan keeps the pin, and reset clears only this view', async () => {
      const rescanned = page.waitForResponse(
        (res) => new URL(res.url()).pathname === '/api/rescan' && res.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Rescan' }).click();
      expect((await rescanned).ok()).toBe(true);
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      const afterRescan = await centers(page);
      expect(afterRescan.domain.y).toBeLessThan(afterRescan.app.y);
      await doubleClickBox(page, 'app');
      await waitForBoxes(page, ['a.ts', 'b.ts']);
      await dragToRightOf(page, 'a.ts', 'b.ts');
      await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      await setChecked(page, 'Tests', true);
      await page.getByRole('button', { name: 'Reset layout' }).click();
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      await expectAbove(page, 'app', 'infra');
      await expectAbove(page, 'infra', 'domain');
      await expect(page.locator('[data-up="true"]')).toHaveCount(0);
      await expect(page.locator('g.arrow.cycle, g.arrow.up, .box.cycle')).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
      await doubleClickBox(page, 'app');
      await waitForBoxes(page, ['a.test.ts', 'a.ts', 'b.ts']);
      const placed = await centers(page);
      expect(placed['a.ts'].x).toBeGreaterThan(placed['b.ts'].x + 20);
      await expect(box(page, 'a.test.ts')).toBeVisible();
      await expect
        .poll(async () => {
          const doc = await layoutOf(token);
          return JSON.stringify({
            src: Object.hasOwn(doc.views, 'src'),
            pin: doc.views['src/app']?.['src/app/a.ts'] !== undefined,
            tests: doc.settings.tests,
          });
        })
        .toBe(JSON.stringify({ src: false, pin: true, tests: true }));
    });

    await test.step('Tests shows a.test.ts and is remembered', async () => {
      await page.getByRole('button', { name: 'Reset layout' }).click();
      await waitForBoxes(page, ['a.test.ts', 'a.ts', 'b.ts']);
      await expect(page.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
      await expectSideBySide(page, 'a.ts', 'b.ts');
      await expectAbove(page, 'a.test.ts', 'a.ts');
      await expect(box(page, 'a.test.ts').locator('.box-tag')).toHaveText('test');
      const tagSize = await box(page, 'a.test.ts').locator('.box-tag').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const nameSize = await box(page, 'a.test.ts').locator('.box-name').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(tagSize).toBeLessThan(nameSize);
      await expectArrow(page, 'src/app/a.test.ts', 'src/app/a.ts', {
        line: 'solid',
        head: 'filled',
        label: null,
        title: COUNT(1, 0, 0),
        up: false,
      });
      await clickBox(page, 'a.ts');
      await expectButtons(page, 'Imported by', [entry('b.ts', 1, 0, 0), entry('a.test.ts', 1, 0, 0)]);
      await clickBox(page, 'a.test.ts');
      await expect(details(page).locator('h2')).toHaveText('a.test.ts');
      await expectButtons(page, 'Imports', [entry('a.ts', 1, 0, 0)]);
      await expectButtons(page, 'Imported by', []);
      const tab = await freshTab(context, token, '#at=src/app');
      await expect(tab.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
      await expect(box(tab, 'a.test.ts')).toBeVisible();
      await setChecked(tab, 'Tests', false);
      await waitForBoxes(tab, ['a.ts', 'b.ts']);
      await expectSideBySide(tab, 'a.ts', 'b.ts');
      await expect
        .poll(async () => (await layoutOf(token)).settings.tests)
        .toBe(false);
      await tab.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await waitForBoxes(tab, ['app', 'infra', 'domain']);
      await setChecked(tab, 'External packages', true);
      await waitForBoxes(tab, ['app', 'infra', 'domain', 'node:fs', 'react']);
      await expect.poll(async () => (await layoutOf(token)).settings.external).toBe(true);
      const externalTab = await freshTab(context, token, '#at=src');
      await expect(externalTab.getByRole('checkbox', { name: 'External packages' })).toBeChecked();
      await expect(externalTab.getByRole('checkbox', { name: 'Tests' })).not.toBeChecked();
      await waitForBoxes(externalTab, ['app', 'infra', 'domain', 'node:fs', 'react']);
      await expectAbove(externalTab, 'app', 'infra');
      await expectAbove(externalTab, 'infra', 'domain');
      await expectAbove(externalTab, 'domain', 'node:fs');
      const row = await centers(externalTab);
      expect(Math.abs(row['node:fs'].y - row.react.y)).toBeLessThan(8);
      expect(row['node:fs'].x).toBeLessThan(row.react.x - 20);
      expect(await externalTab.locator('.box[data-id="node:fs"]').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
      expect(await externalTab.locator('.box[data-id="react"]').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
      await expectGreen(externalTab, 'domain', true);
      await expectArrow(externalTab, 'src/infra', 'node:fs', {
        line: 'solid',
        head: 'filled',
        label: null,
        title: COUNT(1, 0, 0),
        up: false,
      });
      await expectArrow(externalTab, 'src/infra', 'react', {
        line: 'solid',
        head: 'filled',
        label: null,
        title: COUNT(1, 0, 0),
        up: false,
      });
      await clickBox(externalTab, 'infra');
      await expectButtons(externalTab, 'Imports', [
        entry('domain', 2, 0, 1),
        entry('node:fs', 1, 0, 0),
        entry('react', 1, 0, 0),
      ]);
      await clickBox(externalTab, 'node:fs');
      await expect(details(externalTab).locator('h2')).toHaveText('node:fs');
      expect(await paragraphs(externalTab)).toEqual(expect.arrayContaining(['node:fs', 'external']));
      await expectNoFileCount(externalTab);
      await expectButtons(externalTab, 'Imports', []);
      await expectButtons(externalTab, 'Imported by', [entry('infra', 1, 0, 0)]);
      await clickBox(externalTab, 'react');
      await expect(details(externalTab).locator('h2')).toHaveText('react');
      expect(await paragraphs(externalTab)).toEqual(expect.arrayContaining(['react', 'external']));
      await expectNoFileCount(externalTab);
      await expectButtons(externalTab, 'Imports', []);
      await expectButtons(externalTab, 'Imported by', [entry('infra', 1, 0, 0)]);
      const beforeBoth = await centers(externalTab);
      await setChecked(externalTab, 'Tests', true);
      await expect(externalTab.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
      await expect(externalTab.getByRole('checkbox', { name: 'External packages' })).toBeChecked();
      const afterBoth = await centers(externalTab);
      expect(Math.abs(afterBoth['node:fs'].y - beforeBoth['node:fs'].y)).toBeLessThan(8);
      expect(Math.abs(afterBoth.react.x - beforeBoth.react.x)).toBeLessThan(8);
      await doubleClickBox(externalTab, 'app');
      await waitForBoxes(externalTab, ['a.test.ts', 'a.ts', 'b.ts']);
      await expect(externalTab.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
      await expect(externalTab.getByRole('checkbox', { name: 'External packages' })).toBeChecked();
      await expect(box(externalTab, 'a.test.ts').locator('.box-tag')).toHaveText('test');
      await externalTab.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await waitForBoxes(externalTab, ['app', 'infra', 'domain', 'node:fs', 'react']);
      await setChecked(externalTab, 'Tests', false);
      await setChecked(externalTab, 'External packages', false);
      await waitForBoxes(externalTab, ['app', 'infra', 'domain']);
      await expect
        .poll(async () => {
          const settings = (await layoutOf(token)).settings;
          return JSON.stringify(settings);
        })
        .toBe(JSON.stringify({ tests: false, external: false }));
      await tab.close();
      await externalTab.close();
    });

    await test.step('an external that would land on a pin steps right', async () => {
      const doc = {
        version: 1,
        views: { src: { 'src/domain': { x: 260, y: 420 } } },
        settings: { tests: false, external: true },
      };
      const saved = await putLayout(token, doc);
      expect(saved.status).toBe(200);
      expect(JSON.parse(saved.body)).toEqual(doc);
      const before = fs.readFileSync(layoutPath);
      await openPrinted(page, token, '#at=src');
      await expect(page.getByRole('checkbox', { name: 'External packages' })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Tests' })).not.toBeChecked();
      await waitForBoxes(page, ['app', 'infra', 'domain', 'node:fs', 'react']);
      await expectSpot(page, 'app', 0, 0);
      await expectSpot(page, 'infra', 0, 140);
      await expectSpot(page, 'domain', 260, 420);
      await expectSpot(page, 'node:fs', 0, 420);
      await expectSpot(page, 'react', 520, 420);
      expect(fs.readFileSync(layoutPath).equals(before)).toBe(true);
      const again = await layoutOf(token);
      expect(again).toEqual(doc);
    });

    await test.step('a new file steps right past pinned cells', async () => {
      const doc = {
        version: 1,
        views: { src: { 'src/app': { x: 200, y: 100 }, 'src/domain': { x: 260, y: 0 } } },
        settings: { tests: false, external: false },
      };
      expect((await putLayout(token, doc)).status).toBe(200);
      fs.writeFileSync(path.join(layered, 'src/main.ts'), "import { a } from './app/a';\n");
      const rescan = await requestHttp(`${ORIGIN}/api/rescan`, { method: 'POST', headers: bearer(token) });
      expect(rescan.status).toBe(200);
      const rescanBody = JSON.parse(rescan.body) as { files: number; ms: number };
      expect(rescanBody.files).toBe(8);
      expect(Number.isFinite(rescanBody.ms)).toBe(true);
      expect(rescanBody).not.toHaveProperty('row');
      const graph = await requestHttp(`${ORIGIN}/api/graph?at=src`, { headers: bearer(token) });
      expect(graph.status).toBe(200);
      const nodes = (JSON.parse(graph.body) as { nodes: { name: string; row: number }[] }).nodes;
      expect(nodes.find((node) => node.name === 'main.ts')?.row).toBe(0);
      expect(nodes.find((node) => node.name === 'app')?.row).toBe(1);
      await openPrinted(page, token, '#at=src');
      await waitForBoxes(page, ['main.ts', 'app', 'infra', 'domain']);
      await expectSpot(page, 'main.ts', 520, 0);
      await expectSpot(page, 'app', 200, 100);
      await expectSpot(page, 'domain', 260, 0);
      await expectSpot(page, 'infra', 0, 280);
      const rows = (JSON.parse(graph.body) as { nodes: { name: string; row: number }[] }).nodes;
      expect(rows.find((node) => node.name === 'main.ts')?.row).toBe(0);
      expect(await spotOf(page, 'app')).toEqual({ x: 200, y: 100 });
    });

    await test.step('a pin for a missing file is ignored and kept', async () => {
      const doc = {
        version: 1,
        views: { 'src/domain': { 'src/domain/gone.ts': { x: 0, y: 0 } } },
        settings: { tests: false, external: false },
      };
      expect((await putLayout(token, doc)).status).toBe(200);
      await openPrinted(page, token, '#at=src/domain');
      await waitForBoxes(page, ['model.ts', 'shape.ts']);
      await expect(page.locator('.box-name', { hasText: 'gone.ts' })).toHaveCount(0);
      await expectGreen(page, 'model.ts', true);
      await expectGreen(page, 'shape.ts', true);
      await expectSpot(page, 'model.ts', 0, 0);
      await expectSpot(page, 'shape.ts', 260, 0);
      const placed = await centers(page);
      expect(placed['model.ts'].x).toBeLessThan(placed['shape.ts'].x);
      const kept = await layoutOf(token);
      expect(JSON.stringify(kept)).toContain('src/domain/gone.ts');
    });

    await test.step('clicking shape.ts opens its detail, and a double-click opens the file', async () => {
      await clickBox(page, 'shape.ts');
      await expect(details(page).locator('h2')).toHaveText('shape.ts');
      expect(await paragraphs(page)).toEqual(expect.arrayContaining(['src/domain/shape.ts', 'file', 'abstract']));
      await expectNoFileCount(page);
      await expectButtons(page, 'Imported by', [entry('repo.ts', 1, 0, 1)]);
      await doubleClickBox(page, 'shape.ts');
      await expect(details(page)).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('main header')).toHaveText('src/domain/shape.ts');
      await expect(page.locator('main pre div[data-line]')).toHaveText(['1 export interface Shape { draw(): void }']);
      await expect(page).toHaveURL(`${ORIGIN}/#file=src/domain/shape.ts`);
      const file = await requestHttp(`${ORIGIN}/api/file?path=src/domain/model.ts`, { headers: bearer(token) });
      expect(file.status).toBe(200);
      expect(file.body).toBe('{"path":"src/domain/model.ts","text":"export interface Model { id: number }\\n"}');
    });

    await test.step('a corrupt layout is not rewritten, and a rejected PUT leaves the valid bytes', async () => {
      fs.writeFileSync(layoutPath, 'not json');
      const corrupt = fs.readFileSync(layoutPath);
      const got = await requestHttp(`${ORIGIN}/api/layout`, { headers: bearer(token) });
      expect(got.status).toBe(200);
      expect(got.body).toBe(DEFAULT_LAYOUT);
      expect(fs.readFileSync(layoutPath).equals(corrupt)).toBe(true);
      const valid = {
        version: 1,
        views: { src: { 'src/domain': { x: 3, y: 4 } } },
        settings: { tests: true, external: false },
      };
      const put = await putLayout(token, valid);
      expect(put.status).toBe(200);
      expect(JSON.parse(put.body)).toEqual(valid);
      const validBytes = fs.readFileSync(layoutPath);
      const rejected = await requestHttp(`${ORIGIN}/api/layout`, {
        method: 'PUT',
        headers: { ...bearer(token), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'not json',
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toBe('{"error":"bad layout"}');
      expect(fs.readFileSync(layoutPath).equals(validBytes)).toBe(true);
    });

    await test.step('a cycle arrow that points up says so and stays a cycle', async () => {
      const doc = {
        version: 1,
        views: { 'src/app': { 'src/app/a.ts': { x: 0, y: -400 } } },
        settings: { tests: false, external: false },
      };
      expect((await putLayout(token, doc)).status).toBe(200);
      await openPrinted(page, token, '#at=src/app');
      await waitForBoxes(page, ['a.ts', 'b.ts']);
      const placed = await centers(page);
      expect(placed['b.ts'].y - placed['a.ts'].y).toBeGreaterThan(placed['a.ts'].h / 2);
      await expectRedBox(page, 'a.ts');
      await expectRedBox(page, 'b.ts');
      await expectArrow(page, 'src/app/b.ts', 'src/app/a.ts', {
        line: 'solid',
        head: 'filled',
        label: null,
        title: 'points up: b.ts is drawn below a.ts',
        up: true,
        cycle: true,
      });
      await expectArrow(page, 'src/app/a.ts', 'src/app/b.ts', {
        line: 'solid',
        head: 'filled',
        label: null,
        title: 'a.ts → b.ts → a.ts',
        up: false,
        cycle: true,
      });
      await expect(arrow(page, 'src/app/b.ts', 'src/app/a.ts').locator('title')).not.toHaveText('b.ts → a.ts → b.ts');
    });

    await test.step('the README still lists the old routes beside the new ones', async () => {
      const stopped = await stopChild(active, 'SIGINT');
      active = null;
      expect(stopped).toBe(0);
      const readme = fs.readFileSync(path.join(BW, 'README.md'), 'utf8');
      const start = readme.indexOf('## Routes');
      const end = readme.indexOf('## Environment');
      const routes = readme.slice(start, end);
      for (const route of ['/', '/assets/', '/api/tree', '/api/file', '/api/graph', '/api/rescan', '/api/layout', '/api/detail']) {
        expect(routes).toContain(`| \`${route}\` | live |`);
      }
    });
  } finally {
    if (active) await stopChild(active, 'SIGKILL');
    fs.rmSync(QA, { recursive: true, force: true });
  }
});
