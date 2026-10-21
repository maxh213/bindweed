import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { recordOf, sentenceOf, type PlanDoc } from './domain/plan.ts';
import type { LaunchBody, LaunchInfo, LaunchResult } from './domain/launch.ts';

const execute = promisify(execFile);
type Place = { root: string; env: NodeJS.ProcessEnv };
type Merge = (root: string) => Promise<{ text: string } | { error: string }>;
type Marestail = Extract<LaunchBody, { tool: 'marestail' }>;
type Cannon = Extract<LaunchBody, { tool: 'slop-cannon' }>;
type Started = { args: string[]; out: string };
type Context = Place & {
  doc: PlanDoc;
  body: LaunchBody;
  worktree: string;
  branch: string;
  paths: Set<string>;
  tasks: NonNullable<PlanDoc['tasks']>;
  merge: Merge;
  answer: LaunchResult;
  out?: string;
};

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function onPath(env: NodeJS.ProcessEnv, name: string): Promise<string | undefined> {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    const path = resolve(dir, name);
    if (await executable(path)) return path;
  }
  return undefined;
}

function alive(pid: unknown): boolean {
  if (typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function runsFile(root: string): string {
  return join(root, '.bindweed/runs.json');
}

async function readRuns(root: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(runsFile(root), 'utf8'));
  } catch {
    return undefined;
  }
}

function liveEntry(raw: unknown, slug: string): Record<string, unknown> | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(recordOf).findLast(entry => entry?.slug === slug && alive(entry.pid));
}

function watch(tool: LaunchBody['tool'], worktree: string): string {
  return tool === 'marestail' ? 'marestail watch' : `sc status --repo ${worktree}`;
}

function knownTool(tool: unknown): tool is LaunchBody['tool'] {
  return tool === 'marestail' || tool === 'slop-cannon';
}

function liveLines(entry: Record<string, unknown>): Partial<LaunchInfo> {
  if (typeof entry.worktree !== 'string') return {};
  if (!knownTool(entry.tool)) return {};
  const lines: Partial<LaunchInfo> = { worktree: entry.worktree, watch: watch(entry.tool, entry.worktree) };
  if (typeof entry.branch === 'string') lines.branch = entry.branch;
  return lines;
}

