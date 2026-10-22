import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const GREEN = 'rgb(22, 163, 74)';
const GREY = 'rgb(100, 116, 139)';
const RED = 'rgb(220, 38, 38)';
const DB_IMPORT = "import { query } from '../infra/db';\n";
const PAIR_LINES = ['src/app/a.ts:2', 'src/app/b.ts:2', 'src/app/c.ts:1'];
const CYCLE_LINES = ['src/app/a.ts:1', 'src/app/b.ts:1'];
const CACHE = z.object({ files: z.record(z.string(), z.object({ imports: z.array(z.looseObject({ line: z.number().optional() })) })) });
const GRAPH = z.object({ nodes: z.array(z.object({ id: z.string() })) });
const RUNS = z.object({ runs: z.array(z.object({ planName: z.string().optional() })) });

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function fixture(qa: string, pid: number, dead: number): { root: string; wt: string; plan: string } {
  const root = path.join(qa, 'layered');
  const wt = path.join(qa, 'converge-wt');
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  fs.cpSync(root, wt, { recursive: true });
  write(path.join(wt, 'src/app/c.ts'), `${DB_IMPORT}export const c = query;\n`);
  const plan = JSON.stringify({
    version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-22T12:00:00.000Z', baseCommit: git(root, 'rev-parse', 'HEAD').trim(), redo: [],
    contract: { rules: [
      { name: 'bindweed:no-src-app-to-src-infra', severity: 'error', comment: 'src/app must not import src/infra', from: { path: '^src/app/' }, to: { path: '^src/infra/' } },
      { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
    ] },
    edits: [
      { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' },
      { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: ['a', 'b', 'c'].map(name => [`src/app/${name}.ts`, 'src/infra/db.ts']) },
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
    ],
  });
  write(path.join(root, '.bindweed/plans/gate.json'), plan);
  write(path.join(root, '.bindweed/runs.json'), JSON.stringify([
    { slug: 'gone', tool: 'marestail', worktree: path.join(qa, 'converge-gone'), branch: 'bindweed/gone', pid: dead, startedAt: '2026-10-22T11:00:00.000Z', out: path.join(qa, 'missing.out'), settings: {} },
    { slug: 'gate', tool: 'marestail', worktree: wt, branch: 'bindweed/gate', pid, startedAt: '2026-10-22T12:00:00.000Z', out: path.join(qa, 'missing.out'), settings: {} },
  ]));
  return { root, wt, plan };
}

function start(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`bindweed did not start: ${output}`)), 15_000);
    child.stderr?.on('data', chunk => { output += chunk; });
    child.stdout?.on('data', chunk => {
      output += chunk;
      const match = /bindweed: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{32})\nserving .+\n/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`bindweed exited ${code}: ${output}`)); });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

function box(page: Page, name: string): Locator {
  return page.locator('.box:not(.ghost)').filter({ has: page.locator('.box-name', { hasText: new RegExp(`^${name}$`) }) });
}

function row(page: Page, file: string): Locator {
  return page.locator(`.box-row[data-path="${file}"]`);
}

function edit(page: Page, index: number): Locator {
  return page.locator('aside[aria-label="changes"] .change').nth(index);
}

function rule(page: Page, index: number): Locator {
  return page.locator('.converge-rules > li').nth(index);
}

async function mark(item: Locator, status: string, symbol: string, color: string): Promise<void> {
  const mark = item.locator('.converge-mark');
  await expect(mark).toHaveAttribute('data-status', status);
  await expect(mark).toHaveText(symbol);
  await expect(mark).toHaveCSS('color', color);
}

async function header(page: Page, edits: number, rules: number): Promise<void> {
  await expect(page.locator('.converge-header')).toHaveText(`${edits} of 4 edits done · ${rules} of 2 rules hold`, { timeout: 25_000 });
}

async function lines(item: Locator, expected: string[]): Promise<void> {
  await expect(item.locator('.converge-remain li')).toHaveText(expected);
}

