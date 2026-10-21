import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectLaunch, launchPlan } from './launch.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp } from './serve.ts';
import type { PlanDoc, PlanEdit } from './domain/plan.ts';
import type { LaunchBody, LaunchResult } from './domain/launch.ts';

const CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const TASKS = [
  { file: '005-add-core.md', title: 'Add the core package', body: '# 005 — Add the core package\n\nCreate src/core.\n' },
  { file: '006-move-b.md', title: 'Move b into infra', body: '# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n' },
  { file: '007-cut-app-domain.md', title: 'Cut app from domain', body: '# 007 — Cut app from domain\n\nNo behaviour changes.\n' },
];
const BRIEF = '# Reshape layered\n\nMove b, then cut app from domain.\n';
const MARE: LaunchBody = { tool: 'marestail', model: 'dandelion/route-best', scope: 'hard', focus: 'src/app/a.ts src/domain/model.ts', stopAt: 'qa' };
const SC: LaunchBody = { tool: 'slop-cannon', safety: 'on', ammo: '', cartridge: '' };
const OK = ['Worktree', 'Files', 'Commit', 'Start', 'Record'].map(name => ({ name, ok: true }));
let outer: string;
let root: string;
let bin: string;
let log: string;
let worktree: string;
let env: NodeJS.ProcessEnv;
let app: Exclude<Awaited<ReturnType<typeof bindApp>>, { error: unknown }>;
let doc: PlanDoc;
let base: string;
let pids: number[];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trimEnd();
}

