import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApp } from './serve.ts';

type Fixture = { tool: 'marestail' | 'slop-cannon'; pid: 'live' | 'dead'; at: string; tasks?: string[]; build: (dir: string) => Promise<void> };
type Bound = Exclude<Awaited<ReturnType<typeof bindApp>>, { error: unknown }>;

const SUMMARY = '.marestail/runs/overnight-20261021T1230.md';
const HEAD = 'a'.repeat(40);
let outer: string;
let root: string;
let runs: string;
let bin: string;
let app: Bound;
let port: number;
let live: number[];

function stamp(at: string): Date {
  return new Date(`2026-10-21T${at}:00.000Z`);
}

async function put(path: string, text: string, at = '12:00'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  await utimes(path, stamp(at), stamp(at));
}

function files(...names: string[]) {
  return async (dir: string) => {
    for (const name of names) await put(join(dir, 'tasks', `${name}.md`), '');
  };
}

function log(dir: string, id: string, text: string, at: string): Promise<void> {
  return put(join(dir, '.marestail/runs', id, 'pipeline.log'), text, at);
}

const H = 'coder got the same problems back 3 times in a row; the worker is not making progress, stopping for a human';
const DONE_TAIL = ['== qa (09-qa) attempt 1', 'pipeline complete', ''];
const HUMAN_TAIL = ['== coder (03-coder) attempt 2', 'gate failed', H, 'pipeline stopped at coder', ''];
const BOOM_TAIL = ['== coder (03-coder) attempt 1', 'npm ERR! boom', 'pipeline stopped at coder', ''];
const UNVERIFIED_TAIL = ['== qa (09-qa) attempt 1', 'pipeline complete, NOT verified by eye', ''];
const HARNESS_TAIL = ['== qa (09-qa) attempt 1', 'pipeline complete, NOT verified against the running app (qa ran against a harness)', ''];
const BOUNCE = 'hardener still bouncing after 1 rounds; stopping for a human';
const BOUNCE_TAIL = [BOUNCE, 'pipeline stopped at hardener', ''];
const REFUSED_TAIL = ['== qa (09-qa) attempt 1', 'pipeline complete', '', '## Config changes the agents asked for and were refused', 'Decide whether to make any of these yourself.'];
const COMPLETE = 'pipeline complete\n\n';
const SUMMARY_LINE = "   07-coder finished in 2.0 min: 'stopped treating pipeline complete as the last line'";
const PERF_LINES = ['== qa (09-qa) attempt 1', 'pipeline complete', '', '## Performance changes', ...Array.from({ length: 25 }, (_, index) => `- degraded +1.0% \`bench ${index + 1} p50\``)];
const STEP_TAIL = ['starting', '== coder (07-coder) attempt 2', SUMMARY_LINE, '== hardener (07-hardener) attempt 1'];

