export type Standing = { state: RunState; position: string; prs: string[]; logTail: string[] };

type RunState = 'running' | 'stopped for a human' | 'failed' | 'done' | 'dead';
type TaskLog = { id: string; lines: string[]; mtime: number };
type Verdict = { done: true } | { done: false; path: string };
type Attempt = { at: number; attempt: string };
type Sc = { ok: true; stdout: string } | { ok: false; reason: string };
type MarestailFacts = {
  alive: boolean;
  summary: string[];
  logs: TaskLog[];
  taskCount: number;
  stoppedLines: (taskPath: string) => Promise<string[]>;
};
type CannonFacts = { alive: boolean; answer: Sc; out: string[] };

const TAIL = 20;
const STOPPED = /^stopped: (.+) exited -?\d+$/;
const ATTEMPT = 'attempt ';

function tailOf(lines: string[]): string[] {
  return lines.slice(-TAIL);
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

function verdictOf(line: string): Verdict | undefined {
  if (line.startsWith('all tasks complete')) return { done: true };
  const stopped = STOPPED.exec(line);
  return stopped === null ? undefined : { done: false, path: stopped[1] };
}

function failedOrStopped(lines: string[]): RunState {
  return lastOf(lines).includes('stopping for a human') ? 'stopped for a human' : 'failed';
}

async function stateOf(summary: string[], alive: boolean, stoppedLines: MarestailFacts['stoppedLines']): Promise<RunState> {
  const verdict = summary.map(verdictOf).findLast(found => found !== undefined);
  if (verdict === undefined) return alive ? 'running' : 'dead';
  if (verdict.done) return 'done';
  return failedOrStopped(await stoppedLines(verdict.path));
}

function boundaryBefore(line: string, at: number): boolean {
  return at === 0 || /^\W/.test(line.charAt(at - 1));
}

function leadingDigits(text: string): string {
  return /^\d+/.exec(text)?.[0] ?? '';
}

function attemptMatches(line: string): Attempt[] {
  const found: Attempt[] = [];
  let at = line.indexOf(ATTEMPT);
  while (at >= 0) {
    const digits = leadingDigits(line.slice(at + ATTEMPT.length));
    if (boundaryBefore(line, at) && digits !== '') found.push({ at, attempt: digits });
    at = line.indexOf(ATTEMPT, at + ATTEMPT.length);
  }
  return found;
}

function chosenAttempt(line: string): Attempt | undefined {
  return attemptMatches(line).findLast(match => match.at > '== '.length);
}

function roleFrom(line: string): string | undefined {
  const token = /^== (\S+)/.exec(line)?.[1];
  if (token === undefined) return undefined;
  const chosen = chosenAttempt(line);
  if (chosen === undefined) return undefined;
  const role = line.slice('== '.length, Math.min(chosen.at, '== '.length + token.length));
  return `${role} · attempt ${chosen.attempt}`;
}

function rolePart(log: TaskLog): string | undefined {
  const line = log.lines.findLast(item => item.startsWith('== '));
  if (line === undefined) return undefined;
  return roleFrom(line);
}

function currentPart(log: TaskLog): string {
  if (completes(lastOf(log.lines))) return `task ${log.id} · finished`;
  const role = rolePart(log);
  return role === undefined ? `task ${log.id}` : `task ${log.id} · ${role}`;
}

function marestailPosition(state: RunState, current: TaskLog | undefined, counts: string): string {
  if (state === 'done') return `all tasks complete · ${counts}`;
  if (current === undefined) return `no task started · ${counts}`;
  return `${currentPart(current)} · ${counts}`;
}

export async function marestailStanding(facts: MarestailFacts): Promise<Standing> {
  const done = facts.logs.filter(log => log.lines.some(completes)).length;
  const current = newest(facts.logs);
  const state = await stateOf(facts.summary, facts.alive, facts.stoppedLines);
  const position = marestailPosition(state, current, `${done} of ${facts.taskCount} tasks`);
  return { state, position, prs: [], logTail: tailOf(current?.lines ?? []) };
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

function scState(phase: string, alive: boolean): RunState {
  if (phase === 'done' || phase === 'complete') return 'done';
  return alive ? 'running' : 'dead';
}

function scFailure(reason: string, alive: boolean): Pick<Standing, 'state' | 'position'> {
  return { state: alive ? 'running' : 'dead', position: `sc status failed: ${reason} · pid ${alive ? 'alive' : 'gone'}` };
}

function scReading(answer: Sc, alive: boolean): Pick<Standing, 'state' | 'position' | 'prs'> {
  if (!answer.ok) return { ...scFailure(answer.reason, alive), prs: [] };
  const status = parsedObject(answer.stdout);
  if (status === undefined) return { ...scFailure('not JSON', alive), prs: [] };
  const phase = phaseOf(status);
  const agents = listOf(status.agents).filter(agent => agent.alive === true).length;
  const prs = prsOf(status);
  const position = [phase, counted(agents, 'agent'), ...beadParts(status), counted(prs.length, 'PR')].join(' · ');
  return { state: scState(phase, alive), position, prs };
}

export function cannonStanding(facts: CannonFacts): Standing {
  return { ...scReading(facts.answer, facts.alive), logTail: tailOf(facts.out) };
}
