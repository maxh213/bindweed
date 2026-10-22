import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContractRule, PlanEdit } from './domain/plan.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp } from './serve.ts';

type Bound = Exclude<Awaited<ReturnType<typeof bindApp>>, { error: unknown }>;
type Body = Record<string, unknown> & { edits: { index: number; status: string; sentence: string; remain?: string[] }[]; rules: { name: string; comment: string; holds: boolean; breaks?: string[] }[] };

const MOVE: PlanEdit = { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' };
const CUT: PlanEdit = {
  kind: 'cut-edge',
  from: 'src/app',
  to: 'src/infra',
  files: [
    ['src/app/a.ts', 'src/infra/db.ts'],
    ['src/app/b.ts', 'src/infra/db.ts'],
    ['src/app/c.ts', 'src/infra/db.ts'],
  ],
};
const PACKAGE: PlanEdit = { kind: 'create-package', path: 'src/ports' };
const DELETE: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' };
const PATH_RULE: ContractRule = { name: 'bindweed:no-src-app-to-src-infra', severity: 'error', comment: 'src/app must not import src/infra', from: { path: '^src/app/' }, to: { path: '^src/infra/' } };
const CYCLE_RULE: ContractRule = { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };
const C_TEXT = "import { query } from '../infra/db';\nexport const c = query;\n";
const DB_IMPORT = "import { query } from '../infra/db';\n";
const B_CUT_MOVE: PlanEdit[] = [
  { kind: 'cut-edge', from: 'src/app/b.ts', to: 'src/infra/db.ts', files: [['src/app/b.ts', 'src/infra/db.ts']] },
  { kind: 'move-file', file: 'src/app/b.ts', to: 'src/domain' },
];
const FOLD: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'fold', into: 'src/domain/model.ts' };
const NOTE: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'look here' };

let outer: string;
let root: string;
let wt: string;
let head: string;
let livePid: number;
let app: Bound;
let port: number;
let children: number[];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function wtPath(path: string): string {
  return join(wt, path);
}

async function wtRead(path: string): Promise<string> {
  return readFile(wtPath(path), 'utf8');
}

async function wtMove(from: string, to: string): Promise<void> {
  await put(wtPath(to), await wtRead(from));
  await rm(wtPath(from));
}

async function wtReplace(path: string, from: string, to: string): Promise<void> {
  await writeFile(wtPath(path), (await wtRead(path)).replace(from, to));
}

function livePidOf(): number {
  const child = spawn('sleep', ['900'], { stdio: 'ignore' });
  children.push(Number(child.pid));
  return Number(child.pid);
}

function runEntry(worktree: string, startedAt: string, pid = livePid): Record<string, unknown> {
  return { slug: 'gate', tool: 'marestail', worktree, branch: 'bindweed/gate', pid, startedAt, out: join(worktree, 'missing.out'), settings: {} };
}

async function writeRuns(entries: unknown[]): Promise<void> {
  await put(join(root, '.bindweed', 'runs.json'), JSON.stringify(entries));
}

async function plan(edits: PlanEdit[], rules: ContractRule[] | null = [PATH_RULE, CYCLE_RULE], redo: PlanEdit[] = []): Promise<void> {
  const doc = { version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-22T12:00:00.000Z', baseCommit: head, edits, redo, ...(rules === null ? {} : { contract: { rules } }) };
  await put(join(root, '.bindweed', 'plans', 'gate.json'), JSON.stringify(doc));
}

async function call(path: string, method = 'GET', headers: Record<string, string> = { Authorization: `Bearer ${app.token}` }): Promise<{ status: number; body: Body }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
  return { status: response.status, body: (await response.json()) as Body };
}

async function converge(): Promise<Body> {
  const answer = await call('/api/converge?slug=gate');
  expect(answer.status).toBe(200);
  return answer.body;
}