async function text(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function json(path: string) {
  return JSON.parse(await text(path));
}

async function fake(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
}

async function waitFor(path: string) {
  await vi.waitFor(() => expect(existsSync(path)).toBe(true), { timeout: 5000 });
  return json(path);
}

async function request(path: string, method = 'GET', body?: unknown, authorized = true) {
  const response = await fetch(`http://127.0.0.1:${app.port}${path}`, { method, headers: authorized ? { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function launch(body: unknown = MARE): Promise<{ status: number; body: LaunchResult }> {
  const answer = await request('/api/plans/gate/launch', 'POST', body);
  if (answer.body.pid) pids.push(answer.body.pid);
  return answer;
}

async function put(extra: Partial<PlanDoc>) {
  doc = { ...doc, ...extra };
  return request('/api/plans/gate', 'PUT', doc);
}

async function restart() {
  await new Promise<void>(done => app.server.close(() => done()));
  const bound = await bindApp({ repoRoot: root, uiDir: join(outer, 'ui'), env }, { mode: 'fixed', port: 0 });
  if ('error' in bound) throw new Error('bind failed');
  app = { ...bound, port: (bound.server.address() as { port: number }).port };
}

async function flag(name: string) {
  await writeFile(join(log, name), '');
}

function commitFile(path: string, value: string) {
  return writeFile(join(root, path), value).then(() => {
    git(root, 'add', '--', path);
    git(root, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'extra');
  });
}

async function installFailure(name: string, error: string) {
  await flag(name);
  const result = await launch();
  expect(result).toEqual({ status: 200, body: { steps: [OK[0], { name: 'Files', ok: false, error }], worktree, branch: 'bindweed/gate' } });
  expect(git(worktree, 'rev-parse', 'HEAD')).toBe(base);
  expect(existsSync(join(worktree, 'marestail.toml'))).toBe(false);
}

async function removeCommand(missing: string | null) {
  if (missing === null) return;
  await rm(join(bin, missing));
  const path = join(outer, 'restricted');
  await mkdir(path);
  const other = missing === 'sc' ? 'marestail' : 'sc';
  await symlink(join(bin, other), join(path, other));
  env.PATH = path;
}

async function unchangedRuns(file: string, runs: unknown[]) {
  if (runs.length) expect(await text(file)).toBe(JSON.stringify(runs));
  else expect(existsSync(file)).toBe(false);
}

async function setupFakes() {
  await fake(join(bin, 'marestail'), `#!/bin/bash
printf '%s\\n' "$*" >> "$LOG/marestail.log"
if [[ "$1" == install ]]; then
  [[ -f "$LOG/fail-install-many" ]] && { printf 'install failed\\nmore detail\\n' >&2; exit 1; }
  [[ -f "$LOG/fail-install" ]] && { echo 'install failed' >&2; exit 1; }
  [[ -f "$LOG/fail-install-quiet" ]] && exit 1
  [[ -f "$LOG/fail-install-killed" ]] && kill -9 $$
  while [[ -f "$LOG/install.wait" && ! -f "$LOG/install.go" ]]; do sleep .01; done
  printf 'installed=1\\n' > marestail.toml
  /bin/mkdir -p tasks
  printf 'qa tasks\\n' > tasks/README.md
  printf 'qa-ignore\\n' >> .gitignore
fi
exit 0
`);
  await fake(join(bin, '../tools/overnight.sh'), `#!/bin/bash
"${process.execPath}" -e 'const e=process.env; require("fs").writeFileSync(e.LOG+"/overnight.json",JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),model:e.MODEL??null,scope:e.SCOPE??null,focus:e.FOCUS??null,stop:e.STOP_AT??null,claudecode:e.CLAUDECODE??null,entrypoint:e.CLAUDE_CODE_ENTRYPOINT??null,configDir:e.CLAUDE_CONFIG_DIR??null,pathHead:e.PATH.split(":")[0]}))' "$@"
[[ -f "$LOG/overnight.quick" ]] && exit 3
sleep 30
`);
  await fake(join(bin, 'sc'), `#!${process.execPath}
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(log, 'sc.json'))}, JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));
console.log('started');
setTimeout(()=>{},30000);
`);
  await fake(join(bin, 'systemd-inhibit'), '#!/bin/bash\nwhile [[ "$1" == --* ]]; do shift; done\nexec "$@"\n');
}

beforeEach(async () => {
  pids = [];
  outer = await mkdtemp(join(tmpdir(), 'bw-launch space-'));
  root = join(outer, 'layered');
  worktree = `${root}-bw-gate`;
  bin = join(outer, 'fakes/bin');
  log = join(outer, 'log');
  env = { ...process.env, LOG: log, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: '/tmp/qa/claude', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  await cp(join(process.cwd(), 'qa/fixtures/layered'), root, { recursive: true });
  await mkdir(log);
  await mkdir(join(outer, 'ui/assets'), { recursive: true });
  await writeFile(join(outer, 'ui/index.html'), '<title>bindweed</title>');
  await setupFakes();
  git(root, 'init', '-q', '--template=');
  git(root, 'config', 'user.name', 'qa');
  git(root, 'config', 'user.email', 'qa@example.test');
  git(root, 'add', '-A');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  base = git(root, 'rev-parse', 'HEAD');
  await prepareBindweed(root);
  const bound = await bindApp({ repoRoot: root, uiDir: join(outer, 'ui'), env }, { mode: 'fixed', port: 0 });
  if ('error' in bound) throw new Error('bind failed');
  app = { ...bound, port: (bound.server.address() as { port: number }).port };
  doc = (await request('/api/plans', 'POST', { name: 'Gate' })).body;
  await put({ edits: [CUT], tasks: TASKS, brief: BRIEF });
  const rules = (await request('/api/plans/gate/contract')).body.rules;
  await put({ contract: { rules } });
});

afterEach(async () => {
  for (const pid of pids) {
    try { process.kill(-pid, 'SIGKILL'); } catch { pids = pids.filter(value => value !== pid); }
  }
  await new Promise<void>(done => app.server.close(() => done()));
  if (existsSync(worktree)) git(root, 'worktree', 'remove', '--force', worktree);
  await rm(outer, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('launch API', () => {
  it.each([
    { edits: [], focus: '' },
    { edits: [CUT], focus: 'src/app/a.ts src/domain/model.ts' },
    { edits: [{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }], focus: 'src/app/b.ts src/infra/b.ts' },
    { edits: [{ kind: 'rename-package', from: 'src/app', to: 'src/core' }], focus: 'src/app/a.ts src/app/b.ts src/core/a.ts src/core/b.ts' },
    { edits: [{ kind: 'create-package', path: 'src/ports' }], focus: 'src/ports' },
    { edits: [{ kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' }], focus: 'src/domain/model.ts' },
    { edits: [{ kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/infra/db.ts' }], focus: 'src/app/b.ts src/infra/db.ts' },
    { edits: [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }], focus: 'src/app/a.ts src/app/b.ts src/domain/model.ts' },
    { edits: [{ kind: 'move-file', file: 'src/missing.ts', to: 'src/infra' }], focus: '' },
  ] as { edits: PlanEdit[]; focus: string }[])('Focus joins the current files and the planned paths', async ({ edits, focus }) => {
    await put({ edits, redo: [{ kind: 'create-package', path: 'src/ignored' }] });
    expect((await request('/api/plans/gate/launch')).body).toEqual({ marestail: true, sc: true, alive: false, focus });
  });

  it('Marestail commits the tasks, the contract and a fresh install, then sleeps detached', async () => {
    const bytes = await text(join(root, '.bindweed/plans/gate.json'));
    expect((await request('/api/plans/gate/launch')).body).toEqual({ marestail: true, sc: true, alive: false, focus: MARE.focus });
    const preview = (await request('/api/plans/gate/contract', 'POST', { names: (doc.contract?.rules ?? []).map(rule => rule.name) })).body.text;
    const { status, body } = await launch();
    expect(status).toBe(200);
    expect(body).toEqual({ steps: OK, worktree, branch: 'bindweed/gate', watch: 'marestail watch', pid: expect.any(Number) });
    expect(git(worktree, 'rev-parse', 'HEAD^')).toBe(base);
    expect(git(worktree, 'show', '-s', '--format=%an <%ae>%n%cn <%ce>%n%G?')).toBe('qa <qa@example.test>\nqa <qa@example.test>\nN');
    expect(git(worktree, 'show', '-s', '--format=%B')).toBe(`bindweed: Gate\n\nsrc/app must not import src/domain (1 import)\nPlan: gate\nBase: ${base}`);
    expect(git(worktree, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n')).toEqual(['.dependency-cruiser.cjs', '.gitignore', 'marestail.toml', ...TASKS.map(task => `tasks/${task.file}`), 'tasks/README.md']);
    for (const task of TASKS) expect(await text(join(worktree, 'tasks', task.file))).toBe(task.body);
    expect(await text(join(worktree, '.dependency-cruiser.cjs'))).toBe(preview);
    expect(await text(join(worktree, 'tasks/README.md'))).toBe('qa tasks\n');
    expect(await text(join(worktree, '.gitignore'))).toBe('qa-ignore\n');
    expect(await text(join(worktree, 'marestail.toml'))).toBe('installed=1\n');
    expect(git(worktree, 'status', '--porcelain')).toBe('?? .marestail/');
    expect(await text(join(log, 'marestail.log'))).toBe('install .\n');
    expect(await waitFor(join(log, 'overnight.json'))).toEqual({ argv: TASKS.map(task => `tasks/${task.file}`), cwd: worktree, model: MARE.model, scope: MARE.scope, focus: MARE.focus, stop: MARE.stopAt, claudecode: null, entrypoint: null, configDir: null, pathHead: bin });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    expect(run).toEqual({ slug: 'gate', tool: 'marestail', worktree, branch: 'bindweed/gate', pid: body.pid, startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/), out: expect.stringMatching(/launch-\d{8}T\d{4}\.out$/), settings: { model: MARE.model, scope: MARE.scope, focus: MARE.focus, stopAt: MARE.stopAt } });
    expect((await text(run.out)).split('\n')[0]).toBe(`start pid=${body.pid} model=${MARE.model} scope=hard focus=${MARE.focus} stop=qa`);
    const script = await text(run.out.replace(/out$/, 'sh'));
    expect(script).toContain("systemd-inhibit --what=idle --who=bindweed --why='bindweed gate'");
    expect(script).toContain(`'${join(bin, '../tools/overnight.sh')}'`);
    expect(await text(join(root, '.bindweed/plans/gate.json'))).toBe(bytes);
    expect(existsSync(join(root, '.dependency-cruiser.cjs'))).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(base);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(() => git(root, 'config', '--get', 'commit.gpgsign')).toThrow();
    expect((await request('/api/plans/gate/launch')).body).toEqual({ marestail: true, sc: true, alive: true, focus: MARE.focus, worktree, branch: 'bindweed/gate', watch: 'marestail watch' });
    await restart();
    expect(() => process.kill(Number(body.pid), 0)).not.toThrow();
  });

  it('The fields are what was sent, and a blank scope omits SCOPE', async () => {
    env.SCOPE = 'inherited';
    await launch({ ...MARE, model: 'other', scope: '  ', focus: ' src/only.ts ', stopAt: 'coder' });
    expect(await waitFor(join(log, 'overnight.json'))).toMatchObject({ model: 'other', scope: null, focus: 'src/only.ts', stop: 'coder' });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    expect(run.settings).toEqual({ model: 'other', scope: '', focus: 'src/only.ts', stopAt: 'coder' });
    expect(await text(run.out)).toContain('model=other scope=none focus=src/only.ts stop=coder');
  });

  it('Without systemd-inhibit the overnight command still runs', async () => {
    const no = join(outer, 'nosystemd');
    await mkdir(no);
    for (const name of ['git', 'bash', 'setsid', 'sh', 'sleep']) await symlink(await realpath(execFileSync('which', [name], { encoding: 'utf8' }).trim()), join(no, name));
    await cp(join(bin, 'marestail'), join(no, 'marestail'));
    await cp(join(bin, 'sc'), join(no, 'sc'));
    await mkdir(join(outer, 'tools'));
    await cp(join(bin, '../tools/overnight.sh'), join(outer, 'tools/overnight.sh'));
    env.PATH = no;
    await launch();
    expect(await waitFor(join(log, 'overnight.json'))).toMatchObject({ argv: TASKS.map(task => `tasks/${task.file}`), model: MARE.model });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    const script = await text(run.out.replace(/out$/, 'sh'));
    expect(script).not.toContain('systemd-inhibit');
    expect(script).toContain(`'${await realpath('/bin/bash')}'`);
    expect(script).not.toMatch(/(?:^|\s)bash(?:\s|$)/);
  });

  it('Typed values reach overnight.sh unchanged', async () => {
    const focus = 'src/$HOME "x" \'y\' `echo surprise`';
    const { body } = await launch({ ...MARE, model: 'a b', focus });
    expect(await waitFor(join(log, 'overnight.json'))).toMatchObject({ model: 'a b', scope: 'hard', focus, stop: 'qa' });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    expect((await text(run.out)).split('\n')[0]).toBe(`start pid=${body.pid} model=a b scope=hard focus=${focus} stop=qa`);
    const script = await text(run.out.replace(/out$/, 'sh'));
    expect(script).toContain("MODEL='a b'");
    expect(script).toContain(String.raw`FOCUS='src/$HOME "x" '\''y'\'' ` + "`echo surprise`'");
    expect(script).toContain(`cd '${worktree}'`);
  });

  it('A run that exits by itself is not left alive', async () => {
    await flag('overnight.quick');
    const { body } = await launch();
    const [run] = await json(join(root, '.bindweed/runs.json'));
    await vi.waitFor(async () => expect(await text(run.out)).toMatch(/exit 3 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/));
    await vi.waitFor(() => expect(() => process.kill(Number(body.pid), 0)).toThrow());
    expect((await request('/api/plans/gate/launch')).body).toMatchObject({ alive: false });
    expect((await request('/api/plans/gate/launch')).body).not.toHaveProperty('worktree');
    expect((await launch()).body).toEqual({ steps: [{ name: 'Worktree', ok: false, error: "a branch named 'bindweed/gate' already exists" }] });
  });

  it("The overnight script is the real marestail's sibling, and PATH gets the directory that was found", async () => {
    const real = join(outer, 'real-install');
    await mkdir(join(real, 'bin'), { recursive: true });
    await mkdir(join(real, 'tools'));
    await cp(join(bin, 'marestail'), join(real, 'bin/marestail'));
    await cp(join(bin, '../tools/overnight.sh'), join(real, 'tools/overnight.sh'));
    await rm(join(bin, 'marestail'));
    await symlink(join(real, 'bin/marestail'), join(bin, 'marestail'));
    await launch();
    expect(await waitFor(join(log, 'overnight.json'))).toMatchObject({ pathHead: bin });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    const script = await text(run.out.replace(/out$/, 'sh'));
    expect(script).toContain(`'${join(real, 'tools/overnight.sh')}'`);
    expect(script).not.toContain(join(bin, '../tools/overnight.sh'));
  });

  it('An existing marestail.toml is left alone', async () => {
    await commitFile('marestail.toml', 'kept\n');
    expect((await launch()).body.steps).toEqual(OK);
    expect(await text(join(worktree, 'marestail.toml'))).toBe('kept\n');
    expect(existsSync(join(log, 'marestail.log'))).toBe(false);
    expect(git(worktree, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).not.toContain('marestail.toml');
  });

  it.each([{ edits: [] }, { edits: [CUT, { kind: 'note', target: { node: 'src/domain' }, text: 'keep' }] }] as { edits: PlanEdit[] }[])('The commit body is the sentences, then Plan and Base', async ({ edits }) => {
    await put({ edits, contract: undefined });
    await launch({ ...MARE, focus: '' });
    const sentences = edits.length === 0 ? '' : 'src/app must not import src/domain (1 import)\nNote on src/domain: "keep"\n';
    expect(git(worktree, 'show', '-s', '--format=%b')).toBe(`${sentences}Plan: gate\nBase: ${base}`);
  });

  it("Base is the plan's baseCommit even when that is not HEAD", async () => {
    await put({ baseCommit: 'a'.repeat(40) });
    await launch();
    expect(git(worktree, 'show', '-s', '--format=%b')).toContain(`Base: ${'a'.repeat(40)}`);
    expect(git(worktree, 'rev-parse', 'HEAD^')).toBe(base);
  });

  it('Slop-cannon commits the contract only and passes the brief through', async () => {
    const preview = (await request('/api/plans/gate/contract', 'POST', { names: (doc.contract?.rules ?? []).map(rule => rule.name) })).body.text;
    const { body } = await launch(SC);
    expect(body).toEqual({ steps: OK, worktree, branch: 'bindweed/gate', watch: `sc status --repo ${worktree}`, pid: expect.any(Number) });
    expect(git(worktree, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).toBe('.dependency-cruiser.cjs');
    expect(await text(join(worktree, '.dependency-cruiser.cjs'))).toBe(preview);
    expect(existsSync(join(worktree, 'tasks/005-add-core.md'))).toBe(false);
    expect(existsSync(join(worktree, 'marestail.toml'))).toBe(false);
    expect(await waitFor(join(log, 'sc.json'))).toEqual({ cwd: root, argv: ['--repo', worktree, '--headless', '--safety', 'on', '-m', BRIEF] });
    const [run] = await json(join(root, '.bindweed/runs.json'));
    expect(await text(run.out)).toContain('started');
    expect(run).toMatchObject({ tool: SC.tool, settings: { safety: 'on', ammo: '', cartridge: '' } });
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(log, 'overnight.json'))).toBe(false);
    expect(await launch({ ...SC, safety: 'off', ammo: '3', cartridge: 'wide' })).toEqual({ status: 409, body: { error: 'a run for this plan is still alive' } });
  });

  it('Ammo and cartridge are flags only when they are not blank', async () => {
    await launch({ ...SC, safety: 'off', ammo: ' 3 ', cartridge: ' wide ' });
    expect(await waitFor(join(log, 'sc.json'))).toEqual({ cwd: root, argv: ['--repo', worktree, '--headless', '--safety', 'off', '--ammo', '3', '--cartridge', 'wide', '-m', BRIEF] });
  });

  it('Slop-cannon with no contract still commits the message and starts', async () => {
    await put({ edits: [], contract: undefined });
    expect((await launch(SC)).body.steps).toEqual(OK);
    expect(git(worktree, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).toBe('');
    expect(git(worktree, 'show', '-s', '--format=%b')).toBe(`Plan: gate\nBase: ${base}`);
    expect((await waitFor(join(log, 'sc.json'))).argv.slice(-2)).toEqual(['-m', BRIEF]);
  });

  it('An existing branch stops at Worktree and changes nothing', async () => {
    git(root, 'branch', 'bindweed/gate');
    expect((await launch()).body).toEqual({ steps: [{ name: 'Worktree', ok: false, error: "a branch named 'bindweed/gate' already exists" }] });
    expect(existsSync(worktree)).toBe(false);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(existsSync(join(log, 'marestail.log'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('An existing directory stops at Worktree and does not create the branch', async () => {
    await mkdir(worktree);
    expect((await launch()).body).toEqual({ steps: [{ name: 'Worktree', ok: false, error: `${worktree} already exists` }] });
    expect(git(root, 'branch')).not.toContain('bindweed/gate');
    expect(git(root, 'status', '--porcelain')).toBe('');
    await rm(worktree, { recursive: true });
  });

  it('uses the saved rule names exactly as the contract preview does after edits change', async () => {
    await put({ edits: [] });
    const preview = (await request('/api/plans/gate/contract', 'POST', { names: (doc.contract?.rules ?? []).map(rule => rule.name) })).body.text;
    expect((await launch()).body.steps).toEqual(OK);
    expect(await text(join(worktree, '.dependency-cruiser.cjs'))).toBe(preview);
    expect(preview).not.toContain('bindweed:no-src-app-to-src-domain');
  });

  it('A cruiser file that 007 cannot merge stops at Files, with no commit', async () => {
    const source = 'const base = [];\nmodule.exports = { forbidden: [...base] };\n';
    await commitFile('.dependency-cruiser.cjs', source);
    const { body } = await launch();
    expect(body).toEqual({ steps: [OK[0], { name: 'Files', ok: false, error: "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array" }], worktree, branch: 'bindweed/gate' });
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(await text(join(worktree, '.dependency-cruiser.cjs'))).toBe(source);
    expect(existsSync(join(worktree, 'tasks', TASKS[0].file))).toBe(true);
    expect(existsSync(join(root, '.bindweed/runs.json'))).toBe(false);
    expect(existsSync(join(log, 'overnight.json'))).toBe(false);
  });

  it('A failing install stops at Files and does not commit', async () => {
    await installFailure('fail-install', 'install failed');
  });

  it('An install that prints nothing names the exit code', async () => {
    await installFailure('fail-install-quiet', 'marestail install exited with code 1');
  });

  it('an install killed by a signal names the command that failed', async () => {
    await installFailure('fail-install-killed', 'Command failed: marestail install .');
  });

  it('an install error uses only the first stderr line', async () => {
    await installFailure('fail-install-many', 'install failed');
  });

  it.each(['user.name', 'user.email'])('No git identity stops at Commit', async key => {
    git(root, 'config', '--unset', key);
    const { body } = await launch();
    expect(body).toEqual({ steps: [OK[0], OK[1], { name: 'Commit', ok: false, error: 'Author identity unknown' }], worktree, branch: 'bindweed/gate' });
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(base);
  });

  it('A file named .marestail stops Start and records nothing', async () => {
    await commitFile('.marestail', 'x\n');
    expect((await launch()).body).toEqual({ steps: [...OK.slice(0, 3), { name: 'Start', ok: false, error: `could not create ${worktree}/.marestail/runs` }], worktree, branch: 'bindweed/gate' });
    expect(await text(join(worktree, '.marestail'))).toBe('x\n');
    expect(existsSync(join(root, '.bindweed/runs.json'))).toBe(false);
    expect(existsSync(join(log, 'overnight.json'))).toBe(false);
    expect(git(worktree, 'rev-parse', 'HEAD^')).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('A second launch waits, and a recorded live pid blocks the next one', async () => {
    await flag('install.wait');
    const pending = launch();
    await vi.waitFor(() => expect(existsSync(join(log, 'marestail.log'))).toBe(true));
    expect(await launch()).toEqual({ status: 409, body: { error: 'already running' } });
    await flag('install.go');
    expect((await pending).body.steps).toEqual(OK);
    expect(await json(join(root, '.bindweed/runs.json'))).toHaveLength(1);
    expect(await launch()).toEqual({ status: 409, body: { error: 'a run for this plan is still alive' } });
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(2);
  });

  it.each(['not json\n', '{}\n', 'null\n'])('A runs.json that is not a list is left as it was', async bytes => {
    await writeFile(join(root, '.bindweed/runs.json'), bytes);
    const { body } = await launch();
    expect(body).toEqual({ steps: [...OK.slice(0, 4), { name: 'Record', ok: false, error: 'runs.json is not a list' }], worktree, branch: 'bindweed/gate', watch: 'marestail watch', pid: expect.any(Number) });
    expect(await text(join(root, '.bindweed/runs.json'))).toBe(bytes);
    expect(() => process.kill(Number(body.pid), 0)).not.toThrow();
  });

  it("A later launch appends and another plan's pid does not block", async () => {
    await writeFile(join(root, '.bindweed/runs.json'), '[{"slug":"other","pid":1}]');
    const { body } = await launch();
    expect(await json(join(root, '.bindweed/runs.json'))).toEqual([{ slug: 'other', pid: 1 }, expect.objectContaining({ slug: 'gate', pid: body.pid })]);
  });

  it('reports failed worktree adds and removes only the branch that add created', async () => {
    const realGit = await realpath(execFileSync('which', ['git'], { encoding: 'utf8' }).trim());
    await fake(join(bin, 'git'), `#!/bin/bash
if [[ "$1" == worktree && "$2" == add ]]; then
  '${realGit}' branch "$4"
  echo 'fatal: checkout failed' >&2
  exit 1
fi
exec '${realGit}' "$@"
`);
    expect((await launch()).body).toEqual({ steps: [{ name: 'Worktree', ok: false, error: 'checkout failed' }] });
    expect(git(root, 'branch')).not.toContain('bindweed/gate');
    expect(existsSync(worktree)).toBe(false);
    await fake(join(bin, 'git'), `#!/bin/bash
if [[ "$1" == worktree && "$2" == add ]]; then
  echo 'fatal: add failed before branch' >&2
  exit 1
fi
exec '${realGit}' "$@"
`);
    expect((await launch()).body).toEqual({ steps: [{ name: 'Worktree', ok: false, error: 'add failed before branch' }] });
    expect(git(root, 'branch')).not.toContain('bindweed/gate');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('reports a non-Error failure from the contract writer', async () => {
    const result = await launchPlan({ root, env }, doc, MARE, async () => { throw 'contract unavailable'; });
    expect(result.steps).toEqual([OK[0], { name: 'Files', ok: false, error: 'contract unavailable' }]);
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(base);
  });

  it('a tool the procedure does not know stops at Start', async () => {
    const result = await launchPlan({ root, env }, doc, JSON.parse('{"tool":"other"}'), async () => ({ text: 'module.exports = {};\n' }));
    expect(result.steps).toEqual([...OK.slice(0, 3), { name: 'Start', ok: false, error: 'unexpected launch {"tool":"other"}' }]);
    expect(existsSync(join(root, '.bindweed/runs.json'))).toBe(false);
  });

  it('slop-cannon needs only a brief and accepts an empty git identity as missing', async () => {
    await put({ tasks: undefined, contract: undefined });
    git(root, 'config', 'user.name', '');
    expect((await launch(SC)).body.steps).toEqual([OK[0], OK[1], { name: 'Commit', ok: false, error: 'Author identity unknown' }]);
  });

  it('a missing setsid stops at Start and leaves runs unrecorded', async () => {
    const restricted = join(outer, 'without-setsid');
    await mkdir(restricted);
    for (const name of ['git', 'bash']) await symlink(await realpath(execFileSync('which', [name], { encoding: 'utf8' }).trim()), join(restricted, name));
    await symlink(join(bin, 'sc'), join(restricted, 'sc'));
    env.PATH = restricted;
    const result = await launch(SC);
    expect(result.body.steps).toEqual([...OK.slice(0, 3), { name: 'Start', ok: false, error: 'spawn setsid ENOENT' }]);
    expect(existsSync(join(root, '.bindweed/runs.json'))).toBe(false);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  });

  it.each([MARE, SC])('stopping the serving process leaves its $tool run alive', async tool => {
    const workerSource = `import { bindApp } from ${JSON.stringify(join(process.cwd(), 'src/serve.ts'))};
const bound = await bindApp(${JSON.stringify({ repoRoot: root, uiDir: join(outer, 'ui') })}, {mode:'fixed',port:0});
console.log(JSON.stringify({port:bound.server.address().port,token:bound.token}));
process.on('SIGTERM',()=>bound.server.close());`;
    const worker = spawn(process.execPath, ['--input-type=module', '-e', workerSource], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const ended = new Promise<void>(done => { worker.once('exit', () => done()); });
    let output = '';
    worker.stdout.on('data', chunk => { output += String(chunk); });
    try {
      await vi.waitFor(() => expect(output).toContain('token'), { timeout: 5000 });
      const address = JSON.parse(output.trim());
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plans/gate/launch`, { method: 'POST', headers: { Authorization: `Bearer ${address.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tool) });
      const result = await response.json();
      expect(result.steps).toEqual(OK);
      pids.push(result.pid);
      await waitFor(join(log, tool.tool === 'marestail' ? 'overnight.json' : 'sc.json'));
      worker.kill('SIGTERM');
      await ended;
      expect(() => process.kill(result.pid, 0)).not.toThrow();
      expect((await request('/api/plans/gate/launch')).body.alive).toBe(true);
    } finally {
      worker.kill('SIGKILL');
      await ended;
    }
  });

  it('A live entry without a branch string does not invent one', async () => {
    await writeFile(join(root, '.bindweed/runs.json'), JSON.stringify([{ slug: 'gate', tool: 'marestail', worktree, pid: process.pid }]));
    expect((await request('/api/plans/gate/launch')).body).toEqual({ marestail: true, sc: true, alive: true, focus: MARE.focus, worktree, watch: 'marestail watch' });
  });

  it.each([
    [{ tasks: undefined }, MARE, null, [], 'this plan has no tasks'],
    [{ tasks: [] }, MARE, null, [], 'this plan has no tasks'],
    [{ brief: undefined }, SC, null, [], 'this plan has no brief'],
    [{ brief: '   ' }, SC, null, [], 'this plan has no brief'],
    [{}, MARE, 'marestail', [], 'marestail is not on PATH'],
    [{}, SC, 'sc', [], 'sc is not on PATH'],
    [{ tasks: undefined }, MARE, null, [{ slug: 'gate', pid: process.pid }], 'a run for this plan is still alive'],
    [{ tasks: undefined }, MARE, 'marestail', [{ slug: 'gate', pid: process.pid }], 'marestail is not on PATH'],
  ] as [Partial<PlanDoc>, LaunchBody, string | null, { slug: string; pid: number }[], string][])('Launch stays disabled and the reason is the first that applies', async (extra, body, missing, runs, error) => {
    await put(extra);
    await removeCommand(missing);
    const file = join(root, '.bindweed/runs.json');
    if (runs.length) await writeFile(file, JSON.stringify(runs));
    expect((await request('/api/plans/gate/launch')).body).toMatchObject({ marestail: missing !== 'marestail', sc: missing !== 'sc', alive: runs.length !== 0 });
    expect(await launch(body)).toEqual({ status: 409, body: { error } });
    expect(existsSync(worktree)).toBe(false);
    await unchangedRuns(file, runs);
  });

  it('A bad body is refused and the guards still hold', async () => {
    for (const body of [{ ...MARE, tool: ['marestail'] }, { ...MARE, tool: { toString: 'x' } }, { ...MARE, tool: null }, { tool: 'toString' }, { tool: '__proto__' }, [], 'marestail', { ...MARE, extra: 1 }, { ...MARE, scope: null }, { tool: 'marestail', scope: '' }, { ...SC, safety: 'maybe' }, { ...SC, safety: ' on ' }, {}, null, { ...MARE, model: 3 }]) expect(await launch(body)).toEqual({ status: 400, body: { error: 'bad launch' } });
    expect(await request('/api/plans/nope/launch', 'POST', MARE)).toEqual({ status: 404, body: { error: 'no such plan' } });
    expect(await request('/api/plans/BAD/launch')).toEqual({ status: 404, body: { error: 'no such plan' } });
    expect(await request('/api/plans/gate/launch', 'PUT', {})).toEqual({ status: 404, body: { error: 'not found' } });
    expect(await request('/api/plans/gate/launch/extra')).toEqual({ status: 404, body: { error: 'not found' } });
    expect(await request('/api/plans/gate/launch', 'GET', undefined, false)).toEqual({ status: 401, body: { error: 'missing or wrong token' } });
    const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.port, path: '/api/plans/gate/launch', method: 'POST', headers: { Host: 'evil.example:5000', Authorization: `Bearer ${app.token}` } }, res => {
        let bytes = '';
        res.on('data', chunk => { bytes += chunk; });
        res.on('end', () => resolve({ status: Number(res.statusCode), body: JSON.parse(bytes) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(MARE));
    });
    expect(response).toEqual({ status: 403, body: { error: 'bad host' } });
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('directories and files without execute permission are not commands', async () => {
    await rm(join(bin, 'marestail'));
    await mkdir(join(bin, 'marestail'));
    await rm(join(bin, 'sc'));
    await writeFile(join(bin, 'sc'), 'plain file', { mode: 0o644 });
    const info = await inspectLaunch({ root, env: { PATH: bin } }, 'gate', '');
    expect(info).toMatchObject({ marestail: false, sc: false });
  });

  it('reads only live numeric pids from arrays and uses the last displayable entry', async () => {
    const file = join(root, '.bindweed/runs.json');
    const entries = [null, false, 2, { slug: 'other', pid: process.pid }, { slug: 'gate', pid: '1' }, { slug: 'gate', pid: 99999999 }];
    await writeFile(file, JSON.stringify(entries));
    expect((await request('/api/plans/gate/launch')).body.alive).toBe(false);
    for (const entry of [
      { slug: 'gate', pid: process.pid },
      { slug: 'gate', pid: process.pid, worktree, tool: 'bad' },
      { slug: 'gate', pid: process.pid, worktree, tool: 'slop-cannon', branch: 4 },
    ]) {
      await writeFile(file, JSON.stringify([...entries, entry]));
      const info = (await request('/api/plans/gate/launch')).body;
      expect(info.alive).toBe(true);
      expect(info).not.toHaveProperty('branch');
      if (entry.tool === 'slop-cannon') expect(info.watch).toBe(`sc status --repo ${worktree}`);
      else expect(info).not.toHaveProperty('worktree');
    }
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect((await inspectLaunch({ root, env }, 'gate', '')).alive).toBe(true);
    kill.mockRestore();
    expect(await inspectLaunch({ root, env: {} }, 'gate', '')).toMatchObject({ marestail: false, sc: false });
  });

  it('A generate that has not answered does not block a launch', async () => {
    await put({ edits: [CUT, { kind: 'note', target: { node: 'src/domain' }, text: 'SLEEP-NOW' }] });
    await request('/api/config', 'PUT', { llm: { backend: 'command', command: `node ${process.cwd()}/qa/fixtures/fake-llm.mjs '${log}'` } });
    let answered = false;
    const pending = request('/api/plans/gate/generate', 'POST', { step: 'ask' }).then(answer => { answered = true; return answer; });
    await vi.waitFor(() => expect(existsSync(join(log, 'sleep.pids'))).toBe(true));
    expect((await launch()).body.steps).toEqual(OK);
    await waitFor(join(log, 'overnight.json'));
    expect(answered).toBe(false);
    expect((await request('/api/plans/gate/cancel', 'POST')).body).toEqual({ cancelled: true });
    await pending;
    const sleepers = (await text(join(log, 'sleep.pids'))).trim().split(/\s+/).map(Number);
    await vi.waitFor(() => { for (const pid of sleepers) expect(() => process.kill(pid, 0)).toThrow(); });
  });

  it('A launch held during install does not block generate', async () => {
    await request('/api/config', 'PUT', { llm: { backend: 'command', command: `node ${process.cwd()}/qa/fixtures/fake-llm.mjs '${log}'` } });
    await flag('install.wait');
    const pending = launch();
    await vi.waitFor(() => expect(existsSync(join(log, 'marestail.log'))).toBe(true));
    try {
      const answer = await request('/api/plans/gate/generate', 'POST', { step: 'ask' });
      expect(answer.status).toBe(200);
      expect(answer.body.plan.interview[0].questions[0].text).toBe('Must a.ts keep exporting a?');
    } finally {
      await flag('install.go');
    }
    expect((await pending).body.steps).toEqual(OK);
  });

  it('Every existing route still answers, and generate does not create a worktree', async () => {
    const config = { llm: { backend: 'command', command: `node ${process.cwd()}/qa/fixtures/fake-llm.mjs '${log}'` } };
    expect((await request('/api/config', 'PUT', config)).status).toBe(200);
    expect((await request('/api/config')).body).toEqual(config);
    expect((await request('/api/tree')).body.entries.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['notes', 'src', 'tsconfig.json']));
    expect((await request('/api/file?path=src/domain/model.ts')).body.text).toBe('export class Model { id = 0; }\n');
    expect((await request('/api/graph?at=src')).body.nodes.map((node: { id: string }) => node.id)).toEqual(expect.arrayContaining(['src/app', 'src/infra', 'src/domain']));
    expect((await request('/api/graph?at=src&plan=gate')).body.edges).not.toEqual(expect.arrayContaining([expect.objectContaining({ from: 'src/app', to: 'src/domain' })]));
    expect((await request('/api/detail?id=src/app&at=src')).body.files).toBe(2);
    expect((await request('/api/pairs?from=src/app&to=src/domain&at=src')).body).toEqual({ pairs: CUT.files });
    expect((await request('/api/plans/gate/contract')).body.rules[0].name).toBe('bindweed:no-src-app-to-src-domain');
    expect((await request('/api/plans/gate/contract', 'POST', { names: [] })).body.text).toContain('forbidden: []');
    const layout = (await request('/api/layout')).body;
    expect(layout).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect((await request('/api/layout', 'PUT', layout)).body).toEqual(layout);
    expect((await request('/api/repo')).body).toEqual({ root });
    expect((await request('/api/rescan', 'POST')).body.files).toBe(4);
    const page = await fetch(`http://127.0.0.1:${app.port}/?token=${app.token}`);
    expect(await page.text()).toContain('<title>bindweed</title>');
    expect((await request('/assets/missing.js')).status).toBe(404);
    const summary = (await request('/api/plans')).body.plans[0];
    expect(summary.name).toBe('Gate');
    expect(summary).not.toHaveProperty('contract');
    expect((await request('/api/plans', 'POST', { name: 'Side' })).status).toBe(201);
    expect((await request('/api/plans/side', 'DELETE')).body).toEqual({ ok: true });
    expect((await request('/api/plans/gate/files', 'POST')).body).toEqual({ dir: join(root, '.bindweed/plans/gate') });
    expect((await request('/api/plans/gate/chat')).body).toEqual([]);
    expect((await request('/api/plans/gate/chat', 'PUT', [])).body).toEqual([]);
    expect((await request('/api/plans/gate/review', 'POST', { edits: [] })).body).toEqual({ stale: [] });
    expect((await request('/api/plans/gate')).body).toEqual(doc);
    expect((await request('/api/plans/gate', 'PUT', doc)).body).toEqual(doc);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect((await request('/api/plans/gate/cancel', 'POST')).body).toEqual({ cancelled: false });
    expect((await request('/api/plans/gate/generate', 'POST', { step: 'ask' })).body.plan.interview[0].questions[0].text).toBe('Must a.ts keep exporting a?');
    expect((await request('/api/plans/gate/propose', 'POST', { text: 'the ui knows about the scanner', at: 'src' })).body.summary).toBe('Pull scanning out of the ui so app has one job.');
    expect(existsSync(worktree)).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});
