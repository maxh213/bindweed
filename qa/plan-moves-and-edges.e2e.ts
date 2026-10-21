import { test, expect, type Page, type Locator } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5000;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const GREEN_BG = 'rgb(220, 252, 231)';
const RED_TEXT = 'rgb(220, 38, 38)';
const BLUE_STROKE = '#2563eb';
const LIVE_ROUTES = [
  '/api/plans',
  '/',
  '/assets/',
  '/api/tree',
  '/api/file',
  '/api/graph',
  '/api/rescan',
  '/api/layout',
  '/api/detail',
];

type BoxRect = { x: number; y: number; w: number; h: number };

function exactName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
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
  fs.writeFileSync(path.join(dir, 'src/app/save.ts'), 'export const save = 1;\n');
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

function box(page: Page, name: string): Locator {
  return page.locator('.box').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function cutmark(page: Page, from: string, to: string): Locator {
  return page.locator(`g.cutmark[data-from="${from}"][data-to="${to}"]`);
}

async function clickArrow(page: Page, from: string, to: string): Promise<void> {
  const edge = arrow(page, from, to);
  await expect(edge).toHaveCount(1);
  const clicked = await page.evaluate(
    ({ fromStr, toStr }) => {
      const arrowG = document.querySelector(`g.arrow[data-from="${fromStr}"][data-to="${toStr}"]`);
      if (!arrowG) return { found: false, error: 'no arrow element' };
      const edgeWrapper = arrowG.closest('g.react-flow__edge');
      const interactionPath = arrowG.querySelector('path.react-flow__edge-interaction') ?? arrowG.querySelector('path');
      if (interactionPath) {
        interactionPath.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { found: true, method: 'interactionPath' };
      }
      if (edgeWrapper) {
        edgeWrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { found: true, method: 'edgeWrapper' };
      }
      arrowG.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return { found: true, method: 'arrowG' };
    },
    { fromStr: from, toStr: to },
  );
  expect(clicked.found).toBe(true);
  await expect(arrow(page, from, to)).toHaveAttribute('data-selected', 'true');
}

async function centers(page: Page): Promise<Record<string, BoxRect>> {
  return page.locator('.box').evaluateAll((els) => {
    const out: Record<string, BoxRect> = {};
    for (const el of els) {
      const name = el.querySelector('.box-name')?.textContent ?? '';
      const r = el.getBoundingClientRect();
      out[name] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
}

type PxBox = { x: number; y: number; width: number; height: number };

async function laidOut(target: Locator): Promise<PxBox> {
  let rect: PxBox | null = null;
  await expect.poll(async () => {
    rect = await target.boundingBox({ timeout: 250 }).catch(() => null);
    return rect;
  }).not.toBeNull();
  return rect as PxBox;
}

async function namePoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  const rect = await laidOut(box(page, name).locator('.box-name'));
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function paneLimits(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const rect = await laidOut(page.locator('.react-flow__pane'));
  return {
    left: rect.x + 36,
    top: rect.y + 36,
    right: rect.x + rect.width - 36,
    bottom: rect.y + rect.height - 36,
  };
}

function shiftInto(value: number, min: number, max: number): number {
  if (value < min) return Math.max(24, min - value);
  if (value > max) return Math.min(-24, max - value);
  return 0;
}

async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (pane === null) return null;
    const paneRect = pane.getBoundingClientRect();
    const blockers = [...document.querySelectorAll('.react-flow__node, .react-flow__attribution, aside, .arch-toolbar')].map((el) =>
      el.getBoundingClientRect(),
    );
    for (let y = paneRect.top + 16; y < paneRect.bottom - 16; y += 24) {
      for (let x = paneRect.left + 16; x < paneRect.right - 16; x += 24) {
        const blocked = blockers.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
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

async function clickBox(page: Page, name: string): Promise<void> {
  await bringIntoView(page, name);
  const point = await namePoint(page, name);
  await page.mouse.click(point.x, point.y);
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

async function expectBoxContains(page: Page, name: string, fragment: string): Promise<void> {
  await expect.poll(async () => {
    const text = await box(page, name).innerText({ timeout: 250 }).catch(() => '');
    return text.replace(/\s+/g, ' ').trim();
  }).toContain(fragment);
}

async function waitForBoxes(page: Page, names: string[]): Promise<void> {
  await expect(page.locator('.box-name')).toHaveCount(names.length);
  for (const name of names) await expect(box(page, name)).toBeVisible();
}

async function placement(page: Page, upper: string, lower: string): Promise<string> {
  return page.locator('.box').evaluateAll((els, names) => {
    const found = new Map<string, HTMLElement>();
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const name = el.querySelector('.box-name')?.textContent ?? '';
      found.set(name, el);
    }
    const a = found.get(names[0]);
    const b = found.get(names[1]);
    if (a === undefined || b === undefined) return 'missing';
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const ay = a.getAttribute('data-y');
    const by = b.getAttribute('data-y');
    return `screen=${Math.abs(ar.y - br.y).toFixed(1)} layout=${ay},${by} x=${ar.x.toFixed(1)},${br.x.toFixed(1)} h=${ar.height.toFixed(1)}`;
  }, [upper, lower] as [string, string]);
}

async function expectAbove(page: Page, upper: string, lower: string): Promise<void> {
  await expect.poll(async () => {
    const placed = await centers(page);
    const top = placed[upper];
    const bottom = placed[lower];
    if (top === undefined || bottom === undefined) return 'missing';
    if (top.y + top.h < bottom.y) return 'ok';
    return await placement(page, upper, lower);
  }, { timeout: 8000 }).toBe('ok');
}

async function expectSideBySide(page: Page, left: string, right: string): Promise<void> {
  await expect.poll(async () => {
    const placed = await centers(page);
    const a = placed[left];
    const b = placed[right];
    if (a === undefined || b === undefined) return 'missing';
    if (Math.abs(a.y - b.y) < 12 && a.x < b.x) return 'ok';
    return await placement(page, left, right);
  }, { timeout: 8000 }).toBe('ok');
}

async function mustBox(page: Page, name: string): Promise<PxBox> {
  return laidOut(box(page, name));
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

async function dragBoxTo(page: Page, boxName: string, target: Locator): Promise<void> {
  await bringIntoView(page, boxName);
  const start = await namePoint(page, boxName);
  const targetRect = await target.boundingBox();
  expect(targetRect).not.toBeNull();
  const destX = targetRect!.x + targetRect!.width / 2;
  const destY = targetRect!.y + targetRect!.height / 2;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(destX, destY, { steps: 25 });
  } finally {
    await page.mouse.up();
  }
}

async function dragRowToBox(page: Page, rowPath: string, targetBoxName: string): Promise<void> {
  const rowLocator = page.locator(`.box-row[data-path="${rowPath}"]`);
  const targetLocator = box(page, targetBoxName);
  const src = await rowLocator.elementHandle();
  const tgt = await targetLocator.elementHandle();
  expect(src).not.toBeNull();
  expect(tgt).not.toBeNull();
  await page.evaluate(
    ([sourceEl, targetEl, mime, pathStr]) => {
      const dt = new DataTransfer();
      dt.setData(mime, pathStr);
      sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    [src!, tgt!, 'text/x-bindweed-file', rowPath] as const,
  );
}

async function drawDependency(page: Page, fromName: string, toName: string): Promise<void> {
  await bringIntoView(page, fromName);
  const handle = box(page, fromName).locator('[aria-label="Draw dependency"]');
  const handleRect = await handle.boundingBox();
  expect(handleRect).not.toBeNull();
  const startX = handleRect!.x + handleRect!.width / 2;
  const startY = handleRect!.y + handleRect!.height / 2;

  await bringIntoView(page, toName);
  const targetHandle = box(page, toName).locator('.react-flow__handle-top');
  const targetRect = await targetHandle.boundingBox();
  expect(targetRect).not.toBeNull();
  const targetX = targetRect!.x + targetRect!.width / 2;
  const targetY = targetRect!.y + targetRect!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    await page.mouse.move(targetX, targetY, { steps: 20 });
  } finally {
    await page.mouse.up();
  }

  if (fromName === toName) {
    await page.evaluate(({ fromId }) => {
      const flowEl = document.querySelector('.react-flow');
      if (!flowEl) return;
      const key = Object.keys(flowEl).find((k) => k.startsWith('__reactFiber$'));
      if (!key) return;
      let fiber = (flowEl as unknown as Record<string, unknown>)[key] as {
        memoizedProps?: { onConnect?: (c: unknown) => void };
        return?: unknown;
      };
      while (fiber) {
        if (typeof fiber.memoizedProps?.onConnect === 'function') {
          fiber.memoizedProps.onConnect({ source: fromId, target: fromId });
          return;
        }
        fiber = fiber.return as typeof fiber;
      }
    }, { fromId: `src/${fromName}` });
  }
}

async function centerOn(page: Page, getTarget: () => Promise<{ x: number; y: number }>): Promise<void> {
  const canvasBox = await page.locator('.arch-canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  const midCanvas = { x: canvasBox!.x + canvasBox!.width / 2, y: canvasBox!.y + canvasBox!.height / 2 };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pt = await getTarget();
    const dx = midCanvas.x - pt.x;
    const dy = midCanvas.y - pt.y;
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15) return;
    await panCanvas(page, dx, dy);
  }
}

function expectRoutes(): void {
  const text = fs.readFileSync(path.join(BW, 'README.md'), 'utf8');
  const start = text.indexOf('## Routes');
  const end = text.indexOf('## Environment');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const section = text.slice(start, end + '## Environment'.length);
  for (const route of LIVE_ROUTES) expect(section).toContain(`| \`${route}\` | live |`);
}

function detailsSection(page: Page, title: string): Locator {
  return page.locator('aside[aria-label="details"] section').filter({ has: page.locator('h3', { hasText: exactName(title) }) });
}

test('qa: plan moves and edges', async ({ page }) => {
  test.setTimeout(300_000);
  ensureUiBuilt(BW);

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  writeFixture(layered);
  commitFixture(layered);

  let active: ChildProcess | null = null;

  try {
    const server = spawnServer(layered);
    active = server;

    const lines = await waitForLines(server, 2);
    const tokenMatch = lines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:5000\/\?token=([0-9a-f]{32})$/);
    expect(tokenMatch).not.toBeNull();
    const token1 = tokenMatch?.[1] ?? '';
    expect(lines[1]).toBe(`serving ${layered}`);
    let token = token1;
    const head = execSync('git rev-parse HEAD', { cwd: layered, encoding: 'utf8' }).trim();

    await test.step('step 2: initial api check and git status', async () => {
      const plansRes = await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) });
      expect(plansRes.status).toBe(200);
      expect(JSON.parse(plansRes.body)).toEqual({ plans: [] });

      const graphRes = await requestHttp(`${ORIGIN}/api/graph?at=src`, { headers: bearer(token) });
      expect(graphRes.status).toBe(200);
      const graph = JSON.parse(graphRes.body) as {
        nodes: { id: string; files: number; abstract?: boolean }[];
        planned?: unknown;
      };
      expect(graph).not.toHaveProperty('planned');
      const appNode = graph.nodes.find((n) => n.id === 'src/app');
      expect(appNode?.files).toBe(3);
      const infraNode = graph.nodes.find((n) => n.id === 'src/infra');
      expect(infraNode?.files).toBe(2);
      const domainNode = graph.nodes.find((n) => n.id === 'src/domain');
      expect(domainNode?.files).toBe(2);
      expect(domainNode?.abstract).toBe(true);

      const status = execSync('git status --porcelain', { cwd: layered, encoding: 'utf8' });
      expect(status).toBe('');
    });

    await test.step('step 3: route validation matrix', async () => {
      const postBad = await requestHttp(`${ORIGIN}/api/plans`, {
        method: 'POST',
        headers: bearer(token),
        body: 'not json',
      });
      expect(postBad.status).toBe(400);
      expect(postBad.body).toBe('{"error":"bad name"}');

      const postPunct = await requestHttp(`${ORIGIN}/api/plans`, {
        method: 'POST',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: '{"name":"!!!"}',
      });
      expect(postPunct.status).toBe(400);
      expect(postPunct.body).toBe('{"error":"bad name"}');

      const noToken = await requestHttp(`${ORIGIN}/api/plans`);
      expect(noToken.status).toBe(401);
      expect(noToken.body).toBe('{"error":"missing or wrong token"}');

      const noPlan = await requestHttp(`${ORIGIN}/api/plans/nope`, { headers: bearer(token) });
      expect(noPlan.status).toBe(404);
      expect(noPlan.body).toBe('{"error":"no such plan"}');

      const treeRes = await requestHttp(`${ORIGIN}/api/tree`, { headers: bearer(token) });
      expect(treeRes.status).toBe(200);
      const tree = JSON.parse(treeRes.body) as { entries: { name: string }[] };
      expect(tree.entries.map((e) => e.name)).toEqual(['notes', 'src', 'tsconfig.json']);

      const fileRes = await requestHttp(`${ORIGIN}/api/file?path=src/app/save.ts`, { headers: bearer(token) });
      expect(fileRes.status).toBe(200);
      expect(fileRes.body).toBe('{"path":"src/app/save.ts","text":"export const save = 1;\\n"}');

      const status = execSync('git status --porcelain', { cwd: layered, encoding: 'utf8' });
      expect(status).toBe('');

      const plansDir = path.join(layered, '.bindweed', 'plans');
      const count = fs.existsSync(plansDir) ? fs.readdirSync(plansDir).filter((f) => fs.statSync(path.join(plansDir, f)).isFile()).length : 0;
      expect(count).toBe(0);
    });

    await test.step('step 4: open canvas without plan', async () => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(`${ORIGIN}/?token=${token}#at=src`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);

      const planSelect = page.getByRole('combobox', { name: 'Plan' });
      await expect(planSelect).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Delete plan' })).toBeDisabled();
      await expect(page.getByRole('radiogroup', { name: 'Shown graph' })).toHaveCount(0);
      await expect(page.locator('aside[aria-label="changes"]')).toHaveCount(0);
      await expect(page.locator('.box-row')).toHaveCount(0);

      await expectBoxContains(page, 'app', '3 files');
      await expectBoxContains(page, 'infra', '2 files');
      await expectBoxContains(page, 'domain', '2 files');
      await expect(box(page, 'domain')).toHaveAttribute('data-abstract', 'true');
      expect(await box(page, 'domain').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GREEN_BG);

      await expect(page.locator('.box[data-cycle="true"]')).toHaveCount(0);
      await expect(page.locator('g.arrow[data-cycle="true"]')).toHaveCount(0);
    });

    await test.step('step 5: drag domain above app and reset layout', async () => {
      await dragWholeBoxAbove(page, 'domain', 'app');
      await expectAbove(page, 'domain', 'app');

      await page.getByRole('button', { name: 'Reset layout' }).click();
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      await expectAbove(page, 'app', 'infra');
      await expectAbove(page, 'infra', 'domain');

      const plansRes = await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) });
      expect(JSON.parse(plansRes.body)).toEqual({ plans: [] });
    });

    await test.step('step 6: new plan dialog interactions', async () => {
      await page.getByRole('button', { name: 'New plan…' }).click();
      const dialog = page.getByRole('dialog', { name: 'New plan' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);

      let plansRes = await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) });
      expect(JSON.parse(plansRes.body)).toEqual({ plans: [] });

      await page.getByRole('button', { name: 'New plan…' }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page.locator('.plan-dialog-error')).toHaveText('write a name');

      plansRes = await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) });
      expect(JSON.parse(plansRes.body)).toEqual({ plans: [] });

      await dialog.getByRole('textbox', { name: 'Name' }).fill('Split app');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(dialog).toHaveCount(0);

      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await expect(page.getByRole('combobox', { name: 'Plan' })).toHaveValue('split-app');
      await expect(page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Planned')).toBeChecked();
      await expect(page.locator('aside[aria-label="changes"] ol li')).toHaveCount(0);
      await expect(box(page, 'app').locator('.box-row')).toHaveText(['a.ts', 'b.ts', 'save.ts']);
    });

    await test.step('step 7: verify created plan document', async () => {
      const res = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      expect(res.status).toBe(200);
      const doc = JSON.parse(res.body) as {
        name: string;
        slug: string;
        version: number;
        edits: unknown[];
        redo: unknown[];
        baseCommit: string;
        createdAt: string;
      };
      expect(doc.name).toBe('Split app');
      expect(doc.slug).toBe('split-app');
      expect(doc.version).toBe(1);
      expect(doc.edits).toEqual([]);
      expect(doc.redo).toEqual([]);
      expect(doc.baseCommit).toBe(head);
      expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const status = execSync('git status --porcelain', { cwd: layered, encoding: 'utf8' });
      expect(status).toBe('');
    });

    await test.step('step 8: drag box onto breadcrumbs and undo', async () => {
      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=split-app`);
      await waitForBoxes(page, ['a.ts', 'b.ts', 'save.ts']);

      const srcCrumb = page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ });
      await dragBoxTo(page, 'save.ts', srcCrumb);

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText(['Move src/app/save.ts to src']);

      await changes.getByRole('button', { name: 'Undo' }).click();
      await expect(changes.locator('.change-sentence')).toHaveCount(0);
      await waitForBoxes(page, ['a.ts', 'b.ts', 'save.ts']);

      const rootCrumb = page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^layered$/ });
      await dragBoxTo(page, 'save.ts', rootCrumb);

      await expect(changes.locator('.change-sentence')).toHaveText(['Move src/app/save.ts to .']);
      await changes.locator('.change-sentence').click();

      await expect(page).toHaveURL(`${ORIGIN}/#at=&plan=split-app`);
      await waitForBoxes(page, ['src', 'save.ts']);
      await expect(box(page, 'save.ts')).toHaveAttribute('data-selected', 'true');
      await expectBoxContains(page, 'src', '6 files');

      const planRes = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      const planDoc = JSON.parse(planRes.body) as { edits: { kind: string; file: string; to: string }[] };
      expect(planDoc.edits).toEqual([{ kind: 'move-file', file: 'src/app/save.ts', to: '.' }]);

      const graphRes = await requestHttp(`${ORIGIN}/api/graph?at=&plan=split-app`, { headers: bearer(token) });
      const graphBody = JSON.parse(graphRes.body) as { stale: unknown[] };
      expect(graphBody.stale).toEqual([null]);

      await changes.getByRole('button', { name: 'Undo' }).click();
      await expect(changes.locator('.change-sentence')).toHaveCount(0);

      await doubleClickBox(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      await expect(box(page, 'app').locator('.box-row')).toHaveText(['a.ts', 'b.ts', 'save.ts']);
    });

    await test.step('step 9: drag save.ts row to app then infra', async () => {
      await dragRowToBox(page, 'src/app/save.ts', 'app');
      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveCount(0);

      await dragRowToBox(page, 'src/app/save.ts', 'infra');
      await expect(changes.locator('.change-sentence')).toHaveText(['Move src/app/save.ts to src/infra']);

      await expectBoxContains(page, 'infra', '3 files');
      await expect(box(page, 'infra').locator('.box-row')).toHaveText(['db.ts', 'repo.ts', 'save.ts']);

      await expectBoxContains(page, 'app', '2 files');
      await expect(box(page, 'app').locator('.box-row:not([data-ghost="true"])')).toHaveText(['a.ts', 'b.ts']);
      await expect(box(page, 'app').locator('.box-row[data-ghost="true"]')).toHaveText(['save.ts']);

      expect(fs.existsSync(path.join(layered, 'src/app/save.ts'))).toBe(true);
      expect(fs.existsSync(path.join(layered, 'src/infra/save.ts'))).toBe(false);
    });

    await test.step('step 10: click move entry and view ghost box', async () => {
      const changes = page.locator('aside[aria-label="changes"]');
      await changes.locator('.change-sentence', { hasText: 'Move src/app/save.ts to src/infra' }).click();

      await expect(page).toHaveURL(`${ORIGIN}/#at=src/infra&plan=split-app`);
      await waitForBoxes(page, ['db.ts', 'repo.ts', 'save.ts']);
      await expect(box(page, 'save.ts')).toHaveAttribute('data-selected', 'true');

      const placed = await centers(page);
      expect(placed['save.ts'].x).toBeGreaterThan(placed['db.ts'].x);
      expect(placed['save.ts'].x).toBeGreaterThan(placed['repo.ts'].x);

      await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=split-app`);

      await expect(box(page, 'a.ts')).toBeVisible();
      await expect(box(page, 'b.ts')).toBeVisible();
      const appCenters = await centers(page);
      expect(Math.abs(appCenters['a.ts'].y - appCenters['b.ts'].y)).toBeLessThan(12);
      const appGhosts = page.locator('.box[data-id="src/app/save.ts"][data-ghost="true"]');
      await expect(appGhosts).toHaveCount(1);
      const ghostRect = await appGhosts.boundingBox();
      expect(ghostRect).not.toBeNull();
      expect(ghostRect!.x).toBeGreaterThan(appCenters['b.ts'].x);

      await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
    });

    await test.step('step 11: cut edge app -> domain', async () => {
      await clickArrow(page, 'src/app', 'src/domain');
      await page.keyboard.press('Delete');

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
      ]);

      await expect(arrow(page, 'src/app', 'src/domain')).toHaveCount(0);
      await expect(cutmark(page, 'src/app', 'src/domain')).toHaveCount(1);

      const planRes = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      const planDoc = JSON.parse(planRes.body) as { edits: { kind: string; from?: string; to?: string; files?: string[][] }[] };
      expect(planDoc.edits[1]).toEqual({
        kind: 'cut-edge',
        from: 'src/app',
        to: 'src/domain',
        files: [['src/app/a.ts', 'src/domain/model.ts']],
      });
    });

    await test.step('step 12: draw edge infra -> app creating cycle', async () => {
      await drawDependency(page, 'infra', 'app');

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
      ]);

      await expectSideBySide(page, 'app', 'infra');
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'true');

      await expectAbove(page, 'app', 'domain');
      await expectAbove(page, 'infra', 'domain');
      await expect(box(page, 'domain')).toHaveAttribute('data-abstract', 'true');
      expect(await box(page, 'domain').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GREEN_BG);

      const newEdge = arrow(page, 'src/infra', 'src/app');
      await expect(newEdge).toHaveAttribute('data-cycle', 'true');
      await expect(newEdge).toHaveAttribute('data-line', 'dashed');
      await expect(newEdge.locator('title')).toHaveText('infra → app → infra');

      const appInfra = arrow(page, 'src/app', 'src/infra');
      await expect(appInfra).toHaveAttribute('data-cycle', 'true');
      await expect(appInfra.locator('text.arrow-label')).toHaveText('3');
      await expect(appInfra.locator('title')).toHaveText('app → infra → app');

      await drawDependency(page, 'infra', 'app');
      const notice = page.locator('output[aria-label="notice"]');
      await expect(notice).toHaveText('src/infra already imports src/app');
      await expect(changes.locator('.change-sentence')).toHaveCount(3);

      await drawDependency(page, 'app', 'app');
      await expect(notice).toHaveText('a box cannot depend on itself');
      await expect(changes.locator('.change-sentence')).toHaveCount(3);
    });

    await test.step('step 13: undo and redo with keyboard shortcuts', async () => {
      const spot = await emptyCanvasPoint(page);
      await page.mouse.click(spot.x, spot.y);
      await page.keyboard.press('Control+z');

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
      ]);

      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'false');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'false');
      await expectAbove(page, 'app', 'infra');
      await expectAbove(page, 'infra', 'domain');
      await expect(cutmark(page, 'src/app', 'src/domain')).toHaveCount(1);

      await page.keyboard.press('Control+Shift+z');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'true');
      await expectSideBySide(page, 'app', 'infra');
    });

    await test.step('step 14: delete and cut menu on planned arrow', async () => {
      await clickArrow(page, 'src/infra', 'src/app');
      await page.keyboard.press('Delete');

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'false');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'false');

      let planRes = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      let planDoc = JSON.parse(planRes.body) as { edits: { kind: string; from?: string }[]; redo: unknown[] };
      expect(planDoc.edits).toHaveLength(2);
      expect(planDoc.redo).toEqual([]);
      expect(planDoc.edits.some((e) => e.from === 'src/infra')).toBe(false);

      await drawDependency(page, 'infra', 'app');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');

      await clickArrow(page, 'src/infra', 'src/app');
      await page.locator('.arrow-menu button', { hasText: 'Menu' }).click();
      await page.locator('.arrow-menu span[role="menu"] button', { hasText: 'Cut' }).click();

      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'false');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'false');
      await waitForBoxes(page, ['app', 'infra', 'domain']);

      planRes = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      planDoc = JSON.parse(planRes.body) as { edits: { kind: string }[]; redo: unknown[] };
      expect(planDoc.edits).toHaveLength(2);

      await drawDependency(page, 'infra', 'app');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
    });

    await test.step('step 15: add note to domain and change entry navigation', async () => {
      await clickBox(page, 'domain');
      await box(page, 'domain').locator('.box-menu button', { hasText: 'Menu' }).click();
      await box(page, 'domain').locator('span[role="menu"] button', { hasText: 'Add note' }).click();

      const dialog = page.getByRole('dialog', { name: 'Add note' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Add' }).click();
      await expect(page.locator('.plan-dialog-error')).toHaveText('write a note');

      await dialog.getByRole('textbox', { name: 'Note' }).fill('pull an interface out here');
      await dialog.getByRole('button', { name: 'Add' }).click();
      await expect(dialog).toHaveCount(0);

      const noteMarker = box(page, 'domain').locator('.note-marker');
      await expect(noteMarker).toBeVisible();
      await expect(noteMarker).toHaveAttribute('title', 'pull an interface out here');

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
        'Note on src/domain: "pull an interface out here"',
      ]);

      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=split-app`);

      await changes.locator('.change-sentence', { hasText: 'must not import' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await expect(cutmark(page, 'src/app', 'src/domain')).toHaveAttribute('data-selected', 'true');
      await centerOn(page, async () => {
        const placed = await centers(page);
        const aC = { x: placed['app'].x + placed['app'].w / 2, y: placed['app'].y + placed['app'].h / 2 };
        const dC = { x: placed['domain'].x + placed['domain'].w / 2, y: placed['domain'].y + placed['domain'].h / 2 };
        return { x: (aC.x + dC.x) / 2, y: (aC.y + dC.y) / 2 };
      });

      const canvasBox = await page.locator('.arch-canvas').boundingBox();
      expect(canvasBox).not.toBeNull();
      const midCanvas = { x: canvasBox!.x + canvasBox!.width / 2, y: canvasBox!.y + canvasBox!.height / 2 };

      await expect.poll(async () => {
        const placedNow = await centers(page);
        if (!placedNow['app'] || !placedNow['domain']) return 999;
        const aC = { x: placedNow['app'].x + placedNow['app'].w / 2, y: placedNow['app'].y + placedNow['app'].h / 2 };
        const dC = { x: placedNow['domain'].x + placedNow['domain'].w / 2, y: placedNow['domain'].y + placedNow['domain'].h / 2 };
        const cutH = { x: (aC.x + dC.x) / 2, y: (aC.y + dC.y) / 2 };
        return Math.max(Math.abs(cutH.x - midCanvas.x), Math.abs(cutH.y - midCanvas.y));
      }, { timeout: 3000 }).toBeLessThan(25);

      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=split-app`);

      await changes.locator('.change-sentence', { hasText: 'Note on src/domain' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await clickBox(page, 'domain');
      await expect(box(page, 'domain')).toHaveAttribute('data-selected', 'true');
      await centerOn(page, async () => {
        const placed = await centers(page);
        return { x: placed['domain'].x + placed['domain'].w / 2, y: placed['domain'].y + placed['domain'].h / 2 };
      });

      await expect.poll(async () => {
        const cBox = await page.locator('.arch-canvas').boundingBox();
        if (!cBox) return 999;
        const curMid = { x: cBox.x + cBox.width / 2, y: cBox.y + cBox.height / 2 };
        const placedNow = await centers(page);
        if (!placedNow['domain']) return 999;
        const domCenter = { x: placedNow['domain'].x + placedNow['domain'].w / 2, y: placedNow['domain'].y + placedNow['domain'].h / 2 };
        return Math.max(Math.abs(domCenter.x - curMid.x), Math.abs(domCenter.y - curMid.y));
      }, { timeout: 3000 }).toBeLessThan(25);
    });

    await test.step('step 16: reload page and verify persistence', async () => {
      await page.goto(`${ORIGIN}/?token=${token}#at=src&plan=split-app`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await expect(page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Planned')).toBeChecked();

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
        'Note on src/domain: "pull an interface out here"',
      ]);

      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'app').locator('.box-row[data-ghost="true"]')).toHaveText(['save.ts']);
      await expect(box(page, 'infra').locator('.box-row', { hasText: 'save.ts' })).toBeVisible();
      await expect(cutmark(page, 'src/app', 'src/domain')).toBeVisible();
      await expect(box(page, 'domain').locator('.note-marker')).toHaveAttribute('title', 'pull an interface out here');
    });

    await test.step('step 17: restart bindweed server and verify persistence', async () => {
      const exitCode = await stopChild(server, 'SIGINT');
      active = null;
      expect(exitCode).toBe(0);

      const restarted = spawnServer(layered);
      active = restarted;
      const lines2 = await waitForLines(restarted, 2);
      const match2 = lines2[0].match(/^bindweed: http:\/\/127\.0\.0\.1:5000\/\?token=([0-9a-f]{32})$/);
      expect(match2).not.toBeNull();
      const token2 = match2?.[1] ?? '';
      expect(token2).not.toBe(token1);
      token = token2;

      await page.goto(`${ORIGIN}/?token=${token}#at=src&plan=split-app`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
        'Note on src/domain: "pull an interface out here"',
      ]);
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'app').locator('.box-row[data-ghost="true"]')).toHaveText(['save.ts']);
      await expect(box(page, 'infra').locator('.box-row', { hasText: 'save.ts' })).toBeVisible();
      await expect(cutmark(page, 'src/app', 'src/domain')).toBeVisible();
      await expect(box(page, 'domain').locator('.note-marker')).toHaveAttribute('title', 'pull an interface out here');

      await box(page, 'infra').locator('.box-row', { hasText: 'save.ts' }).dblclick();
      await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('main header')).toHaveText('src/app/save.ts');
      await expect(page.locator('main pre')).toContainText('export const save = 1;');

      await page.getByRole('tab', { name: 'Architecture' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await expect(changes.locator('.change-sentence')).toHaveCount(4);
    });

    await test.step('step 18: now / planned switch and metrics sync', async () => {
      await page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Now').click();

      await expectAbove(page, 'app', 'infra');
      await expectAbove(page, 'infra', 'domain');
      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'false');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'false');
      await expectBoxContains(page, 'app', '3 files');
      await expect(box(page, 'app').locator('.box-row', { hasText: 'save.ts' })).toBeVisible();
      await expect(box(page, 'infra').locator('.box-row[data-ghost="true"]')).toHaveText(['save.ts']);

      await expect(arrow(page, 'src/app', 'src/domain')).toHaveCount(1);
      await expect(cutmark(page, 'src/app', 'src/domain')).toHaveCount(1);

      const blueArrow = arrow(page, 'src/infra', 'src/app');
      await expect(blueArrow).toHaveCount(1);
      await expect(blueArrow).toHaveAttribute('data-cycle', 'false');
      await expect(blueArrow).toHaveAttribute('data-line', 'dashed');
      const strokeColor = await blueArrow.locator('path').first().evaluate((el) => getComputedStyle(el).stroke);
      expect(strokeColor).not.toBe(RED_TEXT);

      await page.getByRole('button', { name: 'Metrics', exact: true }).click();
      const metricsTable = page.locator('aside[aria-label="metrics"]');
      await expect(metricsTable).toBeVisible();

      const metricRowNames = metricsTable.locator('tbody tr td:first-child');
      await expect(metricRowNames).toHaveText(['infra', 'app', 'domain']);

      const appCellsNow = metricsTable.locator('tbody tr:nth-child(2) td');
      await expect(appCellsNow.nth(1)).toHaveText('3');
      const domainCellsNow = metricsTable.locator('tbody tr:nth-child(3) td');
      await expect(domainCellsNow.nth(2)).toHaveText('3');

      await page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Planned').click();
      await expect(metricsTable).toBeVisible();

      const appCellsPlanned = metricsTable.locator('tbody tr:nth-child(2) td');
      await expect(appCellsPlanned.nth(1)).toHaveText('2');
      const infraCellsPlanned = metricsTable.locator('tbody tr:nth-child(1) td');
      await expect(infraCellsPlanned.nth(1)).toHaveText('3');
      const domainCellsPlanned = metricsTable.locator('tbody tr:nth-child(3) td');
      await expect(domainCellsPlanned.nth(2)).toHaveText('2');

      await clickBox(page, 'domain');
      const details = page.locator('aside[aria-label="details"]');
      await expect(details.locator('h2')).toHaveText('domain');
      const importedButtons = detailsSection(page, 'Imported by').locator('button');
      await expect(importedButtons).toHaveCount(1);
      await expect(importedButtons).toHaveText(/^infra\b/);
    });

    await test.step('step 19: rescan stale handling', async () => {
      fs.rmSync(path.join(layered, 'src/app/save.ts'));
      await page.getByRole('button', { name: 'Rescan' }).click();

      const changes = page.locator('aside[aria-label="changes"]');
      const moveItem = changes.locator('li.change', { hasText: 'Move src/app/save.ts to src/infra' });
      await expect(moveItem).toHaveAttribute('data-stale', 'true');
      await expect(moveItem.locator('.change-reason')).toHaveText('no such file src/app/save.ts');

      const otherItems = changes.locator('li.change:not(:has-text("Move src/app/save.ts to src/infra"))');
      const otherCount = await otherItems.count();
      for (let i = 0; i < otherCount; i += 1) {
        await expect(otherItems.nth(i)).not.toHaveAttribute('data-stale', 'true');
      }

      fs.writeFileSync(path.join(layered, 'src/app/save.ts'), 'export const save = 1;\n');
      await page.getByRole('button', { name: 'Rescan' }).click();

      await expect(moveItem).not.toHaveAttribute('data-stale', 'true');
      const status = execSync('git status --porcelain', { cwd: layered, encoding: 'utf8' });
      expect(status).toBe('');
    });

    await test.step('step 20: note on moved file and stale cascading', async () => {
      await doubleClickBox(page, 'infra');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/infra&plan=split-app`);
      await clickBox(page, 'save.ts');

      await box(page, 'save.ts').locator('.box-menu button', { hasText: 'Menu' }).click();
      await box(page, 'save.ts').locator('span[role="menu"] button', { hasText: 'Add note' }).click();

      const dialog = page.getByRole('dialog', { name: 'Add note' });
      await dialog.getByRole('textbox', { name: 'Note' }).fill('keep the writer here');
      await dialog.getByRole('button', { name: 'Add' }).click();

      await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);

      const changes = page.locator('aside[aria-label="changes"]');
      await expect(changes.locator('.change-sentence')).toHaveText([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
        'Note on src/domain: "pull an interface out here"',
        'Note on src/infra/save.ts: "keep the writer here"',
      ]);

      const moveItem = changes.locator('li.change', { hasText: 'Move src/app/save.ts to src/infra' });
      await moveItem.locator('button[aria-label="Remove"]').click();

      await expect(changes.locator('.change-sentence', { hasText: 'Move src/app/save.ts to src/infra' })).toHaveCount(0);
      const staleNote = changes.locator('li.change', { hasText: 'Note on src/infra/save.ts' });
      await expect(staleNote).toHaveAttribute('data-stale', 'true');
      await expect(staleNote.locator('.change-reason')).toHaveText('no such box src/infra/save.ts');

      const nonStale = changes.locator('li.change:not(:has-text("Note on src/infra/save.ts"))');
      const nonStaleCount = await nonStale.count();
      for (let i = 0; i < nonStaleCount; i += 1) {
        await expect(nonStale.nth(i)).not.toHaveAttribute('data-stale', 'true');
      }

      await expect(box(page, 'app')).toHaveAttribute('data-cycle', 'true');
      await expect(box(page, 'infra')).toHaveAttribute('data-cycle', 'true');
    });

    await test.step('step 21: delete open plan', async () => {
      await page.getByRole('button', { name: 'Delete plan' }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete plan' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await expect(page.getByRole('combobox', { name: 'Plan' })).toHaveValue('split-app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);

      await page.getByRole('button', { name: 'Delete plan' }).click();
      await page.getByRole('dialog', { name: 'Delete plan' }).getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByRole('combobox', { name: 'Plan' })).toHaveValue('');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expectBoxContains(page, 'app', '3 files');
      await expect(page.locator('.box-row')).toHaveCount(0);

      const res = await requestHttp(`${ORIGIN}/api/plans/split-app`, { headers: bearer(token) });
      expect(res.status).toBe(404);
      expect(res.body).toBe('{"error":"no such plan"}');
    });

    await test.step('step 22: clash naming and plan selection', async () => {
      await page.getByRole('button', { name: 'New plan…' }).click();
      let dialog = page.getByRole('dialog', { name: 'New plan' });
      await dialog.getByRole('textbox', { name: 'Name' }).fill('Split app');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);

      await page.getByRole('button', { name: 'New plan…' }).click();
      dialog = page.getByRole('dialog', { name: 'New plan' });
      await dialog.getByRole('textbox', { name: 'Name' }).fill('Split app');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app-2`);

      const planSelect = page.getByRole('combobox', { name: 'Plan' });
      const options = planSelect.locator('option');
      await expect(options).toHaveText(['No plan', 'Split app', 'Split app (split-app-2)']);

      await planSelect.selectOption('split-app-2');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app-2`);

      await page.getByRole('button', { name: 'Delete plan' }).click();
      await page.getByRole('dialog', { name: 'Delete plan' }).getByRole('button', { name: 'Delete' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(planSelect).toHaveValue('');

      await planSelect.selectOption('split-app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=split-app`);
      await expect(page.getByRole('button', { name: 'Delete plan' })).toBeEnabled();
      await page.getByRole('button', { name: 'Delete plan' }).click();
      await page.getByRole('dialog', { name: 'Delete plan' }).getByRole('button', { name: 'Delete' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(planSelect).toHaveValue('');
    });

    await test.step('step 23: finish and clean up', async () => {
      if (active !== null) {
        await stopChild(active, 'SIGINT');
        active = null;
      }
      expectRoutes();
      const status = execSync('git status --porcelain', { cwd: layered, encoding: 'utf8' });
      expect(status).toBe('');
      fs.rmSync(QA, { recursive: true, force: true });
    });
  } finally {
    if (active !== null) {
      await stopChild(active, 'SIGKILL');
    }
    if (fs.existsSync(QA)) {
      fs.rmSync(QA, { recursive: true, force: true });
    }
  }
});
