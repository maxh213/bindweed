import { spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

type Place = { root: string; env: NodeJS.ProcessEnv };
type PlanNamer = (slug: string) => Promise<string | undefined>;
type Tool = 'marestail' | 'slop-cannon';
type Entry = { slug: string; tool: Tool; worktree: string; startedAt: string; branch: string | null; pid: number | null; out?: unknown; tasks?: unknown };
type Standing = { state: string; position: string; prs: string[]; logTail: string[] };
type Log = { id: string; lines: string[]; mtime: number };
type Sc = { ok: true; stdout: string } | { ok: false; reason: string };
type Verdict = { done: true } | { done: false; path: string };
type Answer = { status: number; body: unknown };

const SC_TIMEOUT = 10000;
const TAIL = 20;
const DENIED = z.object({ code: z.literal('EPERM') });
const MISSING = z.object({ code: z.literal('ENOENT') });
const ENTRY = z.object({ slug: z.string(), tool: z.enum(['marestail', 'slop-cannon']), worktree: z.string(), startedAt: z.string(), branch: z.unknown().optional(), pid: z.unknown().optional(), out: z.unknown().optional(), tasks: z.unknown().optional() });
const STOPPED = /^stopped: (.+) exited -?\d+$/;
const ROLE = /^== (\S+).*\battempt (\d+)/;
const REMOVED: Standing = { state: 'worktree removed', position: 'worktree removed', prs: [], logTail: [] };

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

function tailOf(lines: string[]): string[] {
  return lines.slice(-TAIL);
}

function entryOf(raw: unknown): Entry | undefined {
  const parsed = ENTRY.safeParse(raw);
  if (!parsed.success) return undefined;
  const branch = typeof parsed.data.branch === 'string' ? parsed.data.branch : null;
  const pid = typeof parsed.data.pid === 'number' ? parsed.data.pid : null;
  return { ...parsed.data, branch, pid };
}

function entriesOf(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.map(entryOf).filter(entry => entry !== undefined).reverse();
  return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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

function lastOf(lines: string[]): string {
  return lines.at(-1) ?? '';
}

function completes(line: string): boolean {
  return line.startsWith('pipeline complete');
}

function newest<T extends { mtime: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>((best, item) => (best === undefined || item.mtime > best.mtime ? item : best), undefined);
}

async function summaryLines(worktree: string): Promise<string[]> {
  const dir = join(worktree, '.marestail/runs');
  const names = (await readdir(dir).catch(() => [])).filter(name => name.startsWith('overnight-') && name.endsWith('.md'));
  const dated = await Promise.all(names.map(async name => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })));
  const chosen = newest(dated);
  return chosen === undefined ? [] : readLines(join(dir, chosen.name));
}

function verdictOf(line: string): Verdict | undefined {
  if (line.startsWith('all tasks complete')) return { done: true };
  const stopped = STOPPED.exec(line);
  return stopped === null ? undefined : { done: false, path: stopped[1] };
}

async function stoppedState(worktree: string, path: string): Promise<string> {
  const log = await readLines(logPath(worktree, taskId(path)));
  return lastOf(log).includes('stopping for a human') ? 'stopped for a human' : 'failed';
}

async function marestailState(entry: Entry): Promise<string> {
  const verdict = (await summaryLines(entry.worktree)).map(verdictOf).findLast(found => found !== undefined);
  if (verdict === undefined) return alive(entry.pid) ? 'running' : 'dead';
  if (verdict.done) return 'done';
  return stoppedState(entry.worktree, verdict.path);
}

function rolePart(log: Log): string | undefined {
  const match = ROLE.exec(log.lines.findLast(line => line.startsWith('== ')) ?? '');
  return match === null ? undefined : `${match[1]} · attempt ${match[2]}`;
}

function currentPart(log: Log): string {
  if (completes(lastOf(log.lines))) return `task ${log.id} · finished`;
  const role = rolePart(log);
  return role === undefined ? `task ${log.id}` : `task ${log.id} · ${role}`;
}

function marestailPosition(state: string, current: Log | undefined, counts: string): string {
  if (state === 'done') return `all tasks complete · ${counts}`;
  if (current === undefined) return `no task started · ${counts}`;
  return `${currentPart(current)} · ${counts}`;
}

