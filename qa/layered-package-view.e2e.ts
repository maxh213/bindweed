import { test, expect, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const BW = process.cwd();
const PORT = 4700;
const ORIGIN = `http://127.0.0.1:${PORT}`;

type BoxRect = { x: number; y: number; w: number; h: number };

type GraphNode = {
  id: string;
  kind: 'package' | 'file';
  name: string;
  path: string;
  files?: number;
  row: number;
  order: number;
  cycle: boolean;
};

type GraphEdge = {
  from: string;
  to: string;
  runtime: number;
  type: number;
  cycle: boolean;
  cycleText?: string;
};

type Graph = {
  at: string;
  crumbs: { name: string; at: string }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const ROOT_GRAPH: Graph = {
  at: '',
  crumbs: [{ name: 'layered', at: '' }],
  nodes: [
    { id: 'src', kind: 'package', name: 'src', path: 'src', files: 4, row: 0, order: 0, cycle: false },
  ],
  edges: [],
};

const SRC_GRAPH: Graph = {
  at: 'src',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
  ],
  nodes: [
    { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
    { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false },
    { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 2, order: 0, cycle: false },
  ],
  edges: [
    { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
    { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
    { from: 'src/infra', to: 'src/domain', runtime: 1, type: 0, cycle: false },
  ],
};

const APP_GRAPH: Graph = {
  at: 'src/app',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
    { name: 'app', at: 'src/app' },
  ],
  nodes: [
    { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true },
    { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
  ],
};

const WORKSPACE_GRAPH: Graph = {
  at: '',
  crumbs: [{ name: 'workspace', at: '' }],
  nodes: [
    { id: 'packages/web', kind: 'package', name: '@acme/web', path: 'packages/web', files: 1, row: 0, order: 0, cycle: false },
    { id: 'packages/core', kind: 'package', name: '@acme/core', path: 'packages/core', files: 1, row: 1, order: 0, cycle: false },
  ],
  edges: [{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }],
};

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
  const e = { ...process.env, ...extra };
  delete e.NO_COLOR;
  return e;
}

function requestHttp(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
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
    req.end();
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function sortedGraph(graph: Graph): Graph {
  return {
    at: graph.at,
    crumbs: graph.crumbs,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`)),
  };
}

function expectGraph(body: string, expected: Graph): void {
  const actual = JSON.parse(body) as Graph;
  expect(sortedGraph(actual)).toEqual(sortedGraph(expected));
}

function expectRescan(body: string, files: number): void {
  const json = JSON.parse(body) as { files: number; ms: number };
  expect(Object.keys(json).sort()).toEqual(['files', 'ms']);
  expect(json.files).toBe(files);
  expect(Number.isFinite(json.ms)).toBe(true);
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function box(page: Page, name: string) {
  return page.locator('.box').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string) {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
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

async function expectAbove(page: Page, upper: string, lower: string): Promise<void> {
  const c = await centers(page);
  expect(c[upper].y).toBeLessThan(c[lower].y - 20);
}

async function crumbText(page: Page): Promise<string> {
  const text = await page.locator('nav[aria-label="breadcrumb"]').evaluate((el) => el.textContent ?? '');
  return text.replace(/\s+/g, ' ').trim();
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
      const c = await centers(page);
      return names.every((name) => (c[name]?.w ?? 0) > 30 && (c[name]?.h ?? 0) > 10);
    })
    .toBe(true);
}

async function expectArrow(page: Page, from: string, to: string, label: string | null, cycle: boolean): Promise<void> {
  const edge = arrow(page, from, to);
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveAttribute('data-cycle', cycle ? 'true' : 'false');
  await expect(page.locator(`g.react-flow__edge[aria-label="Edge from ${from} to ${to}"]`)).toHaveCount(1);
  if (label === null) await expect(edge.locator('text.arrow-label')).toHaveCount(0);
  else await expect(edge.locator('text.arrow-label')).toHaveText(label);
  const stroke = await edge.locator('path').first().evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke).toBe(cycle ? 'rgb(220, 38, 38)' : 'rgb(100, 116, 139)');
}

async function flowScale(page: Page): Promise<number> {
  const transform = await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform);
  const match = /^matrix\(([-0-9.eE]+)/.exec(transform);
  if (match === null) throw new Error(`viewport transform ${transform}`);
  return Number(match[1]);
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
        const blocked = blockers.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        if (!blocked) return { x, y };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  return point as { x: number; y: number };
}

function expectMovedTogether(before: Record<string, BoxRect>, after: Record<string, BoxRect>, names: string[]): void {
  const deltas = names.map((name) => ({
    dx: after[name].x - before[name].x,
    dy: after[name].y - before[name].y,
    dw: after[name].w - before[name].w,
    dh: after[name].h - before[name].h,
  }));
  expect(Math.hypot(deltas[0].dx, deltas[0].dy)).toBeGreaterThan(40);
  for (const delta of deltas) {
    expect(Math.abs(delta.dx - deltas[0].dx)).toBeLessThan(3);
    expect(Math.abs(delta.dy - deltas[0].dy)).toBeLessThan(3);
    expect(Math.abs(delta.dw)).toBeLessThan(2);
    expect(Math.abs(delta.dh)).toBeLessThan(2);
  }
}

function expectScaledTogether(before: Record<string, BoxRect>, after: Record<string, BoxRect>, names: string[]): void {
  const scales = names.map((name) => after[name].w / before[name].w);
  for (const scale of scales) expect(Math.abs(scale - scales[0])).toBeLessThan(0.03);
  expect(Math.abs(scales[0] - 1)).toBeGreaterThan(0.05);
  const beforeDist = Math.hypot(before[names[0]].x - before[names[1]].x, before[names[0]].y - before[names[1]].y);
  const afterDist = Math.hypot(after[names[0]].x - after[names[1]].x, after[names[0]].y - after[names[1]].y);
  expect(afterDist / beforeDist).toBeCloseTo(scales[0], 1);
}

test('qa: layered package view', async ({ page, context }) => {
  test.setTimeout(180_000);

  execSync('flock -w 180 /tmp/bindweed-qa-build.lock npm run build', { cwd: BW, stdio: 'ignore' });

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  const workspace = path.join(QA, 'workspace');
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), layered, { recursive: true });
  fs.cpSync(path.join(BW, 'qa/fixtures/workspace'), workspace, { recursive: true });
  commitFixture(layered);
  commitFixture(workspace);

  let activeChild: ChildProcess | null = null;

  try {
    const bwProcess = spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
      cwd: layered,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeChild = bwProcess;

    const lines = await waitForLines(bwProcess, 2);
    const match = lines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:4700\/\?token=([0-9a-f]{32})$/);
    expect(match).not.toBeNull();
    const token = match?.[1] ?? '';
    expect(lines[1]).toBe(`serving ${layered}`);
    const printedLink = `${ORIGIN}/?token=${token}`;

    const root = await requestHttp(`${ORIGIN}/api/graph`, { headers: bearer(token) });
    expect(root.status).toBe(200);
    expectGraph(root.body, ROOT_GRAPH);
    expect(root.body).not.toContain('notes');
    const emptyAt = await requestHttp(`${ORIGIN}/api/graph?at=`, { headers: bearer(token) });
    expect(emptyAt.status).toBe(200);
    expectGraph(emptyAt.body, ROOT_GRAPH);

    const src = await requestHttp(`${ORIGIN}/api/graph?at=src`, { headers: bearer(token) });
    expect(src.status).toBe(200);
    expectGraph(src.body, SRC_GRAPH);

    const app = await requestHttp(`${ORIGIN}/api/graph?at=src/app`, { headers: bearer(token) });
    expect(app.status).toBe(200);
    expectGraph(app.body, APP_GRAPH);

    const misses: { url: string; method?: string; headers?: Record<string, string>; status: number; body: string }[] = [
      { url: `${ORIGIN}/api/graph?at=notes`, headers: bearer(token), status: 404, body: '{"error":"no such directory"}' },
      { url: `${ORIGIN}/api/graph?at=tsconfig.json`, headers: bearer(token), status: 404, body: '{"error":"no such directory"}' },
      { url: `${ORIGIN}/api/graph?at=..`, headers: bearer(token), status: 404, body: '{"error":"no such directory"}' },
      { url: `${ORIGIN}/api/graph`, status: 401, body: '{"error":"missing or wrong token"}' },
      { url: `${ORIGIN}/api/rescan`, method: 'POST', status: 401, body: '{"error":"missing or wrong token"}' },
      {
        url: `${ORIGIN}/api/graph?token=${token}`,
        headers: { Host: `evil.example:${PORT}` },
        status: 403,
        body: '{"error":"bad host"}',
      },
      { url: `${ORIGIN}/api/rescan`, headers: bearer(token), status: 404, body: '{"error":"not found"}' },
    ];
    for (const miss of misses) {
      const res = await requestHttp(miss.url, { method: miss.method, headers: miss.headers });
      expect(res.status).toBe(miss.status);
      expect(res.body).toBe(miss.body);
    }

    const rescan = await requestHttp(`${ORIGIN}/api/rescan`, { method: 'POST', headers: bearer(token) });
    expect(rescan.status).toBe(200);
    expectRescan(rescan.body, 4);
    expect(fs.readdirSync(path.join(layered, '.bindweed', 'cache'))).toContain('scan.json');

    const tree = await requestHttp(`${ORIGIN}/api/tree`, { headers: bearer(token) });
    expect(tree.status).toBe(200);
    const treeJson = JSON.parse(tree.body) as { entries: { name: string }[] };
    expect(treeJson.entries.map((entry) => entry.name)).toEqual(['notes', 'src', 'tsconfig.json']);
    const file = await requestHttp(`${ORIGIN}/api/file?path=src/domain/model.ts`, { headers: bearer(token) });
    expect(file.status).toBe(200);
    expect(file.body).toBe('{"path":"src/domain/model.ts","text":"export class Model { id = 0; }\\n"}');

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(printedLink);
    await expect(page).toHaveTitle('bindweed — layered');
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole('tab')).toHaveText(['Files', 'Architecture']);
    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('aside nav button')).toHaveText(['layered/', 'notes/', 'src/', 'tsconfig.json']);
    await expect(page.locator('main')).toHaveText('select a file');

    await page.getByRole('tab', { name: 'Architecture' }).click();
    await expect(page.getByRole('tab', { name: 'Architecture' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(`${ORIGIN}/#at=`);
    await waitForBoxes(page, ['src']);
    expect(await boxText(page, 'src')).toBe('src 4 files');
    await expect(page.locator('g.arrow')).toHaveCount(0);
    expect(await page.locator('.box.package').evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none');

    await box(page, 'src').dblclick();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
    await waitForBoxes(page, ['app', 'infra', 'domain']);
    expect(await crumbText(page)).toBe('layered / src');
    expect(await boxText(page, 'app')).toBe('app 2 files');
    expect(await boxText(page, 'infra')).toBe('infra 1 file');
    expect(await boxText(page, 'domain')).toBe('domain 1 file');
    await expectAbove(page, 'app', 'infra');
    await expectAbove(page, 'infra', 'domain');
    await expectArrow(page, 'src/app', 'src/infra', '2', false);
    await expectArrow(page, 'src/app', 'src/domain', null, false);
    await expectArrow(page, 'src/infra', 'src/domain', null, false);
    await expect(page.locator('[data-cycle="true"]')).toHaveCount(0);

    const layerNames = ['app', 'infra', 'domain'];
    const beforePan = await centers(page);
    const panFrom = await emptyCanvasPoint(page);
    await page.mouse.move(panFrom.x, panFrom.y);
    await page.mouse.down();
    await page.mouse.move(panFrom.x + 140, panFrom.y + 90, { steps: 12 });
    await page.mouse.up();
    const afterPan = await centers(page);
    expectMovedTogether(beforePan, afterPan, layerNames);

    const beforeZoom = await centers(page);
    const scaleBefore = await flowScale(page);
    await page.mouse.move(panFrom.x, panFrom.y);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => flowScale(page)).toBeLessThan(scaleBefore - 0.05);
    const zoomedOut = await centers(page);
    expectScaledTogether(beforeZoom, zoomedOut, layerNames);
    const scaleOut = await flowScale(page);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => flowScale(page)).toBeGreaterThan(scaleOut + 0.05);
    const zoomedIn = await centers(page);
    expectScaledTogether(zoomedOut, zoomedIn, layerNames);

    const beforeDrag = await centers(page);
    const appBox = await box(page, 'app').boundingBox();
    expect(appBox).not.toBeNull();
    const held = appBox as { x: number; y: number; width: number; height: number };
    await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
    await page.mouse.down();
    await page.mouse.move(held.x + held.width / 2 + 160, held.y + held.height / 2 + 110, { steps: 10 });
    await page.mouse.up();
    const afterDrag = await centers(page);
    for (const name of layerNames) {
      expect(Math.abs(afterDrag[name].x - beforeDrag[name].x)).toBeLessThan(2);
      expect(Math.abs(afterDrag[name].y - beforeDrag[name].y)).toBeLessThan(2);
    }

    await box(page, 'app').dblclick();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src/app`);
    await waitForBoxes(page, ['a.ts', 'b.ts']);
    expect(await crumbText(page)).toBe('layered / src / app');
    const placed = await centers(page);
    expect(Math.abs(placed['a.ts'].y - placed['b.ts'].y)).toBeLessThan(8);
    expect(placed['a.ts'].x).toBeLessThan(placed['b.ts'].x - 20);
    await expect(box(page, 'a.ts')).toHaveAttribute('data-cycle', 'true');
    await expect(box(page, 'b.ts')).toHaveAttribute('data-cycle', 'true');
    expect(await box(page, 'a.ts').evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(220, 38, 38)');
    expect(await box(page, 'b.ts').evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(220, 38, 38)');
    expect(await box(page, 'a.ts').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
    await expectArrow(page, 'src/app/a.ts', 'src/app/b.ts', null, true);
    await expectArrow(page, 'src/app/b.ts', 'src/app/a.ts', null, true);
    await expect(page.locator('.box')).toHaveCount(2);
    await expect(page.locator('g.arrow')).toHaveCount(2);
    await arrow(page, 'src/app/a.ts', 'src/app/b.ts').hover({ force: true });
    await expect(arrow(page, 'src/app/a.ts', 'src/app/b.ts').locator('title')).toHaveText('a.ts → b.ts → a.ts');
    await arrow(page, 'src/app/b.ts', 'src/app/a.ts').hover({ force: true });
    await expect(arrow(page, 'src/app/b.ts', 'src/app/a.ts').locator('title')).toHaveText('b.ts → a.ts → b.ts');

    await page.goBack();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
    await waitForBoxes(page, ['app', 'infra', 'domain']);
    await page.goBack();
    await expect(page).toHaveURL(`${ORIGIN}/#at=`);
    await waitForBoxes(page, ['src']);

    await box(page, 'src').dblclick();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
    await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^layered$/ }).click();
    await expect(page).toHaveURL(`${ORIGIN}/#at=`);
    await waitForBoxes(page, ['src']);
    await box(page, 'src').dblclick();
    await waitForBoxes(page, ['app', 'infra', 'domain']);
    await box(page, 'domain').dblclick();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src/domain`);
    await waitForBoxes(page, ['model.ts']);
    await box(page, 'model.ts').dblclick();
    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('main header')).toHaveText('src/domain/model.ts');
    await expect(page.locator('main pre div[data-line]')).toHaveText(['1 export class Model { id = 0; }']);
    await expect(page.locator('aside nav button', { hasText: /^model\.ts$/ })).toHaveAttribute('aria-current', 'true');
    await expect(page).toHaveURL(`${ORIGIN}/#file=src/domain/model.ts`);

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1400, height: 900 });
    await tab.goto(`${ORIGIN}/?token=${token}#at=src/app`);
    await expect(tab.getByRole('tab', { name: 'Architecture' })).toHaveAttribute('aria-selected', 'true');
    await waitForBoxes(tab, ['a.ts', 'b.ts']);
    await expect(box(tab, 'a.ts')).toHaveAttribute('data-cycle', 'true');
    await expect(box(tab, 'b.ts')).toHaveAttribute('data-cycle', 'true');
    expect(await crumbText(tab)).toBe('layered / src / app');
    await expect(tab).toHaveURL(`${ORIGIN}/#at=src/app`);

    fs.writeFileSync(path.join(layered, 'src/main.ts'), "import { a } from './app/a';\n");
    await page.getByRole('tab', { name: 'Architecture' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src/domain`);
    await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
    await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
    await page.getByRole('button', { name: 'Rescan' }).click();
    await expect(box(page, 'main.ts')).toBeVisible({ timeout: 15_000 });
    await waitForBoxes(page, ['main.ts', 'app', 'infra', 'domain']);
    await expectAbove(page, 'main.ts', 'app');
    await expectArrow(page, 'src/main.ts', 'src/app', null, false);
    await expectArrow(page, 'src/app', 'src/infra', '2', false);
    await expectArrow(page, 'src/app', 'src/domain', null, false);
    await expectArrow(page, 'src/infra', 'src/domain', null, false);

    fs.writeFileSync(path.join(layered, 'src/app/a.test.ts'), "import { a } from './a';\n");
    const testRescan = await requestHttp(`${ORIGIN}/api/rescan`, { method: 'POST', headers: bearer(token) });
    expect(testRescan.status).toBe(200);
    expectRescan(testRescan.body, 6);
    const appRefresh = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === '/api/graph' && url.searchParams.get('at') === 'src/app' && res.request().method() === 'GET';
    });
    await box(page, 'app').dblclick();
    const appBody = (await (await appRefresh).json()) as Graph;
    expect(appBody.nodes.map((node) => node.name).sort()).toEqual(['a.ts', 'b.ts']);
    expect(appBody.edges).toHaveLength(2);
    await waitForBoxes(page, ['a.ts', 'b.ts']);
    await expect(page.locator('.box-name', { hasText: 'a.test.ts' })).toHaveCount(0);
    await expect(page.locator('g.arrow')).toHaveCount(2);
    await expect(box(page, 'a.ts')).toHaveAttribute('data-cycle', 'true');
    await expect(box(page, 'b.ts')).toHaveAttribute('data-cycle', 'true');

    fs.writeFileSync(
      path.join(layered, 'src/infra/env.ts'),
      "import { readFileSync } from 'node:fs';\nexport const rf = readFileSync;\n",
    );
    const externalRescan = await requestHttp(`${ORIGIN}/api/rescan`, { method: 'POST', headers: bearer(token) });
    expect(externalRescan.status).toBe(200);
    expectRescan(externalRescan.body, 7);
    const srcRefresh = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === '/api/graph' && url.searchParams.get('at') === 'src' && res.request().method() === 'GET';
    });
    await page.locator('nav[aria-label="breadcrumb"] button', { hasText: /^src$/ }).click();
    const srcBody = (await (await srcRefresh).json()) as Graph;
    expect(srcBody.nodes.map((node) => node.name).sort()).toEqual(['app', 'domain', 'infra', 'main.ts']);
    expect(srcBody.edges).toHaveLength(4);
    expect(JSON.stringify(srcBody)).not.toContain('node:fs');
    await waitForBoxes(page, ['main.ts', 'app', 'infra', 'domain']);
    await expect(page.locator('.arch-canvas')).not.toContainText('node:fs');
    await expect(page.locator('g.arrow')).toHaveCount(4);
    await expectArrow(page, 'src/main.ts', 'src/app', null, false);
    await expectArrow(page, 'src/app', 'src/infra', '2', false);
    await expectArrow(page, 'src/app', 'src/domain', null, false);
    await expectArrow(page, 'src/infra', 'src/domain', null, false);

    await tab.close();
    const stopped = await stopChild(bwProcess, 'SIGINT');
    activeChild = null;
    expect(stopped).toBe(0);

    const workspaceProcess = spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
      cwd: workspace,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeChild = workspaceProcess;
    const workspaceLines = await waitForLines(workspaceProcess, 2);
    const workspaceMatch = workspaceLines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:4700\/\?token=([0-9a-f]{32})$/);
    expect(workspaceMatch).not.toBeNull();
    const workspaceToken = workspaceMatch?.[1] ?? '';
    expect(workspaceLines[1]).toBe(`serving ${workspace}`);
    const workspaceGraph = await requestHttp(`${ORIGIN}/api/graph`, { headers: bearer(workspaceToken) });
    expect(workspaceGraph.status).toBe(200);
    expectGraph(workspaceGraph.body, WORKSPACE_GRAPH);

    await page.goto(`${ORIGIN}/?token=${workspaceToken}`);
    await page.getByRole('tab', { name: 'Architecture' }).click();
    await waitForBoxes(page, ['@acme/web', '@acme/core']);
    await expectAbove(page, '@acme/web', '@acme/core');
    await expectArrow(page, 'packages/web', 'packages/core', null, false);
    expect(await crumbText(page)).toBe('workspace');

    await stopChild(workspaceProcess, 'SIGINT');
    activeChild = null;

    const readmeLines = fs
      .readFileSync(path.join(BW, 'README.md'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('/api/graph') || line.includes('/api/rescan'));
    expect(readmeLines).toEqual(['| `/api/graph` | live |', '| `/api/rescan` | live |']);
  } finally {
    if (activeChild) await stopChild(activeChild, 'SIGKILL');
    fs.rmSync(QA, { recursive: true, force: true });
  }
});
