import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parsePlan, type PlanDoc } from './domain/plan.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20625 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);

const LAYERED_FILES: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}',
  'notes/readme.md': '# notes\n',
  'src/app/a.ts':
    "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n",
  'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  'src/app/a.test.ts': "import { a } from './a';\n",
  'src/app/save.ts': 'export const save = 1;\n',
  'src/domain/model.ts': 'export interface Model { id: number }\n',
  'src/domain/shape.ts': 'export interface Shape { draw(): void }\n',
  'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
  'src/infra/repo.ts':
    "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n",
};

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; body: Buffer };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function gitRepo(name: string, files: Record<string, string>, commit: boolean): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-plans-')), name);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  git(root, 'init', '-q', '--template=');
  if (!commit) return root;
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
  return root;
}

async function boundOn(repoRoot: string, port: number): Promise<Bound> {
  const result = await bindApp({ repoRoot, uiDir: '/nowhere' }, { mode: 'fixed', port });
  if ('error' in result) throw new Error(listenErrorMessage(result.error));
  return result;
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, 'close');
}

function hit(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(4000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

const loose = z.record(z.string(), z.unknown());

const graphJson = z.object({
  nodes: z.array(loose),
  edges: z.array(loose),
  stale: z.array(z.string().nullable()).optional(),
});

function graphOf(raw: unknown): z.infer<typeof graphJson> {
  return graphJson.parse(raw);
}

function planOf(raw: unknown): PlanDoc {
  const doc = parsePlan(raw);
  if (doc === undefined) throw new Error('not a plan');
  return doc;
}

function withoutStale(raw: unknown): Record<string, unknown> {
  const rec = { ...loose.parse(raw) };
  delete rec.stale;
  return rec;
}

function sortedEntryPaths(raw: unknown): string[] {
  const entries = z.object({ entries: z.array(z.object({ path: z.string() })) }).parse(raw).entries;
  return entries.map(entry => entry.path).sort();
}

function nodeOf(nodes: Record<string, unknown>[], id: string): Record<string, unknown> {
  const node = nodes.find(item => item.id === id);
  if (node === undefined) throw new Error(id);
  return node;
}

function edgeOf(edges: Record<string, unknown>[], from: string, to: string): Record<string, unknown> {
  const edge = edges.find(item => item.from === from && item.to === to);
  if (edge === undefined) throw new Error(`${from} ${to}`);
  return edge;
}

function placeLabel(node: Record<string, unknown>): string {
  return `${String(node.id)}:${String(node.row)}:${String(node.order)}`;
}

function nodeAt(nodes: Record<string, unknown>[], index: number): Record<string, unknown> {
  const node = nodes[index];
  if (node === undefined) throw new Error(String(index));
  return node;
}

const NO_PLAN = { error: 'no such plan' };
const NOT_FOUND = { error: 'not found' };
const NO_TOKEN = { error: 'missing or wrong token' };

async function planFiles(root: string): Promise<string[]> {
  try {
    return await readdir(join(root, '.bindweed', 'plans'));
  } catch {
    return [];
  }
}

describe('the plans api over the layered fixture', () => {
  let root = '';
  let app: Bound;
  let bearer: Record<string, string> = {};
  let head = '';
  const port = PORT_BASE;

  beforeAll(async () => {
    root = await gitRepo('layered', LAYERED_FILES, true);
    await prepareBindweed(root);
    app = await boundOn(root, port);
    bearer = { Authorization: `Bearer ${app.token}` };
    head = git(root, 'rev-parse', 'HEAD').trim();
  });

  afterAll(async () => {
    await closeServer(app.server);
    await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('refuses names that do not slug and writes nothing', async () => {
    const bodies = ['not json', '{}', '{"name":""}', '{"name":"   "}', '{"name":"!!!"}', '{"name":3}', '{"name":"Split app","slug":"x"}'];
    for (const body of bodies) {
      const res = await hit(port, 'POST', '/api/plans', bearer, body);
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({ error: 'bad name' });
    }
    expect(await planFiles(root)).toHaveLength(0);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('keeps the old routes answering', async () => {
    expect(sortedEntryPaths(json(await hit(port, 'GET', '/api/tree', bearer)))).toEqual(['notes', 'src', 'tsconfig.json']);
    expect(json(await hit(port, 'GET', '/api/file?path=src/domain/model.ts', bearer))).toEqual({
      path: 'src/domain/model.ts',
      text: 'export interface Model { id: number }\n',
    });
    expect(json(await hit(port, 'GET', '/api/graph?at=notes', bearer))).toEqual({ error: 'no such directory' });
    expect(json(await hit(port, 'GET', '/api/graph?at=src&plan=missing', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/detail?id=missing&at=src', bearer))).toEqual({ error: 'no such node' });
    expect(json(await hit(port, 'GET', '/api/detail?id=src/domain&at=src&plan=missing', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/layout', bearer))).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    await expect(readFile(join(root, '.bindweed', 'layout.json'))).rejects.toThrow();
    expect(json(await hit(port, 'GET', '/api/plans/Split-App', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/plans/split.app', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/graph?at=src&plan=src/app', bearer))).toEqual(NO_PLAN);
    const nested = await hit(port, 'GET', '/api/plans/src/app', bearer);
    expect(nested.status).toBe(404);
    expect(json(nested)).toEqual(NOT_FOUND);
    expect(await planFiles(root)).toHaveLength(0);
    expect(json(await hit(port, 'POST', '/api/rescan', bearer))).toEqual({ files: 8, ms: expect.any(Number) });
  });

  it('creates a plan, reads it back, lists it, and leaves the tree clean', async () => {
    const created = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
    expect(created.status).toBe(201);
    const doc = planOf(json(created));
    expect(doc).toMatchObject({ version: 1, name: 'Split app', slug: 'split-app', baseCommit: head, edits: [], redo: [] });
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const fetched = await hit(port, 'GET', '/api/plans/split-app', bearer);
    expect(json(fetched)).toEqual(doc);
    const listed = await hit(port, 'GET', '/api/plans', bearer);
    expect(json(listed)).toEqual({ plans: [{ name: 'Split app', slug: 'split-app', editCount: 0, createdAt: doc.createdAt }] });
    const onDisk = JSON.parse(await readFile(join(root, '.bindweed', 'plans', 'split-app.json'), 'utf8'));
    expect(onDisk).toEqual(doc);
    expect(git(root, 'status', '--porcelain')).toBe('');
    const file = await hit(port, 'GET', '/api/file?path=src/app/save.ts', bearer);
    expect(json(file)).toEqual({ path: 'src/app/save.ts', text: 'export const save = 1;\n' });
  });

  it('clashes, truncates with a trailing dash, and frees deleted slugs', async () => {
    const second = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
    const third = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
    expect(json(second)).toMatchObject({ slug: 'split-app-2', name: 'Split app' });
    expect(json(third)).toMatchObject({ slug: 'split-app-3' });
    const removed = await hit(port, 'DELETE', '/api/plans/split-app', bearer);
    expect(removed.status).toBe(200);
    expect(json(removed)).toEqual({ ok: true });
    expect(await planFiles(root)).not.toContain('split-app.json');
    const again = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
    expect(json(again)).toMatchObject({ slug: 'split-app' });
    const longName = { name: 'aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaa x' };
    const longOne = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify(longName));
    const slugOne = 'aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa-';
    expect(json(longOne)).toMatchObject({ slug: slugOne });
    const longDoc = await hit(port, 'GET', `/api/plans/${slugOne}`, bearer);
    expect(json(longDoc)).toEqual(json(longOne));
    const longGraph = await hit(port, 'GET', `/api/graph?at=src&plan=${slugOne}`, bearer);
    const plainGraph = await hit(port, 'GET', '/api/graph?at=src', bearer);
    expect(longGraph.status).toBe(200);
    expect(loose.parse(json(longGraph)).stale).toEqual([]);
    expect(withoutStale(json(longGraph))).toEqual(json(plainGraph));
    const longTwo = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify(longName));
    const slugTwo = 'aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa--2';
    expect(json(longTwo)).toMatchObject({ slug: slugTwo });
    expect(json(await hit(port, 'GET', `/api/plans/${slugTwo}`, bearer))).toEqual(json(longTwo));
    const clashGraph = await hit(port, 'GET', `/api/graph?at=src&plan=${slugTwo}`, bearer);
    expect(clashGraph.status).toBe(200);
    expect(loose.parse(json(clashGraph)).stale).toEqual([]);
    expect(withoutStale(json(clashGraph))).toEqual(json(plainGraph));
    const lodz = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Łódź plan' }));
    expect(json(lodz)).toMatchObject({ slug: 'd-plan', name: 'Łódź plan' });
    const hello = await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Hello!!!' }));
    expect(json(hello)).toMatchObject({ slug: 'hello' });
  });

  it('keeps host and token checks and route shape', async () => {
    for (const [method, path] of [
      ['GET', '/api/plans'],
      ['POST', '/api/plans'],
      ['GET', '/api/plans/split-app'],
      ['PUT', '/api/plans/split-app'],
      ['DELETE', '/api/plans/split-app'],
      ['GET', '/api/graph'],
      ['GET', '/api/tree'],
    ]) {
      const res = await hit(port, method, path);
      expect(res.status).toBe(401);
      expect(json(res)).toEqual(NO_TOKEN);
    }
    const evilHost = await hit(port, 'GET', `/api/plans?token=${app.token}`, { Host: 'evil.example:5000' });
    expect(evilHost.status).toBe(403);
    expect(json(evilHost)).toEqual({ error: 'bad host' });
    expect(json(await hit(port, 'POST', '/api/plans/split-app', bearer, '{}'))).toEqual(NOT_FOUND);
    expect(json(await hit(port, 'DELETE', '/api/plans', bearer))).toEqual(NOT_FOUND);
    expect(json(await hit(port, 'GET', '/api/plans/Split-App', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/plans/split.app', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/graph?at=src&plan=src/app', bearer))).toEqual(NO_PLAN);
    const deep = await hit(port, 'GET', '/api/plans/src/app', bearer);
    expect(deep.status).toBe(404);
    expect(json(deep)).toEqual(NOT_FOUND);
    expect(json(await hit(port, 'GET', '/api/plans/nope', bearer))).toEqual(NO_PLAN);
  });

  it('serves the 004 src view plus save.ts with no plan query, and with an empty plan query', async () => {
    const expected = {
      at: 'src',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 3, row: 0, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 2, row: 1, order: 0, cycle: false, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 2, order: 0, cycle: false, abstract: true, ca: 3, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy' },
      ],
      edges: [
        { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
        { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: false },
        { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
      ],
    };
    expect(json(await hit(port, 'GET', '/api/graph?at=src', bearer))).toEqual(expected);
    expect(json(await hit(port, 'GET', '/api/graph?at=src&plan=', bearer))).toEqual(expected);
    const rootView = graphOf(json(await hit(port, 'GET', '/api/graph', bearer)));
    expect(rootView.nodes).toHaveLength(1);
    const rootNode = nodeAt(rootView.nodes, 0);
    expect(rootNode).toMatchObject({ id: 'src', files: 7, ca: 0, ce: 0, i: '–', a: '0.29', d: '–' });
    expect(rootNode).not.toHaveProperty('zone');
    expect(rootNode).not.toHaveProperty('crap');
    expect(rootNode).not.toHaveProperty('coverage');
    expect(rootNode).not.toHaveProperty('mutants');
  });

  it('serves the saved plan after a restart with a new token', async () => {
    const previous = app.token;
    await closeServer(app.server);
    app = await boundOn(root, port);
    bearer = { Authorization: `Bearer ${app.token}` };
    expect(app.token).not.toBe(previous);
    expect(json(await hit(port, 'GET', '/api/plans/split-app', bearer))).toMatchObject({ slug: 'split-app', edits: [] });
  });

  it('never reads a plan file whose name is not a slug', async () => {
    const file = join(root, '.bindweed', 'plans', 'Split-App.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      name: 'Split app',
      slug: 'split-app',
      createdAt: '2026-10-01T00:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      edits: [],
      redo: [],
    }));
    const res = await hit(port, 'GET', '/api/plans/Split-App', bearer);
    expect(res.status).toBe(404);
    expect(json(res)).toEqual(NO_PLAN);
    await rm(file);
  });
});

describe('plan documents and the planned graph', () => {
  let root = '';
  let app: Bound;
  let bearer: Record<string, string> = {};
  const port = PORT_BASE + 1;

  async function putDoc(edits: unknown[], redo: unknown[] = []): Promise<Hit> {
    const doc = {
      version: 1,
      name: 'Split app',
      slug: 'split-app',
      createdAt: '2026-10-01T00:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      edits,
      redo,
    };
    return hit(port, 'PUT', '/api/plans/split-app', bearer, JSON.stringify(doc));
  }

  beforeAll(async () => {
    root = await gitRepo('layered', LAYERED_FILES, true);
    await prepareBindweed(root);
    app = await boundOn(root, port);
    bearer = { Authorization: `Bearer ${app.token}` };
    await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
  });

  afterAll(async () => {
    await closeServer(app.server);
    await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('answers the pinned planned body for the three edits', async () => {
    const put = await putDoc([
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' },
      { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
      { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
    ]);
    expect(put.status).toBe(200);
    const body = json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer));
    expect(body).toEqual({
      at: 'src',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: true, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 3, row: 0, order: 1, cycle: true, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 1, order: 0, cycle: false, abstract: true, ca: 2, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy' },
      ],
      edges: [
        { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: true, cycleText: 'app → infra → app' },
        { from: 'src/infra', to: 'src/app', runtime: 0, type: 0, planned: true, cycle: true, cycleText: 'infra → app → infra' },
        { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
      ],
      stale: [null, null, null],
      warnings: [[], [], [{ kind: 'added-cycle', cycle: 'app → infra → app' }]],
    });
    const drilled = graphOf(json(await hit(port, 'GET', '/api/graph?at=src/infra&plan=split-app', bearer)));
    expect(drilled.nodes.map(placeLabel)).toEqual(['src/infra/db.ts:0:0', 'src/infra/repo.ts:0:1', 'src/infra/save.ts:0:2']);
    expect(drilled.edges).toEqual([]);
    const movedFile = nodeAt(drilled.nodes, 2);
    expect(movedFile).toMatchObject({ ca: 0, ce: 0, i: '–', a: '0.00', d: '–' });
    expect(movedFile).not.toHaveProperty('zone');
    expect(drilled.stale).toEqual([null, null, null]);
    const missing = await hit(port, 'GET', '/api/file?path=src/infra/save.ts', bearer);
    expect(missing.status).toBe(404);
    expect(json(missing)).toEqual({ error: 'no such file' });
    const detail = loose.parse(json(await hit(port, 'GET', '/api/detail?id=src/domain&at=src&plan=split-app', bearer)));
    expect(detail).toMatchObject({ files: 2, abstract: true, ca: 2, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy', imports: [] });
    expect(detail).not.toHaveProperty('stale');
    expect(detail.importedBy).toEqual([{ id: 'src/infra', name: 'infra', kind: 'package', runtime: 2, type: 0, heritage: 1 }]);
    expect(loose.parse(json(await hit(port, 'GET', '/api/detail?id=src/domain&at=src', bearer)))).toMatchObject({
      ca: 3,
      importedBy: [
        { id: 'src/app', name: 'app', kind: 'package', runtime: 0, type: 1, heritage: 0 },
        { id: 'src/infra', name: 'infra', kind: 'package', runtime: 2, type: 0, heritage: 1 },
      ],
    });
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('keeps both directions of a moved file’s imports', async () => {
    await putDoc([{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }]);
    expect(loose.parse(json(await hit(port, 'GET', '/api/detail?id=src/infra/b.ts&at=src/infra&plan=split-app', bearer)))).toMatchObject({
      path: 'src/infra/b.ts',
      imports: [
        { id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
        { id: 'src/infra/db.ts', name: 'db.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      ],
      importedBy: [{ id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
    });
    const graph = graphOf(json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer)));
    const back = edgeOf(graph.edges, 'src/infra', 'src/app');
    expect(back).toMatchObject({ runtime: 1, type: 0, cycle: true });
    expect(back).not.toHaveProperty('planned');
    expect(edgeOf(graph.edges, 'src/app', 'src/infra')).toMatchObject({ runtime: 2, type: 1, cycle: true });
    expect(nodeOf(graph.nodes, 'src/app')).toMatchObject({ files: 2 });
    expect(nodeOf(graph.nodes, 'src/infra')).toMatchObject({ files: 3 });
  });

  it('cuts only the listed pairs', async () => {
    await putDoc([{ kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/a.ts', 'src/infra/db.ts']] }]);
    const graph = graphOf(json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer)));
    expect(edgeOf(graph.edges, 'src/app', 'src/infra')).toMatchObject({ runtime: 1, type: 1 });
    expect(edgeOf(graph.edges, 'src/app', 'src/domain')).toMatchObject({ runtime: 0, type: 1 });
  });

  it('marks a stale move and keeps it in the document, across a rescan', async () => {
    await putDoc([{ kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' }]);
    const noted = json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer));
    expect(loose.parse(noted).stale).toEqual([null]);
    expect(withoutStale(noted)).toEqual(json(await hit(port, 'GET', '/api/graph?at=src', bearer)));
    await putDoc([{ kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' }]);
    const graph = json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer));
    expect(loose.parse(graph).stale).toEqual(['no such file src/app/missing.ts']);
    expect(withoutStale(graph)).toEqual(json(await hit(port, 'GET', '/api/graph?at=src', bearer)));
    const doc = loose.parse(json(await hit(port, 'GET', '/api/plans/split-app', bearer)));
    expect(doc.edits).toEqual([{ kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' }]);
    expect(doc).not.toHaveProperty('stale');
    await hit(port, 'POST', '/api/rescan', bearer);
    const after = loose.parse(json(await hit(port, 'GET', '/api/plans/split-app', bearer)));
    expect(after.edits).toEqual(doc.edits);
    expect(after).not.toHaveProperty('stale');
  });

  it('treats a hidden test file as present and a fileless directory as missing', async () => {
    await putDoc([{ kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/infra' }]);
    const graph = graphOf(json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer)));
    expect(graph.stale).toEqual([null]);
    const withTests = graphOf(json(await hit(port, 'GET', '/api/graph?at=src&tests=1&plan=split-app', bearer)));
    expect(withTests.stale).toEqual([null]);
    expect(nodeOf(withTests.nodes, 'src/app')).toMatchObject({ files: 3 });
    expect(nodeOf(withTests.nodes, 'src/infra')).toMatchObject({ files: 3 });
    await putDoc([{ kind: 'move-file', file: 'src/app/save.ts', to: 'notes' }]);
    const notes = graphOf(json(await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer)));
    expect(notes.stale).toEqual(['no such directory notes']);
    expect(nodeOf(notes.nodes, 'src/app')).toMatchObject({ files: 3 });
    expect(nodeOf(notes.nodes, 'src/infra')).toMatchObject({ files: 2 });
    const doc = loose.parse(json(await hit(port, 'GET', '/api/plans/split-app', bearer)));
    expect(doc.edits).toEqual([{ kind: 'move-file', file: 'src/app/save.ts', to: 'notes' }]);
    expect(doc).not.toHaveProperty('stale');
  });

  it('refuses bad PUTs and leaves the file’s bytes', async () => {
    await putDoc([]);
    const file = join(root, '.bindweed', 'plans', 'split-app.json');
    const before = await readFile(file);
    const badBodies = [
      'not json',
      JSON.stringify({ version: 2, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'other', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] }),
      JSON.stringify({ version: 1, name: '', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: 'yesterday', baseCommit: 'a'.repeat(40), edits: [], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'abc', edits: [], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [{ kind: 'add-edge', from: 'src/app', to: 'src/app' }], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [{ kind: 'note', target: { node: 'src/domain' }, text: '' }], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [{ kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [] }], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [{ kind: 'fold', file: 'src/app/save.ts' }], redo: [] }),
      JSON.stringify({ version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [], extra: 1 }),
    ];
    for (const body of badBodies) {
      const res = await hit(port, 'PUT', '/api/plans/split-app', bearer, body);
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({ error: 'bad plan' });
      expect(await readFile(file)).toEqual(before);
    }
    const missing = await hit(port, 'PUT', '/api/plans/missing', bearer, JSON.stringify({
      version: 1,
      name: 'Missing',
      slug: 'missing',
      createdAt: '2026-10-01T00:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      edits: [],
      redo: [],
    }));
    expect(missing.status).toBe(404);
    expect(json(missing)).toEqual(NO_PLAN);
    expect(await planFiles(root)).not.toContain('missing.json');
    await writeFile(file, 'not json');
    const corrupt = await hit(port, 'GET', '/api/plans/split-app', bearer);
    expect(corrupt.status).toBe(404);
    expect(json(corrupt)).toEqual(NO_PLAN);
    expect(await readFile(file, 'utf8')).toBe('not json');
    expect(json(await hit(port, 'GET', '/api/plans', bearer))).toEqual({ plans: [] });
    await writeFile(file, before);
  });

  it('lists pairs behind an arrow for the planned graph, with flags', async () => {
    await putDoc([]);
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/app&to=src/infra&at=src', bearer))).toEqual({
      pairs: [
        ['src/app/a.ts', 'src/infra/db.ts'],
        ['src/app/a.ts', 'src/infra/repo.ts'],
        ['src/app/b.ts', 'src/infra/db.ts'],
      ],
    });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/app&to=src/domain&at=src', bearer))).toEqual({
      pairs: [['src/app/a.ts', 'src/domain/model.ts']],
    });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/infra&to=react&at=src&external=1', bearer))).toEqual({
      pairs: [['src/infra/repo.ts', 'react']],
    });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/infra&to=react&at=src', bearer))).toEqual({ pairs: [] });
    await putDoc([{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }]);
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/infra&to=src/app&at=src&plan=split-app', bearer))).toEqual({
      pairs: [['src/infra/b.ts', 'src/app/a.ts']],
    });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/infra&to=src/app&at=src', bearer))).toEqual({ pairs: [] });
    const noAt = await hit(port, 'GET', '/api/pairs?from=src/app&to=src/infra', bearer);
    expect(noAt.status).toBe(200);
    expect(json(noAt)).toEqual({ pairs: [] });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src&to=react&external=1', bearer))).toEqual({ pairs: [['src/infra/repo.ts', 'react']] });
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/app&to=react&at=src&external=1', bearer))).toEqual({ pairs: [] });
    const missingParam = await hit(port, 'GET', '/api/pairs?to=src/app', bearer);
    expect(missingParam.status).toBe(404);
    const missingTo = await hit(port, 'GET', '/api/pairs?from=src/app', bearer);
    expect(missingTo.status).toBe(404);
    expect(json(missingTo)).toEqual(NOT_FOUND);
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/app&to=src/infra&at=src&plan=missing', bearer))).toEqual(NO_PLAN);
    expect(json(await hit(port, 'GET', '/api/pairs?from=src/app&to=src/infra&at=src&plan=src/app', bearer))).toEqual(NO_PLAN);
  });

  it('reads a corrupt plan file as missing without rewriting it, and skips it in the list', async () => {
    await putDoc([]);
    const file = join(root, '.bindweed', 'plans', 'split-app.json');
    await writeFile(file, 'not json');
    const res = await hit(port, 'GET', '/api/plans/split-app', bearer);
    expect(res.status).toBe(404);
    expect(json(res)).toEqual(NO_PLAN);
    expect(await readFile(file, 'utf8')).toBe('not json');
    expect(json(await hit(port, 'GET', '/api/plans', bearer))).toEqual({ plans: [] });
    const graph = await hit(port, 'GET', '/api/graph?at=src&plan=split-app', bearer);
    expect(graph.status).toBe(404);
    expect(json(graph)).toEqual(NO_PLAN);
    await hit(port, 'DELETE', '/api/plans/split-app', bearer);
    expect(await planFiles(root)).toHaveLength(0);
    expect(json(await hit(port, 'DELETE', '/api/plans/split-app', bearer))).toEqual(NO_PLAN);
  });

});

describe('a repository with no commit', () => {
  let root = '';
  let app: Bound;
  const port = PORT_BASE + 2;

  beforeAll(async () => {
    root = await gitRepo('plain', { 'src/only.ts': 'export const n = 1;\n' }, false);
    await prepareBindweed(root);
    app = await boundOn(root, port);
  });

  afterAll(async () => {
    await closeServer(app.server);
    await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('refuses to create a plan and writes nothing', async () => {
    const res = await hit(port, 'POST', '/api/plans', { Authorization: `Bearer ${app.token}` }, JSON.stringify({ name: 'Split app' }));
    expect(res.status).toBe(400);
    expect(json(res)).toEqual({ error: 'no commit' });
    expect(await planFiles(root)).toHaveLength(0);
    const listed = await hit(port, 'GET', '/api/graph?at=src', { Authorization: `Bearer ${app.token}` });
    expect(listed.status).toBe(200);
  });
});
