import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5100;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const GREEN_BG = 'rgb(220, 252, 231)';
const RED_BORDER = 'rgb(220, 38, 38)';
const YELLOW_BG = 'rgb(254, 249, 195)';
const CREATE = 'Create package src/ports';
const MOVE = 'Move src/domain/shape.ts to src/ports';
const RENAME = 'Rename src/infra to src/adapters';
const SPLIT = 'Split src/app into src/app/read (2 files) and src/app/write (2 files)';
const MERGE_READ = 'Merge src/app/read and src/app/write into src/app/read';
const MERGE_APP = 'Merge src/app/read and src/app/write into src/app';
const DELETE = 'Delete src/domain/model.ts';
const FOLD = 'Fold src/adapters/repo.ts into src/ports/shape.ts';
const CYCLE = 'this plan adds a cycle: read → write → read';
const APP_CYCLE = 'this plan adds a cycle: app → infra → app';
const FILE_CYCLE = 'a.ts → b.ts → a.ts';
const DELETE_WARNING = '2 files still import src/domain/model.ts, which this plan deletes';
const FOLD_TIP = '0 runtime · 1 type-only · 0 extends/implements';
const SEVEN = [CREATE, MOVE, RENAME, SPLIT, MERGE_APP, DELETE, FOLD];
const SPLIT_FILES = ['a.test.ts', 'a.ts', 'b.ts', 'save.ts'];

