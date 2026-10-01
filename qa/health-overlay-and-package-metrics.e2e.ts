import { test, expect, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const BW = process.cwd();
const PORT = 4900;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DASH = '\u2013';
const PALE = {
  green: 'rgb(220, 252, 231)',
  amber: 'rgb(254, 243, 199)',
  red: 'rgb(254, 226, 226)',
};
const COVERAGE_HINT = 'no coverage data: run marestail gate';
const MUTATION_HINT = 'no mutation report: run marestail gate --tier full';
const HOT_BAD = 'bad \u00b7 line 1 \u00b7 cc 6 \u00b7 coverage 0.00';
const HEADERS = ['Name', 'Files', 'Ca', 'Ce', 'I', 'A', 'D', 'Zone', 'CRAP', 'Coverage', 'Mutants'];
const LIVE_ROUTES = ['/', '/assets/', '/api/tree', '/api/file', '/api/graph', '/api/rescan', '/api/layout', '/api/detail'];
const COVERAGE_JSON =
  '{"src/green.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}}},"s":{"0":1,"1":1,"2":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/amber.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":1,"1":0,"2":1,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/red.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":0,"1":0,"2":0,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/plain.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/clean.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}}}\n';
const MUTATION_JSON =
  '{"files":{"src/plain.ts":{"mutants":[{"status":"Survived"},{"status":"NoCoverage"},{"status":"Survived"}]},"src/clean.ts":{"mutants":[{"status":"Killed"},{"status":"Timeout"}]},"src/green.ts":{"mutants":[{"status":"Killed"}]}}}\n';

type Json = Record<string, unknown>;
type Level = 'green' | 'amber' | 'red';

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

function requestHttp(urlStr: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout GET ${urlStr}`)));
    req.on('error', reject);
    req.end();
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

function writeReports(dir: string): void {
  writeTree(dir, {
    '.marestail/ts-coverage/coverage-final.json': COVERAGE_JSON,
    'reports/mutation/mutation.json': MUTATION_JSON,
  });
}

function writeLayered(dir: string): void {
  writeTree(dir, {
    'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}\n',
    'notes/readme.md': '# notes\n',
    'src/app/a.ts':
      "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n",
    'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
    'src/app/a.test.ts': "import { a } from './a';\n",
    'src/domain/model.ts': 'export interface Model { id: number }\n',
    'src/domain/shape.ts': 'export interface Shape { draw(): void }\n',
    'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
    'src/infra/repo.ts':
      "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n",
  });
}

function writeZones(dir: string): void {
  writeTree(dir, {
    'src/pain/a.ts': 'export const a = 1;\n',
    'src/use/b.ts': 'export interface B { n: number }\n',
    'src/use/c.ts': "import type { B } from './b';\nimport type { D } from '../mid/d';\nexport type C = B | D;\n",
    'src/mid/d.ts': "import { a } from '../pain/a';\nexport const d = a;\nexport type D = typeof a;\n",
  });
}

function touch(file: string): void {
  const now = new Date();
  fs.utimesSync(file, now, now);
}

function spawnServer(cwd: string): ChildProcess {
  return spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
    cwd,
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function readToken(child: ChildProcess, cwd: string): Promise<string> {
  const lines = await waitForLines(child, 2);
  const match = lines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:4900\/\?token=([0-9a-f]{32})$/);
  expect(match).not.toBeNull();
  expect(lines[1]).toBe(`serving ${cwd}`);
  return match?.[1] ?? '';
}

async function getJson(token: string, pathName: string): Promise<Json> {
  const res = await requestHttp(`${ORIGIN}${pathName}`, bearer(token));
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as Json;
}

function nodesOf(body: Json): Json[] {
  return body.nodes as Json[];
}

function nodeNamed(body: Json, name: string): Json {
  const found = nodesOf(body).find((node) => node.name === name);
  expect(found).toBeDefined();
  return found as Json;
}

function expectMartin(node: Json, ca: number, ce: number, i: string, a: string, d: string, zone?: string): void {
  expect(node.ca).toBe(ca);
  expect(node.ce).toBe(ce);
  expect(node.i).toBe(i);
  expect(node.a).toBe(a);
  expect(node.d).toBe(d);
  if (zone === undefined) expect(node).not.toHaveProperty('zone');
  else expect(node.zone).toBe(zone);
}

function expectHealth(node: Json, crap: number | 'absent', coverage: string | 'absent', mutants: number | 'absent'): void {
  if (crap === 'absent') expect(node).not.toHaveProperty('crap');
  else expect(node.crap).toBe(crap);
  if (coverage === 'absent') expect(node).not.toHaveProperty('coverage');
  else expect(node.coverage).toBe(coverage);
  if (mutants === 'absent') expect(node).not.toHaveProperty('mutants');
  else expect(node.mutants).toBe(mutants);
}

function box(page: Page, name: string) {
  return page.locator('.box').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

async function waitForBoxes(page: Page, names: string[]): Promise<void> {
  await expect(page.locator('.box-name')).toHaveCount(names.length);
  for (const name of names) await expect(box(page, name)).toBeVisible();
}

async function openArch(page: Page, token: string, hash: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${ORIGIN}/?token=${token}${hash}`);
  await expect(page).toHaveURL(`${ORIGIN}/${hash}`);
  await expect(page.getByRole('tab', { name: 'Architecture' })).toHaveAttribute('aria-selected', 'true');
}

