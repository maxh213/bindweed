import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, spawnSync, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5500;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const NODEBIN = path.dirname(process.execPath);
const TICKS = ['Worktree ✓', 'Files ✓', 'Commit ✓', 'Start ✓', 'Record ✓'];
const BRIEF = '# Reshape layered\n\nMove b, then cut app from domain.\n';
const FOCUS = 'src/app/a.ts src/domain/model.ts';
const SENTENCE = 'src/app must not import src/domain (1 import)';
const ALIVE = 'a run for this plan is still alive';
const TASKS = [
  { file: '005-add-core.md', title: 'Add the core package', body: '# 005 — Add the core package\n\nCreate src/core.\n' },
  { file: '006-move-b.md', title: 'Move b into infra', body: '# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n' },
  { file: '007-cut-app-domain.md', title: 'Cut app from domain', body: '# 007 — Cut app from domain\n\nNo behaviour changes.\n' },
];
const DEFAULTS = { MODEL: 'dandelion/route-best', SCOPE: 'hard', FOCUS, STOP_AT: 'qa' };

type Server = { child: ChildProcess; token: string };
type Run = { slug: string; pid: number };

function exactName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function writeExecutable(file: string, text: string): void {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function writeFakes(qa: string): void {
  const log = path.join(qa, 'log');
  for (const dir of ['fakes/bin', 'fakes/tools', 'fakes/nosh', 'log']) fs.mkdirSync(path.join(qa, dir), { recursive: true });
  writeExecutable(
    path.join(qa, 'fakes/bin/marestail'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${log}/marestail.log"`,
      'if [ "$1" = install ]; then',
      `  if [ -e "${log}/fail-install" ]; then echo "install failed" >&2; exit 1; fi`,
      `  if [ -e "${log}/fail-install-quiet" ]; then exit 1; fi`,
      `  if [ -e "${log}/install.wait" ]; then while [ ! -e "${log}/install.go" ]; do sleep 0.1; done; fi`,
      "  printf 'installed=1\\n' > marestail.toml",
      "  printf 'qa tasks\\n' > tasks/README.md",
      "  printf 'qa-ignore\\n' >> .gitignore",
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeExecutable(
    path.join(qa, 'fakes/tools/overnight.sh'),
    [
      '#!/bin/sh',
      `node -e 'const fs=require("fs"); const e=process.env; fs.writeFileSync("${log}/overnight.json", JSON.stringify({argv:process.argv.slice(1), cwd:process.cwd(), model:e.MODEL??null, scope:e.SCOPE??null, focus:e.FOCUS??null, stop:e.STOP_AT??null, claudecode:e.CLAUDECODE??null, entrypoint:e.CLAUDE_CODE_ENTRYPOINT??null, configDir:e.CLAUDE_CONFIG_DIR??null, pathHead:(e.PATH||"").split(":")[0]})+"\\n")' -- "$@"`,
      `if [ -e "${log}/overnight.quick" ]; then exit 3; fi`,
      'sleep 900',
      '',
    ].join('\n'),
  );
  writeExecutable(
    path.join(qa, 'fakes/bin/sc'),
    [
      '#!/bin/sh',
      `node -e 'const fs=require("fs"); fs.writeFileSync("${log}/sc.json", JSON.stringify({argv:process.argv.slice(1), cwd:process.cwd()})+"\\n")' -- "$@"`,
      "printf 'started\\n'",
      'sleep 900',
      '',
    ].join('\n'),
  );
  writeExecutable(
    path.join(qa, 'fakes/bin/systemd-inhibit'),
    ['#!/bin/sh', 'while [ "$#" -gt 0 ]; do case "$1" in --*) shift ;; *) break ;; esac; done', 'exec "$@"', ''].join('\n'),
  );
  for (const name of ['sc', 'systemd-inhibit']) fs.copyFileSync(path.join(qa, 'fakes/bin', name), path.join(qa, 'fakes/nosh', name));
  fs.chmodSync(path.join(qa, 'fakes/nosh/sc'), 0o755);
  fs.chmodSync(path.join(qa, 'fakes/nosh/systemd-inhibit'), 0o755);
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git config user.name qa && git config user.email qa@example.test && git add -A && git -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function sh(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execSync(command, { cwd, encoding: 'utf8', env, shell: '/bin/sh' });
}

function gitStatus(dir: string): string {
  return sh('git status --porcelain', dir);
}

function pathOf(qa: string, first: string): string {
  return `${path.join(qa, first)}:${NODEBIN}:/usr/bin:/bin`;
}

function serverEnv(searchPath: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  env.PATH = searchPath;
  env.CLAUDECODE = '1';
  env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  env.CLAUDE_CONFIG_DIR = '/tmp/qa/claude';
  return env;
}

function waitForLines(child: ChildProcess, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let err = '';
    const onData = (chunk: Buffer): void => {
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
      else reject(new Error(`server exited ${code} before ${count} lines: ${buf}${err}`));
    });
  });
}

async function startServer(cwd: string, searchPath: string): Promise<Server> {
  const child = spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
    cwd,
    env: serverEnv(searchPath),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const lines = await waitForLines(child, 2);
  const match = new RegExp(`^bindweed: http://127\\.0\\.0\\.1:${PORT}/\\?token=([0-9a-f]{32})$`).exec(lines[0]);
  expect(match).not.toBeNull();
  expect(lines[1]).toBe(`serving ${cwd}`);
  return { child, token: match?.[1] ?? '' };
}

function stopServer(child: ChildProcess, signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    signalGroup(child.pid, signal);
  });
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function runsOf(root: string): Run[] {
  const file = path.join(root, '.bindweed/runs.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Run[];
}

function lastPid(root: string): number {
  const runs = runsOf(root);
  return runs[runs.length - 1].pid;
}

function requestHttp(urlStr: string, method: string, token: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout ${method} ${urlStr}`)));
    req.on('error', reject);
    req.end(body);
  });
}

function box(page: Page, name: string): Locator {
  return page.locator('.box:not(.ghost)').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function launchDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Launch' });
}

function field(page: Page, label: string): Locator {
  return launchDialog(page).getByRole('textbox', { name: label, exact: true });
}

function toolSelect(page: Page): Locator {
  return launchDialog(page).getByRole('combobox', { name: 'Tool', exact: true });
}

function launchButton(page: Page): Locator {
  return launchDialog(page).getByRole('button', { name: 'Launch', exact: true });
}

function steps(page: Page): Locator {
  return launchDialog(page).getByRole('list', { name: 'Steps' }).locator('li');
}

function codes(page: Page): Locator {
  return launchDialog(page).locator('code');
}

async function openLaunch(page: Page): Promise<Locator> {
  await page.locator('.arch-toolbar').getByRole('button', { name: 'Launch', exact: true }).click();
  const dialog = launchDialog(page);
  await expect(dialog).toBeVisible();
  await expect(toolSelect(page)).toBeVisible();
  return dialog;
}

async function closeLaunch(page: Page): Promise<void> {
  await launchDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(launchDialog(page)).toHaveCount(0);
}

async function expectFields(page: Page, values: Record<string, string>): Promise<void> {
  for (const [label, value] of Object.entries(values)) await expect(field(page, label)).toHaveValue(value);
}

async function copyLine(page: Page, label: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await launchDialog(page).getByRole('button', { name: label, exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
  return page.evaluate(() => navigator.clipboard.readText());
}

async function cutArrow(page: Page, from: string, to: string): Promise<void> {
  await expect(arrow(page, from, to)).toHaveCount(1);
  await page.evaluate(
    ({ fromStr, toStr }) => {
      const arrowG = document.querySelector(`g.arrow[data-from="${fromStr}"][data-to="${toStr}"]`);
      const target = arrowG?.querySelector('path.react-flow__edge-interaction') ?? arrowG?.querySelector('path') ?? arrowG;
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    { fromStr: from, toStr: to },
  );
  await expect(arrow(page, from, to)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(arrow(page, from, to)).toHaveCount(0);
}

async function createPlan(page: Page, name: string, slug: string): Promise<void> {
  await page.getByRole('button', { name: 'New plan…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New plan' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=${slug}`);
}