async function rows(page: Page, name: string, files: string[]): Promise<void> {
  await expect(box(page, name).locator('.box-row')).toHaveCount(files.length);
  await expect.poll(async () => box(page, name).locator('.box-row').evaluateAll(items => items.map(item => item.getAttribute('data-path')).sort())).toEqual(files.map(file => `src/${name}/${file}.ts`).sort());
}

async function visibility(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  if (from === null || to === null) throw new Error('drag endpoints are absent');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

function scanRequest(request: Request): boolean {
  return ['/api/converge', '/api/graph', '/api/detail', '/api/pairs'].includes(new URL(request.url()).pathname);
}

test('qa: watch a run converge on the plan', async ({ page }) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(10_000);
  ensureUiBuilt(BW);
  const qa = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-converge-')));
  const live = spawn('sleep', ['7200'], { stdio: 'ignore' });
  let server: ChildProcess | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await once(live, 'spawn');
    if (live.pid === undefined) throw new Error('sleep has no pid');
    const { root, wt, plan } = fixture(qa, live.pid, spawnSync('true').pid);
    const planPath = path.join(root, '.bindweed/plans/gate.json');
    server = spawn(process.execPath, [path.join(BW, 'src/cli.ts')], { cwd: root, env: { ...process.env, BINDWEED_PORT: '5700' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const address = await start(server);
    const origin = new URL(address).origin;
    const token = new URL(address).searchParams.get('token');
    if (token === null) throw new Error('server did not give a token');
    const requests: Request[] = [];
    const pending = new Set<Request>();
    let loads = 0;
    page.on('load', () => { loads++; });
    page.on('request', request => {
      if (scanRequest(request)) { requests.push(request); pending.add(request); }
    });
    page.on('requestfinished', request => pending.delete(request));
    page.on('requestfailed', request => pending.delete(request));
    const idle = async () => {
      await expect.poll(() => pending.size).toBe(0);
      await page.waitForTimeout(200);
      expect(pending.size).toBe(0);
    };
    const api = async (route: string) => {
      const response = await page.request.get(`${origin}${route}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const picture = async (shown: 'Now' | 'Planned') => { await page.getByRole('radio', { name: shown, exact: true }).check(); await idle(); };
    await page.setViewportSize({ width: 1800, height: 1100 });
    let cache = '';

    await test.step('1. the browsed plan and toolbar are unchanged', async () => {
      await page.goto(`${address}#at=src&plan=gate`);
      await expect(page).toHaveURL(`${origin}/#at=src&plan=gate`);
      await expect(box(page, 'app').locator('.box-count')).toHaveText('3 files');
      await expect(box(page, 'domain')).toHaveCount(0);
      await expect(row(page, 'src/app/model.ts')).toBeVisible();
      await expect(page.locator('.converge-header')).toHaveCount(0);
      await expect(edit(page, 0).locator('.change-reason')).toHaveCount(0);
      await expect(edit(page, 1).locator('.change-reason')).toHaveText('no such file src/app/c.ts');
      const names = await page.locator('.arch-toolbar button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? button.textContent?.trim()));
      expect(names.slice(names.indexOf('Tasks'), names.indexOf('Converge') + 1)).toEqual(['Tasks', 'Launch', 'Settings', 'Converge']);
      await idle();
      cache = fs.readFileSync(path.join(root, '.bindweed/cache/scan.json'), 'utf8');
    });

    await test.step('2. Converge opens the worktree read-only, including Now', async () => {
      await page.getByRole('button', { name: 'Converge', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/#at=src&plan=gate&converge=gate`);
      await header(page, 0, 0);
      await expect(page.locator('.change-sentence')).toHaveText(['Move src/domain/model.ts to src/app', 'src/app must not import src/infra (3 imports)', 'Create package src/ports', 'Delete src/app/b.ts']);
      for (let index = 0; index < 4; index++) await mark(edit(page, index), 'not yet', '○', GREY);
      await lines(edit(page, 1), PAIR_LINES);
      await lines(rule(page, 0), PAIR_LINES);
      await lines(rule(page, 1), CYCLE_LINES);
      for (const name of ['Undo', 'Redo', 'New plan…', 'Delete plan', 'Contract', 'Tasks', 'Launch']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(4);
      for (const button of await page.getByRole('button', { name: 'Remove', exact: true }).all()) await expect(button).toBeDisabled();
      await expect(page.getByRole('combobox', { name: 'Plan', exact: true })).toBeDisabled();
      for (const name of ['Canvas', 'Menu']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
      await expect(page.locator('aside[aria-label="ask"], aside[aria-label="proposals"]')).toHaveCount(0);
      for (const name of ['Settings', 'Rescan']) await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
      for (const name of ['Now', 'Planned']) await expect(page.getByRole('radio', { name, exact: true })).toBeEnabled();
      await rows(page, 'app', ['a', 'b', 'c', 'model']);
      await expect(row(page, 'src/app/b.ts')).toHaveAttribute('data-fate', 'delete');
      await expect(row(page, 'src/app/model.ts')).not.toHaveCSS('color', GREEN);
      await expect(box(page, 'domain')).toHaveCount(0);
      await expect(box(page, 'ports').locator('.box-count')).toHaveText('0 files');
      await expect(page.locator('g.cutmark path.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(148, 163, 184)');
      await box(page, 'infra').locator('.box-name').click();
      await drag(page, box(page, 'infra').locator('.react-flow__handle-bottom'), box(page, 'app'));
      await drag(page, row(page, 'src/app/a.ts'), box(page, 'infra'));
      await expect(page.locator('.change')).toHaveCount(4);
      await expect(page.locator('g.arrow[data-planned="true"]')).toHaveCount(0);
      expect(fs.readFileSync(planPath, 'utf8')).toBe(plan);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
      await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
      await picture('Now');
      await rows(page, 'app', ['a', 'b', 'c', 'model']);
      await expect(row(page, 'src/app/model.ts')).toHaveAttribute('data-ghost', 'true');
      await expect(row(page, 'src/app/model.ts')).not.toHaveAttribute('data-converge');
      await rows(page, 'domain', ['model']);
      await picture('Planned');
    });

    await test.step('3. polling shows a contradicted move, then the real move in green', async () => {
      fs.renameSync(path.join(wt, 'src/domain/model.ts'), path.join(qa, 'model.ts'));
      await expect(edit(page, 0).locator('.converge-mark')).toHaveAttribute('data-status', 'contradicted', { timeout: 25_000 });
      await header(page, 0, 0);
      await mark(edit(page, 0), 'contradicted', '✗', RED);
      await expect(row(page, 'src/app/model.ts')).toHaveAttribute('data-ghost', 'true');
      await expect(row(page, 'src/app/model.ts')).toHaveCSS('color', RED);
      fs.renameSync(path.join(qa, 'model.ts'), path.join(wt, 'src/app/model.ts'));
      await header(page, 1, 0);
      await mark(edit(page, 0), 'done', '✓', GREEN);
      await expect(row(page, 'src/app/model.ts')).toHaveAttribute('data-converge', 'done');
      await expect(row(page, 'src/app/model.ts')).toHaveCSS('color', GREEN);
      expect(fs.existsSync(path.join(root, 'src/domain/model.ts'))).toBe(true);
      await picture('Now');
      await rows(page, 'app', ['a', 'b', 'c', 'model']);
      await expect(box(page, 'app').locator('[data-ghost="true"]')).toHaveCount(0);
      await expect(box(page, 'domain')).toHaveCount(0);
      await picture('Planned');
    });

    await test.step('4. removing two cut imports leaves the third and its line', async () => {
      for (const name of ['a', 'b']) {
        const file = path.join(wt, `src/app/${name}.ts`);
        write(file, fs.readFileSync(file, 'utf8').replace(DB_IMPORT, ''));
      }
      await expect(edit(page, 1).locator('.converge-remain li')).toHaveText(['src/app/c.ts:1'], { timeout: 25_000 });
      await mark(edit(page, 1), 'not yet', '○', GREY);
      await lines(rule(page, 0), ['src/app/c.ts:1']);
      await lines(rule(page, 1), CYCLE_LINES);
      await header(page, 1, 0);
    });

    await test.step('5. removing the last cut import ticks the cut and path rule', async () => {
      write(path.join(wt, 'src/app/c.ts'), 'export const c = 1;\n');
      await header(page, 2, 1);
      await mark(edit(page, 1), 'done', '✓', GREEN);
      await lines(edit(page, 1), []);
      await mark(rule(page, 0), 'done', '✓', GREEN);
      await lines(rule(page, 0), []);
      await mark(rule(page, 1), 'not yet', '○', GREY);
      await expect(page.locator('g.cutmark')).toHaveAttribute('data-converge', 'done');
      await expect(page.locator('g.cutmark path.react-flow__edge-path')).toHaveCSS('stroke', GREEN);
      await expect(page.locator('g.cutmark text')).toHaveCSS('fill', GREEN);
    });

    await test.step('6. hidden polling pauses and visibility refreshes all worktree queries', async () => {
      await idle();
      await visibility(page, 'hidden');
      await page.waitForTimeout(100);
      const before = requests.length;
      write(path.join(wt, 'src/ports/port.ts'), 'export const port = 1;\n');
      await page.waitForTimeout(25_000);
      expect(requests).toHaveLength(before);
      await visibility(page, 'visible');
      await expect(page.locator('.converge-header')).toHaveText('3 of 4 edits done · 1 of 2 rules hold', { timeout: 5_000 });
      await rows(page, 'ports', ['port']);
      await expect(box(page, 'ports')).toHaveAttribute('data-converge', 'done');
      await expect(box(page, 'ports')).toHaveCSS('border-top-color', GREEN);
      await idle();
      const refresh = requests.slice(before).map(request => new URL(request.url()));
      expect(refresh.some(url => url.pathname === '/api/converge')).toBe(true);
      expect(refresh.some(url => url.pathname === '/api/detail')).toBe(true);
      expect(refresh.some(url => url.pathname === '/api/graph' && !url.searchParams.has('plan'))).toBe(true);
      expect(refresh.some(url => url.searchParams.get('plan') === 'gate' && url.searchParams.get('tests') === '1')).toBe(true);
      expect(refresh.some(url => url.searchParams.get('at') === 'src/ports')).toBe(true);
      for (const url of refresh) expect(url.searchParams.get(url.pathname === '/api/converge' ? 'slug' : 'converge')).toBe('gate');
      expect(loads).toBe(1);
    });

    await test.step('7. a dangling importer blocks delete while both rules hold', async () => {
      fs.rmSync(path.join(wt, 'src/app/b.ts'));
      await header(page, 3, 2);
      await mark(edit(page, 3), 'not yet', '○', GREY);
      await lines(edit(page, 3), ['src/app/a.ts:1']);
      for (let index = 0; index < 2; index++) await mark(rule(page, index), 'done', '✓', GREEN);
      await rows(page, 'app', ['a', 'c', 'model']);
      await expect(row(page, 'src/app/b.ts')).toHaveCount(0);
      await picture('Now');
      await rows(page, 'app', ['a', 'c', 'model']);
      await expect(row(page, 'src/app/b.ts')).toHaveCount(0);
      await picture('Planned');
      await test.info().attach('converge-progress', { body: await page.screenshot(), contentType: 'image/png' });
    });

    await test.step('8. a dead pid stops polling, and Rescan still works', async () => {
      await stop(live);
      await page.waitForTimeout(25_000);
      await header(page, 3, 2);
      const before = requests.length;
      fs.rmSync(path.join(wt, 'src/ports/port.ts'));
      await page.waitForTimeout(25_000);
      expect(requests).toHaveLength(before);
      await header(page, 3, 2);
      await expect(box(page, 'ports')).toHaveCSS('border-top-color', GREEN);
      const rescan = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/rescan');
      await page.getByRole('button', { name: 'Rescan', exact: true }).click();
      expect(new URL((await rescan).url()).searchParams.get('converge')).toBe('gate');
      await header(page, 2, 2);
      await expect(box(page, 'ports').locator('.box-count')).toHaveText('0 files');
      await expect(box(page, 'ports')).not.toHaveCSS('border-top-color', GREEN);
      await expect(row(page, 'src/app/model.ts')).toHaveCSS('color', GREEN);
      await expect(page.locator('g.cutmark path.react-flow__edge-path')).toHaveCSS('stroke', GREEN);
      expect(fs.readFileSync(planPath, 'utf8')).toBe(plan);
    });

    await test.step('9. Leave restores the browsed repository on Planned and Now', async () => {
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/#at=src&plan=gate`);
      await expect(page.locator('.converge-header, .converge-mark, [data-converge]')).toHaveCount(0);
      await expect(box(page, 'app').locator('.box-count')).toHaveText('3 files');
      await rows(page, 'app', ['a', 'b', 'model']);
      await expect(box(page, 'domain')).toHaveCount(0);
      await expect(edit(page, 1).locator('.change-reason')).toHaveText('no such file src/app/c.ts');
      await picture('Now');
      await rows(page, 'domain', ['model']);
      await rows(page, 'app', ['a', 'b', 'model']);
      await expect(row(page, 'src/app/model.ts')).toHaveAttribute('data-ghost', 'true');
      await expect(row(page, 'src/app/c.ts')).toHaveCount(0);
      await picture('Planned');
    });

    await test.step('10. caches, plan, files and git status stay isolated', async () => {
      expect(fs.existsSync(path.join(wt, '.bindweed'))).toBe(false);
      expect(fs.readFileSync(path.join(root, '.bindweed/cache/scan.json'), 'utf8')).toBe(cache);
      const browsed = CACHE.parse(JSON.parse(cache));
      for (const file of Object.values(browsed.files)) {
        expect(file).toHaveProperty('imports');
        for (const item of file.imports) expect(item).not.toHaveProperty('line');
      }
      const cached = CACHE.parse(JSON.parse(fs.readFileSync(path.join(root, '.bindweed/cache/gate/scan.json'), 'utf8')));
      expect(cached.files['src/app/a.ts'].imports).toContainEqual(expect.objectContaining({ line: 1 }));
      expect(git(root, 'status', '--porcelain')).toBe('');
      expect(fs.readFileSync(planPath, 'utf8')).toBe(plan);
      const graph = GRAPH.parse(await api('/api/graph?at=src'));
      expect(graph.nodes.map(node => node.id)).toContain('src/domain');
      expect(graph.nodes.map(node => node.id)).not.toContain('src/app/c.ts');
      expect(RUNS.parse(await api('/api/runs')).runs[0].planName).toBe('Gate');
    });

    await test.step('11. only the existing worktree card offers Converge', async () => {
      await page.getByRole('tab', { name: /^Runs/ }).click();
      const gate = page.getByRole('article', { name: 'Gate', exact: true });
      const gone = page.getByRole('article', { name: 'gone', exact: true });
      await expect(gone.getByText('worktree removed', { exact: true }).first()).toBeVisible();
      await expect(gone.getByRole('button', { name: 'Forget', exact: true })).toBeVisible();
      await expect(gone.getByRole('button', { name: 'Converge', exact: true })).toHaveCount(0);
      await gate.getByRole('button', { name: 'Converge', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/#at=src&plan=gate&converge=gate`);
      await header(page, 2, 2);
      expect(loads).toBe(1);
      expect(errors).toEqual([]);
      await test.info().attach('scan-requests', { body: requests.map(request => `${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`).join('\n'), contentType: 'text/plain' });
    });

    await test.step('12. stop the app and remove the temporary repositories', async () => {
      if (server === undefined) throw new Error('server is absent');
      await stop(server);
      server = undefined;
      fs.rmSync(qa, { recursive: true, force: true });
      expect(fs.existsSync(qa)).toBe(false);
    });
  } finally {
    if (server !== undefined) await stop(server);
    await stop(live);
    fs.rmSync(qa, { recursive: true, force: true });
  }
});
