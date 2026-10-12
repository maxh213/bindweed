import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PlanEdit } from './domain/plan.ts';
import type { Limits } from './llm.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 23125 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);
const FIXTURES = join(process.cwd(), 'qa', 'fixtures');
const SYSTEM_PATH = '/usr/bin:/bin';

const PACKAGE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };

function noteOf(text: string): PlanEdit {
  return { kind: 'note', target: { node: 'src/domain' }, text };
}

const QUESTIONS = {
  questions: [
    { id: 'q1', text: 'Must a.ts keep exporting a?', why: 'Other code may import it.' },
    { id: 'q2', text: 'Should b.ts move before the cut?', why: 'The order decides which slice breaks the build.' },
  ],
};

const SLICES = {
  slices: [
    { title: 'Add the core package', slug: 'add-core', body: 'Create src/core.\n' },
    { title: 'Move b into infra', slug: 'move-b', body: 'Move src/app/b.ts to src/infra.\n' },
    { title: 'Cut app from domain', slug: 'cut-app-domain', body: '# Cut\nNo behaviour changes.\n' },
  ],
  brief: '# Reshape layered\n\nMove b, then cut app from domain.\n',
};

const FENCE = '```';
const QUESTIONS_REPLY = `Some questions first.\n${FENCE}json\n${JSON.stringify(QUESTIONS)}\n${FENCE}\n`;
const SLICES_REPLY = `${FENCE}json\n{"example":1}\n${FENCE}\nHere are the slices.\n${FENCE}json\n${JSON.stringify(SLICES)}\n${FENCE}\n`;
const BAD_REPLY = `${FENCE}json\n{"slices": [\n${FENCE}\n`;

const TASKS = [
  { file: '005-add-core.md', title: 'Add the core package', body: '# 005 — Add the core package\n\nCreate src/core.\n' },
  { file: '006-move-b.md', title: 'Move b into infra', body: '# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n' },
  { file: '007-cut-app-domain.md', title: 'Cut app from domain', body: '# 007 — Cut app from domain\n\nNo behaviour changes.\n' },
];

const INSTRUCTION_LINES = [
  'Order the slices so each leaves the repository working: leaves and new packages first, then moves, then cuts, then the contract.',
  'A slice that changes no behaviour says so in its first line and freezes everything else.',
  'Each slice names the files it touches, the imports that must be gone when it ends, the contract rules it makes pass, and what must not change.',
  'Write one thin slice per logical step.',
];
const EXACTLY_LINE = 'Reply with exactly one JSON object, in a fenced json block.';
const ASK_LINE = 'To ask, reply {"questions":[{"id":"<id>","text":"<question>","why":"<why you ask>"}]} with at most 5 questions.';
const WRITE_LINE = 'To write, reply {"slices":[{"title":"<title>","slug":"<slug>","body":"<markdown>"}],"brief":"<markdown>"}.';

const FAKE_LLM = `import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const log = process.argv[2];
const input = readFileSync(0, 'utf8');
const n = readdirSync(log).filter(name => name.endsWith('.prompt')).length + 1;
writeFileSync(log + '/' + n + '.prompt', input);
const env = process.env;
writeFileSync(log + '/' + n + '.env.json', JSON.stringify({ cwd: process.cwd(), root: env.BINDWEED_ROOT ?? null, claudecode: env.CLAUDECODE ?? null, entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null }));
const questions = ${JSON.stringify(QUESTIONS_REPLY)};
const slices = ${JSON.stringify(SLICES_REPLY)};
if (input.includes('SLEEP-NOW')) {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' });
  writeFileSync(log + '/sleep.pids', process.pid + '\\n' + child.pid + '\\n');
  setInterval(() => undefined, 1000);
} else if (input.includes('BAD-ONCE') && !existsSync(log + '/bad.done')) {
  writeFileSync(log + '/bad.done', '');
  process.stdout.write(${JSON.stringify(BAD_REPLY)});
} else if (input.includes('Reply with slices now.')) {
  process.stdout.write(slices);
} else if (input.includes('ASK-AGAIN')) {
  process.stdout.write(questions);
} else if (/^A: /m.test(input)) {
  process.stdout.write(slices);
} else {
  process.stdout.write(questions);
}
`;

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; body: Buffer };