export async function inspectLaunch(place: Place, slug: string, focus: string): Promise<LaunchInfo> {
  const entry = liveEntry(await readRuns(place.root), slug);
  const info = { marestail: await onPath(place.env, 'marestail') !== undefined, sc: await onPath(place.env, 'sc') !== undefined, alive: entry !== undefined, focus };
  return entry === undefined ? info : { ...info, ...liveLines(entry) };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function firstLine(text: string): string {
  return text.split('\n')[0];
}

function lastLine(text: string): string {
  return text.slice(text.lastIndexOf('\n') + 1);
}

function commandError(error: unknown, fallback: string): Error {
  const failure = error as { stderr: string; code: number };
  return new Error(failure.stderr.trim() || `${fallback} exited with code ${failure.code}`);
}

async function command(place: Place, bin: string, args: string[], fallback: string): Promise<string> {
  try {
    const result = await execute(bin, args, { cwd: place.root, env: place.env });
    return result.stdout;
  } catch (error) {
    throw commandError(error, fallback);
  }
}

function git(place: Place, args: string[]): Promise<string> {
  return command(place, 'git', args, `git ${args[0]}`);
}

function inWorktree(ctx: Context): Place {
  return { root: ctx.worktree, env: ctx.env };
}

async function branchExists(ctx: Context): Promise<boolean> {
  return git(ctx, ['show-ref', '--verify', `refs/heads/${ctx.branch}`]).then(() => true, () => false);
}

async function addWorktree(ctx: Context): Promise<void> {
  try {
    await git(ctx, ['worktree', 'add', '-b', ctx.branch, ctx.worktree, 'HEAD']);
  } catch (error) {
    await git(ctx, ['branch', '-D', ctx.branch]).catch(() => undefined);
    throw new Error(lastLine(errorText(error).trim()).replace(/^fatal: /, ''), { cause: error });
  }
}

async function worktreeStep(ctx: Context): Promise<void> {
  if (await branchExists(ctx)) throw new Error(`a branch named '${ctx.branch}' already exists`);
  if (await exists(ctx.worktree)) throw new Error(`${ctx.worktree} already exists`);
  await addWorktree(ctx);
  ctx.answer.worktree = ctx.worktree;
  ctx.answer.branch = ctx.branch;
}

async function writeTasks(ctx: Context): Promise<void> {
  if (ctx.body.tool !== 'marestail') return;
  await mkdir(join(ctx.worktree, 'tasks'), { recursive: true });
  for (const task of ctx.tasks) {
    const path = `tasks/${task.file}`;
    await writeFile(join(ctx.worktree, path), task.body);
    ctx.paths.add(path);
  }
}

async function writeContract(ctx: Context): Promise<void> {
  if (ctx.doc.contract === undefined) return;
  const preview = await ctx.merge(ctx.worktree);
  if ('error' in preview) throw new Error(preview.error);
  await writeFile(join(ctx.worktree, '.dependency-cruiser.cjs'), preview.text);
  ctx.paths.add('.dependency-cruiser.cjs');
}

async function statusPaths(ctx: Context): Promise<string[]> {
  const text = await git(inWorktree(ctx), ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall']);
  return text.trimEnd().split('\n').filter(line => line !== '').flatMap(line => line.slice(3).split(' -> '));
}

async function needsInstall(ctx: Context): Promise<boolean> {
  return ctx.body.tool === 'marestail' && !await exists(join(ctx.worktree, 'marestail.toml'));
}

async function runInstall(ctx: Context): Promise<void> {
  await command(inWorktree(ctx), 'marestail', ['install', '.'], 'marestail install').catch(error => {
    throw new Error(firstLine(errorText(error)), { cause: error });
  });
}

async function install(ctx: Context): Promise<void> {
  if (!await needsInstall(ctx)) return;
  const before = new Set(await statusPaths(ctx));
  await runInstall(ctx);
  for (const path of await statusPaths(ctx)) {
    if (!before.has(path)) ctx.paths.add(path);
  }
}

async function filesStep(ctx: Context): Promise<void> {
  await writeTasks(ctx);
  await writeContract(ctx);
  await install(ctx);
}

async function requireIdentity(ctx: Context, key: string): Promise<void> {
  const value = await git(ctx, ['config', '--get', key]).catch(() => '');
  if (value.trim() === '') throw new Error('Author identity unknown');
}

function commitMessage(doc: PlanDoc): string {
  const lines = [...doc.edits.map(sentenceOf), `Plan: ${doc.slug}`, `Base: ${doc.baseCommit}`];
  return `bindweed: ${doc.name}\n\n${lines.join('\n')}`;
}

async function commitStep(ctx: Context): Promise<void> {
  await requireIdentity(ctx, 'user.name');
  await requireIdentity(ctx, 'user.email');
  const place = inWorktree(ctx);
  if (ctx.paths.size > 0) await git(place, ['add', '--', ...ctx.paths]);
  await git(place, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', commitMessage(ctx.doc)]);
}

const ESCAPED_QUOTE = String.raw`'\''`;

function quoted(value: string): string {
  return `'${value.replaceAll("'", ESCAPED_QUOTE)}'`;
}

function stamp(): string {
  const now = new Date();
  const digits = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()].map(value => String(value).padStart(2, '0'));
  return `${digits.slice(0, 3).join('')}T${digits.slice(3).join('')}`;
}

async function inhibitor(ctx: Context): Promise<string> {
  if (await onPath(ctx.env, 'systemd-inhibit') === undefined) return '';
  const why = quoted(`bindweed ${ctx.doc.slug}`);
  return `systemd-inhibit --what=idle --who=bindweed --why=${why} `;
}

function settings(body: Marestail): string {
  const scope = body.scope === '' ? '' : ` SCOPE=${quoted(body.scope)}`;
  return `MODEL=${quoted(body.model)} FOCUS=${quoted(body.focus)} STOP_AT=${quoted(body.stopAt)}${scope}`;
}

function startLine(body: Marestail): string {
  return ` model=${body.model} scope=${body.scope || 'none'} focus=${body.focus} stop=${body.stopAt}`;
}

async function overnightCommand(ctx: Context, body: Marestail, found: string): Promise<string> {
  const overnight = resolve(dirname(await realpath(found)), '../tools/overnight.sh');
  const bash = await realpath(String(await onPath(ctx.env, 'bash')));
  const taskArgs = ctx.tasks.map(task => quoted(`tasks/${task.file}`)).join(' ');
  return `${settings(body)} ${await inhibitor(ctx)}${quoted(bash)} ${quoted(overnight)} ${taskArgs}`;
}

async function script(ctx: Context, body: Marestail): Promise<string> {
  const found = String(await onPath(ctx.env, 'marestail'));
  return [
    `PATH=${quoted(dirname(found))}:"$PATH"`,
    'export PATH',
    'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CONFIG_DIR SCOPE',
    `cd ${quoted(ctx.worktree)}`,
    String.raw`printf 'start pid=%s%s\n' "$$" ${quoted(startLine(body))}`,
    await overnightCommand(ctx, body, found),
    'code=$?',
    String.raw`printf 'exit %s %s\n' "$code" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"`,
    'exit "$code"',
    '',
  ].join('\n');
}

function scArgs(ctx: Context, body: Cannon): string[] {
  const args = ['--repo', ctx.worktree, '--headless', '--safety', body.safety];
  if (body.ammo !== '') args.push('--ammo', body.ammo);
  if (body.cartridge !== '') args.push('--cartridge', body.cartridge);
  return [...args, '-m', String(ctx.doc.brief)];
}

async function cannonStart(ctx: Context, body: Cannon, time: string): Promise<Started> {
  const dir = join(ctx.root, '.bindweed/runs');
  await mkdir(dir, { recursive: true });
  return { args: ['sc', ...scArgs(ctx, body)], out: join(dir, `${ctx.doc.slug}-${time}.out`) };
}

async function marestailStart(ctx: Context, body: Marestail, time: string): Promise<Started> {
  const dir = join(ctx.worktree, '.marestail/runs');
  await mkdir(dir, { recursive: true }).catch(() => { throw new Error(`could not create ${dir}`); });
  const file = join(dir, `launch-${time}.sh`);
  await writeFile(file, await script(ctx, body));
  return { args: ['bash', file], out: join(dir, `launch-${time}.out`) };
}

function preparedStart(ctx: Context): Promise<Started> {
  const time = stamp();
  if (ctx.body.tool === 'slop-cannon') return cannonStart(ctx, ctx.body, time);
  return marestailStart(ctx, ctx.body, time);
}

async function detached(ctx: Context, { args, out }: Started): Promise<number> {
  const setsid = await onPath(ctx.env, 'setsid') ?? 'setsid';
  const input = await open('/dev/null', 'r');
  const output = await open(out, 'a');
  try {
    const child = spawn(setsid, args, { cwd: ctx.root, env: ctx.env, stdio: [input.fd, output.fd, output.fd] });
    await new Promise<void>((done, failed) => { child.once('spawn', done); child.once('error', failed); });
    child.unref();
    return Number(child.pid);
  } finally {
    await input.close();
    await output.close();
  }
}

async function startStep(ctx: Context): Promise<void> {
  const started = await preparedStart(ctx);
  ctx.answer.pid = await detached(ctx, started);
  ctx.answer.watch = watch(ctx.body.tool, ctx.worktree);
  ctx.out = started.out;
}

async function recordStep(ctx: Context): Promise<void> {
  const file = runsFile(ctx.root);
  const raw = await readRuns(ctx.root);
  const runs = await exists(file) ? raw : [];
  if (!Array.isArray(runs)) throw new Error('runs.json is not a list');
  const { tool, ...settings } = ctx.body;
  runs.push({ slug: ctx.doc.slug, tool, worktree: ctx.worktree, branch: ctx.branch, pid: ctx.answer.pid, startedAt: new Date().toISOString(), out: ctx.out, settings });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(runs));
}

const STEPS = [['Worktree', worktreeStep], ['Files', filesStep], ['Commit', commitStep], ['Start', startStep], ['Record', recordStep]] as const;

function contextFor(place: Place, doc: PlanDoc, body: LaunchBody, merge: Merge): Context {
  const worktree = join(dirname(place.root), `${basename(place.root)}-bw-${doc.slug}`);
  return { ...place, doc, body, merge, worktree, branch: `bindweed/${doc.slug}`, paths: new Set(), tasks: doc.tasks ?? [], answer: { steps: [] } };
}

export async function launchPlan(place: Place, doc: PlanDoc, body: LaunchBody, merge: Merge): Promise<LaunchResult> {
  const ctx = contextFor(place, doc, body, merge);
  for (const [name, step] of STEPS) {
    try {
      await step(ctx);
      ctx.answer.steps.push({ name, ok: true });
    } catch (error) {
      ctx.answer.steps.push({ name, ok: false, error: errorText(error) });
      break;
    }
  }
  return ctx.answer;
}