function overlay(page: Page) {
  return page.getByRole('combobox', { name: 'Overlay' });
}

async function chooseOverlay(page: Page, label: string): Promise<void> {
  const select = overlay(page);
  const option = select.locator('option', { hasText: exactName(label) });
  const value = await option.getAttribute('value');
  expect(value).not.toBeNull();
  if ((await select.inputValue()) === value) return;
  const saved = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/layout' && res.request().method() === 'PUT');
  await select.selectOption({ label });
  expect((await saved).ok()).toBe(true);
}

async function expectBadge(page: Page, name: string, text: string, level: Level | null): Promise<void> {
  const badge = box(page, name).locator('.box-badge');
  await expect(badge).toHaveText(text);
  const color = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (level === null) {
    await expect(badge).not.toHaveAttribute('data-health');
    expect(color === 'rgba(0, 0, 0, 0)' || color === 'transparent').toBe(true);
    return;
  }
  await expect(badge).toHaveAttribute('data-health', level);
  expect(color).toBe(PALE[level]);
}

async function expectStale(page: Page, shown: boolean): Promise<void> {
  const badge = page.locator('.overlay-box [aria-label="stale"]');
  if (shown) await expect(badge).toHaveText('stale');
  else await expect(badge).toHaveCount(0);
}

async function metricCells(page: Page): Promise<string[][]> {
  const rows = page.locator('aside[aria-label="metrics"] tbody tr');
  const count = await rows.count();
  const out: string[][] = [];
  for (let i = 0; i < count; i += 1) out.push(await rows.nth(i).locator('td').allTextContents());
  return out;
}

function metricRow(
  name: string,
  files: number,
  ca: number,
  ce: number,
  i: string,
  a: string,
  d: string,
  zone: string,
  crap: string,
  coverage: string,
  mutants: string,
): string[] {
  return [name, String(files), String(ca), String(ce), i, a, d, zone, crap, coverage, mutants];
}

async function openMetrics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Metrics', exact: true }).click();
  await expect(page.locator('aside[aria-label="metrics"]')).toBeVisible();
  await expect(page.locator('aside[aria-label="metrics"] thead th')).toHaveText(HEADERS);
}