async function marestailStanding(entry: Entry): Promise<Standing> {
  const tasks = await runTasks(entry);
  const logs = (await Promise.all(tasks.map(path => readLog(entry.worktree, taskId(path))))).filter(log => log !== undefined);
  const done = logs.filter(log => log.lines.some(completes)).length;
  const current = newest(logs);
  const state = await marestailState(entry);
  const position = marestailPosition(state, current, `${done} of ${tasks.length} tasks`);
  return { state, position, prs: [], logTail: tailOf(current?.lines ?? []) };
}

function spawnFailure(error: unknown): string {
  return MISSING.safeParse(error).success ? 'sc is not on PATH' : String(error);
}

function exitFailure(code: number | null, stderr: string): string {
  return stderr === '' ? `exited ${code}` : stderr.split('\n')[0];
}

function runSc(place: Place, worktree: string): Promise<Sc> {
  return new Promise(done => {
    const child = spawn('sc', ['status', '--repo', worktree, '--json'], { cwd: place.root, env: place.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ ok: false, reason: 'timed out after 10s' });
    }, SC_TIMEOUT);
    child.once('error', error => {
      clearTimeout(timer);
      done({ ok: false, reason: spawnFailure(error) });
    });
    child.once('close', code => {
      clearTimeout(timer);
      done(code === 0 ? { ok: true, stdout } : { ok: false, reason: exitFailure(code, stderr) });
    });
  });
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function objectOf(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

function listOf(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.map(objectOf) : [];
}

function parsedObject(text: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function counted(count: number, word: string): string {
  return count === 1 ? `1 ${word}` : `${count} ${word}s`;
}

function phaseOf(status: Record<string, unknown>): string {
  const phase = objectOf(status.state).phase;
  return typeof phase === 'string' ? phase : '';
}

function beadParts(status: Record<string, unknown>): string[] {
  return Object.entries(objectOf(status.beads)).filter(([, count]) => typeof count === 'number').map(([name, count]) => `${count} ${name}`);
}

function prsOf(status: Record<string, unknown>): string[] {
  return listOf(status.prs).map(pr => pr.url).filter(url => typeof url === 'string');
}

function scState(phase: string, pid: number | null): string {
  if (phase === 'done' || phase === 'complete') return 'done';
  return alive(pid) ? 'running' : 'dead';
}

function scFailure(reason: string, pid: number | null): Pick<Standing, 'state' | 'position'> {
  const living = alive(pid);
  return { state: living ? 'running' : 'dead', position: `sc status failed: ${reason} · pid ${living ? 'alive' : 'gone'}` };
}

function scReading(sc: Sc, pid: number | null): Pick<Standing, 'state' | 'position' | 'prs'> {
  if (!sc.ok) return { ...scFailure(sc.reason, pid), prs: [] };
  const status = parsedObject(sc.stdout);
  if (status === undefined) return { ...scFailure('not JSON', pid), prs: [] };
  const phase = phaseOf(status);
  const agents = listOf(status.agents).filter(agent => agent.alive === true).length;
  const prs = prsOf(status);
  const position = [phase, counted(agents, 'agent'), ...beadParts(status), counted(prs.length, 'PR')].join(' · ');
  return { state: scState(phase, pid), position, prs };
}

async function cannonStanding(place: Place, entry: Entry): Promise<Standing> {
  const [sc, lines] = await Promise.all([runSc(place, entry.worktree), readLines(entry.out)]);
  return { ...scReading(sc, entry.pid), logTail: tailOf(lines) };
}

async function standingOf(place: Place, entry: Entry): Promise<Standing> {
  if (!await exists(entry.worktree)) return REMOVED;
  return entry.tool === 'marestail' ? marestailStanding(entry) : cannonStanding(place, entry);
}

async function viewOf(place: Place, namer: PlanNamer, entry: Entry): Promise<Record<string, unknown>> {
  const [name, standing] = await Promise.all([namer(entry.slug), standingOf(place, entry)]);
  const { slug, tool, branch, worktree, pid, startedAt } = entry;
  const plan = { planName: name ?? slug, planExists: name !== undefined };
  return { slug, ...plan, tool, branch, worktree, worktreeExists: standing !== REMOVED, pid, startedAt, ...standing };
}

export async function listRuns(place: Place, namer: PlanNamer): Promise<Record<string, unknown>[]> {
  const entries = entriesOf(await readRuns(place.root));
  return Promise.all(entries.map(entry => viewOf(place, namer, entry)));
}

function worktreeIs(raw: unknown, worktree: string): boolean {
  return objectOf(raw).worktree === worktree;
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
