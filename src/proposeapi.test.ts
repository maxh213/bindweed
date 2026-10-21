import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PlanEdit } from './domain/plan.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 24500 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);
const FIXTURES = join(process.cwd(), 'qa', 'fixtures');
const FENCE = '```';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const PACKAGE: PlanEdit = { kind: 'create-package', path: 'src/ports' };
const MOVE: PlanEdit = { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' };
const MISSING: PlanEdit = { kind: 'move-file', file: 'src/no-such.ts', to: 'src/ports' };
const KEEP: PlanEdit = { kind: 'add-edge', from: 'src/domain', to: 'src/app' };
const FOUR: PlanEdit[] = [CUT, PACKAGE, MOVE, MISSING];
const JOBS: unknown[] = [
  { kind: 'split-package', package: 'src/app', parts: [{ name: 'scan', files: ['src/app/a.ts'] }, { name: 'jobs', files: ['src/app/b.ts'] }] },
  { kind: 'move-file', file: 'src/app/scan/a.ts', to: 'src/infra' },
  { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' },
  { kind: 'note', target: { node: 'src/app' }, text: 'three jobs' },
];

const QUESTIONS = {
  questions: [
    { id: 'q1', text: 'Must a.ts keep exporting a?', why: 'Other code may import it.' },
    { id: 'q2', text: 'Should b.ts move before the cut?', why: 'The order decides which slice breaks the build.' },
  ],
};
const SUMMARY = 'Pull scanning out of the ui so app has one job.';
const PROPOSALS = { summary: SUMMARY, edits: FOUR };
const KEEP_REPLY = { summary: 'Leave scanning in app.', edits: [KEEP] };
const JOBS_REPLY = { summary: 'Give each job its own package.', edits: JOBS };
const BAD_REPLY = `${FENCE}json\n{"slices": [\n${FENCE}\n`;
const QUESTIONS_REPLY = `Some questions first.\n${FENCE}json\n${JSON.stringify(QUESTIONS)}\n${FENCE}\n`;

function fenced(value: unknown): string {
  return `${FENCE}json\n${JSON.stringify(value)}\n${FENCE}\n`;
}

const PROPOSALS_REPLY = `Pull scanning out.\n${fenced({ example: 1 })}Proposed.\n${fenced(PROPOSALS)}`;

const FAKE_LLM = `import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const log = process.argv[2];
const input = readFileSync(0, 'utf8');
const n = readdirSync(log).filter(name => name.endsWith('.prompt')).length + 1;
writeFileSync(log + '/' + n + '.prompt', input);
const env = process.env;
writeFileSync(log + '/' + n + '.env.json', JSON.stringify({ cwd: process.cwd(), root: env.BINDWEED_ROOT ?? null, claudecode: env.CLAUDECODE ?? null, entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null }));
const dislike = (phrase) => input.includes('## What they dislike\\n' + phrase + '\\n');
if (input.includes('SLEEP-NOW')) {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' });
  writeFileSync(log + '/sleep.pids', process.pid + '\\n' + child.pid + '\\n');
  setInterval(() => undefined, 1000);
} else if (input.includes('BAD-ONCE') && !existsSync(log + '/bad.done')) {
  writeFileSync(log + '/bad.done', '');
  process.stdout.write(${JSON.stringify(BAD_REPLY)});
} else if (dislike('keep scan where it is')) {
  process.stdout.write(${JSON.stringify(fenced(KEEP_REPLY))});
} else if (dislike('the ui knows about the scanner')) {
  process.stdout.write(${JSON.stringify(PROPOSALS_REPLY)});
} else if (dislike('app is doing three jobs')) {
  process.stdout.write(${JSON.stringify(fenced(JOBS_REPLY))});
} else if (input.includes('Reply with slices now.')) {
  process.stdout.write(${JSON.stringify(fenced({ slices: [{ title: 'T', slug: 't', body: 'b' }], brief: 'b' }))});
} else {
  process.stdout.write(${JSON.stringify(QUESTIONS_REPLY)});
}
`;

const SRC_GRAPH = `## Planned graph
### src
node src/app package app files 2 ca 0 ce 2 i 1.00 a 0.00 d 0.00 zone healthy cycle false
node src/infra package infra files 1 ca 2 ce 1 i 0.33 a 0.00 d 0.67 zone pain cycle false
node src/domain package domain files 1 ca 2 ce 0 i 0.00 a 0.00 d 1.00 zone pain cycle false
edge src/app -> src/domain runtime 0 type 1 cycle false
edge src/app -> src/infra runtime 2 type 0 cycle false
edge src/infra -> src/domain runtime 1 type 0 cycle false
cycles none
### src/app
node src/app/a.ts file a.ts ca 1 ce 3 i 0.75 a 0.00 d 0.25 cycle true
node src/app/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 cycle true
edge src/app/a.ts -> src/app/b.ts runtime 1 type 0 cycle true text a.ts → b.ts → a.ts
edge src/app/b.ts -> src/app/a.ts runtime 1 type 0 cycle true text b.ts → a.ts → b.ts
cycles a.ts → b.ts → a.ts
### src/domain
node src/domain/model.ts file model.ts ca 2 ce 0 i 0.00 a 0.00 d 1.00 cycle false
cycles none
### src/infra
node src/infra/db.ts file db.ts ca 2 ce 1 i 0.33 a 0.00 d 0.67 cycle false
cycles none`;

const PORTS_GRAPH = `## Planned graph
### src/ports
node src/ports/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 cycle false
cycles none`;

const HEALTH_GRAPH = `## Planned graph
### src
node src/app package app files 1 ca 1 ce 1 i 0.50 a 0.00 d 0.50 zone healthy coverage 1.00 mutants 2 cycle true
node src/ports package ports files 1 ca 1 ce 1 i 0.50 a 0.00 d 0.50 zone healthy crap – mutants 0 cycle true
node src/infra package infra files 1 ca 2 ce 1 i 0.33 a 0.00 d 0.67 zone pain crap – mutants 0 cycle false
node src/domain package domain files 2 ca 2 ce 0 i 0.00 a 0.00 d 1.00 zone pain crap 2.5 coverage 0.50 mutants 1 cycle false
edge src/app -> src/domain runtime 0 type 1 cycle false
edge src/app -> src/infra runtime 1 type 0 cycle false
edge src/app -> src/ports runtime 1 type 0 cycle true text app → ports → app
edge src/infra -> src/domain runtime 1 type 0 cycle false
edge src/ports -> src/app runtime 1 type 0 cycle true text ports → app → ports
edge src/ports -> src/infra runtime 1 type 0 cycle false
cycles app → ports → app
### src/app
node src/app/a.ts file a.ts ca 1 ce 3 i 0.75 a 0.00 d 0.25 coverage 1.00 mutants 2 cycle false
cycles none
### src/domain
node src/domain/model.ts file model.ts ca 2 ce 0 i 0.00 a 0.00 d 1.00 crap – mutants 0 cycle false
node src/domain/rule.ts file rule.ts ca 0 ce 0 i – a 0.00 d – crap 2.5 coverage 0.50 mutants 1 cycle false
cycles none
### src/infra
node src/infra/db.ts file db.ts ca 2 ce 1 i 0.33 a 0.00 d 0.67 crap – mutants 0 cycle false
cycles none
### src/ports
node src/ports/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 crap – mutants 0 cycle false
cycles none`;

const EDIT_LINES = [
  '{"kind":"move-file","file":"<path>","to":"<dir>"}',
  '{"kind":"cut-edge","from":"<box>","to":"<box>","files":[["<file>","<file>"]]}',
  '{"kind":"add-edge","from":"<box>","to":"<box>"}',
  '{"kind":"note","target":{"node":"<box>"},"text":"<text>"}',
  '{"kind":"note","target":{"edge":["<box>","<box>"]},"text":"<text>"}',
  '{"kind":"create-package","path":"<path>"}',
  '{"kind":"rename-package","from":"<path>","to":"<path>"}',
  '{"kind":"rename-file","from":"<path>","to":"<name>"}',
  '{"kind":"merge-packages","packages":["<path>"],"into":"<path>"}',
  '{"kind":"split-package","package":"<path>","parts":[{"name":"<name>","files":["<path>"]}]}',
  '{"kind":"fate","file":"<path>","fate":"delete"}',
  '{"kind":"fate","file":"<path>","fate":"fold","into":"<path>"}',
];

type Bound = { server: Server; port: number; token: string };
type Hit = { status: number; body: Buffer };

const loose = z.record(z.string(), z.unknown());

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commitAll(root: string): void {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
}

async function fixtureRepo(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-propose-')), 'layered');
  const { cp } = await import('node:fs/promises');
  await cp(join(FIXTURES, 'layered'), root, { recursive: true });
  git(root, 'init', '-q', '--template=');
  commitAll(root);
  await prepareBindweed(root);
  return root;
}

async function boundOn(repoRoot: string, uiDir: string, port: number): Promise<Bound> {
  const result = await bindApp({ repoRoot, uiDir }, { mode: 'fixed', port });
  if ('error' in result) throw new Error(listenErrorMessage(result.error));
  return result;
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}

function hit(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pause(ms: number): Promise<void> {
  await new Promise(done => setTimeout(done, ms));
}

async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await pause(25);
  }
  return check();
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(() => true, () => false);
}

type World = {
  root: string;
  log: string;
  fake: string;
  token: string;
  read(path: string, headers?: Record<string, string>): Promise<Hit>;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Hit>;
  plan(edits: PlanEdit[], extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
  backend(command: string): Promise<void>;
  propose(text: string, at?: string): Promise<Hit>;
  prompt(n: number): Promise<string>;
};

function worldFor(port: number): () => World {
  const held: { root: string; log: string; fake: string; app?: Bound; base: Record<string, unknown> } = { root: '', log: '', fake: '', base: {} };
  beforeAll(async () => {
    held.root = await fixtureRepo();
    const scratch = await mkdtemp(join(tmpdir(), 'bw-fake-'));
    held.fake = join(scratch, 'fake-llm.mjs');
    held.log = join(scratch, 'log');
    await writeFile(held.fake, FAKE_LLM);
    const ui = join(scratch, 'ui');
    await mkdir(ui);
    await writeFile(join(ui, 'index.html'), '<!DOCTYPE html><html><head><title>bindweed</title></head><body></body></html>');
    held.app = await boundOn(held.root, ui, port);
  });
  beforeEach(async () => {
    await rm(held.log, { recursive: true, force: true });
    await mkdir(held.log);
    await rm(join(held.root, '.bindweed', 'plans'), { recursive: true, force: true });
    await writeFile(join(held.root, '.bindweed', 'config.json'), JSON.stringify({ llm: { backend: 'command', command: `node ${held.fake} ${held.log}` } }));
    held.base = {};
  });
  afterAll(async () => {
    if (held.app !== undefined) await closeServer(held.app.server);
    await rm(dirname(held.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(dirname(held.log), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return () => {
    const app = held.app;
    if (app === undefined) throw new Error('not bound');
    const bearer = { Authorization: `Bearer ${app.token}` };
    const view: World = {
      root: held.root,
      log: held.log,
      fake: `node ${held.fake} ${held.log}`,
      token: app.token,
      read: (path, headers = bearer) => hit(app.port, 'GET', path, headers),
      call: (method, path, body, headers = { ...bearer, 'Content-Type': 'application/json' }) =>
        hit(app.port, method, path, headers, body === undefined ? undefined : JSON.stringify(body)),
      async plan(edits, extra = {}) {
        if (held.base.slug === undefined) held.base = loose.parse(json(await view.call('POST', '/api/plans', { name: 'Gate' })));
        const put = await view.call('PUT', '/api/plans/gate', { ...held.base, edits, redo: [], ...extra });
        expect(put.status).toBe(200);
        return held.base;
      },
      async backend(command) {
        expect((await view.call('PUT', '/api/config', { llm: { backend: 'command', command } })).status).toBe(200);
      },
      propose: (text, at = 'src') => view.call('POST', '/api/plans/gate/propose', { text, at }),
      prompt: n => readFile(join(held.log, `${n}.prompt`), 'utf8'),
    };
    return view;
  };
}

describe('propose over the four-file fixture', () => {
  const world = worldFor(PORT_BASE);

  it('The dislike is sent with the view, the schema and no plan change', async () => {
    await world().plan([]);
    const sent = await world().propose('the ui knows about the scanner');
    expect(sent.status).toBe(200);
    const body = loose.parse(json(sent));
    expect(body.ran).toBe(`command: ${world().fake}`);
    expect(body.summary).toBe(SUMMARY);
    expect(body.edits).toEqual(FOUR);
    expect(body.stale).toEqual([null, null, null, 'no such file src/no-such.ts']);
    const chat = z.array(loose).parse(body.chat);
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ text: 'the ui knows about the scanner', summary: SUMMARY, edits: FOUR, decisions: {} });
    expect(ISO.test(String(chat[0].at))).toBe(true);
    expect(JSON.parse(await readFile(join(world().root, '.bindweed', 'plans', 'gate.chat.json'), 'utf8'))).toEqual(chat);
    const plan = loose.parse(json(await world().read('/api/plans/gate')));
    expect(plan.edits).toEqual([]);
    expect(plan.redo).toEqual([]);
    expect(plan).not.toHaveProperty('chat');
    expect(plan).not.toHaveProperty('interview');
    expect(plan).not.toHaveProperty('tasks');
    expect(plan).not.toHaveProperty('brief');
    expect(json(await world().read('/api/plans'))).toEqual({ plans: [{ name: 'Gate', slug: 'gate', editCount: 0, createdAt: plan.createdAt }] });
    const prompt = await world().prompt(1);
    expect(prompt).toContain('## What they dislike\nthe ui knows about the scanner\n');
    expect(prompt).toContain('## Current view\nsrc\n');
    expect(prompt).toContain('You are proposing edits to the plan "Gate".');
    expect(prompt).toContain(SRC_GRAPH);
    for (const line of [...EDIT_LINES, 'Reply with exactly one JSON object, in a fenced json block.', '{"summary":"<one paragraph>","edits":[<edit>]}']) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain("## The plan's edits so far\nnone");
    expect(prompt).toContain('## Conversation so far\nnone');
    expect(prompt).not.toContain('Reply with slices now.');
    expect(prompt).not.toContain('crap');
    expect(prompt).not.toContain('To ask, reply');
    expect(JSON.parse(await readFile(join(world().log, '1.env.json'), 'utf8'))).toEqual({ cwd: world().root, root: world().root, claudecode: null, entrypoint: null });
    expect(git(world().root, 'status', '--porcelain')).toBe('');
  });

  it('a proposals query draws the edits that parse and ignores the rest', async () => {
    await world().plan([]);
    const ids = async (proposals: string): Promise<string[]> => {
      const view = z.object({ nodes: z.array(z.object({ id: z.string() })) }).parse(json(await world().read(`/api/graph?at=src&plan=gate&proposals=${encodeURIComponent(proposals)}`)));
      return view.nodes.map(node => node.id);
    };
    expect(await ids(JSON.stringify([PACKAGE]))).toContain('src/ports');
    expect(await ids('not json')).not.toContain('src/ports');
    expect(await ids(JSON.stringify({}))).not.toContain('src/ports');
    expect(await ids(JSON.stringify([{ kind: 'fold', file: 'src/app/a.ts' }, PACKAGE]))).toContain('src/ports');
  });

  it('One level below the root is src, and a saved cut is the planned graph', async () => {
    await world().plan([CUT]);
    const sent = await world().propose('the ui knows about the scanner', '');
    expect(sent.status).toBe(200);
    const prompt = await world().prompt(1);
    expect(prompt).toContain('## Current view\n(root)\n');
    expect(prompt).toContain('### (root)\nnode src package src files 4 ca 0 ce 0 i – a 0.00 d – cycle false');
    expect(prompt).toContain('### src\nnode src/app package app');
    expect(prompt).not.toContain('node src/app/a.ts');
    expect(prompt).not.toContain('edge src/app -> src/domain');
    expect(prompt).toContain('src/app must not import src/domain (1 import)');
    expect(prompt).toContain(JSON.stringify([CUT]));
    const plan = loose.parse(json(await world().read('/api/plans/gate')));
    expect(plan.edits).toEqual([CUT]);
    expect(plan.redo).toEqual([]);
  });

  it('A package that exists only in the plan is a view', async () => {
    await world().plan([PACKAGE, MOVE]);
    const sent = await world().propose('the ui knows about the scanner', 'src/ports');
    expect(sent.status).toBe(200);
    const prompt = await world().prompt(1);
    expect(prompt).toContain('## Current view\nsrc/ports\n');
    expect(prompt).toContain(`${PORTS_GRAPH}\n\n## The plan's edits so far`);
  });

  it('an empty created package is still a heading', async () => {
    await world().plan([PACKAGE]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    expect(await world().prompt(1)).toContain('### src/ports\ncycles none');
  });

  it('Health from the reports and every saved edit are in the prompt', async () => {
    const root = world().root;
    const rule = join(root, 'src', 'domain', 'rule.ts');
    const coverage = join(root, '.marestail', 'ts-coverage', 'coverage-final.json');
    const mutation = join(root, 'reports', 'mutation', 'mutation.json');
    try {
      await world().plan([PACKAGE, MOVE]);
      await writeFile(rule, 'export function rule(n: number): number {\n  if (n > 0) return 1;\n  return 0;\n}\n');
      await mkdir(dirname(coverage), { recursive: true });
      await mkdir(dirname(mutation), { recursive: true });
      await writeFile(coverage, JSON.stringify({ 'src/app/a.ts': { statementMap: { '0': { start: { line: 4 } } }, s: { '0': 1 } }, 'src/domain/rule.ts': { statementMap: { '0': { start: { line: 2 } }, '1': { start: { line: 3 } } }, s: { '0': 1, '1': 0 } } }));
      await writeFile(mutation, JSON.stringify({ files: { 'src/app/a.ts': { mutants: [{ status: 'Survived' }, { status: 'Killed' }, { status: 'NoCoverage' }] }, 'src/domain/rule.ts': { mutants: [{ status: 'Survived' }] } } }));
      const later = new Date(Date.now() + 10000);
      await utimes(coverage, later, later);
      await utimes(mutation, later, later);
      expect((await world().call('POST', '/api/rescan')).status).toBe(200);
      const sent = await world().propose('the ui knows about the scanner');
      expect(sent.status).toBe(200);
      const prompt = await world().prompt(1);
      expect(prompt).toContain(`${HEALTH_GRAPH}\n\n## The plan's edits so far`);
      expect(prompt).toContain(`## The plan's edits so far\nCreate package src/ports\nMove src/app/b.ts to src/ports\n${JSON.stringify([PACKAGE, MOVE])}\n\n## Edit JSON`);
      expect(prompt).not.toContain('crapMax');
      expect(prompt).not.toContain('coverage on');
      expect(prompt).not.toContain('mutation on');
    } finally {
      await rm(rule, { force: true });
      await rm(dirname(coverage), { recursive: true, force: true });
      await rm(join(root, 'reports'), { recursive: true, force: true });
      await world().call('POST', '/api/rescan');
    }
  });

  it('Review uses the same check and writes nothing', async () => {
    await world().plan([]);
    const file = join(world().root, '.bindweed', 'plans', 'gate.json');
    const before = await readFile(file);
    const four = await world().call('POST', '/api/plans/gate/review', { edits: FOUR });
    expect(json(four)).toEqual({ stale: [null, null, null, 'no such file src/no-such.ts'] });
    expect(json(await world().call('POST', '/api/plans/gate/review', { edits: [MOVE] }))).toEqual({ stale: ['no such directory src/ports'] });
    expect(json(await world().call('POST', '/api/plans/gate/review', { edits: [{ kind: 'fold', file: 'src/app/a.ts' }] }))).toEqual({ stale: ['not an edit'] });
    expect(await readFile(file)).toEqual(before);
    expect(await readdir(join(world().root, '.bindweed', 'plans'))).toEqual(['gate.json']);
  });

  it("The prompt quotes the plan's edits and every earlier turn", async () => {
    await world().plan([CUT]);
    const turns = [
      { at: '2026-10-21T09:00:00.000Z', text: 'the ui knows about the scanner', summary: SUMMARY, edits: FOUR, decisions: { '0': 'accepted', '1': 'rejected', '2': 'rejected', '3': 'rejected' } },
      { at: '2026-10-21T09:05:00.000Z', text: 'split it\nby job', summary: 'Split app.', edits: [KEEP, { kind: 'fold', file: 'src/app/a.ts' }], decisions: { '0': 'rejected' } },
    ];
    expect((await world().call('PUT', '/api/plans/gate/chat', turns)).status).toBe(200);
    const sent = await world().propose('keep scan where it is');
    expect(sent.status).toBe(200);
    const chat = z.array(loose).parse(loose.parse(json(sent)).chat);
    expect(chat).toHaveLength(3);
    expect(chat.slice(0, 2)).toEqual(turns);
    const prompt = await world().prompt(1);
    expect(prompt).toContain(`## The plan's edits so far\nsrc/app must not import src/domain (1 import)\n${JSON.stringify([CUT])}\n\n## Edit JSON`);
    expect(prompt).toContain(`## Conversation so far
They said: the ui knows about the scanner
Summary: ${SUMMARY}
0 accepted: src/app must not import src/domain (1 import)
1 rejected: Create package src/ports
2 rejected: Move src/app/b.ts to src/ports
3 rejected: Move src/no-such.ts to src/ports
They said: split it
  by job
Summary: Split app.
0 rejected: src/domain should use src/app
1 open: {"kind":"fold","file":"src/app/a.ts"}

## What to reply`);
    expect(prompt).toContain('## What they dislike\nkeep scan where it is\n');
  });

  it('Deleting a plan deletes its chat, so a new plan of the same name starts clean', async () => {
    await world().plan([]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    const removed = await world().call('DELETE', '/api/plans/gate');
    expect(json(removed)).toEqual({ ok: true });
    const names = await readdir(join(world().root, '.bindweed', 'plans')).catch(() => []);
    expect(names).not.toContain('gate.json');
    expect(names).not.toContain('gate.chat.json');
    const created = loose.parse(json(await world().call('POST', '/api/plans', { name: 'Gate' })));
    expect(created.slug).toBe('gate');
    expect(json(await world().read('/api/plans/gate/chat'))).toEqual([]);
  });

  it('A chat file that is not a chat document reads as empty and is replaced by the next turn', async () => {
    await world().plan([]);
    const file = join(world().root, '.bindweed', 'plans', 'gate.chat.json');
    await writeFile(file, '{not json');
    const read = await world().read('/api/plans/gate/chat');
    expect([read.status, json(read)]).toEqual([200, []]);
    expect(await readFile(file, 'utf8')).toBe('{not json');
    expect((await world().propose('keep scan where it is')).status).toBe(200);
    expect(await world().prompt(1)).toContain('## Conversation so far\nnone');
    const saved = z.array(loose).parse(JSON.parse(await readFile(file, 'utf8')));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ text: 'keep scan where it is', edits: [KEEP] });
  });

  it('A bad reply is retried once and Cancel kills the run', async () => {
    await world().plan([]);
    const bad = loose.parse(json(await world().propose('BAD-ONCE')));
    expect(bad.error).toBe("the LLM's reply was not usable: it needs a summary and an edits array");
    expect(String(bad.raw)).toContain('"questions"');
    expect((await readdir(world().log)).filter(name => name.endsWith('.prompt'))).toEqual(['1.prompt', '2.prompt']);
    const [first, second] = [await world().prompt(1), await world().prompt(2)];
    expect(second).toBe(`${first}\n\nYour last reply was not usable: it is not valid JSON`);
    expect(await exists(join(world().root, '.bindweed', 'plans', 'gate.chat.json'))).toBe(false);
    expect(loose.parse(json(await world().read('/api/plans/gate')))).not.toHaveProperty('interview');
    await world().backend('echo nope');
    expect(json(await world().propose('hello'))).toEqual({ error: "the LLM's reply was not usable: it is not valid JSON", raw: 'nope\n', ran: 'command: echo nope' });
    await world().backend(`node -e 'console.log(JSON.stringify({summary:"one"+String.fromCharCode(10)+"two",edits:[]}))'`);
    expect(loose.parse(json(await world().propose('hello'))).error).toBe("the LLM's reply was not usable: the summary must be one paragraph");
    expect(await exists(join(world().root, '.bindweed', 'plans', 'gate.chat.json'))).toBe(false);
    await world().backend('echo half; exit 3');
    expect(json(await world().propose('hello'))).toEqual({ error: 'the LLM command exited with code 3', raw: 'half\n', ran: 'command: echo half; exit 3' });
    await world().backend(world().fake);
    const running = world().propose('SLEEP-NOW');
    const pidsFile = join(world().log, 'sleep.pids');
    expect(await until(async () => (await readFile(pidsFile, 'utf8').catch(() => '')).split('\n').length === 3, 8000)).toBe(true);
    const again = await world().propose('the ui knows about the scanner');
    expect([again.status, json(again)]).toEqual([409, { error: 'already running' }]);
    const generate = await world().call('POST', '/api/plans/gate/generate', { step: 'ask' });
    expect([generate.status, json(generate)]).toEqual([409, { error: 'already running' }]);
    expect((await world().call('POST', '/api/plans/gate/cancel')).status).toBe(200);
    const pids = (await readFile(pidsFile, 'utf8')).trim().split('\n').map(Number);
    expect(await until(async () => pids.every(pid => !alive(pid)), 2000)).toBe(true);
    expect(json(await running)).toEqual({ error: 'cancelled', ran: `command: ${world().fake}` });
    expect(await exists(join(world().root, '.bindweed', 'plans', 'gate.chat.json'))).toBe(false);
  }, 20000);

  it('Propose, chat and review are guarded', async () => {
    await world().plan([]);
    const bearer = { Authorization: `Bearer ${world().token}` };
    const rows: [string, string, boolean, Record<string, string>, unknown, number, unknown][] = [
      ['POST', '/api/plans/gate/propose', false, {}, { text: 'hi', at: 'src' }, 401, { error: 'missing or wrong token' }],
      ['GET', '/api/plans/gate/chat', false, {}, undefined, 401, { error: 'missing or wrong token' }],
      ['PUT', '/api/plans/gate/chat', false, {}, [], 401, { error: 'missing or wrong token' }],
      ['POST', '/api/plans/gate/review', true, { Host: 'evil.example:5000' }, { edits: [] }, 403, { error: 'bad host' }],
      ['POST', '/api/plans/nope/propose', true, {}, { text: 'hi', at: 'src' }, 404, { error: 'no such plan' }],
      ['POST', '/api/plans/gate/propose', true, {}, { text: '  ', at: 'src' }, 400, { error: 'bad propose' }],
      ['POST', '/api/plans/gate/propose', true, {}, { text: 'hi', at: 'notes' }, 400, { error: 'bad propose' }],
      ['POST', '/api/plans/gate/propose', true, {}, { text: 'hi' }, 400, { error: 'bad propose' }],
      ['GET', '/api/plans/gate/propose', true, {}, undefined, 404, { error: 'not found' }],
      ['GET', '/api/plans/gate/chat', true, {}, undefined, 200, []],
      ['POST', '/api/plans/gate/review', true, {}, { edits: [] }, 200, { stale: [] }],
      ['PUT', '/api/plans/gate/chat', true, {}, [{ text: 'x' }], 400, { error: 'bad chat' }],
      ['GET', '/api/plans/nope/chat', true, {}, undefined, 404, { error: 'no such plan' }],
      ['PUT', '/api/plans/nope/chat', true, {}, [], 404, { error: 'no such plan' }],
      ['POST', '/api/plans/nope/review', true, {}, { edits: [] }, 404, { error: 'no such plan' }],
      ['POST', '/api/plans/gate/review', true, {}, { edits: {} }, 400, { error: 'bad review' }],
      ['POST', '/api/plans/gate/review', true, {}, { edits: [], x: 1 }, 400, { error: 'bad review' }],
    ];
    for (const [method, path, authed, extra, body, status, expected] of rows) {
      const headers = authed ? { ...bearer, ...extra } : extra;
      const sent = method === 'GET' ? await world().read(path, headers) : await world().call(method, path, body, headers);
      expect([method, path, sent.status, json(sent)], `${method} ${path}`).toEqual([method, path, status, expected]);
    }
    await writeFile(join(world().root, '.bindweed', 'plans', 'gate.chat.json'), '[{"at":1}]');
    expect(json(await world().read('/api/plans/gate/chat'))).toEqual([]);
    expect(await exists(join(world().root, '.bindweed', 'plans', 'nope.chat.json'))).toBe(false);
    expect(await readdir(world().log)).toEqual([]);
  });

  it('A 008 plan loads unchanged and the old routes still answer', async () => {
    const rule = { name: 'bindweed:no-src-app-to-src-domain', severity: 'error', comment: 'src/app must not import src/domain', from: { path: '^src/app/' }, to: { path: '^src/domain/' } };
    const doc = {
      version: 1,
      name: 'Old',
      slug: 'old',
      createdAt: '2026-10-21T09:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      edits: [CUT],
      redo: [],
      contract: { rules: [rule] },
      interview: [],
      tasks: [],
      brief: 'b',
    };
    await mkdir(join(world().root, '.bindweed', 'plans'), { recursive: true });
    await writeFile(join(world().root, '.bindweed', 'plans', 'old.json'), JSON.stringify(doc));
    expect(json(await world().read('/api/plans/old'))).toEqual(doc);
    const tree = loose.parse(json(await world().read('/api/tree')));
    const names = z.array(loose).parse(tree.entries).map(entry => entry.name);
    expect(names).toEqual(expect.arrayContaining(['src', 'tsconfig.json']));
    expect(loose.parse(json(await world().read('/api/file?path=src/domain/model.ts'))).text).toBe('export class Model { id = 0; }\n');
    const plain = loose.parse(json(await world().read('/api/graph?at=src')));
    expect(z.array(loose).parse(plain.nodes).map(node => node.id)).toEqual(['src/app', 'src/infra', 'src/domain']);
    const planned = loose.parse(json(await world().read('/api/graph?at=src&plan=old')));
    expect(planned.stale).toEqual([null]);
    expect(z.array(loose).parse(planned.edges).some(edge => edge.from === 'src/app' && edge.to === 'src/domain')).toBe(false);
    expect(loose.parse(json(await world().read('/api/detail?id=src/app&at=src'))).files).toBe(2);
    expect(json(await world().read('/api/pairs?from=src/app&to=src/domain&at=src'))).toEqual({ pairs: [['src/app/a.ts', 'src/domain/model.ts']] });
    expect(z.array(loose).parse(loose.parse(json(await world().read('/api/plans/old/contract'))).rules)).toContainEqual(rule);
    expect(json(await world().read('/api/layout'))).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect(json(await world().read('/api/config'))).toEqual({ llm: { backend: 'command', command: world().fake } });
    expect(json(await world().read('/api/repo'))).toEqual({ root: world().root });
    expect(loose.parse(json(await world().call('POST', '/api/rescan'))).files).toBe(4);
    const page = await world().read('/');
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain('<title>bindweed</title>');
    expect(json(await world().call('POST', '/api/plans/old/files'))).toEqual({ dir: join(world().root, '.bindweed', 'plans', 'old') });
    const asked = loose.parse(json(await world().call('POST', '/api/plans/old/generate', { step: 'ask' })));
    expect(loose.parse(asked.plan).interview).toEqual([{ round: 1, questions: QUESTIONS.questions, answers: [] }]);
    expect(await exists(join(world().root, '.bindweed', 'plans', 'old.chat.json'))).toBe(false);
    const listed = z.array(loose).parse(loose.parse(json(await world().read('/api/plans'))).plans).map(item => item.name);
    expect(listed).toContain('Old');
    expect(listed).not.toContain('old.chat');
  });
});