const SEVEN_EDITS = [
  { kind: 'create-package', path: 'src/ports' },
  { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/ports' },
  { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' },
  {
    kind: 'split-package',
    package: 'src/app',
    parts: [
      { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts'] },
      { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
    ],
  },
  { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app' },
  { kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' },
  { kind: 'fate', file: 'src/adapters/repo.ts', fate: 'fold', into: 'src/ports/shape.ts' },
];

const SPLIT_APP_EDITS = [
  { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' },
  { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
  { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
];

const ADDED_CYCLE = [[], [], [{ kind: 'added-cycle', cycle: 'app → infra → app' }]];

type BoxRect = { x: number; y: number; w: number; h: number };

type GraphBody = {
  nodes: { id: string; files?: number; abstract?: boolean; name?: string }[];
  edges: { from: string; to: string; cycleText?: string }[];
  planned?: unknown;
  stale?: (string | null)[];
  warnings?: unknown;
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

function gitStatus(dir: string): string {
  return execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
}

function box(page: Page, name: string): Locator {
  return page.locator('.box:not(.ghost)').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function sentences(page: Page): Locator {
  return page.locator('aside[aria-label="changes"] .change-sentence');
}

function changeOf(page: Page, sentence: string): Locator {
  return page.locator('aside[aria-label="changes"] .change').filter({
    has: page.locator('.change-sentence', { hasText: exactName(sentence) }),
  });
}

function badge(page: Page): Locator {
  return page.locator('.changes-heading .warning-badge');
}

function notice(page: Page): Locator {
  return page.locator('output[aria-label="notice"]');
}

function dialogOf(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name });
}

async function expectBadge(page: Page, count: number): Promise<void> {
  const label = count === 1 ? '1 warning' : `${count} warnings`;
  await expect(badge(page)).toHaveText(String(count));
  await expect(badge(page)).toHaveAttribute('aria-label', label);
}

async function expectNoBadge(page: Page): Promise<void> {
  await expect(badge(page)).toHaveCount(0);
}

async function expectCount(page: Page, name: string, text: string): Promise<void> {
  await expect(box(page, name).locator('.box-count')).toHaveText(text);
}

async function crumb(page: Page, name: string): Promise<void> {
  await page.locator('nav[aria-label="breadcrumb"] button', { hasText: exactName(name) }).click();
}

async function centers(page: Page): Promise<Record<string, BoxRect>> {
  return page.locator('.box:not(.ghost)').evaluateAll((els) => {
    const out: Record<string, BoxRect> = {};
    for (const el of els) {
      const name = el.querySelector('.box-name')?.textContent ?? '';
      const r = el.getBoundingClientRect();
      out[name] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
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

function boxName(page: Page, name: string): Locator {
  return box(page, name).locator('.box-name');
}

async function clickBox(page: Page, name: string): Promise<void> {
  await boxName(page, name).click();
}

async function doubleClickBox(page: Page, name: string): Promise<void> {
  const before = page.url();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await boxName(page, name).dblclick();
    try {
      await expect(page).not.toHaveURL(before, { timeout: 1500 });
      return;
    } catch {
      await expect(box(page, name)).toBeVisible();
    }
  }
  throw new Error(`double-click did not leave ${before}`);
}

async function shiftSelect(page: Page, first: string, second: string): Promise<void> {
  await boxName(page, first).click();
  await boxName(page, second).click({ modifiers: ['Shift'] });
}

async function clickMenuItem(menu: Locator, item: string): Promise<void> {
  const button = menu.getByRole('button', { name: item, exact: true });
  await expect(button).toBeVisible();
  await button.evaluate((el: HTMLElement) => el.click());
}

async function chooseMenu(page: Page, name: string, item: string): Promise<void> {
  await clickBox(page, name);
  const menu = box(page, name).locator('.box-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Menu', exact: true }).click();
  await clickMenuItem(menu, item);
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

async function expectSelected(page: Page, name: string): Promise<void> {
  await expect(page.locator('.box[data-selected="true"]')).toHaveCount(1);
  await expect(box(page, name)).toHaveAttribute('data-selected', 'true');
}

async function submitField(dialog: Locator, value: string, submit: string): Promise<void> {
  if (value !== '') await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(value);
  await dialog.getByRole('button', { name: submit, exact: true }).click();
}

async function expectStruck(locator: Locator): Promise<void> {
  await expect(locator).toHaveAttribute('data-fate', 'delete');
  await expect(locator).toHaveCSS('text-decoration-line', 'line-through');
}

async function graphBody(token: string, query: string): Promise<GraphBody> {
  const res = await requestHttp(`${ORIGIN}/api/graph?${query}`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as GraphBody;
}

test('qa: plan package edits and file fates', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
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
    const tokenMatch = lines[0].match(/^bindweed: http:\/\/127\.0\.0\.1:5100\/\?token=([0-9a-f]{32})$/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch?.[1] ?? '';
    expect(lines[1]).toBe(`serving ${layered}`);

    await test.step('step 2: plans, graph, pairs and a clean tree', async () => {
      const plansRes = await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) });
      expect(plansRes.status).toBe(200);
      expect(JSON.parse(plansRes.body)).toEqual({ plans: [] });

      const graph = await graphBody(token, 'at=src');
      expect(graph).not.toHaveProperty('planned');
      expect(graph).not.toHaveProperty('stale');
      expect(graph).not.toHaveProperty('warnings');
      const domain = graph.nodes.find((node) => node.id === 'src/domain');
      expect(domain?.files).toBe(2);
      expect(domain?.abstract).toBe(true);

      const pairsRes = await requestHttp(`${ORIGIN}/api/pairs?from=src/app&to=src/infra&at=src`, { headers: bearer(token) });
      expect(pairsRes.status).toBe(200);
      expect(JSON.parse(pairsRes.body)).toEqual({
        pairs: [
          ['src/app/a.ts', 'src/infra/db.ts'],
          ['src/app/a.ts', 'src/infra/repo.ts'],
          ['src/app/b.ts', 'src/infra/db.ts'],
        ],
      });
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('step 3: create Reshape', async () => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(`${ORIGIN}/?token=${token}#at=src`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'New plan…' }).click();
      let dialog = dialogOf(page, 'New plan');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Plan' })).toHaveValue('');

      await page.getByRole('button', { name: 'New plan…' }).click();
      dialog = dialogOf(page, 'New plan');
      await submitField(dialog, '', 'Create');
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('write a name');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      expect(JSON.parse((await requestHttp(`${ORIGIN}/api/plans`, { headers: bearer(token) })).body)).toEqual({ plans: [] });

      await submitField(dialog, 'Reshape', 'Create');
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
      await expect(page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Planned')).toBeChecked();
      await expect(sentences(page)).toHaveCount(0);
      await expectCount(page, 'app', '3 files');
      await expectCount(page, 'infra', '2 files');
      await expectCount(page, 'domain', '2 files');
    });

    await test.step('step 4: create src/ports', async () => {
      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
      await page.getByRole('button', { name: 'New package', exact: true }).click();
      const dialog = dialogOf(page, 'New package');
      await expect(dialog).toBeVisible();

      await submitField(dialog, '', 'Create');
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('write a name');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('has space');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('bad name');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('infra');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('src/infra already exists');
      await expect(sentences(page)).toHaveCount(0);

      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('ports');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(sentences(page)).toHaveText([CREATE]);
      await expectCount(page, 'ports', '0 files');
      await expect(box(page, 'ports').locator('.box-row')).toHaveCount(0);
      await expect(changeOf(page, CREATE).locator('.change-warning-text')).toHaveText(['src/ports is empty']);
      await expectBadge(page, 1);
      expect(fs.existsSync(path.join(layered, 'src/ports'))).toBe(false);
    });

    await test.step('step 5: rename save.ts, then undo', async () => {
      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=reshape`);
      await chooseMenu(page, 'save.ts', 'Rename');
      const dialog = dialogOf(page, 'Rename');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('b');
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('src/app/b.ts already exists');
      await expect(sentences(page)).toHaveText([CREATE]);

      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('writer');
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(sentences(page)).toHaveText([CREATE, 'Rename src/app/save.ts to writer.ts']);
      await expect(box(page, 'writer.ts')).toBeVisible();

      await page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(sentences(page)).toHaveText([CREATE]);
      await expect(box(page, 'save.ts')).toBeVisible();
      await expect(box(page, 'writer.ts')).toHaveCount(0);
    });

    await test.step('step 6: move shape.ts into ports', async () => {
      await crumb(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
      await expect(page.locator('.box-row[data-path="src/domain/shape.ts"]')).toBeVisible();
      await dragRowToBox(page, 'src/domain/shape.ts', 'ports');
      await expect(sentences(page)).toHaveText([CREATE, MOVE]);
      await expectNoBadge(page);
      await expect(changeOf(page, CREATE).locator('.change-warning-text')).toHaveCount(0);
      await expectCount(page, 'ports', '1 file');
      await expect(box(page, 'ports').locator('.box-row:not([data-ghost="true"])')).toHaveText(['shape.ts']);
      await expect(box(page, 'ports')).toHaveAttribute('data-abstract', 'true');
      expect(await box(page, 'ports').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GREEN_BG);
      await expectCount(page, 'domain', '1 file');
      await expect(box(page, 'domain').locator('.box-row:not([data-ghost="true"])')).toHaveText(['model.ts']);
      const ghost = box(page, 'domain').locator('.box-row[data-ghost="true"]');
      await expect(ghost).toHaveText('shape.ts');
      await expect(ghost).toHaveCSS('opacity', '0.35');
      await expect(ghost).toHaveCSS('border-style', 'dashed');
      expect(fs.existsSync(path.join(layered, 'src/domain/shape.ts'))).toBe(true);
    });

    await test.step('step 7: rename infra to adapters', async () => {
      await chooseMenu(page, 'infra', 'Rename');
      const dialog = dialogOf(page, 'Rename');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('adapters');
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME]);
      await expect(box(page, 'infra')).toHaveCount(0);
      await expect(box(page, 'adapters').locator('.box-row:not([data-ghost="true"])')).toHaveText(['db.ts', 'repo.ts']);
      await expect(changeOf(page, MOVE).locator('.change-sentence')).toHaveText(MOVE);
      const edge = arrow(page, 'src/adapters', 'src/ports');
      await expect(edge).toHaveCount(1);
      await expect(edge).toHaveAttribute('data-line', 'solid');
      await expect(edge).toHaveAttribute('data-head', 'hollow');
    });

    await test.step('step 8: split app into read and write', async () => {
      const before = [CREATE, MOVE, RENAME];
      await chooseMenu(page, 'app', 'Split');
      const dialog = dialogOf(page, 'Split package');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox')).toHaveCount(2);
      await expect(dialog.getByRole('textbox', { name: 'Part 1', exact: true })).toHaveValue('');
      await expect(dialog.getByRole('textbox', { name: 'Part 2', exact: true })).toHaveValue('');
      const selects = dialog.getByRole('combobox');
      await expect(selects).toHaveCount(SPLIT_FILES.length);
      expect(await selects.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(SPLIT_FILES);
      for (const label of SPLIT_FILES) await expect(dialog.getByRole('combobox', { name: label, exact: true })).toHaveValue('');

      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('name at least two parts');
      await dialog.getByRole('textbox', { name: 'Part 1', exact: true }).fill('has space');
      await dialog.getByRole('textbox', { name: 'Part 2', exact: true }).fill('write');
      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('bad name');
      await dialog.getByRole('textbox', { name: 'Part 1', exact: true }).fill('read');
      await dialog.getByRole('textbox', { name: 'Part 2', exact: true }).fill('read');
      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('duplicate part');
      await dialog.getByRole('textbox', { name: 'Part 2', exact: true }).fill('write');
      await expect(dialog.getByRole('combobox', { name: 'a.ts', exact: true })).toHaveValue('');
      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('assign every file');
      await expect(sentences(page)).toHaveText(before);

      await dialog.getByRole('textbox', { name: 'Part 1', exact: true }).fill('a.ts');
      await expect(dialog.getByRole('combobox').first().locator('option')).toHaveText(['choose', 'a.ts', 'write']);
      for (const label of SPLIT_FILES) await dialog.getByRole('combobox', { name: label, exact: true }).selectOption('write');
      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('src/app/a.ts already exists');
      await expect(sentences(page)).toHaveText(before);

      await dialog.getByRole('textbox', { name: 'Part 1', exact: true }).fill('read');
      await dialog.getByRole('combobox', { name: 'a.test.ts', exact: true }).selectOption('read');
      await dialog.getByRole('combobox', { name: 'a.ts', exact: true }).selectOption('read');
      await dialog.getByRole('combobox', { name: 'b.ts', exact: true }).selectOption('write');
      await dialog.getByRole('combobox', { name: 'save.ts', exact: true }).selectOption('write');
      await dialog.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(sentences(page)).toHaveText([...before, SPLIT]);
      await expect(box(page, 'app')).toHaveCount(0);
      await expect(box(page, 'read')).toHaveAttribute('data-y', '0');
      await expect(box(page, 'write')).toHaveAttribute('data-y', '0');
      const readX = Number(await box(page, 'read').getAttribute('data-x'));
      const writeX = Number(await box(page, 'write').getAttribute('data-x'));
      expect(readX).toBeLessThan(writeX);
      const placed = await centers(page);
      expect(placed['read'].x).toBeLessThan(placed['write'].x);
      expect(Math.abs(placed['read'].y - placed['write'].y)).toBeLessThan(12);
      const top = Math.min(...Object.values(placed).map((rect) => rect.y));
      expect(placed['read'].y).toBeLessThanOrEqual(top + 2);
      for (const name of ['read', 'write']) {
        await expect(box(page, name)).toHaveAttribute('data-cycle', 'true');
        await expect(box(page, name)).toHaveCSS('border-color', RED_BORDER);
      }
      await expect(changeOf(page, SPLIT).locator('.change-warning-text')).toHaveText([CYCLE]);
      await expectBadge(page, 1);

      await crumb(page, 'layered');
      await expect(page).toHaveURL(`${ORIGIN}/#at=&plan=reshape`);
      await expect(page.locator('.box-name')).toHaveText(['src']);
      await expectBadge(page, 1);
      await expect(changeOf(page, SPLIT).locator('.change-warning-text')).toHaveText([CYCLE]);

      await doubleClickBox(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
    });

    await test.step('step 9: merge read and write', async () => {
      await shiftSelect(page, 'read', 'write');
      await expect(box(page, 'read')).toHaveAttribute('data-selected', 'true');
      await expect(box(page, 'write')).toHaveAttribute('data-selected', 'true');
      const menu = box(page, 'read').locator('.box-menu');
      await menu.getByRole('button', { name: 'Menu', exact: true }).click();
      await clickMenuItem(menu, 'Merge');
      const dialog = dialogOf(page, 'Merge packages');
      await submitField(dialog, '', 'Merge');
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('write a name');
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME, SPLIT]);

      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('read');
      await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME, SPLIT, MERGE_READ]);
      await expect(box(page, 'write')).toHaveCount(0);
      await expectCount(page, 'read', '3 files');
      await expect(box(page, 'read').locator('.box-row:not([data-ghost="true"])')).toHaveText(['a.ts', 'b.ts', 'save.ts']);
      await expectNoBadge(page);

      await page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME, SPLIT]);
      await expect(box(page, 'read')).toBeVisible();
      await expect(box(page, 'write')).toBeVisible();
      await expect(changeOf(page, SPLIT).locator('.change-warning-text')).toHaveText([CYCLE]);
      await expectBadge(page, 1);

      await shiftSelect(page, 'read', 'write');
      const again = box(page, 'write').locator('.box-menu');
      await again.getByRole('button', { name: 'Menu', exact: true }).click();
      await clickMenuItem(again, 'Merge');
      const merge = dialogOf(page, 'Merge packages');
      await merge.getByRole('textbox', { name: 'Name', exact: true }).fill('adapters');
      await merge.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(merge.locator('.plan-dialog-error')).toHaveText('src/adapters already exists');
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME, SPLIT]);

      await merge.getByRole('textbox', { name: 'Name', exact: true }).fill('app');
      await merge.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(merge).toHaveCount(0);
      await expect(sentences(page)).toHaveText([CREATE, MOVE, RENAME, SPLIT, MERGE_APP]);
      await expectCount(page, 'app', '3 files');
      await expect(box(page, 'app').locator('.box-row:not([data-ghost="true"])')).toHaveText(['a.ts', 'b.ts', 'save.ts']);
      await expect(box(page, 'read')).toHaveCount(0);
      await expect(box(page, 'write')).toHaveCount(0);
      await expect(changeOf(page, SPLIT).locator('.change-warning-text')).toHaveCount(0);
      await expectNoBadge(page);
    });

    await test.step('step 10: delete model.ts', async () => {
      await doubleClickBox(page, 'domain');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/domain&plan=reshape`);
      await chooseMenu(page, 'model.ts', 'Delete');
      await expect(sentences(page)).toHaveText([...SEVEN.slice(0, 5), DELETE]);
      await expectStruck(box(page, 'model.ts'));
      await expect(changeOf(page, DELETE).locator('.change-warning-text')).toHaveText([DELETE_WARNING]);
      await changeOf(page, DELETE).getByRole('button', { name: 'Show importers', exact: true }).click();
      await expect(changeOf(page, DELETE).locator('.change-importers li')).toHaveText(['src/adapters/db.ts', 'src/app/a.ts']);
      await expectBadge(page, 1);
    });

    await test.step('step 11: fold repo.ts into shape.ts', async () => {
      await crumb(page, 'src');
      await doubleClickBox(page, 'adapters');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/adapters&plan=reshape`);
      await chooseMenu(page, 'repo.ts', 'Fold into…');
      await expect(notice(page)).toHaveText('click a file to fold src/adapters/repo.ts into');
      await clickBox(page, 'repo.ts');
      await expect(notice(page)).toHaveText('a file cannot fold into itself');
      await expect(sentences(page)).toHaveText([...SEVEN.slice(0, 6)]);

      await crumb(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
      await expectCount(page, 'domain', '1 file');
      await expectStruck(box(page, 'domain').locator('.box-row[data-path="src/domain/model.ts"]'));

      await box(page, 'ports').locator('.box-row[data-path="src/ports/shape.ts"] .box-row-name').click();
      await expect(sentences(page)).toHaveText(SEVEN);
      await expectCount(page, 'domain', '1 file');
      await expectStruck(box(page, 'domain').locator('.box-row[data-path="src/domain/model.ts"]'));
      await expectCount(page, 'adapters', '1 file');
      await expect(box(page, 'adapters').locator('.box-row:not([data-ghost="true"])')).toHaveText(['db.ts']);
      await expect(arrow(page, 'src/adapters', 'src/ports')).toHaveCount(0);
      const folded = arrow(page, 'src/app', 'src/ports');
      await expect(folded).toHaveCount(1);
      await expect(folded).toHaveAttribute('data-line', 'dashed');
      await expect(folded.locator('title')).toHaveText(FOLD_TIP);
      await expectBadge(page, 1);
      await expect(changeOf(page, DELETE).locator('.change-warning-text')).toHaveText([DELETE_WARNING]);
      const showImporters = changeOf(page, DELETE).getByRole('button', { name: 'Show importers', exact: true });
      if (await showImporters.count()) await showImporters.click();
      await expect(changeOf(page, DELETE).locator('.change-importers li')).toHaveText(['src/adapters/db.ts', 'src/app/a.ts']);
    });

    await test.step('step 12: undo seven and redo seven', async () => {
      await page.mouse.click((await emptyCanvasPoint(page)).x, (await emptyCanvasPoint(page)).y);
      for (let left = 6; left >= 0; left -= 1) {
        await page.keyboard.press('Control+z');
        await expect(sentences(page)).toHaveCount(left);
      }
      await expectNoBadge(page);
      await expectCount(page, 'app', '3 files');
      await expectCount(page, 'infra', '2 files');
      await expect(box(page, 'ports')).toHaveCount(0);

      for (let count = 1; count <= 7; count += 1) {
        await page.keyboard.press('Control+Shift+z');
        await expect(sentences(page)).toHaveCount(count);
      }
      await expect(sentences(page)).toHaveText(SEVEN);
      await expectStruck(box(page, 'domain').locator('.box-row[data-path="src/domain/model.ts"]'));
      await expect(arrow(page, 'src/app', 'src/ports')).toHaveCount(1);
      await expectBadge(page, 1);
    });

    await test.step('step 13: reload, follow entries, read the document', async () => {
      await page.goto(`${ORIGIN}/?token=${token}#at=src&plan=reshape`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
      await expect(sentences(page)).toHaveText(SEVEN);
      await expectStruck(box(page, 'domain').locator('.box-row[data-path="src/domain/model.ts"]'));
      await expect(arrow(page, 'src/app', 'src/ports')).toHaveCount(1);
      await expectBadge(page, 1);

      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=reshape`);
      await clickBox(page, 'a.ts');
      await changeOf(page, RENAME).locator('.change-sentence').click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);
      await expectSelected(page, 'adapters');

      await doubleClickBox(page, 'app');
      await changeOf(page, FOLD).locator('.change-sentence').click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/ports&plan=reshape`);
      await expectSelected(page, 'shape.ts');

      await changeOf(page, SPLIT).locator('.change-sentence').click();
      await expect(notice(page)).toHaveText('no such box src/app/read');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/ports&plan=reshape`);

      await crumb(page, 'src');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=reshape`);

      const docRes = await requestHttp(`${ORIGIN}/api/plans/reshape`, { headers: bearer(token) });
      expect(docRes.status).toBe(200);
      const doc = JSON.parse(docRes.body) as { edits: unknown };
      expect(doc).not.toHaveProperty('warnings');
      expect(doc.edits).toEqual(SEVEN_EDITS);
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('step 14: remove the rename and look at Now', async () => {
      await changeOf(page, RENAME).locator('button[aria-label="Remove"]').click();
      await expect(sentences(page)).toHaveText([CREATE, MOVE, SPLIT, MERGE_APP, DELETE, FOLD]);
      const fold = changeOf(page, FOLD);
      await expect(fold).toHaveAttribute('data-stale', 'true');
      await expect(fold).toHaveCSS('background-color', YELLOW_BG);
      await expect(fold.locator('.change-reason')).toHaveText('no such file src/adapters/repo.ts');
      await expect(changeOf(page, DELETE)).not.toHaveAttribute('data-stale');

      await page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Now').click();
      await expect(box(page, 'infra')).toBeVisible();
      await expect(box(page, 'adapters')).toHaveCount(0);
      await expect(box(page, 'ports')).toHaveCount(0);
      await expect(page.locator('[data-fate="delete"]')).toHaveCount(0);
      await expectCount(page, 'app', '3 files');
      expect(fs.existsSync(path.join(layered, 'src/infra/repo.ts'))).toBe(true);
      expect(fs.existsSync(path.join(layered, 'src/adapters'))).toBe(false);
    });

    await test.step('step 15: a 005 plan warns about its cycle on every view', async () => {
      const created = await requestHttp(`${ORIGIN}/api/plans`, {
        method: 'POST',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Split app' }),
      });
      expect(created.status).toBe(201);
      const doc = JSON.parse(created.body) as { edits: unknown };
      doc.edits = SPLIT_APP_EDITS;
      const put = await requestHttp(`${ORIGIN}/api/plans/split-app`, {
        method: 'PUT',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      expect(put.status).toBe(200);

      await page.goto(`${ORIGIN}/?token=${token}#at=&plan=split-app`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=&plan=split-app`);
      await expect(page.locator('.box-name')).toHaveText(['src']);
      await expectBadge(page, 1);
      await expect(changeOf(page, 'src/infra should use src/app').locator('.change-warning-text')).toHaveText([APP_CYCLE]);
      await expect(page.locator('aside[aria-label="changes"]')).not.toContainText(FILE_CYCLE);

      await page.goto(`${ORIGIN}/?token=${token}#at=src/app&plan=split-app`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=split-app`);
      await expect(page.locator('.box:not(.ghost) .box-name')).toHaveText(['a.ts', 'b.ts']);
      await expectBadge(page, 1);
      await expect(changeOf(page, 'src/infra should use src/app').locator('.change-warning-text')).toHaveText([APP_CYCLE]);
      await expect(page.locator('aside[aria-label="changes"]')).not.toContainText(FILE_CYCLE);

      const root = await graphBody(token, 'plan=split-app');
      const drilled = await graphBody(token, 'at=src/app&plan=split-app');
      expect(root.warnings).toEqual(ADDED_CYCLE);
      expect(drilled.warnings).toEqual(ADDED_CYCLE);
      expect(root.stale).toEqual([null, null, null]);
      expect(drilled.stale).toEqual([null, null, null]);
      expect(root.edges).toEqual([]);
      expect(root.nodes.map((node) => node.id)).toEqual(['src']);
      expect(drilled.edges.some((edge) => edge.cycleText === FILE_CYCLE)).toBe(true);
    });

    await test.step('step 16: the tree is untouched and the playground is removed', async () => {
      expect(fs.readFileSync(path.join(layered, 'src/domain/shape.ts'), 'utf8')).toBe('export interface Shape { draw(): void }\n');
      expect(gitStatus(layered)).toBe('');
      const code = await stopChild(server);
      active = null;
      expect(code).toBe(0);
      fs.rmSync(QA, { recursive: true, force: true });
      expect(fs.existsSync(QA)).toBe(false);
    });
  } finally {
    if (active !== null && active.exitCode === null) {
      await stopChild(active, 'SIGKILL');
    }
    if (fs.existsSync(QA)) fs.rmSync(QA, { recursive: true, force: true });
  }
});