const loose = z.record(z.string(), z.unknown());
const planSchema = z.object({ edits: z.array(z.unknown()), interview: z.array(loose).optional(), tasks: z.array(loose).optional(), brief: z.string().optional() }).loose();
const answerSchema = z.object({ plan: planSchema, ran: z.string() }).loose();

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commitAll(root: string): void {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
}

async function fixtureRepo(withTasks: boolean): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-generate-')), 'layered');
  await cp(join(FIXTURES, 'layered'), root, { recursive: true });
  if (withTasks) {
    await mkdir(join(root, 'tasks'));
    await writeFile(join(root, 'tasks', '004-x.md'), '# 004 — x\n');
    await writeFile(join(root, 'tasks', 'README.md'), '# Our guide\n\nOne slice per step.\n');
  }
  git(root, 'init', '-q', '--template=');
  commitAll(root);
  await prepareBindweed(root);
  return root;
}

async function boundOn(repoRoot: string, port: number, env?: NodeJS.ProcessEnv, limits?: Limits): Promise<Bound> {
  const result = await bindApp({ repoRoot, uiDir: '/nowhere', ...(env === undefined ? {} : { env }), ...(limits === undefined ? {} : { limits }) }, { mode: 'fixed', port });
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
  return readFile(path).then(
    () => true,
    () => false,
  );
}

type World = {
  root: string;
  log: string;
  fake: string;
  app: Bound;
  read(path: string): Promise<Hit>;
  call(method: string, path: string, body?: unknown): Promise<Hit>;
  plan(edits: PlanEdit[], extra?: Record<string, unknown>): Promise<void>;
  backend(command: string): Promise<void>;
  generate(body: unknown): Promise<Record<string, unknown>>;
  prompt(n: number): Promise<string>;
  stored(): Promise<z.infer<typeof planSchema>>;
};