function logged(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

function named(stoppedLog: string, newerLog: string) {
  return async (dir: string) => {
    await files('001-w', '002-x')(dir);
    await log(dir, '001-w', stoppedLog, '12:10');
    await log(dir, '002-x', newerLog, '12:20');
    await put(join(dir, SUMMARY), 'stopped: tasks/001-w.md exited 1\n', '12:30');
  };
}

async function doneBuild(dir: string): Promise<void> {
  await files('001-a', '002-b')(dir);
  await log(dir, '001-a', logged(DONE_TAIL), '12:10');
  await log(dir, '002-b', logged(DONE_TAIL), '12:20');
  await put(join(dir, SUMMARY), '001-a ok\n002-b ok\nall tasks complete 2026-10-21 12:30:00\n', '12:30');
}

async function stoppedBuild(dir: string): Promise<void> {
  await files('001-w', '002-x')(dir);
  await log(dir, '001-w', COMPLETE, '12:10');
  await log(dir, '002-x', logged(HUMAN_TAIL), '12:20');
  await put(join(dir, SUMMARY), 'stopped: tasks/002-x.md exited 1\n', '12:30');
}

function failedBuild(code: number) {
  return async (dir: string) => {
    await files('001-f')(dir);
    await log(dir, '001-f', logged(BOOM_TAIL), '12:10');
    await put(join(dir, SUMMARY), `stopped: tasks/001-f.md exited ${code}\n`, '12:30');
  };
}

const MARESTAIL: Record<string, Fixture> = {
  'done-live': { tool: 'marestail', pid: 'live', at: '12:01', tasks: ['tasks/001-a.md', 'tasks/002-b.md'], build: doneBuild },
  'stopped-live': { tool: 'marestail', pid: 'live', at: '12:02', tasks: ['tasks/001-w.md', 'tasks/002-x.md'], build: stoppedBuild },
  'failed-live': { tool: 'marestail', pid: 'live', at: '12:03', tasks: ['tasks/001-f.md'], build: failedBuild(10) },
  done: { tool: 'marestail', pid: 'dead', at: '12:01', tasks: ['tasks/001-a.md', 'tasks/002-b.md'], build: async dir => {
    await doneBuild(dir);
    await put(join(dir, '.marestail/runs/overnight-20261021T1230.log'), 'marestail output\n', '12:31');
    await put(join(dir, '.marestail/runs/notes.md'), 'scratch\n', '12:32');
  } },
  stopped: { tool: 'marestail', pid: 'dead', at: '12:02', tasks: ['tasks/001-w.md', 'tasks/002-x.md'], build: stoppedBuild },
  failed: { tool: 'marestail', pid: 'dead', at: '12:03', tasks: ['tasks/001-f.md'], build: failedBuild(2) },
  running: { tool: 'marestail', pid: 'live', at: '12:04', tasks: ['tasks/001-init.md', 'tasks/002-step.md', 'tasks/003-later.md'], build: async dir => {
    await files('README', '000-old', '001-init', '002-step', '003-later')(dir);
    await log(dir, '000-old', 'pipeline complete\n', '12:25');
    await log(dir, '001-init', logged(PERF_LINES), '12:10');
    await log(dir, '002-step', logged(STEP_TAIL), '12:20');
    await log(dir, '003-later', `${SUMMARY_LINE}\n`, '12:15');
    await put(join(dir, '.marestail/runs/direct-001-20261021T1226.log'), 'x\n', '12:26');
  } },
  dead: { tool: 'marestail', pid: 'dead', at: '12:05', build: async dir => {
    await files('README', '001-task')(dir);
    await log(dir, '001-task', 'starting\n', '12:10');
  } },
  between: { tool: 'marestail', pid: 'live', at: '12:06', tasks: ['tasks/001-a.md', 'tasks/002-b.md'], build: async dir => {
    await files('001-a', '002-b')(dir);
    await log(dir, '001-a', logged(DONE_TAIL), '12:10');
  } },
  refused: { tool: 'marestail', pid: 'live', at: '12:21', tasks: ['tasks/001-a.md', 'tasks/002-b.md'], build: async dir => {
    await files('001-a', '002-b')(dir);
    await log(dir, '001-a', logged(REFUSED_TAIL), '12:10');
  } },
  perf: { tool: 'marestail', pid: 'live', at: '12:22', tasks: ['tasks/001-a.md', 'tasks/002-b.md'], build: async dir => {
    await files('001-a', '002-b')(dir);
    await log(dir, '001-a', logged(PERF_LINES), '12:10');
  } },
  fresh: { tool: 'marestail', pid: 'dead', at: '12:07', tasks: ['tasks/001-a.md'], build: files('001-a') },
  unverified: { tool: 'marestail', pid: 'live', at: '12:08', tasks: ['tasks/001-a.md'], build: async dir => {
    await files('001-a')(dir);
    await log(dir, '001-a', logged(UNVERIFIED_TAIL), '12:10');
  } },
  harness: { tool: 'marestail', pid: 'live', at: '12:08', tasks: ['tasks/001-a.md'], build: async dir => {
    await files('001-a')(dir);
    await log(dir, '001-a', logged(HARNESS_TAIL), '12:10');
  } },
  bouncing: { tool: 'marestail', pid: 'dead', at: '12:02', tasks: ['tasks/001-h.md'], build: async dir => {
    await files('001-h')(dir);
    await log(dir, '001-h', logged(BOUNCE_TAIL), '12:10');
    await put(join(dir, SUMMARY), 'stopped: tasks/001-h.md exited 1\n', '12:30');
  } },
  'stopped-older': { tool: 'marestail', pid: 'dead', at: '12:02', tasks: ['tasks/001-w.md', 'tasks/002-x.md'], build: named(logged(HUMAN_TAIL), logged(BOOM_TAIL)) },
  'failed-older': { tool: 'marestail', pid: 'dead', at: '12:02', tasks: ['tasks/001-w.md', 'tasks/002-x.md'], build: named(logged(BOOM_TAIL), logged(HUMAN_TAIL)) },
  removed: { tool: 'marestail', pid: 'dead', at: '12:00', tasks: [], build: async dir => rm(dir, { recursive: true }) },
  'removed-live': { tool: 'marestail', pid: 'live', at: '12:00', tasks: [], build: async dir => rm(dir, { recursive: true }) },
};

function status(name: string, text: string) {
  return (dir: string) => put(join(dir, name), text);
}

const CANNON: Record<string, Fixture> = {
  sc: { tool: 'slop-cannon', pid: 'live', at: '12:09', build: status('sc-status.json', JSON.stringify({ state: { phase: 'running' }, agents: [{ alive: true }, { alive: true }, { alive: true }, { alive: true }, { alive: false }], beads: { open: 7, done: 3 }, prs: [{ url: 'https://example.test/pull/41' }, { url: 'https://example.test/pull/42' }] })) },
  'sc-one': { tool: 'slop-cannon', pid: 'live', at: '12:10', build: status('sc-status.json', JSON.stringify({ state: { phase: 'planning' }, agents: [{ alive: true }], beads: {}, prs: [{ url: 'https://example.test/pull/7' }] })) },
  'sc-done': { tool: 'slop-cannon', pid: 'dead', at: '12:11', build: status('sc-status.json', JSON.stringify({ state: { phase: 'complete' }, agents: [], beads: { done: 5 }, prs: [] })) },
  'sc-err': { tool: 'slop-cannon', pid: 'dead', at: '12:12', build: status('sc-status.err', 'no slop-cannon state here\nsecond line\n') },
  'sc-slow': { tool: 'slop-cannon', pid: 'live', at: '12:13', build: status('sc-status.slow', '') },
  'sc-pause': { tool: 'slop-cannon', pid: 'live', at: '12:13', build: status('sc-status.pause', JSON.stringify({ state: { phase: 'planning' }, agents: [{ alive: true }], beads: {}, prs: [{ url: 'https://example.test/pull/7' }] })) },
  'sc-split': { tool: 'slop-cannon', pid: 'live', at: '12:13', build: status('sc-status.split', JSON.stringify({ state: { phase: 'planning' }, agents: [{ alive: true }], beads: {}, prs: [{ url: 'https://example.test/pull/7' }] })) },
  'sc-errsplit': { tool: 'slop-cannon', pid: 'dead', at: '12:12', build: status('sc-status.errsplit', '') },
  'sc-junk': { tool: 'slop-cannon', pid: 'live', at: '12:14', build: status('sc-status.json', 'null') },
  'sc-list': { tool: 'slop-cannon', pid: 'live', at: '12:15', build: status('sc-status.json', '[]') },
  'sc-text': { tool: 'slop-cannon', pid: 'live', at: '12:15', build: status('sc-status.json', 'nope') },
  'sc-quiet': { tool: 'slop-cannon', pid: 'dead', at: '12:16', build: status('sc-status.code', '') },
  'sc-odd': { tool: 'slop-cannon', pid: 'live', at: '12:17', build: status('sc-status.json', JSON.stringify({ state: null, agents: 'x', beads: { open: 'many', done: 2 }, prs: [1, { url: 2 }, { url: 'https://example.test/pull/9' }] })) },
  'sc-zero': { tool: 'slop-cannon', pid: 'live', at: '12:17', build: status('sc-status.json', JSON.stringify({ state: { phase: 'running' }, agents: [{ alive: true }], beads: { open: 0, done: 3 }, prs: [] })) },
  'sc-nulls': { tool: 'slop-cannon', pid: 'live', at: '12:17', build: status('sc-status.json', JSON.stringify({ state: { phase: 'running' }, agents: [null, { alive: true }], beads: {}, prs: [null, 1, { url: 2 }, { url: 'https://example.test/pull/9' }] })) },
  'sc-truthy': { tool: 'slop-cannon', pid: 'live', at: '12:19', build: status('sc-status.json', JSON.stringify({ state: { phase: 'running' }, agents: [{ alive: true }, { alive: 'true' }, { alive: 1 }], beads: {}, prs: [] })) },
  'sc-gone': { tool: 'slop-cannon', pid: 'dead', at: '12:19', build: status('sc-status.json', JSON.stringify({ state: { phase: 'running' } })) },
  'sc-phase': { tool: 'slop-cannon', pid: 'dead', at: '12:18', build: status('sc-status.json', JSON.stringify({ state: { phase: 'done' } })) },
  'sc-done-live': { tool: 'slop-cannon', pid: 'live', at: '12:23', build: status('sc-status.json', JSON.stringify({ state: { phase: 'complete' }, agents: [], beads: { done: 5 }, prs: [] })) },
  'sc-num': { tool: 'slop-cannon', pid: 'live', at: '12:24', build: status('sc-status.json', JSON.stringify({ state: { phase: 5 }, agents: [], beads: {}, prs: [] })) },
  'sc-done-phase-live': { tool: 'slop-cannon', pid: 'live', at: '12:24', build: status('sc-status.json', JSON.stringify({ state: { phase: 'done' }, agents: [], beads: {}, prs: [] })) },
  'sc-string': { tool: 'slop-cannon', pid: 'live', at: '12:15', build: status('sc-status.json', '"x"') },
  'sc-removed-live': { tool: 'slop-cannon', pid: 'live', at: '12:00', build: async dir => {
    await put(join(dir, 'sc-status.json'), JSON.stringify({ state: { phase: 'running' }, agents: [{ alive: true }], beads: {}, prs: [{ url: 'https://example.test/pull/5' }] }));
    await put(outOf('sc-removed-live'), 'sc said something\n');
    await rm(dir, { recursive: true });
  } },
  'sc-removed': { tool: 'slop-cannon', pid: 'dead', at: '12:00', build: async dir => {
    await put(join(dir, 'sc-status.json'), JSON.stringify({ state: { phase: 'running' }, agents: [{ alive: true }], beads: {}, prs: [{ url: 'https://example.test/pull/5' }] }));
    await put(outOf('sc-removed'), 'sc said something\n');
    await rm(dir, { recursive: true });
  } },
};

const FIXTURES: Record<string, Fixture> = { ...MARESTAIL, ...CANNON };

function pidFor(kind: Fixture['pid']): number {
  if (kind === 'dead') return Number(spawnSync('true').pid);
  const child = spawn('sleep', ['900'], { stdio: 'ignore' });
  live.push(Number(child.pid));
  return Number(child.pid);
}

function worktreeOf(name: string): string {
  return join(runs, `wt-${name}`);
}

function outOf(name: string): string {
  return join(root, '.bindweed/runs', `plan-${name}.out`);
}

async function entry(name: string): Promise<Record<string, unknown>> {
  const fixture = FIXTURES[name];
  const dir = worktreeOf(name);
  await mkdir(dir, { recursive: true });
  await fixture.build(dir);
  const base = { slug: `plan-${name}`, tool: fixture.tool, worktree: dir, branch: `bindweed/plan-${name}`, pid: pidFor(fixture.pid), startedAt: stamp(fixture.at).toISOString(), out: outOf(name), settings: {} };
  return fixture.tasks === undefined && fixture.tool === 'marestail' ? base : { ...base, tasks: fixture.tasks ?? [] };
}

async function writeRuns(value: unknown): Promise<string> {
  const text = JSON.stringify(value);
  await put(join(root, '.bindweed/runs.json'), text);
  return text;
}

async function runsText(): Promise<string> {
  return readFile(join(root, '.bindweed/runs.json'), 'utf8');
}

async function plan(slug: string, name: string): Promise<void> {
  await put(join(root, '.bindweed/plans', `${slug}.json`), JSON.stringify({ version: 1, name, slug, createdAt: '2026-10-21T12:00:00.000Z', baseCommit: HEAD, edits: [], redo: [] }));
}

async function bind(path = `${bin}:${process.env.PATH}`): Promise<void> {
  const bound = await bindApp({ repoRoot: root, uiDir: join(outer, 'ui'), env: { ...process.env, PATH: path } }, { mode: 'fixed', port: 0 });
  if ('error' in bound) throw new Error('bind failed');
  app = bound;
  port = (bound.server.address() as { port: number }).port;
}

async function call(path: string, method = 'GET', authorized = true): Promise<{ status: number; body: { runs: Record<string, unknown>[] } & Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: authorized ? { Authorization: `Bearer ${app.token}` } : {} });
  return { status: response.status, body: await response.json() };
}