function withHost(path: string, host: string): Promise<{ status: number; body: unknown }> {
  return new Promise((done, failed) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host, Authorization: `Bearer ${app.token}` } }, res => {
      let text = '';
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => done({ status: Number(res.statusCode), body: JSON.parse(text) }));
    });
    req.on('error', failed);
    req.end();
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function edit(body: Body, index: number) {
  return body.edits[index];
}

beforeEach(async () => {
  children = [];
  outer = await mkdtemp(join(tmpdir(), 'bw-converge-'));
  root = join(outer, 'layered');
  wt = join(outer, 'converge-wt');
  await cp(join(process.cwd(), 'qa', 'fixtures', 'layered'), root, { recursive: true });
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  head = git(root, 'rev-parse', 'HEAD').trim();
  await cp(root, wt, { recursive: true });
  await put(wtPath('src/app/c.ts'), C_TEXT);
  await prepareBindweed(root);
  livePid = livePidOf();
  await plan([MOVE, CUT, PACKAGE, DELETE]);
  await writeRuns([runEntry(wt, '2026-10-22T12:00:00.000Z')]);
  const bound = await bindApp({ repoRoot: root, uiDir: join(outer, 'ui') }, { mode: 'fixed', port: 0 });
  if ('error' in bound) throw new Error('bind failed');
  app = bound;
  port = (bound.server.address() as { port: number }).port;
});

afterEach(async () => {
  app.server.close();
  for (const pid of children) process.kill(pid);
  await rm(outer, { recursive: true, force: true });
});

