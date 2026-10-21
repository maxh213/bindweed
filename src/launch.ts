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
type Context = Place & { doc: PlanDoc; body: LaunchBody; worktree: string; branch: string; paths: Set<string>; tasks: NonNullable<PlanDoc['tasks']>; merge: Merge; answer: LaunchResult; out?: string };

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

async function readRuns(root: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, '.bindweed/runs.json'), 'utf8'));
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

function commandError(error: unknown, fallback: string): Error {
  const rec = error as { stderr: string; code: number };
  return new Error(rec.stderr.trim() || `${fallback} exited with code ${rec.code}`);
}

async function command(place: Place, bin: string, args: string[], fallback: string): Promise<string> {
  try {
    const result = await execute(bin, args, { cwd: place.root, env: place.env });
    return result.stdout;
  } catch (error) {
    throw commandError(error, fallback);
  }
}

async function git(place: Place, args: string[]): Promise<string> {
  const output = await command(place, 'git', args, `git ${args[0]}`);
  return output;
}

async function branchExists(ctx: Context): Promise<boolean> {
  return git(ctx, ['show-ref', '--verify', `refs/heads/${ctx.branch}`]).then(() => true, () => false);
}

async function worktreeStep(ctx: Context): Promise<void> {
  if (await branchExists(ctx)) throw new Error(`a branch named '${ctx.branch}' already exists`);
  if (await exists(ctx.worktree)) throw new Error(`${ctx.worktree} already exists`);
  try {
    await git(ctx, ['worktree', 'add', '-b', ctx.branch, ctx.worktree, 'HEAD']);
  } catch (error) {
    await git(ctx, ['branch', '-D', ctx.branch]).catch(() => undefined);
    throw new Error(errorText(error).trim().split('\n').slice(-1)[0].replace(/^fatal: /, ''), { cause: error });
  }
  ctx.answer.worktree = ctx.worktree;
  ctx.answer.branch = ctx.branch;
}

async function tasks(ctx: Context): Promise<void> {
  if (ctx.body.tool !== 'marestail') return;
  await mkdir(join(ctx.worktree, 'tasks'), { recursive: true });
  for (const task of ctx.tasks) {
    const path = `tasks/${task.file}`;
    await writeFile(join(ctx.worktree, path), task.body);
    ctx.paths.add(path);
  }
}

async function contract(ctx: Context): Promise<void> {
  if (ctx.doc.contract === undefined) return;
  const preview = await ctx.merge(ctx.worktree);
  if ('error' in preview) throw new Error(preview.error);
  await writeFile(join(ctx.worktree, '.dependency-cruiser.cjs'), preview.text);
  ctx.paths.add('.dependency-cruiser.cjs');
}