function withHost(path: string, method: string, host: string): Promise<{ status: number; body: unknown }> {
  return new Promise((done, failed) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { Host: host, Authorization: `Bearer ${app.token}` } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => done({ status: Number(res.statusCode), body: JSON.parse(text) }));
    });
    req.on('error', failed);
    req.end();
  });
}

async function only(name: string): Promise<Record<string, unknown>> {
  await writeRuns([await entry(name)]);
  const before = await runsText();
  const answer = await call('/api/runs');
  expect(answer.status).toBe(200);
  expect(await runsText()).toBe(before);
  return answer.body.runs[0];
}

const LONG = Array.from({ length: 25 }, (_, index) => `step ${index + 1}`);
const SC_LINES = Array.from({ length: 25 }, (_, index) => `[sc] line ${index + 1}`);
const wait = globalThis.setTimeout;

type RunAnswer = { status: number; body: { runs: Record<string, unknown>[] } };
type Flight = { pending: Promise<RunAnswer>; settled: () => boolean };

function realDelay(ms: number): Promise<void> {
  return new Promise(resolve => { wait(resolve, ms); });
}

function alivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number): void {
  if (pid <= 0) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
}

async function appeared(path: string): Promise<boolean> {
  return readFile(path, 'utf8').then(() => true, () => false);
}