function worldFor(withTasks: boolean, port: number): () => World {
  const held: { root: string; log: string; fake: string; app?: Bound; base: Record<string, unknown> } = { root: '', log: '', fake: '', base: {} };
  beforeAll(async () => {
    held.root = await fixtureRepo(withTasks);
    const scratch = await mkdtemp(join(tmpdir(), 'bw-fake-'));
    held.fake = join(scratch, 'fake-llm.mjs');
    held.log = join(scratch, 'log');
    await writeFile(held.fake, FAKE_LLM);
    held.app = await boundOn(held.root, port, { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
  });
  beforeEach(async () => {
    await rm(held.log, { recursive: true, force: true });
    await mkdir(held.log);
    await rm(join(held.root, '.bindweed', 'plans'), { recursive: true, force: true });
    await writeFile(join(held.root, '.bindweed', 'config.json'), JSON.stringify({ llm: { backend: 'command', command: `node ${held.fake} ${held.log}` } }));
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
      app,
      read: path => hit(app.port, 'GET', path, bearer),
      call: (method, path, body) => hit(app.port, method, path, { ...bearer, 'Content-Type': 'application/json' }, body === undefined ? undefined : JSON.stringify(body)),
      async plan(edits, extra = {}) {
        if (!(await exists(join(held.root, '.bindweed', 'plans', 'gate.json')))) {
          held.base = loose.parse(json(await view.call('POST', '/api/plans', { name: 'Gate' })));
        }
        const put = await view.call('PUT', '/api/plans/gate', { ...held.base, edits, redo: [], ...extra });
        expect(put.status).toBe(200);
      },
      async backend(command) {
        expect((await view.call('PUT', '/api/config', { llm: { backend: 'command', command } })).status).toBe(200);
      },
      async generate(body) {
        const res = await view.call('POST', '/api/plans/gate/generate', body);
        expect(res.status).toBe(200);
        return loose.parse(json(res));
      },
      prompt: n => readFile(join(held.log, `${n}.prompt`), 'utf8'),
      async stored() {
        return planSchema.parse(json(await view.read('/api/plans/gate')));
      },
    };
    return view;
  };
}

describe('generate over the layered fixture with a tasks folder', () => {
  const world = worldFor(true, PORT_BASE);

  it('The config round-trips and a bad one is refused', async () => {
    const file = join(world().root, '.bindweed', 'config.json');
    const put = await world().call('PUT', '/api/config', { llm: { backend: 'claude' } });
    expect([put.status, json(put)]).toEqual([200, { llm: { backend: 'claude' } }]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ llm: { backend: 'claude' } });
    for (const body of [{ llm: { backend: 'command', command: '  ' } }, { llm: { backend: 'command' } }, { llm: { backend: 'grok' } }, { llm: { backend: 'claude', command: 3 } }, { llm: { backend: 'claude', extra: 1 } }, { llm: [] }, { llm: { backend: 'claude' }, more: 1 }, 'x']) {
      const bad = await world().call('PUT', '/api/config', body);
      expect([bad.status, json(bad)]).toEqual([400, { error: 'bad config' }]);
    }
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ llm: { backend: 'claude' } });
    const kept = await world().call('PUT', '/api/config', { llm: { backend: 'route', command: '' } });
    expect(json(kept)).toEqual({ llm: { backend: 'route', command: '' } });
    expect(json(await world().read('/api/config'))).toEqual({ llm: { backend: 'route', command: '' } });
    await writeFile(file, 'not json');
    expect(json(await world().read('/api/config'))).toEqual({ llm: { backend: 'route' } });
    await writeFile(file, '{"llm":{"backend":"nope"}}');
    expect(json(await world().read('/api/config'))).toEqual({ llm: { backend: 'route' } });
    await rm(file);
    expect(json(await world().read('/api/config'))).toEqual({ llm: { backend: 'route' } });
  });

  it('Two questions, one left blank, then three slices after 004', async () => {
    await world().plan([PACKAGE_CUT]);
    const asked = await world().generate({ step: 'ask' });
    expect(asked.ran).toBe(`command: ${world().fake}`);
    expect(asked.note).toBeUndefined();
    expect(answerSchema.parse(asked).plan.interview).toEqual([{ round: 1, questions: QUESTIONS.questions, answers: [] }]);
    const first = await world().prompt(1);
    for (const words of ['src/app must not import src/domain (1 import)', JSON.stringify([PACKAGE_CUT]), '# Our guide', '004-x.md', ...INSTRUCTION_LINES, EXACTLY_LINE, ASK_LINE, WRITE_LINE]) {
      expect(first).toContain(words);
    }
    const lines = first.split('\n');
    for (const line of [
      'src/app/a.ts imports src/app/b.ts, src/domain/model.ts, src/infra/db.ts',
      'src/app/a.ts is imported by src/app/b.ts',
      'src/domain/model.ts imports nothing',
      EXACTLY_LINE,
      ASK_LINE,
      WRITE_LINE,
    ]) {
      expect(lines).toContain(line);
    }
    expect(first).not.toContain('Reply with slices now.');
    expect(JSON.parse(await readFile(join(world().log, '1.env.json'), 'utf8'))).toEqual({ cwd: world().root, root: world().root, claudecode: null, entrypoint: null });
    const written = answerSchema.parse(await world().generate({ step: 'answer', answers: ['Yes, keep it.', '  '] }));
    const second = await world().prompt(2);
    expect(second).toContain('Q: Must a.ts keep exporting a?\nA: Yes, keep it.');
    expect(second).toContain('Q: Should b.ts move before the cut?\nA: your call');
    expect(written.plan.interview).toEqual([{ round: 1, questions: QUESTIONS.questions, answers: ['Yes, keep it.', 'your call'] }]);
    expect(written.plan.tasks).toEqual(TASKS);
    expect(written.plan.brief).toBe(SLICES.brief);
    const stored = await world().stored();
    expect([stored.interview, stored.tasks, stored.brief]).toEqual([written.plan.interview, TASKS, SLICES.brief]);
    expect(git(world().root, 'status', '--porcelain')).toBe('');
  });

  it('The prompt carries the saved contract, the warnings and every touched file', async () => {
    const rule = { name: 'bindweed:no-src-app-to-src-domain', severity: 'error', comment: 'src/app must not import src/domain', from: { path: '^src/app/' }, to: { path: '^src/domain/' } };
    await world().plan([{ kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' }, { kind: 'rename-package', from: 'src/app', to: 'src/core' }], { contract: { rules: [rule] } });
    await world().generate({ step: 'ask' });
    const lines = (await world().prompt(1)).split('\n');
    expect(lines).toContain('bindweed:no-src-app-to-src-domain: src/app must not import src/domain');
    expect(lines).toContain('2 files still import src/domain/model.ts, which this plan deletes');
    expect(lines).toContain('src/app/b.ts imports src/app/a.ts, src/infra/db.ts');
    expect(lines).toContain('src/app/b.ts is imported by src/app/a.ts');
    expect(lines).toContain('src/domain/model.ts is imported by src/app/a.ts, src/infra/db.ts');
    expect(lines.filter(line => line.startsWith('src/infra/db.ts imports'))).toEqual([]);
  });

  it('Numbers never pass 999', async () => {
    const extra = join(world().root, 'tasks', '998-y.md');
    await writeFile(extra, '# 998 — y\n');
    try {
      await world().plan([PACKAGE_CUT]);
      const refused = await world().generate({ step: 'write', answers: [] });
      expect(refused).toEqual({ error: 'task numbers would pass 999', raw: SLICES_REPLY, ran: `command: ${world().fake}` });
      expect((await readdir(world().log)).filter(name => name.endsWith('.prompt'))).toEqual(['1.prompt']);
      expect(await world().stored()).not.toHaveProperty('tasks');
    } finally {
      await rm(extra);
    }
  });

  it('After three rounds the prompt demands slices', async () => {
    await world().plan([PACKAGE_CUT, noteOf('ASK-AGAIN')]);
    await world().generate({ step: 'ask' });
    await world().generate({ step: 'answer', answers: ['a', 'b'] });
    const third = answerSchema.parse(await world().generate({ step: 'answer', answers: ['a', 'b'] }));
    expect(third.plan.interview?.map(round => [round.round, round.answers])).toEqual([
      [1, ['a', 'b']],
      [2, ['a', 'b']],
      [3, []],
    ]);
    const last = answerSchema.parse(await world().generate({ step: 'answer', answers: ['c', ''] }));
    expect(await world().prompt(4)).toContain('Reply with slices now.');
    expect(await world().prompt(3)).not.toContain('Reply with slices now.');
    expect(last.plan.tasks).toHaveLength(3);
    expect(last.plan.interview?.map(round => round.answers)).toEqual([
      ['a', 'b'],
      ['a', 'b'],
      ['c', 'your call'],
    ]);
  });

  it('Just write it after a round keeps the interview and fills the pending answers', async () => {
    await world().plan([PACKAGE_CUT, noteOf('ASK-AGAIN')]);
    await world().generate({ step: 'ask' });
    await world().generate({ step: 'answer', answers: ['a', 'b'] });
    const written = answerSchema.parse(await world().generate({ step: 'write', answers: ['c', ''] }));
    const third = await world().prompt(3);
    for (const words of ['A: a', 'A: b', 'A: c', 'A: your call', 'Reply with slices now.']) expect(third).toContain(words);
    expect(third).not.toContain('To ask, reply');
    expect(written.plan.interview?.map(round => [round.round, round.answers])).toEqual([
      [1, ['a', 'b']],
      [2, ['c', 'your call']],
    ]);
    expect(written.plan.tasks).toHaveLength(3);
  });

  it('A bad reply is retried once, and two bad replies show the raw output', async () => {
    await world().plan([PACKAGE_CUT, noteOf('BAD-ONCE')]);
    const fixed = answerSchema.parse(await world().generate({ step: 'write', answers: [] }));
    expect(fixed.plan.tasks).toHaveLength(3);
    const [first, second] = [await world().prompt(1), await world().prompt(2)];
    expect(second.startsWith(`${first}\n\nYour last reply was not usable: `)).toBe(true);
    await world().backend('echo nope');
    const nope = await world().generate({ step: 'write', answers: [] });
    expect(String(nope.error).startsWith("the LLM's reply was not usable: ")).toBe(true);
    expect([nope.raw, nope.ran]).toEqual(['nope\n', 'command: echo nope']);
    expect((await world().stored()).tasks).toEqual(fixed.plan.tasks);
    await world().backend('echo half; exit 3');
    expect(await world().generate({ step: 'write', answers: [] })).toEqual({ error: 'the LLM command exited with code 3', raw: 'half\n', ran: 'command: echo half; exit 3' });
    await world().backend('echo half; kill -TERM $$');
    expect(await world().generate({ step: 'write', answers: [] })).toEqual({ error: 'the LLM command was stopped by SIGTERM', raw: 'half\n', ran: 'command: echo half; kill -TERM $$' });
  });

  it('refuses replies of the wrong shape with a reason', async () => {
    await world().plan([PACKAGE_CUT]);
    const cases: [string, string][] = [
      ['echo \'{"questions":[]}\'', 'it needs 1 to 5 questions'],
      ['echo \'{"slices":[{"title":"t","slug":"Bad","body":""}],"brief":""}\'', 'it needs at least one slice'],
      ['echo \'{"other":1}\'', 'it is neither'],
    ];
    for (const [command, reason] of cases) {
      await world().backend(command);
      expect(String((await world().generate({ step: 'ask' })).error)).toContain(reason);
    }
    await world().backend(`echo '${JSON.stringify(QUESTIONS)}'`);
    expect(String((await world().generate({ step: 'write', answers: [] })).error)).toContain('it asked questions, but slices were demanded');
    expect(await world().stored()).not.toHaveProperty('interview');
  });

  it('Cancel kills the process group within 2 seconds', async () => {
    await world().plan([PACKAGE_CUT, noteOf('SLEEP-NOW')]);
    const running = world().call('POST', '/api/plans/gate/generate', { step: 'ask' });
    const pidsFile = join(world().log, 'sleep.pids');
    expect(await until(async () => (await readFile(pidsFile, 'utf8').catch(() => '')).split('\n').length === 3, 8000)).toBe(true);
    const again = await world().call('POST', '/api/plans/gate/generate', { step: 'ask' });
    expect([again.status, json(again)]).toEqual([409, { error: 'already running' }]);
    const cancel = await world().call('POST', '/api/plans/gate/cancel');
    expect(json(cancel)).toEqual({ cancelled: true });
    const pids = (await readFile(pidsFile, 'utf8')).trim().split('\n').map(Number);
    expect(await until(async () => pids.every(pid => !alive(pid)), 2000)).toBe(true);
    const first = await running;
    expect([first.status, json(first)]).toEqual([200, { error: 'cancelled', ran: `command: ${world().fake}` }]);
    expect(await world().stored()).not.toHaveProperty('interview');
    expect(json(await world().call('POST', '/api/plans/gate/cancel'))).toEqual({ cancelled: false });
  });

  it('does not bring back a plan deleted while its run was alive', async () => {
    await world().plan([PACKAGE_CUT]);
    const ready = join(world().log, 'ready');
    const gone = join(world().log, 'gone');
    await world().backend(`touch ${ready}; while [ ! -e ${gone} ]; do sleep 0.05; done; echo '${JSON.stringify(QUESTIONS)}'`);
    const running = world().call('POST', '/api/plans/gate/generate', { step: 'ask' });
    expect(await until(() => exists(ready), 5000)).toBe(true);
    expect((await world().call('DELETE', '/api/plans/gate')).status).toBe(200);
    await writeFile(gone, '');
    expect(json(await running)).toEqual({ error: 'no such plan', ran: expect.stringMatching(/^command: /) });
    expect((await world().read('/api/plans/gate')).status).toBe(404);
  });

  it("Saved files match the plan, and the target's tasks/ is untouched", async () => {
    await world().plan([PACKAGE_CUT], { tasks: TASKS, brief: SLICES.brief });
    const dir = join(world().root, '.bindweed', 'plans', 'gate');
    await mkdir(join(dir, 'tasks'), { recursive: true });
    await writeFile(join(dir, 'tasks', 'old.md'), 'old');
    const saved = await world().call('POST', '/api/plans/gate/files');
    expect(json(saved)).toEqual({ dir });
    expect((await readdir(join(dir, 'tasks'))).sort()).toEqual(TASKS.map(task => task.file));
    for (const task of TASKS) expect(await readFile(join(dir, 'tasks', task.file), 'utf8')).toBe(task.body);
    expect(await readFile(join(dir, 'brief.md'), 'utf8')).toBe(SLICES.brief);
    expect((await readdir(join(world().root, 'tasks'))).sort()).toEqual(['004-x.md', 'README.md']);
    expect(await readFile(join(world().root, 'tasks', '004-x.md'), 'utf8')).toBe('# 004 — x\n');
    expect(json(await world().read('/api/plans'))).toEqual({ plans: [expect.objectContaining({ name: 'Gate', slug: 'gate', editCount: 1 })] });
    await world().plan([PACKAGE_CUT]);
    await world().call('POST', '/api/plans/gate/files');
    expect(await readdir(join(dir, 'tasks'))).toEqual([]);
    expect(await exists(join(dir, 'brief.md'))).toBe(false);
  });

  it('A 007 plan loads unchanged and a bad task file name is refused', async () => {
    const rule = { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };
    const old = { version: 1, name: 'Old', slug: 'old', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [PACKAGE_CUT], redo: [], contract: { rules: [rule] } };
    const file = join(world().root, '.bindweed', 'plans', 'old.json');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(old));
    expect(json(await world().read('/api/plans/old'))).toEqual(old);
    for (const extra of [{ tasks: [{ file: '5-x.md', title: 'x', body: 'x' }] }, { brief: 3 }, { interview: [{ round: 0, questions: [], answers: [] }] }]) {
      const bad = await world().call('PUT', '/api/plans/old', { ...old, ...extra });
      expect([bad.status, json(bad)]).toEqual([400, { error: 'bad plan' }]);
    }
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify(old));
    const ok = await world().call('PUT', '/api/plans/old', { ...old, brief: 'b', tasks: [] });
    expect(ok.status).toBe(200);
    expect(json(await world().read('/api/plans/old'))).toEqual({ ...old, brief: 'b', tasks: [] });
  });

  it('The new routes are guarded and the old ones still answer', async () => {
    await world().plan([]);
    const port = world().app.port;
    const host = { Host: `127.0.0.1:${port}` };
    for (const [method, path] of [
      ['GET', '/api/config'],
      ['POST', '/api/plans/gate/generate'],
      ['POST', '/api/plans/gate/cancel'],
      ['PUT', '/api/config'],
    ]) {
      const res = await hit(port, method, path, host, method === 'PUT' ? '{"llm":{"backend":"claude"}}' : undefined);
      expect([res.status, json(res)]).toEqual([401, { error: 'missing or wrong token' }]);
    }
    const evil = await hit(port, 'POST', '/api/plans/gate/files', { Host: `evil.example:${port}`, Authorization: `Bearer ${world().app.token}` });
    expect([evil.status, json(evil)]).toEqual([403, { error: 'bad host' }]);
    const nope = await world().call('POST', '/api/plans/nope/generate', { step: 'ask' });
    expect([nope.status, json(nope)]).toEqual([404, { error: 'no such plan' }]);
    for (const body of [{ step: 'answer', answers: [] }, { step: 'go' }, { step: 'ask', answers: [] }, { step: 'write', answers: ['x'] }, { step: 'write', answers: [1] }, { step: 'write' }, [], null]) {
      const bad = await world().call('POST', '/api/plans/gate/generate', body);
      expect([bad.status, json(bad)]).toEqual([400, { error: 'bad generate' }]);
    }
    const wrongVerb = await world().read('/api/plans/gate/generate');
    expect([wrongVerb.status, json(wrongVerb)]).toEqual([404, { error: 'not found' }]);
    const contract = await world().read('/api/plans/gate/contract');
    expect(contract.status).toBe(200);
    expect(z.object({ rules: z.array(z.unknown()) }).parse(json(contract)).rules).toHaveLength(4);
    expect(json(await world().read('/api/pairs?from=src/app&to=src/domain&at=src'))).toEqual({ pairs: [['src/app/a.ts', 'src/domain/model.ts']] });
    expect(json(await world().read('/api/repo'))).toEqual({ root: world().root });
  });

  it('refuses answers that do not fit the pending round', async () => {
    await world().plan([PACKAGE_CUT]);
    await world().generate({ step: 'ask' });
    for (const body of [{ step: 'answer', answers: ['one'] }, { step: 'write', answers: [] }]) {
      const bad = await world().call('POST', '/api/plans/gate/generate', body);
      expect([bad.status, json(bad)]).toEqual([400, { error: 'bad generate' }]);
    }
  });
});

