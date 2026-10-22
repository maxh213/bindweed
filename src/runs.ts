import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, join, resolve } from 'node:path';
import { z } from 'zod';
import { cannonStanding, marestailStanding, type Standing } from './domain/runs.ts';

type Place = { root: string; env: NodeJS.ProcessEnv };
type PlanNamer = (slug: string) => Promise<string | undefined>;
type Tool = 'marestail' | 'slop-cannon';
type Entry = { slug: string; tool: Tool; worktree: string; startedAt: string; branch: string | null; pid: number | null; out?: unknown; tasks?: unknown };
type Log = { id: string; lines: string[]; mtime: number };
type Sc = { ok: true; stdout: string } | { ok: false; reason: string };
type Answer = { status: number; body: unknown };
type Removed = { state: 'worktree removed'; position: string; prs: string[]; logTail: string[] };

const DENIED = z.object({ code: z.literal('EPERM') });
const ENTRY = z.object({ slug: z.string(), tool: z.enum(['marestail', 'slop-cannon']), worktree: z.string(), startedAt: z.string(), branch: z.unknown().optional(), pid: z.unknown().optional(), out: z.unknown().optional(), tasks: z.unknown().optional() });
const REMOVED: Removed = { state: 'worktree removed', position: 'worktree removed', prs: [], logTail: [] };

function runsFile(root: string): string {
  return join(root, '.bindweed/runs.json');
}

async function readRuns(root: string): Promise<unknown> {
  return readFile(runsFile(root), 'utf8').then(JSON.parse).catch(() => undefined);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function alive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return DENIED.safeParse(error).success;
  }
}

function linesOf(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

async function readLines(path: unknown): Promise<string[]> {
  if (typeof path !== 'string') return [];
  return readFile(path, 'utf8').then(linesOf, () => []);
}

function entryOf(raw: unknown): Entry | undefined {
  const parsed = ENTRY.safeParse(raw);
  if (!parsed.success) return undefined;
  const branch = typeof parsed.data.branch === 'string' ? parsed.data.branch : null;
  const pid = typeof parsed.data.pid === 'number' ? parsed.data.pid : null;
  return { ...parsed.data, branch, pid };
}

function newestFirst(entries: Entry[]): Entry[] {
  return entries.toReversed().toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function entriesOf(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  return newestFirst(raw.map(entryOf).filter(entry => entry !== undefined));
}

function taskId(path: string): string {
  return basename(path, '.md');
}

function logPath(worktree: string, id: string): string {
  return join(worktree, '.marestail/runs', id, 'pipeline.log');
}

function isTaskFile(name: string): boolean {
  return name.endsWith('.md') && name !== 'README.md';
}

async function runTasks(entry: Entry): Promise<string[]> {
  const listed = z.array(z.string()).safeParse(entry.tasks);
  if (listed.success) return listed.data;
  const names = await readdir(join(entry.worktree, 'tasks')).catch(() => []);
  return names.filter(isTaskFile).sort((a, b) => a.localeCompare(b)).map(name => `tasks/${name}`);
}

async function readLog(worktree: string, id: string): Promise<Log | undefined> {
  const path = logPath(worktree, id);
  try {
    const mtime = (await stat(path)).mtimeMs;
    return { id, lines: linesOf(await readFile(path, 'utf8')), mtime };
  } catch {
    return undefined;
  }
}

function laterSummary(left: { mtime: number }, right: { mtime: number }): number {
  return right.mtime - left.mtime;
}

async function summaryLines(worktree: string): Promise<string[]> {
  const dir = join(worktree, '.marestail/runs');
  const names = (await readdir(dir).catch(() => [])).filter(name => name.startsWith('overnight-') && name.endsWith('.md'));
  const dated = await Promise.all(names.map(async name => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })));
  const chosen = dated.toSorted(laterSummary)[0];
  return chosen === undefined ? [] : readLines(join(dir, chosen.name));
}

async function marestailOf(entry: Entry): Promise<Standing> {
  const tasks = await runTasks(entry);
  const read = tasks.map(path => readLog(entry.worktree, taskId(path)));
  const logs = (await Promise.all(read)).filter(log => log !== undefined);
  const summary = await summaryLines(entry.worktree);
  return marestailStanding({
    alive: alive(entry.pid),
    summary,
    logs,
    taskCount: tasks.length,
    stoppedLines: path => readLines(logPath(entry.worktree, taskId(path))),
  });
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  if (env.PATH === undefined) return [];
  return env.PATH.split(delimiter);
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    return false;
  }
  return statSync(path).isFile();
}