async function until(ready: () => Promise<boolean>): Promise<void> {
  for (let left = 100; left > 0; left -= 1) {
    await vi.advanceTimersByTimeAsync(0);
    if (await ready()) return;
    await realDelay(20);
  }
  throw new Error('not ready');
}

async function readPid(name: string): Promise<number> {
  const path = join(worktreeOf(name), 'sc.pid');
  await until(() => appeared(path));
  return Number(await readFile(path, 'utf8'));
}

async function stopSc(name: string): Promise<void> {
  killPid(Number(await readFile(join(worktreeOf(name), 'sc.pid'), 'utf8').catch(() => '')));
  await realDelay(50);
}

function track(pending: Promise<RunAnswer>): Flight {
  let done = false;
  return { pending: pending.then(result => { done = true; return result; }), settled: () => done };
}

function take(pending: Promise<RunAnswer>): Promise<RunAnswer> {
  const failed = realDelay(2000).then(() => Promise.reject(new Error('still pending')));
  return Promise.race([pending, failed]);
}

function installClock(): () => void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return () => { vi.useRealTimers(); };
}

async function release(name: string, restore: () => void): Promise<void> {
  await stopSc(name);
  restore();
}

beforeEach(async () => {
  live = [];
  outer = await mkdtemp(join(tmpdir(), 'bw-runs-'));
  root = join(outer, 'layered');
  runs = join(outer, 'runs');
  bin = join(outer, 'fakes/bin');
  await mkdir(join(outer, 'ui/assets'), { recursive: true });
  await writeFile(join(outer, 'ui/index.html'), '<title>bindweed</title>');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'sc'), `#!/bin/sh
if [ "$#" -ne 4 ] || [ "$1" != status ] || [ "$2" != --repo ] || [ "$4" != --json ]; then
  echo 'usage: sc status --repo <dir> --json' >&2
  exit 2
fi
d="$3"
echo $$ > "$d/sc.pid"
trap 'echo done > "$d/sc.ended"' EXIT
if [ -e "$d/sc-status.hold" ]; then
  while [ ! -e "$d/sc-status.go" ]; do sleep 0.02; done
  cat "$d/sc-status.json"
  exit 0
fi
if [ -e "$d/sc-status.slow" ]; then sleep 15; fi
if [ -e "$d/sc-status.pause" ]; then sleep 3; cat "$d/sc-status.pause"; exit 0; fi
if [ -e "$d/sc-status.split" ]; then head -c 20 "$d/sc-status.split"; sleep 0.2; tail -c +21 "$d/sc-status.split"; exit 0; fi
if [ -e "$d/sc-status.errsplit" ]; then echo 'first problem' >&2; sleep 0.2; echo second >&2; exit 1; fi
if [ -e "$d/sc-status.err" ]; then cat "$d/sc-status.err" >&2; exit 1; fi
if [ -e "$d/sc-status.code" ]; then exit 3; fi
cat "$d/sc-status.json"
`, { mode: 0o755 });
  await put(outOf('sc'), `${SC_LINES.join('\n')}\n`);
  await bind();
});