async function statusPaths(ctx: Context): Promise<string[]> {
  const text = await git({ ...ctx, root: ctx.worktree }, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall']);
  return text.trimEnd().split('\n').filter(line => line !== '').flatMap(line => line.slice(3).split(' -> '));
}

async function needsInstall(ctx: Context): Promise<boolean> {
  return ctx.body.tool === 'marestail' && !await exists(join(ctx.worktree, 'marestail.toml'));
}

async function install(ctx: Context): Promise<void> {
  if (!await needsInstall(ctx)) return;
  const before = new Set(await statusPaths(ctx));
  await command({ ...ctx, root: ctx.worktree }, 'marestail', ['install', '.'], 'marestail install').catch(error => {
    throw new Error(errorText(error).split('\n')[0], { cause: error });
  });
  for (const path of await statusPaths(ctx)) {
    if (!before.has(path)) ctx.paths.add(path);
  }
}

async function filesStep(ctx: Context): Promise<void> {
  await tasks(ctx);
  await contract(ctx);
  await install(ctx);
}

async function identity(ctx: Context, key: string): Promise<void> {
  const value = await git(ctx, ['config', '--get', key]).catch(() => '');
  if (value.trim() === '') throw new Error('Author identity unknown');
}

async function commitStep(ctx: Context): Promise<void> {
  await identity(ctx, 'user.name');
  await identity(ctx, 'user.email');
  const place = { ...ctx, root: ctx.worktree };
  if (ctx.paths.size > 0) await git(place, ['add', '--', ...ctx.paths]);
  const lines = [...ctx.doc.edits.map(sentenceOf), `Plan: ${ctx.doc.slug}`, `Base: ${ctx.doc.baseCommit}`];
  await git(place, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', `bindweed: ${ctx.doc.name}\n\n${lines.join('\n')}`]);
}

function quoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function stamp(): string {
  const now = new Date();
  const digits = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()].map(value => String(value).padStart(2, '0'));
  return `${digits.slice(0, 3).join('')}T${digits.slice(3).join('')}`;
}

async function inhibitor(ctx: Context): Promise<string> {
  return await onPath(ctx.env, 'systemd-inhibit') === undefined ? '' : `systemd-inhibit --what=idle --who=bindweed --why=${quoted(`bindweed ${ctx.doc.slug}`)} `;
}

async function script(ctx: Context, body: Extract<LaunchBody, { tool: 'marestail' }>): Promise<string> {
  const found = String(await onPath(ctx.env, 'marestail'));
  const overnight = resolve(dirname(await realpath(found)), '../tools/overnight.sh');
  const bash = await realpath(String(await onPath(ctx.env, 'bash')));
  const settings = `MODEL=${quoted(body.model)} FOCUS=${quoted(body.focus)} STOP_AT=${quoted(body.stopAt)}`;
  const scope = body.scope === '' ? '' : ` SCOPE=${quoted(body.scope)}`;
  const taskArgs = (ctx.tasks).map(task => quoted(`tasks/${task.file}`)).join(' ');
  const start = ` model=${body.model} scope=${body.scope || 'none'} focus=${body.focus} stop=${body.stopAt}`;
  return [
    `PATH=${quoted(dirname(found))}:"$PATH"`,
    'export PATH',
    'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CONFIG_DIR SCOPE',
    `cd ${quoted(ctx.worktree)}`,
    `printf 'start pid=%s%s\\n' "$$" ${quoted(start)}`,
    `${settings}${scope} ${await inhibitor(ctx)}${quoted(bash)} ${quoted(overnight)} ${taskArgs}`,
    'code=$?',
    `printf 'exit %s %s\\n' "$code" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"`,
    'exit "$code"',
    '',
  ].join('\n');
}

function scArgs(ctx: Context, body: Extract<LaunchBody, { tool: 'slop-cannon' }>): string[] {
  const args = ['--repo', ctx.worktree, '--headless', '--safety', body.safety];
  if (body.ammo !== '') args.push('--ammo', body.ammo);
  if (body.cartridge !== '') args.push('--cartridge', body.cartridge);
  return [...args, '-m', String(ctx.doc.brief)];
}

async function preparedStart(ctx: Context): Promise<{ args: string[]; out: string }> {
  const time = stamp();
  if (ctx.body.tool === 'slop-cannon') {
    const dir = join(ctx.root, '.bindweed/runs');
    await mkdir(dir, { recursive: true });
    return { args: ['sc', ...scArgs(ctx, ctx.body)], out: join(dir, `${ctx.doc.slug}-${time}.out`) };
  }
  const dir = join(ctx.worktree, '.marestail/runs');
  await mkdir(dir, { recursive: true }).catch(() => { throw new Error(`could not create ${dir}`); });
  const file = join(dir, `launch-${time}.sh`);
  await writeFile(file, await script(ctx, ctx.body));
  return { args: ['bash', file], out: join(dir, `launch-${time}.out`) };
}

async function detached(ctx: Context, args: string[], out: string): Promise<number> {
  const input = await open('/dev/null', 'r');
  const output = await open(out, 'a');
  try {
    const child = spawn('setsid', args, { cwd: ctx.root, env: ctx.env, stdio: [input.fd, output.fd, output.fd] });
    await new Promise<void>((done, failed) => { child.once('spawn', done); child.once('error', failed); });
    child.unref();
    return Number(child.pid);
  } finally {
    await input.close();
    await output.close();
  }
}

async function startStep(ctx: Context): Promise<void> {
  const { args, out } = await preparedStart(ctx);
  const pid = await detached(ctx, args, out);
  ctx.answer.pid = pid;
  ctx.answer.watch = watch(ctx.body.tool, ctx.worktree);
  ctx.out = out;
}

async function recordStep(ctx: Context & { out?: string }): Promise<void> {
  const file = join(ctx.root, '.bindweed/runs.json');
  const raw = await readRuns(ctx.root);
  const runs = await exists(file) ? raw : [];
  if (!Array.isArray(runs)) throw new Error('runs.json is not a list');
  const { tool, ...settings } = ctx.body;
  runs.push({ slug: ctx.doc.slug, tool, worktree: ctx.worktree, branch: ctx.branch, pid: ctx.answer.pid, startedAt: new Date().toISOString(), out: ctx.out, settings });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(runs));
}

const STEPS = [['Worktree', worktreeStep], ['Files', filesStep], ['Commit', commitStep], ['Start', startStep], ['Record', recordStep]] as const;

export async function launchPlan(place: Place, doc: PlanDoc, body: LaunchBody, merge: Merge): Promise<LaunchResult> {
  const ctx: Context = { ...place, doc, body, merge, worktree: join(dirname(place.root), `${basename(place.root)}-bw-${doc.slug}`), branch: `bindweed/${doc.slug}`, paths: new Set(), tasks: doc.tasks ?? [], answer: { steps: [] } };
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