describe('generate with no tasks folder', () => {
  const world = worldFor(false, PORT_BASE + 1);

  it('Just write it at once, with no tasks folder, starts at 001', async () => {
    await world().plan([PACKAGE_CUT]);
    const written = answerSchema.parse(await world().generate({ step: 'write', answers: [] }));
    expect(written.plan.tasks?.map(task => task.file)).toEqual(['001-add-core.md', '002-move-b.md', '003-cut-app-domain.md']);
    const prompt = await world().prompt(1);
    for (const words of ['Reply with slices now.', '**Slice vertically.**', EXACTLY_LINE, WRITE_LINE]) expect(prompt).toContain(words);
    expect(prompt).not.toContain('To ask, reply');
    expect(written.plan.interview).toEqual([]);
  });
});

const CLAUDE_FAKE = (log: string) => `#!/bin/sh
printf '%s\\n' "$*" > ${log}/claude.args
printf '%s' "\${CLAUDE_CONFIG_DIR-unset}" > ${log}/claude.config
cat > ${log}/claude.stdin
printf '%s' '${QUESTIONS_REPLY.replaceAll("'", "'\\''")}'
`;

describe('backends found on PATH', () => {
  const held: { root: string; bin: string; log: string; home: string; app?: Bound } = { root: '', bin: '', log: '', home: '' };
  const port = PORT_BASE + 2;

  beforeAll(async () => {
    held.root = await fixtureRepo(true);
    const scratch = await mkdtemp(join(tmpdir(), 'bw-path-'));
    held.bin = join(scratch, 'bin');
    held.log = join(scratch, 'log');
    held.home = join(scratch, 'home');
    await mkdir(held.bin);
    await mkdir(held.log);
    held.app = await boundOn(held.root, port, { PATH: `${held.bin}:${SYSTEM_PATH}`, HOME: held.home }, { llmMs: 1000, routeMs: 1000 });
  });

  afterAll(async () => {
    if (held.app !== undefined) await closeServer(held.app.server);
    await rm(dirname(held.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(dirname(held.bin), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function app(): Bound {
    if (held.app === undefined) throw new Error('not bound');
    return held.app;
  }

  function call(method: string, path: string, body: unknown): Promise<Hit> {
    return hit(app().port, method, path, { Authorization: `Bearer ${app().token}`, 'Content-Type': 'application/json' }, JSON.stringify(body));
  }

  async function tool(name: string, text: string | null): Promise<void> {
    const file = join(held.bin, name);
    await rm(file, { force: true });
    if (text === null) return;
    await writeFile(file, text);
    await chmod(file, 0o755);
  }

  async function gate(config: unknown): Promise<void> {
    await rm(join(held.root, '.bindweed', 'plans'), { recursive: true, force: true });
    await writeFile(join(held.root, '.bindweed', 'config.json'), JSON.stringify(config));
    const created = loose.parse(json(await call('POST', '/api/plans', { name: 'Gate' })));
    expect((await call('PUT', '/api/plans/gate', { ...created, edits: [PACKAGE_CUT], redo: [] })).status).toBe(200);
  }

  async function ask(): Promise<Record<string, unknown>> {
    const res = await call('POST', '/api/plans/gate/generate', { step: 'ask' });
    expect(res.status).toBe(200);
    return loose.parse(json(res));
  }

  it('A missing claude and an LLM past its time limit give errors, not retries', async () => {
    await tool('claude', null);
    await gate({ llm: { backend: 'claude' } });
    expect(await ask()).toEqual({ error: 'claude is not on PATH', ran: 'claude: claude-opus-5-5, effort high' });
    const runs = join(held.log, 'runs');
    const command = `echo $$ >> ${runs}; echo part; exec sleep 600`;
    await writeFile(join(held.root, '.bindweed', 'config.json'), JSON.stringify({ llm: { backend: 'command', command } }));
    const started = Date.now();
    expect(await ask()).toEqual({ error: 'the LLM ran past its time limit and was stopped', raw: 'part\n', ran: `command: ${command}` });
    expect(Date.now() - started).toBeLessThan(3000);
    const pids = (await readFile(runs, 'utf8')).trim().split('\n').map(Number);
    expect(pids).toHaveLength(1);
    expect(alive(pids[0])).toBe(false);
    expect(loose.parse(json(await call('GET', '/api/plans/gate', undefined)))).not.toHaveProperty('interview');
  });

  const ROWS: { marestail: string | null; ran: string; note?: string; args: string; config: string }[] = [
    { marestail: 'echo "claude-fable-5-1 max claude"', ran: 'route: claude-fable-5-1, effort max, provider claude', args: 'claude-fable-5-1 --effort max', config: 'unset' },
    { marestail: 'echo "claude-opus-5-5 max claude-work"', ran: 'route: claude-opus-5-5, effort max, provider claude-work', args: 'claude-opus-5-5 --effort max', config: 'HOME/.claude-work' },
    {
      marestail: 'echo "grok-5 high grok"',
      ran: 'claude: claude-opus-5-5, effort high',
      note: 'route picked grok; bindweed speaks to claude only, so it used claude-opus-5-5',
      args: 'claude-opus-5-5 --effort high',
      config: 'unset',
    },
    {
      marestail: 'echo "just one"',
      ran: 'claude: claude-opus-5-5, effort high',
      note: 'marestail route printed "just one", which bindweed can\'t read, so it used claude-opus-5-5',
      args: 'claude-opus-5-5 --effort high',
      config: 'unset',
    },
    { marestail: 'exit 2', ran: 'claude: claude-opus-5-5, effort high', note: 'marestail route exited with code 2, so bindweed used claude-opus-5-5', args: 'claude-opus-5-5 --effort high', config: 'unset' },
    { marestail: null, ran: 'claude: claude-opus-5-5, effort high', note: 'marestail is not on PATH, so bindweed used claude-opus-5-5', args: 'claude-opus-5-5 --effort high', config: 'unset' },
    {
      marestail: 'exec sleep 600',
      ran: 'claude: claude-opus-5-5, effort high',
      note: 'marestail route ran past its time limit, so bindweed used claude-opus-5-5',
      args: 'claude-opus-5-5 --effort high',
      config: 'unset',
    },
    { marestail: 'kill -TERM $$', ran: 'claude: claude-opus-5-5, effort high', note: 'marestail route was stopped by SIGTERM, so bindweed used claude-opus-5-5', args: 'claude-opus-5-5 --effort high', config: 'unset' },
  ];

  it.each(ROWS)('route picks the claude model, or falls back and says why: $marestail', async row => {
    await tool('claude', CLAUDE_FAKE(held.log));
    await tool('marestail', row.marestail === null ? null : `#!/bin/sh\n[ "$*" = "route --high" ] || exit 9\n${row.marestail}\n`);
    await gate({ llm: { backend: 'route' } });
    const answer = await ask();
    expect(answer.ran).toBe(row.ran);
    expect(answer.note).toBe(row.note);
    const [model, effort] = row.args.split(' --effort ');
    expect(await readFile(join(held.log, 'claude.args'), 'utf8')).toBe(`-p --model ${model} --effort ${effort} --output-format text --allowedTools Read,Grep,Glob\n`);
    expect(await readFile(join(held.log, 'claude.config'), 'utf8')).toBe(row.config.replace('HOME', held.home));
    expect(await readFile(join(held.log, 'claude.stdin'), 'utf8')).toContain('src/app must not import src/domain (1 import)');
  });

  it('a route fallback whose claude cannot start says both', async () => {
    await tool('claude', null);
    await tool('marestail', '#!/bin/sh\necho "grok-5 high grok"\n');
    await gate({ llm: { backend: 'route' } });
    expect(await ask()).toEqual({
      error: 'claude is not on PATH',
      ran: 'claude: claude-opus-5-5, effort high',
      note: 'route picked grok; bindweed speaks to claude only, so it used claude-opus-5-5',
    });
  });

  it('cancelling while route runs stops it and answers cancelled', async () => {
    await tool('marestail', '#!/bin/sh\nexec sleep 600\n');
    await gate({ llm: { backend: 'route' } });
    const running = call('POST', '/api/plans/gate/generate', { step: 'ask' });
    await pause(300);
    expect(json(await call('POST', '/api/plans/gate/cancel', undefined))).toEqual({ cancelled: true });
    expect(json(await running)).toEqual({ error: 'cancelled', ran: 'claude: claude-opus-5-5, effort high', note: 'marestail route was cancelled, so bindweed used claude-opus-5-5' });
  });
});