afterEach(async () => {
  for (const pid of live) process.kill(pid, 'SIGKILL');
  await new Promise<void>(done => app.server.close(() => done()));
  await rm(outer, { recursive: true, force: true });
});

describe('GET /api/runs', () => {
  it.each([
    ['done', 'done', 'all tasks complete · 2 of 2 tasks', DONE_TAIL],
    ['stopped', 'stopped for a human', 'task 002-x · coder · attempt 2 · 1 of 2 tasks', HUMAN_TAIL],
    ['done-live', 'done', 'all tasks complete · 2 of 2 tasks', DONE_TAIL],
    ['stopped-live', 'stopped for a human', 'task 002-x · coder · attempt 2 · 1 of 2 tasks', HUMAN_TAIL],
    ['failed-live', 'failed', 'task 001-f · coder · attempt 1 · 0 of 1 tasks', BOOM_TAIL],
    ['failed', 'failed', 'task 001-f · coder · attempt 1 · 0 of 1 tasks', BOOM_TAIL],
    ['stopped-older', 'stopped for a human', 'task 002-x · coder · attempt 1 · 0 of 2 tasks', BOOM_TAIL],
    ['failed-older', 'failed', 'task 002-x · coder · attempt 2 · 0 of 2 tasks', HUMAN_TAIL],
    ['running', 'running', 'task 002-step · hardener · attempt 1 · 1 of 3 tasks', STEP_TAIL],
    ['dead', 'dead', 'task 001-task · 0 of 1 tasks', ['starting']],
    ['between', 'running', 'task 001-a · finished · 1 of 2 tasks', DONE_TAIL],
    ['refused', 'running', 'task 001-a · finished · 1 of 2 tasks', REFUSED_TAIL],
    ['perf', 'running', 'task 001-a · finished · 1 of 2 tasks', PERF_LINES.slice(-20)],
    ['fresh', 'dead', 'no task started · 0 of 1 tasks', []],
    ['unverified', 'running', 'task 001-a · finished · 1 of 1 tasks', UNVERIFIED_TAIL],
    ['harness', 'running', 'task 001-a · finished · 1 of 1 tasks', HARNESS_TAIL],
    ['bouncing', 'stopped for a human', 'task 001-h · 0 of 1 tasks', BOUNCE_TAIL],
    ['removed', 'worktree removed', 'worktree removed', []],
    ['sc-removed', 'worktree removed', 'worktree removed', []],
    ['removed-live', 'worktree removed', 'worktree removed', []],
    ['sc-removed-live', 'worktree removed', 'worktree removed', []],
    ['sc', 'running', 'running · 4 agents · 7 open · 3 done · 2 PRs', SC_LINES.slice(5)],
    ['sc-one', 'running', 'planning · 1 agent · 1 PR', []],
    ['sc-done', 'done', 'complete · 0 agents · 5 done · 0 PRs', []],
    ['sc-err', 'dead', 'sc status failed: no slop-cannon state here · pid gone', []],
    ['sc-split', 'running', 'planning · 1 agent · 1 PR', []],
    ['sc-errsplit', 'dead', 'sc status failed: first problem · pid gone', []],
    ['sc-junk', 'running', 'sc status failed: not JSON · pid alive', []],
    ['sc-list', 'running', 'sc status failed: not JSON · pid alive', []],
    ['sc-text', 'running', 'sc status failed: not JSON · pid alive', []],
    ['sc-string', 'running', 'sc status failed: not JSON · pid alive', []],
    ['sc-quiet', 'dead', 'sc status failed: exited 3 · pid gone', []],
    ['sc-odd', 'running', ' · 0 agents · 2 done · 1 PR', []],
    ['sc-zero', 'running', 'running · 1 agent · 0 open · 3 done · 0 PRs', []],
    ['sc-nulls', 'running', 'running · 1 agent · 1 PR', []],
    ['sc-truthy', 'running', 'running · 1 agent · 0 PRs', []],
    ['sc-phase', 'done', 'done · 0 agents · 0 PRs', []],
    ['sc-done-live', 'done', 'complete · 0 agents · 5 done · 0 PRs', []],
    ['sc-done-phase-live', 'done', 'done · 0 agents · 0 PRs', []],
    ['sc-num', 'running', ' · 0 agents · 0 PRs', []],
    ['sc-gone', 'dead', 'running · 0 agents · 0 PRs', []],
  ])('Each run reports its state and position: %s', async (name, state, position, logTail) => {
    expect(await only(name)).toMatchObject({ state, position, logTail });
  });

  it('Each run reports its state and position: sc-slow, and a slow sc does not hold the answer past its timeout', async () => {
    const started = Date.now();
    expect(await only('sc-slow')).toMatchObject({ state: 'running', position: 'sc status failed: timed out after 10s · pid alive', logTail: [] });
    expect(Date.now() - started).toBeLessThan(12000);
  }, 15000);

  it.each(['sc-removed', 'sc-removed-live'])('A removed slop-cannon worktree reads worktree removed and is not asked: %s', async name => {
    expect(await only(name)).toMatchObject({ worktreeExists: false, state: 'worktree removed', position: 'worktree removed', logTail: [], prs: [] });
    expect(await appeared(join(worktreeOf(name), 'sc.pid'))).toBe(false);
  });

  it('Null agents and PRs from sc are skipped', async () => {
    expect(await only('sc-nulls')).toMatchObject({ state: 'running', position: 'running · 1 agent · 1 PR', prs: ['https://example.test/pull/9'] });
  });

  it('An sc that answers after a few seconds keeps its position', async () => {
    const started = Date.now();
    expect(await only('sc-pause')).toMatchObject({ state: 'running', position: 'planning · 1 agent · 1 PR', logTail: [] });
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThan(2500);
    expect(waited).toBeLessThan(12000);
  }, 15000);

  it('A silent sc stays pending until 10 seconds, then is killed', async () => {
    const started = Date.now();
    const before = await writeRuns([await entry('sc-slow')]);
    const restore = installClock();
    try {
      const flight = track(call('/api/runs'));
      const pid = await readPid('sc-slow');
      await vi.advanceTimersByTimeAsync(9999);
      await realDelay(80);
      expect(flight.settled()).toBe(false);
      expect(alivePid(pid)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await until(() => Promise.resolve(!alivePid(pid)));
      const answer = await take(flight.pending);
      expect(answer.status).toBe(200);
      expect(answer.body.runs[0]).toMatchObject({ state: 'running', position: 'sc status failed: timed out after 10s · pid alive' });
      expect(await appeared(join(worktreeOf('sc-slow'), 'sc.ended'))).toBe(false);
      expect(Date.now() - started).toBeLessThan(12000);
      expect(await runsText()).toBe(before);
    } finally {
      await release('sc-slow', restore);
    }
  }, 15000);

  it('An sc that answers just before 10 seconds keeps its position', async () => {
    const started = Date.now();
    const before = await writeRuns([await entry('sc-one')]);
    await put(join(worktreeOf('sc-one'), 'sc-status.hold'), '');
    const restore = installClock();
    try {
      const flight = track(call('/api/runs'));
      const pid = await readPid('sc-one');
      await vi.advanceTimersByTimeAsync(9999);
      await realDelay(80);
      expect(flight.settled()).toBe(false);
      expect(alivePid(pid)).toBe(true);
      await put(join(worktreeOf('sc-one'), 'sc-status.go'), '');
      const answer = await take(flight.pending);
      expect(answer.status).toBe(200);
      expect(answer.body.runs[0]).toMatchObject({ state: 'running', position: 'planning · 1 agent · 1 PR' });
      expect(await appeared(join(worktreeOf('sc-one'), 'sc.ended'))).toBe(true);
      expect(alivePid(pid)).toBe(false);
      expect(Date.now() - started).toBeLessThan(12000);
      expect(await runsText()).toBe(before);
    } finally {
      await release('sc-one', restore);
    }
  }, 15000);

  it('One run carries every field, and slop-cannon PRs are listed', async () => {
    const sc = await entry('sc');
    await writeRuns([sc, await entry('running')]);
    await plan('plan-sc', 'Plan SC');
    await put(join(root, '.bindweed/plans/plan-running.json'), '{"name":"Bad"}');
    const { body } = await call('/api/runs');
    expect(body.runs[0]).toEqual({ slug: 'plan-sc', planName: 'Plan SC', planExists: true, tool: 'slop-cannon', branch: 'bindweed/plan-sc', worktree: worktreeOf('sc'), worktreeExists: true, pid: sc.pid, startedAt: '2026-10-21T12:09:00.000Z', state: 'running', position: 'running · 4 agents · 7 open · 3 done · 2 PRs', prs: ['https://example.test/pull/41', 'https://example.test/pull/42'], logTail: SC_LINES.slice(5) });
    expect(body.runs[1]).toMatchObject({ slug: 'plan-running', planName: 'plan-running', planExists: false, prs: [], worktreeExists: true });
  });

  it('Runs are ordered newest first and malformed elements are left out', async () => {
    const whole = { tool: 'marestail', worktree: worktreeOf('done'), startedAt: '2026-10-21T11:00:00.000Z' };
    await writeRuns([
      await entry('done'), 7, { slug: 'x' }, await entry('dead'), await entry('removed'),
      { slug: 'no-worktree', tool: 'marestail', startedAt: whole.startedAt },
      { slug: 'no-started', tool: 'marestail', worktree: whole.worktree },
      { ...whole, slug: 5 },
      { ...whole, slug: 'other-tool', tool: 'other' },
    ]);
    const answer = await call('/api/runs');
    expect(answer.status).toBe(200);
    expect(answer.body.runs.map(run => run.slug)).toEqual(['plan-dead', 'plan-done', 'plan-removed']);
    expect(answer.body.runs[2]).toMatchObject({ worktreeExists: false, prs: [] });
  });

  it('On a tie the later element comes first, and odd branch, pid and out read as null and no log', async () => {
    const dead = await entry('dead');
    const secret = join(outer, 'secret.out');
    await put(secret, 'secret\n');
    const fd = openSync(secret, 'r');
    await writeRuns([dead, { ...dead, slug: 'later', branch: 3, pid: 'x' }, { ...(await entry('sc')), out: fd }]);
    const { body } = await call('/api/runs').finally(() => closeSync(fd));
    expect(body.runs.map(run => run.slug)).toEqual(['plan-sc', 'later', 'plan-dead']);
    expect(body.runs[0]).toMatchObject({ logTail: [] });
    expect(body.runs[1]).toMatchObject({ branch: null, pid: null, state: 'dead' });
  });

  it('The newest summary decides, and a summary without a verdict leaves the pid to decide', async () => {
    const done = await entry('done');
    await put(join(worktreeOf('done'), '.marestail/runs/overnight-20261021T1300.md'), 'started\n', '13:00');
    await writeRuns([done]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ state: 'dead', position: 'task 002-b · finished · 2 of 2 tasks' });
  });

  it.each([
    ['all tasks complete 2026-10-21 12:30:00\nstopped: tasks/002-x.md exited 1\n', 'stopped for a human'],
    ['stopped: tasks/002-x.md exited 1\nall tasks complete 2026-10-21 12:30:00\n', 'done'],
  ])('The last verdict line of a summary decides: %j', async (summary, state) => {
    const stopped = await entry('stopped');
    await put(join(worktreeOf('stopped'), SUMMARY), summary, '12:30');
    await writeRuns([stopped]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ state });
  });

  it('Agent text in a summary is not a verdict', async () => {
    const running = await entry('running');
    await put(join(worktreeOf('running'), SUMMARY), '#### timeline.md\n- qa checked that all tasks complete on the panel\n    stopped: tasks/001-init.md exited 1\nstopped: tasks/001-init.md exited 1, retried\n', '12:30');
    await writeRuns([running]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ state: 'running', position: 'task 002-step · hardener · attempt 1 · 1 of 3 tasks' });
  });

  it.each<[string, string[], string]>([
    ['ending in a role line', [...LONG, '== coder (07-coder) attempt 3'], 'coder · attempt 3'],
    ['whose role line is above the tail', ['== coder (07-coder) attempt 2', ...LONG], 'coder · attempt 2'],
  ])('A long log shows its last 20 lines and its position from the whole log: %s', async (_name, lines, role) => {
    const dead = await entry('dead');
    await log(worktreeOf('dead'), '001-task', logged(lines), '12:10');
    await writeRuns([dead]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ position: `task 001-task · ${role} · 0 of 1 tasks`, logTail: lines.slice(-20) });
  });

  it('A pid that refuses kill -0 is alive', async () => {
    const [dead, scErr] = [await entry('dead'), await entry('sc-err')];
    const denied = new Set([dead.pid, scErr.pid]);
    const real = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (denied.has(pid)) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return real(pid, signal);
    });
    try {
      await writeRuns([dead, scErr]);
      expect((await call('/api/runs')).body.runs).toMatchObject([
        { slug: 'plan-sc-err', state: 'running', position: 'sc status failed: no slop-cannon state here · pid alive' },
        { slug: 'plan-dead', state: 'running', position: 'task 001-task · 0 of 1 tasks' },
      ]);
    } finally {
      kill.mockRestore();
    }
  });

  it.each<[string, string, string[]]>([
    ['A role line without an attempt gives the plain task form', '== something odd\n', ['== something odd']],
    ['A blank role line gives the plain task form', '== \n', ['== ']],
    ['An attempt that is not a number gives the plain task form', '== coder attempt x myattempt 1\n', ['== coder attempt x myattempt 1']],
    ['An empty log has no lines', '', []],
  ])('%s', async (_name, text, logTail) => {
    const dead = await entry('dead');
    await log(worktreeOf('dead'), '001-task', text, '12:10');
    await writeRuns([dead]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ position: 'task 001-task · 0 of 1 tasks', logTail });
  });

  it('The current task is the newest log, whatever the task order', async () => {
    await writeRuns([{ ...(await entry('running')), tasks: ['tasks/002-step.md', 'tasks/001-init.md'] }]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ position: 'task 002-step · hardener · attempt 1 · 1 of 2 tasks' });
  });

  it('Without a tasks list the worktree\'s task files except README count', async () => {
    const dead = await entry('dead');
    await put(join(worktreeOf('dead'), 'tasks/000-z.md'), '');
    await put(join(worktreeOf('dead'), 'tasks/notes.txt'), '');
    await writeRuns([dead]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ position: 'task 001-task · 0 of 2 tasks' });
  });

  it('A tasks list holding a non-string falls back to the worktree\'s task files', async () => {
    await writeRuns([{ ...(await entry('dead')), tasks: ['tasks/001-task.md', 5] }]);
    const answer = await call('/api/runs');
    expect(answer.status).toBe(200);
    expect(answer.body.runs[0]).toMatchObject({ state: 'dead', position: 'task 001-task · 0 of 1 tasks', logTail: ['starting'] });
  });

  it('A worktree without a tasks directory has no tasks', async () => {
    const dead = await entry('dead');
    await rm(join(worktreeOf('dead'), 'tasks'), { recursive: true });
    await writeRuns([dead]);
    expect((await call('/api/runs')).body.runs[0]).toMatchObject({ position: 'no task started · 0 of 0 tasks' });
  });

  it('sc missing from PATH is reported on the card', async () => {
    await new Promise<void>(done => app.server.close(() => done()));
    await bind(join(outer, 'nowhere'));
    expect(await only('sc-one')).toMatchObject({ state: 'running', position: 'sc status failed: sc is not on PATH · pid alive' });
  });

  it('sc is not on PATH when PATH is unset', async () => {
    await new Promise<void>(done => app.server.close(() => done()));
    const env = { ...process.env };
    delete env.PATH;
    const bound = await bindApp({ repoRoot: root, uiDir: join(outer, 'ui'), env }, { mode: 'fixed', port: 0 });
    if ('error' in bound) throw new Error('bind failed');
    app = bound;
    port = (bound.server.address() as { port: number }).port;
    expect(await only('sc-one')).toMatchObject({ state: 'running', position: 'sc status failed: sc is not on PATH · pid alive' });
  });

  it('A non-executable sc earlier on PATH is skipped', async () => {
    const blocked = join(outer, 'blocked');
    await mkdir(blocked, { recursive: true });
    await writeFile(join(blocked, 'sc'), '', { mode: 0o644 });
    await new Promise<void>(done => app.server.close(() => done()));
    await bind(`${blocked}${delimiter}${bin}${delimiter}${process.env.PATH}`);
    expect(await only('sc-one')).toMatchObject({ state: 'running', position: 'planning · 1 agent · 1 PR' });
  });

  it('A sc that cannot be run for another reason shows the error', async () => {
    await mkdir(join(outer, 'odd/sc'), { recursive: true });
    await new Promise<void>(done => app.server.close(() => done()));
    await bind(join(outer, 'odd'));
    expect((await only('sc-one')).position).toMatch(/^sc status failed: Error: spawn sc EACCES · pid alive$/);
  });

  it.each([['missing', null], ['not json', 'not json'], ['an object', '{"a":1}'], ['empty', '[]']])('Missing or malformed runs.json answers no runs: %s', async (_name, text) => {
    if (text !== null) await put(join(root, '.bindweed/runs.json'), text);
    expect(await call('/api/runs')).toEqual({ status: 200, body: { runs: [] } });
  });

  it('GET /api/runs checks host and token', async () => {
    expect(await call('/api/runs', 'GET', false)).toEqual({ status: 401, body: { error: 'missing or wrong token' } });
    expect(await withHost('/api/runs', 'GET', 'evil.example:5000')).toEqual({ status: 403, body: { error: 'bad host' } });
  });
});