describe('GET /api/converge compares the worktree with the plan', () => {
  it('Four edits and two rules start undone', async () => {
    const runsBefore = await readFile(join(root, '.bindweed', 'runs.json'), 'utf8');
    const answer = await call('/api/converge?slug=gate');
    expect(answer.status).toBe(200);
    expect(Object.keys(answer.body)).toEqual(['slug', 'worktree', 'pidAlive', 'header', 'edits', 'rules']);
    expect(answer.body).toMatchObject({ slug: 'gate', worktree: wt, pidAlive: true, header: '0 of 4 edits done · 0 of 2 rules hold' });
    expect(answer.body.edits).toEqual([
      { index: 0, status: 'not yet', sentence: 'Move src/domain/model.ts to src/app' },
      { index: 1, status: 'not yet', sentence: 'src/app must not import src/infra (3 imports)', remain: ['src/app/a.ts:2', 'src/app/b.ts:2', 'src/app/c.ts:1'] },
      { index: 2, status: 'not yet', sentence: 'Create package src/ports' },
      { index: 3, status: 'not yet', sentence: 'Delete src/app/b.ts' },
    ]);
    expect(answer.body.rules).toEqual([
      { name: PATH_RULE.name, comment: PATH_RULE.comment, holds: false, breaks: ['src/app/a.ts:2', 'src/app/b.ts:2', 'src/app/c.ts:1'] },
      { name: CYCLE_RULE.name, comment: CYCLE_RULE.comment, holds: false, breaks: ['src/app/a.ts:1', 'src/app/b.ts:1'] },
    ]);
    expect(await readFile(join(root, '.bindweed', 'runs.json'), 'utf8')).toBe(runsBefore);
  });

  it('The move ticks only when the old path is gone, and a copy stays open', async () => {
    await put(wtPath('src/app/model.ts'), await wtRead('src/domain/model.ts'));
    let body = await converge();
    expect(edit(body, 0).status).toBe('not yet');
    expect(body.header).toMatch(/^0 of 4 edits done/);
    await rm(wtPath('src/domain/model.ts'));
    body = await converge();
    expect(edit(body, 0).status).toBe('done');
    expect(body.header).toBe('1 of 4 edits done · 0 of 2 rules hold');
    await rm(wtPath('src/app/model.ts'));
    body = await converge();
    expect(edit(body, 0).status).toBe('contradicted');
    expect(body.header).toMatch(/^0 of 4 edits done/);
  });

  it('A cut stays open until its last import, at the old path or the planned one', async () => {
    await wtReplace('src/app/a.ts', DB_IMPORT, '');
    await wtReplace('src/app/b.ts', DB_IMPORT, '');
    let body = await converge();
    expect(edit(body, 1)).toMatchObject({ status: 'not yet', remain: ['src/app/c.ts:1'] });
    expect(body.rules[0].breaks).toEqual(['src/app/c.ts:1']);
    expect(body.rules[1].breaks).toEqual(['src/app/a.ts:1', 'src/app/b.ts:1']);
    await writeFile(wtPath('src/app/c.ts'), 'export const c = 1;\n');
    body = await converge();
    expect(edit(body, 1)).toEqual({ index: 1, status: 'done', sentence: 'src/app must not import src/infra (3 imports)' });
    expect(body.rules[0]).toEqual({ name: PATH_RULE.name, comment: PATH_RULE.comment, holds: true });
    expect(body.header).toBe('1 of 4 edits done · 1 of 2 rules hold');
  });

  it('A cut follows the file to its planned path', async () => {
    await plan(B_CUT_MOVE, null);
    let body = await converge();
    expect(edit(body, 0).remain).toEqual(['src/app/b.ts:2']);
    expect(body.header).toBe('0 of 2 edits done · 0 of 0 rules hold');
    await wtMove('src/app/b.ts', 'src/domain/b.ts');
    body = await converge();
    expect(edit(body, 0)).toMatchObject({ status: 'not yet', remain: ['src/domain/b.ts:2'] });
    expect(edit(body, 1).status).toBe('done');
    await wtReplace('src/domain/b.ts', DB_IMPORT, '');
    body = await converge();
    expect(edit(body, 0).status).toBe('done');
    expect(body.header).toBe('2 of 2 edits done · 0 of 0 rules hold');
  });

  it('A cut matches each end on its own, so a half-moved import still remains', async () => {
    await plan([...B_CUT_MOVE, { kind: 'move-file', file: 'src/infra/db.ts', to: 'src/domain' }], null);
    await wtMove('src/infra/db.ts', 'src/domain/db.ts');
    await wtReplace('src/app/b.ts', DB_IMPORT, "import { query } from '../domain/db';\n");
    let body = await converge();
    expect(edit(body, 0)).toMatchObject({ status: 'not yet', remain: ['src/app/b.ts:2'] });
    expect([edit(body, 1).status, edit(body, 2).status]).toEqual(['not yet', 'done']);
    expect(body.header).toBe('1 of 3 edits done · 0 of 0 rules hold');
    await wtReplace('src/app/b.ts', "import { query } from '../domain/db';\n", 'export const moved = 1;\n');
    body = await converge();
    expect(edit(body, 0)).toEqual({ index: 0, status: 'done', sentence: 'src/app/b.ts must not import src/infra/db.ts (1 import)' });
  });

  it('A stopped run still answers', async () => {
    await writeRuns([runEntry(wt, '2026-10-22T12:00:00.000Z', Number(spawnSync('true').pid))]);
    const body = await converge();
    expect(body.pidAlive).toBe(false);
    expect(body.header).toBe('0 of 4 edits done · 0 of 2 rules hold');
  });

  it('Creating the package, and deleting a file something still imports', async () => {
    await put(wtPath('src/ports/readme.md'), '# ports\n');
    expect(edit(await converge(), 2).status).toBe('not yet');
    await put(wtPath('src/ports/port.ts'), 'export const port = 1;\n');
    await rm(wtPath('src/ports/readme.md'));
    expect(edit(await converge(), 2).status).toBe('done');
    await rm(wtPath('src/app/b.ts'));
    let body = await converge();
    expect(edit(body, 3)).toMatchObject({ status: 'not yet', remain: ['src/app/a.ts:1'] });
    expect(body.rules[1].holds).toBe(true);
    await wtReplace('src/app/a.ts', "import { b } from './b';\n", '');
    body = await converge();
    expect(edit(body, 3)).toEqual({ index: 3, status: 'done', sentence: 'Delete src/app/b.ts' });
  });

  it('A fold names who does not import into, and ignores a file the browsed scan never had', async () => {
    await plan([FOLD], null);
    expect((await converge()).edits).toEqual([{ index: 0, status: 'not yet', sentence: 'Fold src/infra/db.ts into src/domain/model.ts' }]);
    await rm(wtPath('src/infra/db.ts'));
    expect(edit(await converge(), 0)).toMatchObject({ status: 'not yet', remain: ['src/app/b.ts:2'] });
    await writeFile(wtPath('src/app/b.ts'), 'export const b = 1;\n');
    expect(edit(await converge(), 0).remain).toEqual(['src/app/b.ts']);
    await writeFile(wtPath('src/app/b.ts'), "import { Model } from '../domain/model';\nexport const b = 1;\n");
    expect(edit(await converge(), 0)).toEqual({ index: 0, status: 'done', sentence: 'Fold src/infra/db.ts into src/domain/model.ts' });
  });

  it('A fold looks for a former importer at its planned path, and a deleted one counts', async () => {
    await plan([FOLD, { kind: 'move-file', file: 'src/app/b.ts', to: 'src/domain' }, { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' }], null);
    await rm(wtPath('src/infra/db.ts'));
    await wtMove('src/app/b.ts', 'src/domain/b.ts');
    let body = await converge();
    expect(edit(body, 0)).toMatchObject({ status: 'not yet', remain: ['src/domain/b.ts:2'] });
    expect(body.header).toBe('1 of 3 edits done · 0 of 0 rules hold');
    await rm(wtPath('src/app/a.ts'));
    await writeFile(wtPath('src/domain/b.ts'), "import { Model } from './model';\nexport const b = 1;\n");
    body = await converge();
    expect(edit(body, 0).remain).toBeUndefined();
    expect(body.header).toBe('3 of 3 edits done · 0 of 0 rules hold');
    await rm(wtPath('src/domain/b.ts'));
    body = await converge();
    expect(edit(body, 0)).toMatchObject({ status: 'not yet', remain: ['src/domain/b.ts'] });
    expect(edit(body, 1).status).toBe('contradicted');
    expect(body.header).toBe('1 of 3 edits done · 0 of 0 rules hold');
  });

  it('The other edits, against a fresh worktree', async () => {
    const cases: [string, PlanEdit, () => Promise<void>, string][] = [
      ['add-edge unchanged', { kind: 'add-edge', from: 'src/domain', to: 'src/app' }, async () => undefined, 'not yet'],
      ['add-edge joined', { kind: 'add-edge', from: 'src/domain', to: 'src/app' }, () => wtReplace('src/domain/model.ts', 'export', "import { a } from '../app/a';\nexport"), 'done'],
      ['rename-file', { kind: 'rename-file', from: 'src/domain/model.ts', to: 'entity.ts' }, () => wtMove('src/domain/model.ts', 'src/domain/entity.ts'), 'done'],
      [
        'rename-package',
        { kind: 'rename-package', from: 'src/app', to: 'src/ui' },
        async () => {
          await wtMove('src/app/a.ts', 'src/ui/a.ts');
          await wtMove('src/app/b.ts', 'src/ui/b.ts');
        },
        'done',
      ],
      ['rename-package half', { kind: 'rename-package', from: 'src/app', to: 'src/ui' }, () => wtMove('src/app/a.ts', 'src/ui/a.ts'), 'not yet'],
      ['rename-package lost', { kind: 'rename-package', from: 'src/domain', to: 'src/core' }, () => rm(wtPath('src/domain/model.ts')), 'contradicted'],
      ['create-package nested', { kind: 'create-package', path: 'src/ports' }, () => put(wtPath('src/ports/http/port.ts'), 'export const port = 1;\n'), 'done'],
      [
        'merge-packages',
        { kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/core' },
        async () => {
          await wtMove('src/app/a.ts', 'src/core/a.ts');
          await wtMove('src/app/b.ts', 'src/core/b.ts');
          await wtMove('src/domain/model.ts', 'src/core/model.ts');
        },
        'done',
      ],
      [
        'split-package',
        { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: ['src/app/b.ts'] }] },
        async () => {
          await wtMove('src/app/a.ts', 'src/app/read/a.ts');
          await wtMove('src/app/b.ts', 'src/app/write/b.ts');
        },
        'done',
      ],
      ['note', NOTE, async () => undefined, 'note'],
    ];
    for (const [name, only, change, status] of cases) {
      await rm(wt, { recursive: true });
      await cp(root, wt, { recursive: true, filter: source => !source.includes('.bindweed') });
      await put(wtPath('src/app/c.ts'), C_TEXT);
      await plan([only], null);
      await change();
      const body = await converge();
      expect([name, body.edits.length, edit(body, 0).status, 'remain' in edit(body, 0)]).toEqual([name, 1, status, false]);
    }
  });

  it('A note is outside the count, a redo is ignored, and a fate covers a move', async () => {
    await plan([MOVE, CUT, PACKAGE, DELETE, NOTE], [PATH_RULE, CYCLE_RULE], [CUT]);
    let body = await converge();
    expect(body.header).toMatch(/^0 of 4 edits done/);
    expect(edit(body, 4)).toEqual({ index: 4, status: 'note', sentence: 'Note on src/domain: "look here"' });
    await plan([MOVE, { kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' }], null);
    await rm(wtPath('src/domain/model.ts'));
    body = await converge();
    expect(edit(body, 0).status).toBe('done');
    expect(edit(body, 1)).toMatchObject({ status: 'not yet', remain: ['src/infra/db.ts:1'] });
  });

  it('A saved rule is matched as written, and a test import breaks it', async () => {
    const plus: ContractRule = { name: 'bindweed:no-src-c++-to-src-app-a-ts', severity: 'error', comment: 'src/c++ must not import src/app/a.ts', from: { path: String.raw`^src/c\+\+/` }, to: { path: String.raw`^src/app/a\.ts$` } };
    await plan([MOVE, CUT, PACKAGE, DELETE], [plus]);
    await put(wtPath('src/c++/plus.ts'), "import { a } from '../app/a';\nexport const plus = a;\n");
    expect((await converge()).rules).toEqual([{ name: plus.name, comment: plus.comment, holds: false, breaks: ['src/c++/plus.ts:1'] }]);
    await put(wtPath('src/app/a.test.ts'), C_TEXT);
    await plan([MOVE, CUT, PACKAGE, DELETE]);
    for (const file of ['src/app/a.ts', 'src/app/b.ts', 'src/app/c.ts']) await wtReplace(file, DB_IMPORT, '');
    const body = await converge();
    expect(edit(body, 1).status).toBe('done');
    expect(body.rules[0].breaks).toEqual(['src/app/a.test.ts:1']);
  });

  it('The newest run for a slug is the one that is scanned', async () => {
    const old = join(outer, 'converge-old');
    await cp(wt, old, { recursive: true });
    await rm(join(old, 'src/app/c.ts'));
    await writeRuns([runEntry(wt, '2026-10-22T12:00:00.000Z'), runEntry(old, '2026-10-22T11:00:00.000Z')]);
    let body = await converge();
    expect(body.worktree).toBe(wt);
    expect(edit(body, 1).remain).toEqual(['src/app/a.ts:2', 'src/app/b.ts:2', 'src/app/c.ts:1']);
    await writeRuns([runEntry(wt, '2026-10-22T11:00:00.000Z'), runEntry(old, '2026-10-22T12:00:00.000Z')]);
    body = await converge();
    expect(body.worktree).toBe(old);
    expect(edit(body, 1).remain).toEqual(['src/app/a.ts:2', 'src/app/b.ts:2']);
  });

  it('A converge request that cannot be answered writes nothing', async () => {
    const cases: [string, () => Promise<void>, string, number, unknown][] = [
      ['missing slug', async () => undefined, '/api/converge', 400, { error: 'missing slug' }],
      ['unknown slug', async () => undefined, '/api/converge?slug=nope', 404, { error: 'no such run' }],
      ['bad slug', async () => undefined, '/api/converge?slug=../gate', 404, { error: 'no such run' }],
      ['bad converge on graph', async () => undefined, '/api/graph?at=src&converge=nope', 404, { error: 'no such run' }],
      ['bad converge on detail', async () => undefined, '/api/detail?id=src/app&at=src&converge=nope', 404, { error: 'no such run' }],
      ['bad converge on pairs', async () => undefined, '/api/pairs?from=src/app&to=src/infra&at=src&converge=nope', 404, { error: 'no such run' }],
      ['removed worktree', () => rm(wt, { recursive: true }), '/api/converge?slug=gate', 404, { error: 'worktree removed' }],
      ['not a plan', () => put(join(root, '.bindweed', 'plans', 'gate.json'), '{"name":"Bad"}'), '/api/converge?slug=gate', 404, { error: 'no such plan' }],
    ];
    expect(await call('/api/converge?slug=gate', 'GET', {})).toEqual({ status: 401, body: { error: 'missing or wrong token' } });
    expect(await withHost('/api/converge?slug=gate', `evil.example:${port}`)).toEqual({ status: 403, body: { error: 'bad host' } });
    for (const [name, world, path, status, body] of cases) {
      await world();
      const answer = await call(path);
      expect([name, answer.status, answer.body]).toEqual([name, status, body]);
      expect(await exists(join(root, '.bindweed', 'cache', 'gate'))).toBe(false);
      expect(await exists(join(root, '.bindweed', 'cache', 'scan.json'))).toBe(false);
    }
  });
});

type GraphBody = { nodes: { id: string; files?: number }[] };

function nodeOf(body: unknown, id: string) {
  return (body as GraphBody).nodes.find(node => node.id === id);
}

describe('the canvas reads the worktree and the cache stays under the browsed root', () => {
  it('The worktree graph has c.ts and the browsed graph does not', async () => {
    const worktreeGraph = await call('/api/graph?at=src&plan=gate&converge=gate');
    expect(worktreeGraph.status).toBe(200);
    expect(nodeOf(worktreeGraph.body, 'src/app')?.files).toBe(4);
    expect(nodeOf(worktreeGraph.body, 'src/ports')).toBeDefined();
    expect(nodeOf(worktreeGraph.body, 'src/domain')).toBeUndefined();
    expect((await call('/api/pairs?from=src/app&to=src/infra&at=src&converge=gate')).body).toEqual({
      pairs: [
        ['src/app/a.ts', 'src/infra/db.ts'],
        ['src/app/b.ts', 'src/infra/db.ts'],
        ['src/app/c.ts', 'src/infra/db.ts'],
      ],
    });
    expect((await call('/api/detail?id=src/app&at=src&converge=gate')).body).toMatchObject({ id: 'src/app', files: 3 });
    expect((await call('/api/detail?id=src/app&at=src')).body).toMatchObject({ id: 'src/app', files: 2 });
    expect((await call('/api/detail?id=src/app/c.ts&at=src/app&converge=gate')).body).toMatchObject({ id: 'src/app/c.ts', path: 'src/app/c.ts' });
    expect((await call('/api/detail?id=src/app/c.ts&at=src/app')).status).toBe(404);
    const browsed = await call('/api/graph?at=src&plan=gate');
    expect(nodeOf(browsed.body, 'src/app')?.files).toBe(3);
    expect(nodeOf(browsed.body, 'src/app/c.ts')).toBeUndefined();
    expect((await call('/api/pairs?from=src/app&to=src/infra&at=src')).body).toEqual({
      pairs: [
        ['src/app/a.ts', 'src/infra/db.ts'],
        ['src/app/b.ts', 'src/infra/db.ts'],
      ],
    });
    expect(await exists(wtPath('.bindweed'))).toBe(false);
  });

  it('A converge graph sees a worktree change with no rescan', async () => {
    expect(nodeOf((await call('/api/graph?at=src&plan=gate&converge=gate')).body, 'src/ports')?.files).toBe(0);
    await put(wtPath('src/ports/port.ts'), 'export const port = 1;\n');
    expect(nodeOf((await call('/api/graph?at=src&plan=gate&converge=gate')).body, 'src/ports')?.files).toBe(1);
    expect((await call('/api/detail?id=src/ports&at=src&converge=gate')).body).toMatchObject({ id: 'src/ports', files: 1 });
    expect((await call('/api/detail?id=src/ports/port.ts&at=src/ports&converge=gate')).body).toMatchObject({ path: 'src/ports/port.ts' });
  });

  it("A warm cache entry is reused until the file's stamp changes", async () => {
    await call('/api/graph?at=src');
    const browsedCache = join(root, '.bindweed', 'cache', 'scan.json');
    const noted = await readFile(browsedCache, 'utf8');
    await converge();
    const slugCache = join(root, '.bindweed', 'cache', 'gate', 'scan.json');
    const cached = JSON.parse(await readFile(slugCache, 'utf8'));
    const entry = cached.files['src/app/a.ts'];
    expect(Object.keys(entry)).toEqual(['mtimeMs', 'size', 'imports', 'abstract', 'functions']);
    expect(entry.imports[1]).toEqual({ specifier: '../infra/db', typeOnly: false, line: 2 });
    entry.imports[1].line = 9;
    await writeFile(slugCache, JSON.stringify(cached));
    expect(edit(await converge(), 1).remain?.[0]).toBe('src/app/a.ts:9');
    const stamp = await stat(wtPath('src/app/a.ts'));
    await writeFile(wtPath('src/app/a.ts'), `${await wtRead('src/app/a.ts')}\n`);
    await utimes(wtPath('src/app/a.ts'), stamp.atime, stamp.mtime);
    expect(edit(await converge(), 1).remain?.[0]).toBe('src/app/a.ts:2');
    expect(await readFile(browsedCache, 'utf8')).toBe(noted);
    expect(JSON.parse(noted).files['src/app/a.ts'].imports[1]).toEqual({ specifier: '../infra/db', typeOnly: false });
  });

  it('builds the browsed scan once when converge comes first', async () => {
    await converge();
    const browsedCache = join(root, '.bindweed', 'cache', 'scan.json');
    const noted = await readFile(browsedCache, 'utf8');
    await writeFile(join(root, 'src/app/extra.ts'), 'export const extra = 1;\n');
    await converge();
    expect(await readFile(browsedCache, 'utf8')).toBe(noted);
  });

  it('Rescan of the worktree does not rescan the browsed repository', async () => {
    await call('/api/graph?at=src');
    const browsedCache = join(root, '.bindweed', 'cache', 'scan.json');
    const noted = await readFile(browsedCache, 'utf8');
    const rescan = await call('/api/rescan?converge=gate', 'POST');
    expect(rescan.status).toBe(200);
    expect(rescan.body.files).toBe(5);
    expect(await readFile(browsedCache, 'utf8')).toBe(noted);
    expect(await exists(wtPath('.bindweed'))).toBe(false);
    expect((await call('/api/rescan', 'POST')).body.files).toBe(4);
    expect(await call('/api/rescan?converge=nope', 'POST')).toEqual({ status: 404, body: { error: 'no such run' } });
  });
});

describe('the routes from 001 to 011 keep working', () => {
  it('Old routes still answer and README lists /api/converge', async () => {
    expect((await call('/api/tree')).status).toBe(200);
    const file = await call('/api/file?path=src/app/a.ts');
    expect([file.status, file.body.path]).toEqual([200, 'src/app/a.ts']);
    for (const path of ['/api/plans', '/api/plans/gate/contract', '/api/config', '/api/layout']) expect((await call(path)).status).toBe(200);
    const runs = await call('/api/runs');
    expect([runs.status, (runs.body as unknown as { runs: { slug: string; planName: string }[] }).runs[0]]).toMatchObject([200, { slug: 'gate', planName: 'Gate' }]);
    expect(await readFile(join(process.cwd(), 'README.md'), 'utf8')).toContain('| `/api/converge` | live |');
  });
});