async function clickRow(page: Page, name: string): Promise<void> {
  await page
    .locator('aside[aria-label="metrics"] tbody tr')
    .filter({ has: page.locator('td', { hasText: exactName(name) }) })
    .click();
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

test('qa: health overlay and package metrics', async ({ page }) => {
  test.setTimeout(300_000);
  execSync('flock -w 180 /tmp/bindweed-qa-build.lock npm run build', { cwd: BW, stdio: 'ignore' });

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const healthy = path.join(QA, 'healthy');
  const layered = path.join(QA, 'layered');
  const zones = path.join(QA, 'zones');
  fs.cpSync(path.join(BW, 'qa/fixtures/healthy'), healthy, { recursive: true });
  writeReports(healthy);
  commitFixture(healthy);

  let active: ChildProcess | null = null;
  try {
    await test.step('the healthy server prints its link', async () => {
      active = spawnServer(healthy);
      const token = await readToken(active, healthy);

      await test.step('src reports CRAP, coverage and mutants for every file', async () => {
        const body = await getJson(token, '/api/graph?at=src');
        expect(body.coverage).toBe('on');
        expect(body.mutation).toBe('on');
        expect(body.crapMax).toBe(4);
        expect(nodesOf(body).map((node) => node.name).sort()).toEqual(['amber.ts', 'clean.ts', 'green.ts', 'plain.ts', 'red.ts']);
        expect(nodesOf(body).every((node) => node.kind === 'file')).toBe(true);
        expectHealth(nodeNamed(body, 'green.ts'), 3, '1.00', 0);
        expectHealth(nodeNamed(body, 'amber.ts'), 6, '0.50', 0);
        expectHealth(nodeNamed(body, 'red.ts'), 42, '0.00', 0);
        expectHealth(nodeNamed(body, 'plain.ts'), 'absent', '1.00', 3);
        expectHealth(nodeNamed(body, 'clean.ts'), 'absent', '1.00', 0);
        for (const name of ['green.ts', 'amber.ts', 'red.ts', 'plain.ts', 'clean.ts']) {
          expectMartin(nodeNamed(body, name), 0, 0, DASH, '0.00', DASH);
        }
      });

      await test.step('the root package and the red file carry the worst numbers', async () => {
        const root = await getJson(token, '/api/graph');
        expect(nodesOf(root)).toHaveLength(1);
        const src = nodeNamed(root, 'src');
        expect(src.files).toBe(5);
        expectHealth(src, 42, '0.54', 3);
        expectMartin(src, 0, 0, DASH, '0.00', DASH);
        const red = await getJson(token, '/api/detail?id=src/red.ts&at=src');
        expectHealth(red, 42, '0.00', 0);
        expect(red.hot).toEqual([{ name: 'bad', line: 1, cc: 6, coverage: '0.00', crap: 42 }]);
        const green = await getJson(token, '/api/detail?id=src/green.ts&at=src');
        expect(green.crap).toBe(3);
        expect(green.hot).toEqual([]);
        const pkg = await getJson(token, '/api/detail?id=src&at=');
        expect(pkg.files).toBe(5);
        expectHealth(pkg, 42, '0.54', 3);
        expect(pkg).not.toHaveProperty('hot');
      });

      await test.step('None shows the five files and no health badge', async () => {
        await openArch(page, token, '#at=src');
        await waitForBoxes(page, ['green.ts', 'amber.ts', 'red.ts', 'plain.ts', 'clean.ts']);
        await expect(overlay(page)).toHaveValue('none');
        await expect(overlay(page).locator('option:checked')).toHaveText('None');
        await expect(page.locator('.box-badge')).toHaveCount(0);
      });

      await test.step('CRAP colours 3, 6 and 42 and remembers the choice', async () => {
        await chooseOverlay(page, 'CRAP');
        await expectBadge(page, 'green.ts', '3', 'green');
        await expectBadge(page, 'amber.ts', '6', 'amber');
        await expectBadge(page, 'red.ts', '42', 'red');
        await expectBadge(page, 'plain.ts', DASH, null);
        await expectBadge(page, 'clean.ts', DASH, null);
        const layout = await getJson(token, '/api/layout');
        expect((layout.settings as Json).overlay).toBe('crap');
      });

      await test.step('surviving mutants colours the red 3 and the green zeroes', async () => {
        await chooseOverlay(page, 'Surviving mutants');
        await expectBadge(page, 'plain.ts', '3', 'red');
        await expectBadge(page, 'clean.ts', '0', 'green');
        await expectBadge(page, 'green.ts', '0', 'green');
        await expectBadge(page, 'amber.ts', '0', 'green');
        await expectBadge(page, 'red.ts', '0', 'green');
      });

      await test.step('coverage colours the ratios and the red file lists bad', async () => {
        await chooseOverlay(page, 'Coverage');
        await expectBadge(page, 'green.ts', '1.00', 'green');
        await expectBadge(page, 'amber.ts', '0.50', 'red');
        await expectBadge(page, 'red.ts', '0.00', 'red');
        await box(page, 'red.ts').click();
        const panel = page.locator('aside[aria-label="details"]');
        await expect(panel.locator('h2')).toHaveText('red.ts');
        await expect(panel).toContainText('CRAP 42');
        await expect(panel).toContainText('Coverage 0.00');
        await expect(panel).toContainText('Mutants 0');
        await expect(panel.locator('li[data-hot]')).toHaveCount(1);
        await expect(panel.locator('li[data-hot]')).toHaveText(HOT_BAD);
      });

      await test.step('the root Metrics row shows the real health numbers', async () => {
        await openArch(page, token, '#at=');
        await waitForBoxes(page, ['src']);
        await openMetrics(page);
        await expect(page.getByRole('columnheader', { name: 'D', exact: true })).toHaveAttribute('aria-sort', 'descending');
        await expect.poll(() => metricCells(page)).toEqual([metricRow('src', 5, 0, 0, DASH, '0.00', DASH, DASH, '42', '0.54', '3')]);
      });

      await test.step('a newer source is stale until a reload re-reads the reports', async () => {
        touch(path.join(healthy, 'src/green.ts'));
        await openArch(page, token, '#at=src');
        await waitForBoxes(page, ['green.ts', 'amber.ts', 'red.ts', 'plain.ts', 'clean.ts']);
        await chooseOverlay(page, 'CRAP');
        await expectStale(page, true);
        await expectBadge(page, 'red.ts', '42', 'red');
        await chooseOverlay(page, 'Surviving mutants');
        await expectStale(page, true);
        touch(path.join(healthy, 'reports/mutation/mutation.json'));
        await chooseOverlay(page, 'CRAP');
        await expectStale(page, true);
        await chooseOverlay(page, 'Surviving mutants');
        await expectStale(page, true);
        await openArch(page, token, '#at=src');
        await waitForBoxes(page, ['green.ts', 'amber.ts', 'red.ts', 'plain.ts', 'clean.ts']);
        await expect(overlay(page)).toHaveValue('mutants');
        await chooseOverlay(page, 'Surviving mutants');
        await expectStale(page, false);
        await chooseOverlay(page, 'Coverage');
        await expectStale(page, true);
        await chooseOverlay(page, 'None');
        await expectStale(page, false);
      });

      expect(await stopChild(active, 'SIGINT')).toBe(0);
      active = null;
    });

    await test.step('a repository with no reports disables the overlays', async () => {
      writeLayered(layered);
      commitFixture(layered);
      active = spawnServer(layered);
      const token = await readToken(active, layered);
      await openArch(page, token, '#at=src');
      await waitForBoxes(page, ['app', 'infra', 'domain']);
      const crap = overlay(page).locator('option', { hasText: exactName('CRAP') });
      const coverage = overlay(page).locator('option', { hasText: exactName('Coverage') });
      const mutants = overlay(page).locator('option', { hasText: exactName('Surviving mutants') });
      await expect(crap).toHaveAttribute('disabled', '');
      await expect(coverage).toHaveAttribute('disabled', '');
      await expect(mutants).toHaveAttribute('disabled', '');
      await expect(overlay(page).locator('option', { hasText: exactName('None') })).not.toHaveAttribute('disabled');
      await expect(crap).toHaveAttribute('title', COVERAGE_HINT);
      await expect(coverage).toHaveAttribute('title', COVERAGE_HINT);
      await expect(mutants).toHaveAttribute('title', MUTATION_HINT);
      await overlay(page).selectOption({ label: 'CRAP' }).catch(() => undefined);
      await expect(overlay(page)).toHaveValue('none');
      await expect(page.locator('.box-badge')).toHaveCount(0);
    });

    await test.step('layered Metrics sorts by D and a row selects the box', async () => {
      await openMetrics(page);
      await expect(page.getByRole('columnheader', { name: 'D', exact: true })).toHaveAttribute('aria-sort', 'descending');
      await expect.poll(() => metricCells(page)).toEqual([
        metricRow('infra', 2, 2, 2, '0.50', '0.00', '0.50', 'healthy', DASH, DASH, DASH),
        metricRow('app', 2, 0, 2, '1.00', '0.00', '0.00', 'healthy', DASH, DASH, DASH),
        metricRow('domain', 2, 3, 0, '0.00', '1.00', '0.00', 'healthy', DASH, DASH, DASH),
      ]);
      await page.getByRole('columnheader', { name: 'I', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: 'I', exact: true })).toHaveAttribute('aria-sort', 'descending');
      await expect.poll(() => metricCells(page)).toEqual([
        metricRow('app', 2, 0, 2, '1.00', '0.00', '0.00', 'healthy', DASH, DASH, DASH),
        metricRow('infra', 2, 2, 2, '0.50', '0.00', '0.50', 'healthy', DASH, DASH, DASH),
        metricRow('domain', 2, 3, 0, '0.00', '1.00', '0.00', 'healthy', DASH, DASH, DASH),
      ]);
      await clickRow(page, 'domain');
      await expect(box(page, 'domain')).toHaveAttribute('data-selected', 'true');
      const panel = page.locator('aside[aria-label="details"]');
      await expect(panel.locator('h2')).toHaveText('domain');
      await expect(panel).toContainText('I 0.00');
      await expect(panel).toContainText('A 1.00');
      await expect(panel).toContainText('D 0.00');
      await expect(panel).toContainText('Zone healthy');
      await page.getByRole('button', { name: 'Metrics', exact: true }).click();
      await expect(page.locator('aside[aria-label="metrics"]')).toHaveCount(0);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      expect(await stopChild(active as ChildProcess, 'SIGINT')).toBe(0);
      active = null;
    });

    await test.step('zones shows pain, useless and healthy in D order', async () => {
      writeZones(zones);
      commitFixture(zones);
      active = spawnServer(zones);
      const token = await readToken(active, zones);
      await openArch(page, token, '#at=src');
      await waitForBoxes(page, ['pain', 'use', 'mid']);
      await openMetrics(page);
      await expect.poll(() => metricCells(page)).toEqual([
        metricRow('pain', 1, 1, 0, '0.00', '0.00', '1.00', 'pain', DASH, DASH, DASH),
        metricRow('use', 2, 0, 1, '1.00', '1.00', '1.00', 'useless', DASH, DASH, DASH),
        metricRow('mid', 1, 1, 1, '0.50', '0.00', '0.50', 'healthy', DASH, DASH, DASH),
      ]);
      await clickRow(page, 'pain');
      await expect(box(page, 'pain')).toHaveAttribute('data-selected', 'true');
      const panel = page.locator('aside[aria-label="details"]');
      await expect(panel.locator('h2')).toHaveText('pain');
      await expect(panel).toContainText('D 1.00');
      await expect(panel).toContainText('Zone pain');
      expect(await stopChild(active, 'SIGINT')).toBe(0);
      active = null;
    });

    await test.step('the routes table lists the live paths and the playground is removed', async () => {
      expectRoutes();
      fs.rmSync(QA, { recursive: true, force: true });
      expect(fs.existsSync(QA)).toBe(false);
    });
  } finally {
    if (active && active.exitCode === null) active.kill('SIGKILL');
    fs.rmSync(QA, { recursive: true, force: true });
  }
});