describe('DELETE /api/runs', () => {
  it('Forget drops the removed run and keeps the rest', async () => {
    const [done, removed, dead] = [await entry('done'), await entry('removed'), await entry('dead')];
    const relaunched = { ...removed, startedAt: stamp('12:40').toISOString() };
    const sibling = { ...removed, slug: 'plan-removed-2', worktree: `${worktreeOf('removed')}-2` };
    await writeRuns([done, 7, null, [], removed, dead, relaunched, sibling]);
    expect(await call(`/api/runs?worktree=${worktreeOf('removed')}`, 'DELETE')).toEqual({ status: 200, body: { ok: true } });
    expect(JSON.parse(await runsText())).toEqual([done, 7, null, [], dead, sibling]);
  });

  it.each([
    ['', 400, { error: 'missing worktree' }],
    ['?worktree=WT/wt-done', 400, { error: 'worktree still exists' }],
    ['?worktree=WT/wt-elsewhere', 404, { error: 'no such run' }],
    ['?worktree=WT/wt-remov', 404, { error: 'no such run' }],
  ])('Forget refuses and leaves runs.json unchanged: %s', async (query, code, body) => {
    const before = await writeRuns([await entry('done'), await entry('removed')]);
    expect(await call(`/api/runs${query.replace('WT', runs)}`, 'DELETE')).toEqual({ status: code, body });
    expect(await runsText()).toBe(before);
  });

  it('Forget answers no such run when runs.json is not a list', async () => {
    const before = await writeRuns({ worktree: worktreeOf('removed') });
    expect(await call(`/api/runs?worktree=${worktreeOf('removed')}`, 'DELETE')).toEqual({ status: 404, body: { error: 'no such run' } });
    expect(await runsText()).toBe(before);
  });

  it('Forget checks host and token', async () => {
    const before = await writeRuns([await entry('removed')]);
    const url = `/api/runs?worktree=${worktreeOf('removed')}`;
    expect(await call(url, 'DELETE', false)).toEqual({ status: 401, body: { error: 'missing or wrong token' } });
    expect(await withHost(url, 'DELETE', 'evil.example:5000')).toEqual({ status: 403, body: { error: 'bad host' } });
    expect(await runsText()).toBe(before);
  });
});
