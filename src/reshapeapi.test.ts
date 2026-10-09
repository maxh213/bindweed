import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sentenceOf, type PlanEdit } from './domain/plan.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 21500 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);

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

const CREATE_PORTS: PlanEdit = { kind: 'create-package', path: 'src/ports' };
const MOVE_SHAPE: PlanEdit = { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/ports' };
const RENAME_INFRA: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' };
const SPLIT_APP: PlanEdit = {
  kind: 'split-package',
  package: 'src/app',
  parts: [
    { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts'] },
    { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
  ],
};
const MERGE_BACK: PlanEdit = { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app' };
const DELETE_MODEL: PlanEdit = { kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' };
const FOLD_REPO: PlanEdit = { kind: 'fate', file: 'src/adapters/repo.ts', fate: 'fold', into: 'src/ports/shape.ts' };
const SEVEN = [CREATE_PORTS, MOVE_SHAPE, RENAME_INFRA, SPLIT_APP, MERGE_BACK, DELETE_MODEL, FOLD_REPO];
const SPLIT_CYCLE = [[], [], [], [{ kind: 'added-cycle', cycle: 'read → write → read' }]];
const DELETE_WARNING = { kind: 'deleted-imports', file: 'src/domain/model.ts', importers: ['src/adapters/db.ts', 'src/app/a.ts'] };

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; body: Buffer };

type Rec = Record<string, unknown>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function gitRepo(name: string, files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-reshape-')), name);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
  return root;
}

function hit(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Hit> {
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

const loose = z.record(z.string(), z.unknown());

const graphJson = z.object({
  nodes: z.array(loose),
  edges: z.array(loose),
  stale: z.array(z.string().nullable()).optional(),
  warnings: z.array(z.array(loose)).optional(),
});

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

function nodeOf(nodes: Rec[], id: string): Rec {
  const node = nodes.find(item => item.id === id);
  if (node === undefined) throw new Error(id);
  return node;
}

function edgeOf(edges: Rec[], from: string, to: string): Rec {
  const edge = edges.find(item => item.from === from && item.to === to);
  if (edge === undefined) throw new Error(`${from} ${to}`);
  return edge;
}

function idsOf(nodes: Rec[]): unknown[] {
  return nodes.map(node => node.id);
}

function edgePairsOf(edges: Rec[]): string[] {
  return edges.map(edge => `${String(edge.from)}>${String(edge.to)}`);
}

function withoutKey(raw: unknown, key: string): Rec {
  return Object.fromEntries(Object.entries(loose.parse(raw)).filter(([name]) => name !== key));
}

describe('package edits and file fates over the 005 tree', () => {
  let root = '';
  let app: Bound;
  let bearer: Record<string, string> = {};
  const port = PORT_BASE + 1;

  function docBody(edits: unknown[]): string {
    return JSON.stringify({ version: 1, name: 'Reshape', slug: 'reshape', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits, redo: [] });
  }

  async function putDoc(edits: unknown[]): Promise<Hit> {
    return hit(port, 'PUT', '/api/plans/reshape', bearer, docBody(edits));
  }

  async function get(path: string): Promise<Hit> {
    return hit(port, 'GET', path, bearer);
  }

  async function graph(query: string): Promise<z.infer<typeof graphJson>> {
    return graphJson.parse(json(await get(`/api/graph?${query}`)));
  }

  async function body(path: string): Promise<unknown> {
    return json(await get(path));
  }

  beforeAll(async () => {
    root = await gitRepo('layered', LAYERED_FILES);
    await prepareBindweed(root);
    const result = await bindApp({ repoRoot: root, uiDir: '/nowhere' }, { mode: 'fixed', port });
    if ('error' in result) throw new Error(listenErrorMessage(result.error));
    app = result;
    bearer = { Authorization: `Bearer ${app.token}` };
  });

  beforeEach(async () => {
    await hit(port, 'DELETE', '/api/plans/reshape', bearer);
    await hit(port, 'DELETE', '/api/plans/split-app', bearer);
  });

  afterAll(async () => {
    app.server.close();
    await once(app.server, 'close');
    await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function reshape(edits: PlanEdit[]): Promise<void> {
    await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Reshape' }));
    expect((await putDoc(edits)).status).toBe(200);
  }

  it('A 005 plan loads unchanged and warns about the cycle it adds', async () => {
    const edits: PlanEdit[] = [
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' },
      { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
      { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
    ];
    await hit(port, 'POST', '/api/plans', bearer, JSON.stringify({ name: 'Split app' }));
    const doc = { version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits, redo: [] };
    expect((await hit(port, 'PUT', '/api/plans/split-app', bearer, JSON.stringify(doc))).status).toBe(200);
    const saved = loose.parse(await body('/api/plans/split-app'));
    expect(saved.edits).toEqual(edits);
    expect(saved).not.toHaveProperty('warnings');
    expect(saved).not.toHaveProperty('stale');
    expect(edits.map(sentenceOf)).toEqual(['Move src/app/save.ts to src/infra', 'src/app must not import src/domain (1 import)', 'src/infra should use src/app']);
    const cycle = [[], [], [{ kind: 'added-cycle', cycle: 'app → infra → app' }]];
    const src = await graph('at=src&plan=split-app');
    expect(src.warnings).toEqual(cycle);
    expect(idsOf(src.nodes)).toEqual(['src/app', 'src/infra', 'src/domain']);
    expect(edgeOf(src.edges, 'src/infra', 'src/app')).toMatchObject({ planned: true, cycleText: 'infra → app → infra' });
    for (const query of ['plan=split-app', 'at=&plan=split-app']) {
      const top = await graph(query);
      expect(idsOf(top.nodes)).toEqual(['src']);
      expect(nodeOf(top.nodes, 'src').files).toBe(7);
      expect(top.edges).toEqual([]);
      expect(top.warnings).toEqual(cycle);
      expect(top.stale).toEqual([null, null, null]);
    }
    const drilled = await graph('at=src/app&plan=split-app');
    expect(idsOf(drilled.nodes)).toEqual(['src/app/a.ts', 'src/app/b.ts']);
    expect(drilled.nodes.map(node => node.cycle)).toEqual([true, true]);
    expect(edgeOf(drilled.edges, 'src/app/a.ts', 'src/app/b.ts').cycleText).toBe('a.ts → b.ts → a.ts');
    expect(drilled.warnings).toEqual(cycle);
    expect(drilled.stale).toEqual([null, null, null]);
    const flagged = await graph('at=src&tests=1&external=1&plan=split-app');
    expect(flagged.warnings).toEqual(cycle);
    expect(flagged.stale).toEqual([null, null, null]);
  });

  it('A document that is not one of these edits is refused', async () => {
    await reshape([]);
    const file = join(root, '.bindweed', 'plans', 'reshape.json');
    const before = await readFile(file);
    const bad: unknown[] = [
      { kind: 'fold', file: 'src/app/save.ts' },
      { kind: 'create-package', path: 'src/../ports' },
      { kind: 'rename-package', from: 'src/infra', to: 'lib/adapters' },
      { kind: 'rename-file', from: 'src/app/a.ts', to: 'src/app/b.ts' },
      { kind: 'merge-packages', packages: ['src/app'], into: 'src/app' },
      { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }] },
      { kind: 'fate', file: 'src/app/save.ts', fate: 'fold' },
      { kind: 'fate', file: 'src/app/save.ts', fate: 'delete', into: 'src/app/a.ts' },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/a.ts' },
    ];
    for (const edit of bad) {
      const res = await putDoc([edit]);
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({ error: 'bad plan' });
      expect(await readFile(file)).toEqual(before);
    }
  });

  it('The old routes still answer on this tree', async () => {
    const tree = z.object({ entries: z.array(z.object({ name: z.string() })) }).parse(await body('/api/tree'));
    expect(tree.entries.map(entry => entry.name)).toEqual(['notes', 'src', 'tsconfig.json']);
    expect(await body('/api/file?path=src/domain/shape.ts')).toEqual({ path: 'src/domain/shape.ts', text: 'export interface Shape { draw(): void }\n' });
    const src = loose.parse(await body('/api/graph?at=src'));
    expect(src).not.toHaveProperty('warnings');
    expect(src).not.toHaveProperty('stale');
    expect(idsOf(graphJson.parse(src).nodes)).toEqual(['src/app', 'src/infra', 'src/domain']);
    const top = loose.parse(await body('/api/graph'));
    expect(top).not.toHaveProperty('warnings');
    expect(graphJson.parse(top).nodes).toEqual([expect.objectContaining({ id: 'src', files: 7, a: '0.29' })]);
    const notes = await get('/api/graph?at=notes');
    expect(notes.status).toBe(404);
    expect(json(notes)).toEqual({ error: 'no such directory' });
    expect(loose.parse(await body('/api/detail?id=src/domain&at=src')).ca).toBe(3);
    expect(await body('/api/pairs?from=src/app&to=src/infra&at=src')).toEqual({
      pairs: [
        ['src/app/a.ts', 'src/infra/db.ts'],
        ['src/app/a.ts', 'src/infra/repo.ts'],
        ['src/app/b.ts', 'src/infra/db.ts'],
      ],
    });
    expect(await body('/api/pairs?from=src/infra&to=react&at=src&external=1')).toEqual({ pairs: [['src/infra/repo.ts', 'react']] });
    expect(await body('/api/layout')).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    const rescan = await hit(port, 'POST', '/api/rescan', bearer);
    expect(loose.parse(json(rescan)).files).toBe(8);
    expect(await body('/api/plans')).toEqual({ plans: [] });
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('An empty src/ports warns, and the move of shape.ts clears it', async () => {
    const plain = await graph('at=src');
    await reshape([CREATE_PORTS]);
    const created = await graph('at=src&plan=reshape');
    expect(created.stale).toEqual([null]);
    expect(created.warnings).toEqual([[{ kind: 'empty-package', path: 'src/ports' }]]);
    expect(nodeOf(created.nodes, 'src/ports')).toEqual({
      id: 'src/ports',
      kind: 'package',
      name: 'ports',
      path: 'src/ports',
      files: 0,
      row: 2,
      order: 1,
      cycle: false,
      ca: 0,
      ce: 0,
      i: '–',
      a: '0.00',
      d: '–',
    });
    expect(created.nodes.filter(node => node.id !== 'src/ports')).toEqual(plain.nodes);
    expect(created.edges).toEqual(plain.edges);
    await expect(stat(join(root, 'src/ports'))).rejects.toThrow();
    expect(await readFile(join(root, 'src/domain/shape.ts'), 'utf8')).toBe('export interface Shape { draw(): void }\n');
    await putDoc([CREATE_PORTS, MOVE_SHAPE]);
    const moved = await graph('at=src&plan=reshape');
    expect(moved.stale).toEqual([null, null]);
    expect(moved).not.toHaveProperty('warnings');
    expect(nodeOf(moved.nodes, 'src/domain')).toMatchObject({ files: 1, abstract: true, ca: 2, row: 2, order: 0 });
    expect(nodeOf(moved.nodes, 'src/ports')).toMatchObject({ files: 1, abstract: true, ca: 1, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy', row: 2, order: 1 });
    const toDomain = edgeOf(moved.edges, 'src/infra', 'src/domain');
    expect(toDomain).toMatchObject({ runtime: 1, type: 0 });
    expect(toDomain).not.toHaveProperty('heritage');
    expect(edgeOf(moved.edges, 'src/infra', 'src/ports')).toMatchObject({ runtime: 1, type: 0, heritage: 1 });
    const file = await get('/api/file?path=src/ports/shape.ts');
    expect(file.status).toBe(404);
    expect(json(file)).toEqual({ error: 'no such file' });
  });

  it('Renaming the empty package chains into the move', async () => {
    const rename: PlanEdit = { kind: 'rename-package', from: 'src/ports', to: 'src/hex' };
    await reshape([CREATE_PORTS, rename]);
    const renamed = await graph('at=src&plan=reshape');
    expect(renamed.stale).toEqual([null, null]);
    expect(renamed.warnings).toEqual([[{ kind: 'empty-package', path: 'src/hex' }], []]);
    expect(idsOf(renamed.nodes)).not.toContain('src/ports');
    expect(nodeOf(renamed.nodes, 'src/hex').files).toBe(0);
    const move: PlanEdit = { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/hex' };
    await putDoc([CREATE_PORTS, rename, move]);
    const moved = await graph('at=src&plan=reshape');
    expect(moved.stale).toEqual([null, null, null]);
    expect(moved).not.toHaveProperty('warnings');
    expect(nodeOf(moved.nodes, 'src/hex')).toMatchObject({ files: 1, abstract: true });
    expect([CREATE_PORTS, rename, move].map(sentenceOf)).toEqual(['Create package src/ports', 'Rename src/ports to src/hex', 'Move src/domain/shape.ts to src/hex']);
  });

  it('Splitting app hides it and warns about the new cycle', async () => {
    await reshape([CREATE_PORTS, MOVE_SHAPE, RENAME_INFRA, SPLIT_APP]);
    const src = await graph('at=src&plan=reshape');
    expect(idsOf(src.nodes)).not.toContain('src/app');
    expect(idsOf(src.nodes)).not.toContain('src/infra');
    expect(nodeOf(src.nodes, 'src/app/read')).toMatchObject({ files: 1, row: 0, order: 0, cycle: true, ca: 1, ce: 1, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' });
    expect(nodeOf(src.nodes, 'src/app/write')).toMatchObject({ files: 2, row: 0, order: 1, cycle: true });
    expect(nodeOf(src.nodes, 'src/adapters')).toMatchObject({ files: 2, row: 1, order: 0, cycle: false });
    expect(nodeOf(src.nodes, 'src/domain')).toMatchObject({ row: 2, order: 0 });
    expect(nodeOf(src.nodes, 'src/ports')).toMatchObject({ row: 2, order: 1 });
    expect(edgeOf(src.edges, 'src/app/read', 'src/app/write')).toMatchObject({ runtime: 1, cycle: true, cycleText: 'read → write → read' });
    expect(edgeOf(src.edges, 'src/app/write', 'src/app/read').cycleText).toBe('write → read → write');
    expect(src.warnings).toEqual(SPLIT_CYCLE);
    expect(sentenceOf(SPLIT_APP)).toBe('Split src/app into src/app/read (2 files) and src/app/write (2 files)');
    const app = await graph('at=src/app&plan=reshape');
    expect(idsOf(app.nodes)).toEqual(['src/app/read', 'src/app/write']);
    expect(app.warnings).toEqual(SPLIT_CYCLE);
    const top = await graph('plan=reshape');
    expect(idsOf(top.nodes)).toEqual(['src']);
    expect(nodeOf(top.nodes, 'src').files).toBe(7);
    expect(top.edges).toEqual([]);
    expect(top.warnings).toEqual(SPLIT_CYCLE);
    expect(top.stale).toEqual([null, null, null, null]);
    const plain = loose.parse(await body('/api/graph?at=src'));
    expect(idsOf(graphJson.parse(plain).nodes)).toEqual(['src/app', 'src/infra', 'src/domain']);
    expect(plain).not.toHaveProperty('stale');
  });

  it('A split part that stays empty is drawn and warns', async () => {
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts'] },
        { name: 'spare', files: [] },
      ],
    };
    await reshape([split]);
    const src = await graph('at=src&plan=reshape');
    expect(src.stale).toEqual([null]);
    expect(src.warnings).toEqual([[{ kind: 'empty-package', path: 'src/app/spare' }]]);
    expect(idsOf(src.nodes)).not.toContain('src/app');
    expect(nodeOf(src.nodes, 'src/app/read')).toMatchObject({ files: 3, row: 0, order: 0, ca: 0, ce: 2, i: '1.00', zone: 'healthy' });
    const spare = nodeOf(src.nodes, 'src/app/spare');
    expect(spare).toMatchObject({ files: 0, row: 2, order: 1, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' });
    expect(spare).not.toHaveProperty('zone');
    expect(spare).not.toHaveProperty('abstract');
    expect(nodeOf(src.nodes, 'src/domain')).toMatchObject({ row: 2, order: 0 });
    expect(sentenceOf(split)).toBe('Split src/app into src/app/read (4 files) and src/app/spare (0 files)');
  });

  it('Merging read and write into read keeps read and drops write', async () => {
    const merge: PlanEdit = { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app/read' };
    await reshape([SPLIT_APP, merge]);
    const src = await graph('at=src&plan=reshape');
    expect(src.stale).toEqual([null, null]);
    expect(src).not.toHaveProperty('warnings');
    expect(idsOf(src.nodes)).toEqual(['src/app/read', 'src/infra', 'src/domain']);
    const read = nodeOf(src.nodes, 'src/app/read');
    expect(read).toMatchObject({ files: 3, row: 0, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' });
    expect(read).not.toHaveProperty('abstract');
    expect(nodeOf(src.nodes, 'src/infra')).toMatchObject({ files: 2, row: 1, order: 0, cycle: false, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' });
    expect(nodeOf(src.nodes, 'src/domain')).toMatchObject({ files: 2, abstract: true, row: 2, order: 0, cycle: false, ca: 3, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy' });
    expect(src.edges).toEqual([
      { from: 'src/app/read', to: 'src/domain', runtime: 0, type: 1, cycle: false },
      { from: 'src/app/read', to: 'src/infra', runtime: 2, type: 1, cycle: false },
      { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
    ]);
    expect([SPLIT_APP, merge].map(sentenceOf)).toEqual([
      'Split src/app into src/app/read (2 files) and src/app/write (2 files)',
      'Merge src/app/read and src/app/write into src/app/read',
    ]);
    const read2 = await graph('at=src/app/read&plan=reshape');
    expect(idsOf(read2.nodes)).toEqual(['src/app/read/a.ts', 'src/app/read/b.ts', 'src/app/read/save.ts']);
    expect(nodeOf(read2.nodes, 'src/app/read/a.ts').cycle).toBe(true);
    expect(nodeOf(read2.nodes, 'src/app/read/b.ts').cycle).toBe(true);
    expect(read2.stale).toEqual([null, null]);
    expect(read2).not.toHaveProperty('warnings');
    const doc = loose.parse(await body('/api/plans/reshape'));
    expect(doc.edits).toEqual([SPLIT_APP, merge]);
    expect(doc).not.toHaveProperty('warnings');
    expect(doc).not.toHaveProperty('stale');
  });

  it('Merge, delete and fold leave one warning and move the arrow', async () => {
    await reshape(SEVEN);
    const src = await graph('at=src&plan=reshape');
    expect(src.stale).toEqual([null, null, null, null, null, null, null]);
    expect(src.warnings).toEqual([[], [], [], [], [], [DELETE_WARNING], []]);
    expect(idsOf(src.nodes)).toEqual(['src/app', 'src/adapters', 'src/domain', 'src/ports']);
    expect(nodeOf(src.nodes, 'src/app')).toMatchObject({ files: 3, row: 0 });
    expect(nodeOf(src.nodes, 'src/adapters')).toMatchObject({ files: 1, ca: 2, ce: 1, i: '0.33', a: '0.00', d: '0.67', zone: 'pain', row: 1 });
    expect(nodeOf(src.nodes, 'src/domain')).toMatchObject({ files: 1, abstract: true, ca: 2, row: 2, order: 0 });
    expect(nodeOf(src.nodes, 'src/ports')).toMatchObject({ files: 1, abstract: true, ca: 1, row: 2, order: 1 });
    expect(edgePairsOf(src.edges)).toEqual(['src/adapters>src/domain', 'src/app>src/adapters', 'src/app>src/domain', 'src/app>src/ports']);
    expect(edgeOf(src.edges, 'src/adapters', 'src/domain')).toMatchObject({ runtime: 1 });
    expect(edgeOf(src.edges, 'src/app', 'src/adapters')).toMatchObject({ runtime: 2, type: 0 });
    expect(edgeOf(src.edges, 'src/app', 'src/domain')).toMatchObject({ runtime: 0, type: 1 });
    expect(edgeOf(src.edges, 'src/app', 'src/ports')).toMatchObject({ runtime: 0, type: 1 });
    expect(src.edges.map(edge => edge.cycle)).toEqual([false, false, false, false]);
    expect(SEVEN.slice(4).map(sentenceOf)).toEqual([
      'Merge src/app/read and src/app/write into src/app',
      'Delete src/domain/model.ts',
      'Fold src/adapters/repo.ts into src/ports/shape.ts',
    ]);
    const detail = loose.parse(await body('/api/detail?id=src/ports/shape.ts&at=src/ports&plan=reshape'));
    expect(detail.importedBy).toEqual([{ id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 }]);
    expect(await body('/api/pairs?from=src/ports&to=react&at=src&external=1&plan=reshape')).toEqual({ pairs: [['src/ports/shape.ts', 'react']] });
    expect(await body('/api/pairs?from=src/adapters&to=react&at=src&external=1&plan=reshape')).toEqual({ pairs: [] });
    expect(await body('/api/pairs?from=src/infra&to=react&at=src&external=1')).toEqual({ pairs: [['src/infra/repo.ts', 'react']] });
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect((await stat(join(root, 'src/infra/repo.ts'))).isFile()).toBe(true);
    const deleted = await graph('at=src/domain&plan=reshape');
    expect(nodeOf(deleted.nodes, 'src/domain/model.ts').fate).toBe('delete');
  });

  it('Deleting a file nothing imports does not warn', async () => {
    await reshape([{ kind: 'fate', file: 'src/app/save.ts', fate: 'delete' }]);
    const src = await graph('at=src&plan=reshape');
    expect(src.stale).toEqual([null]);
    expect(src).not.toHaveProperty('warnings');
    expect(nodeOf(src.nodes, 'src/app').files).toBe(3);
  });

  it('Each new kind gives its reason when it no longer applies', async () => {
    const rows: [PlanEdit, string][] = [
      [MOVE_SHAPE, 'no such directory src/ports'],
      [{ kind: 'create-package', path: 'src/infra' }, 'src/infra already exists'],
      [{ kind: 'create-package', path: 'lib/ports' }, 'no such directory lib'],
      [{ kind: 'rename-package', from: 'src/io', to: 'src/net' }, 'no such directory src/io'],
      [{ kind: 'rename-package', from: 'src/infra', to: 'src/domain' }, 'src/domain already exists'],
      [{ kind: 'rename-file', from: 'src/app/save.ts', to: 'b.ts' }, 'src/app/b.ts already exists'],
      [MERGE_BACK, 'no such directory src/app/read'],
      [{ kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/domain' }, 'src/domain already exists'],
      [
        {
          kind: 'split-package',
          package: 'src/app',
          parts: [
            { name: 'read', files: ['src/infra/db.ts'] },
            { name: 'write', files: [] },
          ],
        },
        'no such file src/infra/db.ts',
      ],
      [{ kind: 'fate', file: 'src/app/gone.ts', fate: 'delete' }, 'no such file src/app/gone.ts'],
      [{ kind: 'fate', file: 'src/app/save.ts', fate: 'fold', into: 'src/app/gone.ts' }, 'no such file src/app/gone.ts'],
    ];
    const plain = loose.parse(await body('/api/graph?at=src'));
    await reshape([]);
    for (const [edit, reason] of rows) {
      await putDoc([edit]);
      const raw = await body('/api/graph?at=src&plan=reshape');
      expect(graphJson.parse(raw).stale).toEqual([reason]);
      expect(raw).not.toHaveProperty('warnings');
      expect(withoutKey(raw, 'stale')).toEqual(plain);
    }
  });

  it('Removing the split stales the merge, and a fold that follows a removed rename is stale', async () => {
    await reshape(SEVEN);
    await putDoc(SEVEN.filter(edit => edit !== SPLIT_APP));
    const noSplit = await graph('at=src&plan=reshape');
    expect(noSplit.stale).toEqual([null, null, null, 'no such directory src/app/read', null, null]);
    expect(noSplit.warnings).toEqual([[], [], [], [], [DELETE_WARNING], []]);
    expect(nodeOf(noSplit.nodes, 'src/app').files).toBe(3);
    expect(idsOf(noSplit.nodes)).not.toContain('src/app/read');
    await putDoc(SEVEN.filter(edit => edit !== SPLIT_APP && edit !== RENAME_INFRA));
    const noRename = await graph('at=src&plan=reshape');
    expect(noRename.stale).toEqual([null, null, 'no such directory src/app/read', null, 'no such file src/adapters/repo.ts']);
    const doc = loose.parse(await body('/api/plans/reshape'));
    expect(doc.edits).toEqual([CREATE_PORTS, MOVE_SHAPE, MERGE_BACK, DELETE_MODEL, FOLD_REPO]);
    expect(doc).not.toHaveProperty('stale');
  });
});