function nextSc(denied: string | undefined, path: string): { chosen?: string; denied?: string } {
  if (!existsSync(path)) return { denied };
  if (isExecutableFile(path)) return { chosen: path };
  return { denied: path };
}

function scOnPath(env: NodeJS.ProcessEnv): string | undefined {
  let denied: string | undefined;
  for (const dir of pathDirs(env)) {
    const step = nextSc(denied, resolve(dir, 'sc'));
    if (step.chosen !== undefined) return step.chosen;
    denied = step.denied;
  }
  return denied;
}

function shownError(error: Error, bin: string): string {
  return error.toString().replaceAll(bin, 'sc');
}

function exitFailure(code: number | null, stderr: string): string {
  return stderr === '' ? `exited ${code}` : stderr.split('\n')[0];
}

function closedSc(code: number | null, stdout: string, stderr: string): Sc {
  if (code === 0) return { ok: true, stdout };
  return { ok: false, reason: exitFailure(code, stderr) };
}

function settle(done: (result: Sc) => void, result: Sc, timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer);
  done(result);
}

function watchSc(bin: string, worktree: string, place: Place, done: (result: Sc) => void): void {
  const child = spawn(bin, ['status', '--repo', worktree, '--json'], { cwd: place.root, env: place.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    done({ ok: false, reason: 'timed out after 10s' });
  }, 10000);
  child.once('error', error => settle(done, { ok: false, reason: shownError(error, bin) }, timer));
  child.once('close', code => settle(done, closedSc(code, stdout, stderr), timer));
}

function runSc(place: Place, worktree: string): Promise<Sc> {
  const bin = scOnPath(place.env);
  if (bin === undefined) return Promise.resolve({ ok: false, reason: 'sc is not on PATH' });
  return new Promise(done => watchSc(bin, worktree, place, done));
}

async function cannonOf(place: Place, entry: Entry): Promise<Standing> {
  const [answer, out] = await Promise.all([runSc(place, entry.worktree), readLines(entry.out)]);
  return cannonStanding({ alive: alive(entry.pid), answer, out });
}

async function byTool(place: Place, entry: Entry): Promise<Standing> {
  switch (entry.tool) {
    case 'marestail':
      return marestailOf(entry);
    case 'slop-cannon':
      return cannonOf(place, entry);
  }
}

async function standingOf(place: Place, entry: Entry): Promise<Standing | Removed> {
  if (!await exists(entry.worktree)) return REMOVED;
  return byTool(place, entry);
}

async function viewOf(place: Place, namer: PlanNamer, entry: Entry): Promise<Record<string, unknown>> {
  const [name, standing] = await Promise.all([namer(entry.slug), standingOf(place, entry)]);
  const { slug, tool, branch, worktree, pid, startedAt } = entry;
  const plan = { planName: name ?? slug, planExists: name !== undefined };
  return { slug, ...plan, tool, branch, worktree, worktreeExists: standing.state !== REMOVED.state, pid, startedAt, ...standing };
}

export async function listRuns(place: Place, namer: PlanNamer): Promise<Record<string, unknown>[]> {
  const entries = entriesOf(await readRuns(place.root));
  return Promise.all(entries.map(entry => viewOf(place, namer, entry)));
}

export async function convergeRun(root: string, slug: string): Promise<{ worktree: string; pidAlive: boolean } | undefined> {
  const entry = entriesOf(await readRuns(root)).find(item => item.slug === slug);
  return entry === undefined ? undefined : { worktree: entry.worktree, pidAlive: alive(entry.pid) };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function worktreeIs(raw: unknown, worktree: string): boolean {
  return isRecord(raw) && raw.worktree === worktree;
}

async function forgetFrom(root: string, worktree: string): Promise<Answer> {
  const raw = await readRuns(root);
  if (!Array.isArray(raw) || !raw.some(item => worktreeIs(item, worktree))) return { status: 404, body: { error: 'no such run' } };
  await writeFile(runsFile(root), JSON.stringify(raw.filter(item => !worktreeIs(item, worktree))));
  return { status: 200, body: { ok: true } };
}

export async function forgetRun(root: string, worktree: string | null): Promise<Answer> {
  if (worktree === null) return { status: 400, body: { error: 'missing worktree' } };
  if (await exists(worktree)) return { status: 400, body: { error: 'worktree still exists' } };
  return forgetFrom(root, worktree);
}