async function open(page: Page, token: string, hash: string): Promise<void> {
  await page.goto(`${ORIGIN}/?token=${token}#${hash}`);
  await expect(page).toHaveURL(`${ORIGIN}/#${hash}`);
  await expect(box(page, 'app')).toBeVisible();
}

function cleanUp(layered: string, worktree: string): void {
  for (const run of runsOf(layered)) signalGroup(run.pid, 'SIGKILL');
  if (fs.existsSync(path.join(layered, '.git'))) {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: layered });
    spawnSync('git', ['worktree', 'prune'], { cwd: layered });
    spawnSync('git', ['branch', '-D', 'bindweed/gate'], { cwd: layered });
  }
  fs.rmSync(worktree, { recursive: true, force: true });
}

test('qa: launch a plan as a run in its own worktree', async ({ page, context }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  ensureUiBuilt(BW);

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  const worktree = path.join(QA, 'layered-bw-gate');
  const log = path.join(QA, 'log');
  const fakesPath = pathOf(QA, 'fakes/bin');
  const noshPath = pathOf(QA, 'fakes/nosh');
  writeFakes(QA);
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), layered, { recursive: true });
  commitFixture(layered);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await page.setViewportSize({ width: 1800, height: 1000 });

  let server: Server | null = null;
  let preview = '';
  let pid = 0;

  try {
    await test.step('1. the fakes are found and the page has no Launch without a plan', async () => {
      const env = { ...process.env, PATH: fakesPath };
      expect(sh('command -v marestail', QA, env).trim()).toBe(path.join(QA, 'fakes/bin/marestail'));
      expect(sh('command -v sc', QA, env).trim()).toBe(path.join(QA, 'fakes/bin/sc'));
      server = await startServer(layered, fakesPath);
      await open(page, server.token, 'at=src');
      await expect(box(page, 'app').locator('.box-count')).toHaveText('2 files');
      await expect(box(page, 'infra')).toBeVisible();
      await expect(box(page, 'domain')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Launch', exact: true })).toHaveCount(0);
    });

    await test.step('2. Empty has no tasks, so Launch is disabled with the reason', async () => {
      await createPlan(page, 'Empty', 'empty');
      const names = await page.locator('.arch-toolbar button').evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''),
      );
      expect(names.indexOf('Launch')).toBe(names.indexOf('Tasks') + 1);
      expect(names.indexOf('Settings')).toBe(names.indexOf('Launch') + 1);
      const dialog = await openLaunch(page);
      await expect(toolSelect(page)).toHaveValue('marestail');
      await expectFields(page, { ...DEFAULTS, FOCUS: '' });
      await expect(dialog.getByText('this plan has no tasks', { exact: true })).toBeVisible();
      await expect(launchButton(page)).toBeDisabled();
    });

    await test.step('3. slop-cannon shows its own fields and needs a brief', async () => {
      const dialog = launchDialog(page);
      await toolSelect(page).selectOption('slop-cannon');
      for (const label of Object.keys(DEFAULTS)) await expect(field(page, label)).toHaveCount(0);
      await expect(dialog.getByRole('combobox', { name: 'Safety', exact: true })).toHaveValue('on');
      await expectFields(page, { Ammo: '', Cartridge: '' });
      await expect(dialog.getByText('this plan has no brief', { exact: true })).toBeVisible();
      await expect(launchButton(page)).toBeDisabled();
    });

    await test.step('4. without marestail on PATH Launch says so', async () => {
      await closeLaunch(page);
      await stopServer(server!.child);
      server = await startServer(layered, noshPath);
      await open(page, server.token, 'at=src&plan=empty');
      const dialog = await openLaunch(page);
      await expect(dialog.getByText('marestail is not on PATH', { exact: true })).toBeVisible();
      await expect(launchButton(page)).toBeDisabled();
      await toolSelect(page).selectOption('slop-cannon');
      await expect(dialog.getByText('this plan has no brief', { exact: true })).toBeVisible();
      await expect(dialog.getByText('marestail is not on PATH', { exact: true })).toHaveCount(0);
      await expect(launchButton(page)).toBeDisabled();
    });

    await test.step('5. Gate gets a cut, a saved contract, tasks and a brief', async () => {
      await closeLaunch(page);
      await stopServer(server!.child);
      server = await startServer(layered, fakesPath);
      await open(page, server.token, 'at=src');
      await createPlan(page, 'Gate', 'gate');
      await cutArrow(page, 'src/app', 'src/domain');
      const contract = page.getByRole('dialog', { name: 'Contract' });
      await page.getByRole('button', { name: 'Contract', exact: true }).click();
      await contract.getByRole('button', { name: 'Save to plan', exact: true }).click();
      await expect(contract).toHaveCount(0);
      await page.getByRole('button', { name: 'Contract', exact: true }).click();
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await contract.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
      preview = await page.evaluate(() => navigator.clipboard.readText());
      fs.writeFileSync(path.join(QA, 'preview.cjs'), preview);
      await contract.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(contract).toHaveCount(0);

      const planUrl = `${ORIGIN}/api/plans/gate`;
      await expect.poll(async () => (await requestHttp(planUrl, 'GET', server!.token)).body).toContain('"contract"');
      const got = await requestHttp(planUrl, 'GET', server!.token);
      expect(got.status).toBe(200);
      const doc = JSON.parse(got.body) as Record<string, unknown>;
      doc.tasks = TASKS;
      doc.brief = BRIEF;
      const put = await requestHttp(planUrl, 'PUT', server!.token, JSON.stringify(doc));
      expect(put.status).toBe(200);

      await open(page, server.token, 'at=src&plan=gate');
      await expect(page.locator('aside[aria-label="changes"] .change-sentence')).toHaveText([SENTENCE]);
      await page.getByRole('button', { name: 'Tasks', exact: true }).click();
      const tasks = page.getByRole('dialog', { name: 'Tasks' });
      await expect(tasks.locator('.tasks-file')).toHaveText(TASKS.map((task) => task.file));
      await expect(tasks.getByRole('textbox', { name: 'Brief', exact: true })).toHaveValue(/^# Reshape layered/);
      await tasks.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(tasks).toHaveCount(0);
    });

    await test.step('6. Close and Escape launch nothing, and Close refills from GET', async () => {
      await openLaunch(page);
      await closeLaunch(page);
      await openLaunch(page);
      await page.keyboard.press('Escape');
      await expect(launchDialog(page)).toHaveCount(0);
      expect(fs.existsSync(worktree)).toBe(false);

      await openLaunch(page);
      await expectFields(page, DEFAULTS);
      await field(page, 'MODEL').fill('mine');
      await field(page, 'SCOPE').fill('narrow');
      await toolSelect(page).selectOption('slop-cannon');
      await field(page, 'Ammo').fill('3');
      await toolSelect(page).selectOption('marestail');
      await expectFields(page, { MODEL: 'mine', SCOPE: 'narrow' });
      await toolSelect(page).selectOption('slop-cannon');
      await expectFields(page, { Ammo: '3', Cartridge: '' });
      await toolSelect(page).selectOption('marestail');
      await expectFields(page, { MODEL: 'mine', SCOPE: 'narrow' });
      await closeLaunch(page);
      expect(fs.existsSync(worktree)).toBe(false);

      await openLaunch(page);
      await expectFields(page, DEFAULTS);
      await expect(launchButton(page)).toBeEnabled();
      await launchButton(page).click();
    });

    await test.step('7. five ticks, the form stays, and the three lines copy', async () => {
      const dialog = launchDialog(page);
      await expect(steps(page)).toHaveText(TICKS, { timeout: 30_000 });
      await expect(toolSelect(page)).toHaveValue('marestail');
      await expectFields(page, DEFAULTS);
      for (const label of Object.keys(DEFAULTS)) await expect(field(page, label)).toBeEditable();
      await expect(dialog.getByText(ALIVE, { exact: true })).toBeVisible();
      await expect(launchButton(page)).toBeDisabled();
      await expect(codes(page)).toHaveText([worktree, 'bindweed/gate', 'marestail watch']);
      expect(await copyLine(page, 'Copy worktree')).toBe(worktree);
      expect(await copyLine(page, 'Copy branch')).toBe('bindweed/gate');
      expect(await copyLine(page, 'Copy command')).toBe('marestail watch');
    });

    await test.step('8. the run outlives bindweed and blocks the next launch', async () => {
      pid = lastPid(layered);
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(true);
      await stopServer(server!.child);
      server = null;
      expect(alive(pid)).toBe(true);
      server = await startServer(layered, fakesPath);
      await open(page, server.token, 'at=src&plan=gate');
      const dialog = await openLaunch(page);
      await expect(dialog.getByText(ALIVE, { exact: true })).toBeVisible();
      await expect(launchButton(page)).toBeDisabled();
      await expect(codes(page)).toHaveText([worktree, 'bindweed/gate', 'marestail watch']);
      expect(alive(pid)).toBe(true);
    });

    await test.step('9. one commit with the tasks, the contract and the install; overnight saw the settings', async () => {
      const message = sh("git log -1 --format='%s%n%n%b'", worktree);
      expect(message).toMatch(new RegExp(`^bindweed: Gate\\n\\n${SENTENCE.replace(/[()]/g, '\\$&')}\\nPlan: gate\\nBase: [0-9a-f]{40}\\n`));
      expect(sh('git rev-parse HEAD~1', worktree)).toBe(sh('git rev-parse HEAD', layered));
      expect(sh('git diff-tree --no-commit-id --name-only -r HEAD', worktree).trimEnd().split('\n')).toEqual([
        '.dependency-cruiser.cjs',
        '.gitignore',
        'marestail.toml',
        'tasks/005-add-core.md',
        'tasks/006-move-b.md',
        'tasks/007-cut-app-domain.md',
        'tasks/README.md',
      ]);
      expect(fs.readFileSync(path.join(worktree, '.dependency-cruiser.cjs'), 'utf8')).toBe(preview);

      const overnightFile = path.join(log, 'overnight.json');
      await expect.poll(() => fs.existsSync(overnightFile), { timeout: 15_000 }).toBe(true);
      const overnight = JSON.parse(fs.readFileSync(overnightFile, 'utf8')) as Record<string, unknown>;
      expect(overnight.argv).toEqual(TASKS.map((task) => `tasks/${task.file}`));
      expect([overnight.model, overnight.scope, overnight.focus, overnight.stop, overnight.claudecode, overnight.pathHead]).toEqual([
        'dandelion/route-best',
        'hard',
        FOCUS,
        'qa',
        null,
        path.join(QA, 'fakes/bin'),
      ]);

      const scripts = fs.readdirSync(path.join(worktree, '.marestail/runs')).filter((name) => /^launch-\d{8}T\d{4}\.sh$/.test(name));
      expect(scripts).toHaveLength(1);
      const script = fs.readFileSync(path.join(worktree, '.marestail/runs', scripts[0]), 'utf8').split('\n');
      expect(script.filter((line) => line.includes("systemd-inhibit --what=idle --who=bindweed --why='bindweed gate'"))).toHaveLength(1);
      expect(script.filter((line) => line.includes(path.join(QA, 'fakes/tools/overnight.sh')))).toHaveLength(1);
      expect(fs.existsSync(path.join(worktree, '.marestail/runs', scripts[0].replace(/\.sh$/, '.out')))).toBe(true);

      expect(fs.readFileSync(path.join(worktree, 'marestail.toml'), 'utf8')).toBe('installed=1\n');
      expect(fs.readFileSync(path.join(worktree, 'tasks/README.md'), 'utf8')).toBe('qa tasks\n');
      expect(fs.readFileSync(path.join(worktree, '.gitignore'), 'utf8')).toBe('qa-ignore\n');
      expect(gitStatus(worktree)).toBe('?? .marestail/\n');
      expect(gitStatus(layered)).toBe('');
      expect(fs.existsSync(path.join(layered, '.dependency-cruiser.cjs'))).toBe(false);
      expect(fs.readFileSync(path.join(log, 'marestail.log'), 'utf8')).toBe('install .\n');
    });

    await test.step('10. an existing branch stops at Worktree and creates nothing', async () => {
      signalGroup(pid, 'SIGKILL');
      await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
      sh(`git worktree remove --force '${worktree}'`, layered);
      sh('git branch -D bindweed/gate', layered);
      sh('git branch bindweed/gate', layered);

      await closeLaunch(page);
      await openLaunch(page);
      await expectFields(page, DEFAULTS);
      await expect(launchButton(page)).toBeEnabled();
      await launchButton(page).click();
      await expect(steps(page)).toHaveText(["Worktree a branch named 'bindweed/gate' already exists"]);
      await expect(steps(page).filter({ hasText: '✓' })).toHaveCount(0);
      await expect(launchDialog(page).getByRole('button', { name: 'Copy worktree', exact: true })).toHaveCount(0);
      await expect(toolSelect(page)).toHaveValue('marestail');
      await expectFields(page, DEFAULTS);
      await expect(launchButton(page)).toBeEnabled();
      expect(fs.existsSync(worktree)).toBe(false);
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('11. from the same dialog, slop-cannon launches with the brief', async () => {
      sh('git branch -D bindweed/gate', layered);
      const dialog = launchDialog(page);
      await toolSelect(page).selectOption('slop-cannon');
      await expect(dialog.getByRole('combobox', { name: 'Safety', exact: true })).toHaveValue('on');
      await expectFields(page, { Ammo: '', Cartridge: '' });
      await launchButton(page).click();
      await expect(steps(page)).toHaveText(TICKS, { timeout: 30_000 });
      const watch = `sc status --repo ${worktree}`;
      await expect(codes(page).last()).toHaveText(watch);
      expect(await copyLine(page, 'Copy command')).toBe(watch);

      const scFile = path.join(log, 'sc.json');
      await expect.poll(() => fs.existsSync(scFile), { timeout: 15_000 }).toBe(true);
      const sc = JSON.parse(fs.readFileSync(scFile, 'utf8')) as { argv: string[]; cwd: string };
      expect(sc.cwd).toBe(layered);
      expect(sc.argv).toEqual(['--repo', worktree, '--headless', '--safety', 'on', '-m', BRIEF]);
      expect(fs.existsSync(path.join(worktree, 'tasks/005-add-core.md'))).toBe(false);
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('12. stop the run and remove its worktree', async () => {
      pid = lastPid(layered);
      expect(alive(pid)).toBe(true);
      signalGroup(pid, 'SIGKILL');
      sh(`git worktree remove --force '${worktree}'`, layered);
      sh('git branch -D bindweed/gate', layered);
      await stopServer(server!.child);
      server = null;
      expect(gitStatus(layered)).toBe('');
      expect(sh('git worktree list', layered).trimEnd().split('\n')).toHaveLength(1);
    });
  } finally {
    const left: Server | null = server;
    if (left !== null) await stopServer((left as Server).child, 'SIGKILL');
    cleanUp(layered, worktree);
    fs.rmSync(QA, { recursive: true, force: true });
  }
});
