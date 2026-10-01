import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20480 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);

const LAYERED: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}',
  'notes/readme.md': '# notes\n',
  'src/app/a.ts':
    "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n",
  'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  'src/app/a.test.ts': "import { a } from './a';\n",
  'src/domain/model.ts': 'export interface Model { id: number }\n',
  'src/domain/shape.ts': 'export interface Shape { draw(): void }\n',
  'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
  'src/infra/repo.ts':
    "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n",
};

const KINDS: Record<string, string> = {
  'named/shape.ts': 'export interface Shape { draw(): void }\n',
  'named/repo.ts': "import { Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n",
  'default/shape.ts': 'export default class Shape { draw(): void { return; } }\n',
  'default/repo.ts': "import Shape from './shape';\nexport class Repo extends Shape { draw(): void { return; } }\n",
  'ns/shape.ts': 'export class Shape { draw(): void { return; } }\n',
  'ns/repo.ts': "import * as ns from './shape';\nexport class Repo implements ns.Shape { draw(): void { return; } }\n",
  'iface/shape.ts': 'export interface Shape { draw(): void }\n',
  'iface/box.ts': "import { Shape } from './shape';\nexport interface Box extends Shape { draw(): void }\n",
  'alias/shape.ts': 'export interface Shape { draw(): void }\n',
  'alias/repo.ts': "import { Shape as S } from './shape';\nexport class Repo implements S { draw(): void { return; } }\n",
  'inline/shape.ts': 'export interface Shape { draw(): void }\n',
  'inline/repo.ts': "import { type Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n",
  'typed/shape.ts': 'export interface Shape { draw(): void }\n',
  'typed/repo.ts': "import type { Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n",
  'twice/shape.ts': 'export class Shape { id = 0; }\n',
  'twice/repo.ts': "import { Shape } from './shape';\nexport class A extends Shape { id = 1; }\nexport class B extends Shape { id = 2; }\n",
  'pair/a.ts': 'export interface A { a: number }\n',
  'pair/b.ts': 'export interface B { b: number }\n',
  'pair/repo.ts': "import { A } from './a';\nimport { B } from './b';\nexport class Repo implements A, B { a = 0; b = 0; }\n",
  'local/repo.ts': 'export class Base { id = 0; }\nexport class Repo extends Base { id = 1; }\n',
  'loose/repo.ts': 'export class Repo implements Unknown { id = 0; }\n',
  'pure/iface.ts': 'export interface I { n: number }\n',
  'pure/alias.ts': 'export type Id = string;\n',
  'pure/door.ts': 'export abstract class Door { abstract open(): void }\n',
  'pure/decl.ts': 'declare function ready(): void;\n',
  'pure/reexp.ts': "export type { Id } from './alias';\n",
  'pure/onlyimport.ts': "import type { Id } from './alias';\n",
  'mixed/iface.ts': 'export interface I { n: number }\n',
  'mixed/value.ts': 'export class Model { id = 0; }\n',
  'other/ns.ts': 'export namespace Bag { export type Id = string; }\n',
  'other/empty.ts': '\n',
  'other/both.ts': 'export interface I { n: number }\nexport const n = 1;\n',
  'other/valuereexp.ts': "export { n } from './both';\n",
  'other/valueimport.ts': "import { n } from './both';\n",
  'deep/shape.ts': 'export class Shape { draw(): void { return; } }\n',
  'deep/repo.ts': "import * as ns from './shape';\nexport class Repo implements ns.Shape.Extra { draw(): void { return; } }\n",
  'cyc/a.ts': "import type { B } from './b';\nexport interface A { b: B }\n",
  'cyc/b.ts': "import type { A } from './a';\nexport interface B { a: A }\n",
  'half/iface.ts': 'export interface I { n: number }\n',
  'half/value.test.ts': 'export const n = 1;\n',
  'half/value.spec.ts': 'export const n = 1;\n',
  'half/__tests__/n.ts': 'export const n = 1;\n',
};

type Bound = { server: Server; port: number; token: string; root: string };
type Hit = { status: number; body: Buffer };
type Node = {
  id: string;
  kind: string;
  name: string;
  path: string;
  files?: number;
  row: number;
  order?: number;
  cycle?: boolean;
  abstract?: true;
  test?: true;
  ca?: number;
  ce?: number;
  i?: string;
  a?: string;
  d?: string;
  zone?: string;
  crap?: number | string;
  coverage?: string;
  mutants?: number;
};
type Edge = { from: string; to: string; runtime: number; type: number; heritage?: number; cycle: boolean; cycleText?: string };
type View = { at: string; crumbs: { name: string; at: string }[]; nodes: Node[]; edges: Edge[]; crapMax: number; coverage: string; mutation: string };
type Entry = { id: string; name: string; kind: string; runtime: number; type: number; heritage: number };
type Detail = { imports: Entry[]; importedBy: Entry[] };

const SRC: View = {
  at: 'src',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
  ],
  nodes: [
    {
      id: 'src/app',
      kind: 'package',
      name: 'app',
      path: 'src/app',
      files: 2,
      row: 0,
      order: 0,
      cycle: false,
      ca: 0,
      ce: 2,
      i: '1.00',
      a: '0.00',
      d: '0.00',
      zone: 'healthy',
    },
    {
      id: 'src/infra',
      kind: 'package',
      name: 'infra',
      path: 'src/infra',
      files: 2,
      row: 1,
      order: 0,
      cycle: false,
      ca: 2,
      ce: 2,
      i: '0.50',
      a: '0.00',
      d: '0.50',
      zone: 'healthy',
    },
    {
      id: 'src/domain',
      kind: 'package',
      name: 'domain',
      path: 'src/domain',
      files: 2,
      row: 2,
      order: 0,
      cycle: false,
      abstract: true,
      ca: 3,
      ce: 0,
      i: '0.00',
      a: '1.00',
      d: '0.00',
      zone: 'healthy',
    },
  ],
  edges: [
    { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: false },
    { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
    { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
  ],
  crapMax: 4,
  coverage: 'off',
  mutation: 'off',
} as View;

const APP: View = {
  at: 'src/app',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
    { name: 'app', at: 'src/app' },
  ],
  nodes: [
    { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true, ca: 1, ce: 4, i: '0.80', a: '0.00', d: '0.20' },
    { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true, ca: 1, ce: 2, i: '0.67', a: '0.00', d: '0.33' },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
  ],
  crapMax: 4,
  coverage: 'off',
  mutation: 'off',
} as View;

const INFRA: Detail = {
  imports: [{ id: 'src/domain', name: 'domain', kind: 'package', runtime: 2, type: 0, heritage: 1 }],
  importedBy: [{ id: 'src/app', name: 'app', kind: 'package', runtime: 2, type: 1, heritage: 0 }],
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function gitRepo(name: string, files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-edge-')), name);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
  await prepareBindweed(root);
  return root;
}

async function boundOn(root: string, port: number): Promise<Bound> {
  const result = await bindApp({ repoRoot: root, uiDir: '/nowhere' }, { mode: 'fixed', port });
  if ('error' in result) throw new Error(listenErrorMessage(result.error));
  return { ...result, root };
}

function hit(port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(4000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    if (body === undefined) req.end();
    else req.end(body);
  });
}

function parsed(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

function textOrder(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => textOrder(key(a), key(b)));
}

function normView(view: View): View {
  return { ...view, nodes: sortBy(view.nodes, node => node.id), edges: sortBy(view.edges, edge => `${edge.from} ${edge.to}`) };
}

function normDetail<T extends Detail>(detail: T): T {
  return { ...detail, imports: sortBy(detail.imports, entry => entry.id), importedBy: sortBy(detail.importedBy, entry => entry.id) };
}

function layoutPath(root: string): string {
  return join(root, '.bindweed', 'layout.json');
}

async function shut(server: Server): Promise<void> {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
}

describe('edge kinds over HTTP', () => {
  let layered: Bound;
  let kinds: Bound;
  let auth: Record<string, string> = {};
  let kindAuth: Record<string, string> = {};

  beforeAll(async () => {
    layered = await boundOn(await gitRepo('layered', LAYERED), PORT_BASE);
    kinds = await boundOn(await gitRepo('kinds', KINDS), PORT_BASE + 1);
    auth = { Authorization: `Bearer ${layered.token}` };
    kindAuth = { Authorization: `Bearer ${kinds.token}` };
  });

  afterAll(async () => {
    await shut(layered.server);
    await shut(kinds.server);
    await rm(dirname(layered.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(dirname(kinds.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function graph(path: string, app: Bound = layered, headers = auth): Promise<View> {
    const res = await hit(app.port, 'GET', path, headers);
    expect(res.status).toBe(200);
    return parsed(res) as View;
  }

  async function detail(path: string, app: Bound = layered, headers = auth): Promise<Detail & Record<string, unknown>> {
    const res = await hit(app.port, 'GET', path, headers);
    expect(res.status).toBe(200);
    return parsed(res) as Detail & Record<string, unknown>;
  }

  it('The src view has three layers, one hollow count and one green box', async () => {
    const view = await graph('/api/graph?at=src');
    expect(normView(view)).toEqual(normView(SRC));
    expect(view.edges).toEqual([
      { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
      { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: false },
      { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
    ]);
    for (const item of view.nodes) {
      expect(item.crap).toBeUndefined();
      expect(item.coverage).toBeUndefined();
      expect(item.mutants).toBeUndefined();
    }
    expect(view.coverage).toBe('off');
    expect(view.mutation).toBe('off');
  });

  it('The root counts the six non-test files and draws nothing else', async () => {
    expect(await graph('/api/graph')).toEqual({
      at: '',
      crumbs: [{ name: 'layered', at: '' }],
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 6, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.33', d: '–' }],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('The app view is still the 002 cycle and the test file is absent', async () => {
    expect(normView(await graph('/api/graph?at=src/app'))).toEqual(normView(APP));
  });

  it('Both files in domain are abstract', async () => {
    expect(await graph('/api/graph?at=src/domain')).toEqual({
      at: 'src/domain',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
        { name: 'domain', at: 'src/domain' },
      ],
      nodes: [
        {
          id: 'src/domain/model.ts',
          kind: 'file',
          name: 'model.ts',
          path: 'src/domain/model.ts',
          row: 0,
          order: 0,
          cycle: false,
          abstract: true,
          ca: 2,
          ce: 0,
          i: '0.00',
          a: '1.00',
          d: '0.00',
        },
        {
          id: 'src/domain/shape.ts',
          kind: 'file',
          name: 'shape.ts',
          path: 'src/domain/shape.ts',
          row: 0,
          order: 1,
          cycle: false,
          abstract: true,
          ca: 1,
          ce: 0,
          i: '0.00',
          a: '1.00',
          d: '0.00',
        },
      ],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('Turning tests on puts a.test.ts above the cycle and counts it in app', async () => {
    const app = await graph('/api/graph?at=src/app&tests=1');
    expect(normView(app)).toEqual(
      normView({
        ...APP,
        nodes: [
          { id: 'src/app/a.test.ts', kind: 'file', name: 'a.test.ts', path: 'src/app/a.test.ts', row: 0, order: 0, cycle: false, test: true, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' },
          { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 1, order: 0, cycle: true, ca: 1, ce: 4, i: '0.80', a: '0.00', d: '0.20' },
          { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 1, order: 1, cycle: true, ca: 1, ce: 2, i: '0.67', a: '0.00', d: '0.33' },
        ],
        edges: [{ from: 'src/app/a.test.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: false }, ...APP.edges],
      } as View),
    );
    const src = await graph('/api/graph?at=src&tests=1');
    expect(src.nodes.find(node => node.id === 'src/app')).toMatchObject({ files: 3, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' });
    expect(src.nodes.find(node => node.id === 'src/domain')).toMatchObject({ ca: 3, ce: 0 });
    expect(src.nodes.map(node => node.name)).not.toEqual(expect.arrayContaining(['a.test.ts', 'node:fs', 'react']));
    expect(await detail('/api/detail?id=src/app&at=src&tests=1')).toMatchObject({ files: 3, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' });
    expect((await graph('/api/graph?at=src/app&tests=1')).nodes.find(node => node.id === 'src/app/a.ts')).toMatchObject({ ca: 1, ce: 4, i: '0.80', a: '0.00', d: '0.20' });
  });

  it('Turning externals on adds node:fs and react on one row under the layers', async () => {
    const src = await graph('/api/graph?at=src&external=1');
    expect(sortBy(src.nodes, node => node.id).map(node => node.id)).toEqual(['node:fs', 'react', 'src/app', 'src/domain', 'src/infra']);
    expect(src.nodes.find(node => node.id === 'src/app')).toMatchObject({ files: 2, row: 0 });
    expect(src.nodes.find(node => node.id === 'src/infra')).toMatchObject({ files: 2, row: 1, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' });
    expect(src.nodes.find(node => node.id === 'src/domain')).toMatchObject({ files: 2, row: 2, abstract: true });
    expect(normView(src).edges).toEqual(
      normView({
        ...SRC,
        edges: [
          ...SRC.edges,
          { from: 'src/infra', to: 'node:fs', runtime: 1, type: 0, cycle: false },
          { from: 'src/infra', to: 'react', runtime: 1, type: 0, cycle: false },
        ],
      } as View).edges,
    );
    expect(src.nodes.find(node => node.id === 'node:fs')).toEqual({ id: 'node:fs', kind: 'external', name: 'node:fs', path: 'node:fs', row: 3, order: 0, cycle: false });
    expect(await detail('/api/detail?id=node:fs&at=src&external=1')).toEqual({
      id: 'node:fs',
      name: 'node:fs',
      path: 'node:fs',
      kind: 'external',
      imports: [],
      importedBy: [{ id: 'src/infra', name: 'infra', kind: 'package', runtime: 1, type: 0, heritage: 0 }],
    });
    expect(src.nodes.find(node => node.id === 'react')).toEqual({ id: 'react', kind: 'external', name: 'react', path: 'react', row: 3, order: 1, cycle: false });
    const infra = await graph('/api/graph?at=src/infra&external=1');
    expect(infra.nodes.find(node => node.name === 'db.ts')?.row).toBe(0);
    expect(infra.nodes.find(node => node.name === 'repo.ts')?.row).toBe(0);
    expect(infra.nodes.find(node => node.id === 'node:fs')).toMatchObject({ row: 1, order: 0 });
    expect(infra.nodes.find(node => node.id === 'react')).toMatchObject({ row: 1, order: 1 });
    expect(sortBy(infra.edges, edge => edge.to)).toEqual([
      { from: 'src/infra/repo.ts', to: 'node:fs', runtime: 1, type: 0, cycle: false },
      { from: 'src/infra/repo.ts', to: 'react', runtime: 1, type: 0, cycle: false },
    ]);
  });

  it('tests=1 and external=1 together keep the test count and both externals', async () => {
    const src = await graph('/api/graph?at=src&tests=1&external=1');
    expect(src.nodes.map(node => node.id).sort()).toEqual(['node:fs', 'react', 'src/app', 'src/domain', 'src/infra']);
    expect(src.nodes.find(node => node.id === 'src/app')).toMatchObject({ files: 3, row: 0, order: 0 });
    expect(src.nodes.find(node => node.id === 'src/infra')).toMatchObject({ files: 2, row: 1 });
    expect(src.nodes.find(node => node.id === 'src/domain')).toMatchObject({ files: 2, row: 2, abstract: true });
    expect(src.nodes.find(node => node.id === 'node:fs')).toMatchObject({ row: 3, order: 0, kind: 'external' });
    expect(src.nodes.find(node => node.id === 'react')).toMatchObject({ row: 3, order: 1, kind: 'external' });
    expect(src.nodes.map(node => node.name)).not.toContain('a.test.ts');
    const app = await graph('/api/graph?at=src/app&tests=1&external=1');
    expect(app.nodes.map(node => node.id).sort()).toEqual(['src/app/a.test.ts', 'src/app/a.ts', 'src/app/b.ts']);
    expect(app.nodes.find(node => node.name === 'a.test.ts')?.test).toBe(true);
    expect(normView(app).edges).toEqual(
      normView({ ...APP, edges: [{ from: 'src/app/a.test.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: false }, ...APP.edges] } as View).edges,
    );
    const infra = await detail('/api/detail?id=src/infra&at=src&tests=1&external=1');
    expect(infra.files).toBe(2);
    expect(infra.abstract).toBeUndefined();
    expect(sortBy(infra.imports, entry => entry.id)).toEqual([
      { id: 'node:fs', name: 'node:fs', kind: 'external', runtime: 1, type: 0, heritage: 0 },
      { id: 'react', name: 'react', kind: 'external', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/domain', name: 'domain', kind: 'package', runtime: 2, type: 0, heritage: 1 },
    ]);
    expect(infra.importedBy).toEqual([{ id: 'src/app', name: 'app', kind: 'package', runtime: 2, type: 1, heritage: 0 }]);
    const file = await detail('/api/detail?id=src/app/a.ts&at=src/app&tests=1&external=1');
    expect(file.files).toBeUndefined();
    expect(file.abstract).toBeUndefined();
    expect(sortBy(file.importedBy, entry => entry.id)).toEqual([
      { id: 'src/app/a.test.ts', name: 'a.test.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    ]);
    expect(sortBy(file.imports, entry => entry.id)).toEqual([
      { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/domain/model.ts', name: 'model.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
      { id: 'src/infra/db.ts', name: 'db.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/infra/repo.ts', name: 'repo.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
    ]);
  });

  it('Rescan counts the test file', async () => {
    const res = await hit(layered.port, 'POST', '/api/rescan', auth);
    const body = parsed(res) as { files: number; ms: number };
    expect(res.status).toBe(200);
    expect(body.files).toBe(7);
    expect(typeof body.ms).toBe('number');
  });

  it('One folder records the heritage of its import', async () => {
    const rows = [
      ['named', 'named/repo.ts', 'named/shape.ts', 1, 0, 1, 1],
      ['default', 'default/repo.ts', 'default/shape.ts', 1, 0, 1, 1],
      ['ns', 'ns/repo.ts', 'ns/shape.ts', 1, 0, 1, 1],
      ['iface', 'iface/box.ts', 'iface/shape.ts', 1, 0, 1, 1],
      ['alias', 'alias/repo.ts', 'alias/shape.ts', 1, 0, 1, 1],
      ['inline', 'inline/repo.ts', 'inline/shape.ts', 0, 1, 1, 1],
      ['typed', 'typed/repo.ts', 'typed/shape.ts', 0, 1, 1, 1],
      ['twice', 'twice/repo.ts', 'twice/shape.ts', 1, 0, 2, 1],
      ['local', '', '', 0, 0, 0, 0],
      ['loose', '', '', 0, 0, 0, 0],
    ] as const;
    for (const [at, from, to, runtime, type, heritage, n] of rows) {
      const view = await graph(`/api/graph?at=${at}`, kinds, kindAuth);
      expect(view.edges).toHaveLength(n);
      if (n === 1) expect(view.edges[0]).toEqual({ from, to, runtime, type, heritage, cycle: false });
    }
  });

  it('implements A, B is two heritage edges', async () => {
    const view = await graph('/api/graph?at=pair', kinds, kindAuth);
    expect(sortBy(view.edges, edge => edge.to)).toEqual([
      { from: 'pair/repo.ts', to: 'pair/a.ts', runtime: 1, type: 0, heritage: 1, cycle: false },
      { from: 'pair/repo.ts', to: 'pair/b.ts', runtime: 1, type: 0, heritage: 1, cycle: false },
    ]);
  });

  it('A deeper dotted name such as ns.Shape.Extra makes no heritage edge', async () => {
    const view = await graph('/api/graph?at=deep', kinds, kindAuth);
    expect(view.edges).toEqual([{ from: 'deep/repo.ts', to: 'deep/shape.ts', runtime: 1, type: 0, cycle: false }]);
  });

  it("The file's box is abstract only in the yes rows", async () => {
    const rows = [
      ['pure', 'iface.ts', true],
      ['pure', 'alias.ts', true],
      ['pure', 'door.ts', true],
      ['pure', 'decl.ts', true],
      ['pure', 'reexp.ts', true],
      ['pure', 'onlyimport.ts', true],
      ['mixed', 'iface.ts', true],
      ['mixed', 'value.ts', false],
      ['other', 'ns.ts', false],
      ['other', 'empty.ts', false],
      ['other', 'both.ts', false],
      ['other', 'valuereexp.ts', false],
      ['other', 'valueimport.ts', false],
    ] as const;
    for (const [at, name, yes] of rows) {
      const view = await graph(`/api/graph?at=${at}`, kinds, kindAuth);
      const node = view.nodes.find(item => item.name === name);
      expect(node).toBeDefined();
      expect(node?.abstract).toBe(yes ? true : undefined);
    }
  });

  it('A package is green only when all of its files are abstract', async () => {
    const view = await graph('/api/graph', kinds, kindAuth);
    expect(view.nodes.find(node => node.name === 'pure')).toMatchObject({ abstract: true, files: 6 });
    expect(view.nodes.find(node => node.name === 'cyc')).toMatchObject({ abstract: true, cycle: false });
    expect(view.nodes.find(node => node.name === 'mixed')?.abstract).toBeUndefined();
    expect(view.nodes.find(node => node.name === 'other')?.abstract).toBeUndefined();
  });

  it('Value test and spec files count against abstract only while tests=1', async () => {
    const closed = await graph('/api/graph', kinds, kindAuth);
    expect(closed.nodes.find(node => node.name === 'half')).toMatchObject({ abstract: true, files: 1 });
    const folder = await graph('/api/graph?at=half', kinds, kindAuth);
    expect(folder.nodes.map(node => node.name)).toEqual(['iface.ts']);
    expect(folder.nodes[0]?.abstract).toBe(true);
    const open = await graph('/api/graph?tests=1', kinds, kindAuth);
    expect(open.nodes.find(node => node.name === 'half')).toMatchObject({ files: 4 });
    expect(open.nodes.find(node => node.name === 'half')?.abstract).toBeUndefined();
    expect(await graph('/api/graph?at=half&tests=1', kinds, kindAuth)).toEqual({
      at: 'half',
      crumbs: [
        { name: 'kinds', at: '' },
        { name: 'half', at: 'half' },
      ],
      nodes: [
        {
          id: 'half/__tests__',
          kind: 'package',
          name: '__tests__',
          path: 'half/__tests__',
          files: 1,
          row: 0,
          order: 0,
          cycle: false,
          ca: 0,
          ce: 0,
          i: '–',
          a: '0.00',
          d: '–',
        },
        {
          id: 'half/iface.ts',
          kind: 'file',
          name: 'iface.ts',
          path: 'half/iface.ts',
          row: 0,
          order: 1,
          cycle: false,
          abstract: true,
          ca: 0,
          ce: 0,
          i: '–',
          a: '1.00',
          d: '–',
        },
        { id: 'half/value.spec.ts', kind: 'file', name: 'value.spec.ts', path: 'half/value.spec.ts', row: 0, order: 2, cycle: false, test: true, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' },
        { id: 'half/value.test.ts', kind: 'file', name: 'value.test.ts', path: 'half/value.test.ts', row: 0, order: 3, cycle: false, test: true, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' },
      ],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
    const inside = await graph('/api/graph?at=half/__tests__&tests=1', kinds, kindAuth);
    expect(inside.nodes.map(node => node.name)).toEqual(['n.ts']);
    expect(inside.nodes[0]).toMatchObject({ test: true });
    expect(inside.nodes[0]?.abstract).toBeUndefined();
  });

  it('A missing layout reads as the default and writes nothing', async () => {
    await rm(layoutPath(layered.root), { force: true });
    const res = await hit(layered.port, 'GET', '/api/layout', auth);
    expect(res.status).toBe(200);
    expect(parsed(res)).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect(existsSync(layoutPath(layered.root))).toBe(false);
  });

  it('A saved pin is returned and a pin for a gone node is kept', async () => {
    const externalOn = {
      version: 1,
      views: { src: { 'src/domain': { x: 0, y: -400 }, 'src/gone': { x: 1, y: 2 } }, 'src/app': { 'src/app/a.ts': { x: 40, y: 10 } } },
      settings: { tests: false, external: true },
    };
    const put = await hit(layered.port, 'PUT', '/api/layout', auth, JSON.stringify(externalOn));
    expect(put.status).toBe(200);
    expect(parsed(put)).toEqual(externalOn);
    expect(parsed(await hit(layered.port, 'GET', '/api/layout', auth))).toEqual(externalOn);
    expect(JSON.parse(await readFile(layoutPath(layered.root), 'utf8'))).toEqual(externalOn);
    expect(normView(await graph('/api/graph?at=src'))).toEqual(normView(SRC));
    expect(normDetail(await detail('/api/detail?id=src/infra&at=src'))).toEqual({
      id: 'src/infra',
      name: 'infra',
      path: 'src/infra',
      kind: 'package',
      files: 2,
      ca: 2,
      ce: 2,
      i: '0.50',
      a: '0.00',
      d: '0.50',
      zone: 'healthy',
      ...normDetail(INFRA),
    });
    const testsOn = { ...externalOn, settings: { tests: true, external: false } };
    const second = await hit(layered.port, 'PUT', '/api/layout', auth, JSON.stringify(testsOn));
    expect(second.status).toBe(200);
    expect(parsed(await hit(layered.port, 'GET', '/api/layout', auth))).toEqual(testsOn);
    expect(normView(await graph('/api/graph?at=src'))).toEqual(normView(SRC));
    expect(normView(await graph('/api/graph?at=src/app'))).toEqual(normView(APP));
    const file = await detail('/api/detail?id=src/app/a.ts&at=src/app');
    expect(JSON.stringify(file)).not.toContain('a.test.ts');
    expect(sortBy(file.importedBy, entry => entry.id)).toEqual([{ id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }]);
  });

  it('A bad file is not rewritten, and a rejected PUT leaves a valid file', async () => {
    const path = layoutPath(layered.root);
    await writeFile(path, 'not json');
    const got = await hit(layered.port, 'GET', '/api/layout', auth);
    expect(got.status).toBe(200);
    expect(parsed(got)).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect(await readFile(path, 'utf8')).toBe('not json');
    const good = { version: 1, views: { src: { 'src/domain': { x: 3, y: 4 } } }, settings: { tests: true, external: false } };
    const put = await hit(layered.port, 'PUT', '/api/layout', auth, JSON.stringify(good));
    expect(put.status).toBe(200);
    expect(parsed(put)).toEqual(good);
    const kept = await readFile(path);
    expect(JSON.parse(kept.toString())).toEqual(good);
    const rejected = await hit(layered.port, 'PUT', '/api/layout', auth, 'not json');
    expect(rejected.status).toBe(400);
    expect(parsed(rejected)).toEqual({ error: 'bad layout' });
    expect(await readFile(path)).toEqual(kept);
  });

  it('leaves a json document that is not a layout where it was', async () => {
    const path = layoutPath(layered.root);
    const bytes = Buffer.from('{"version":2,"views":{},"settings":{"tests":false,"external":false}}');
    await writeFile(path, bytes);
    const got = await hit(layered.port, 'GET', '/api/layout', auth);
    expect(parsed(got)).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect(await readFile(path)).toEqual(bytes);
  });

  it('A layout that is not the document is refused', async () => {
    const path = layoutPath(layered.root);
    const bodies = [
      'not json',
      '{"version":2,"views":{},"settings":{"tests":false,"external":false}}',
      '{"version":1,"settings":{"tests":false,"external":false}}',
      '{"version":1,"views":{},"settings":{"tests":false}}',
      '{"version":1,"views":{"src":{"src/app":{"x":"no","y":0}}},"settings":{"tests":false,"external":false}}',
      '{"version":1,"views":{},"settings":{"tests":false,"external":false},"extra":1}',
    ];
    for (const body of bodies) {
      await rm(path, { force: true });
      const res = await hit(layered.port, 'PUT', '/api/layout', auth, body);
      expect(res.status).toBe(400);
      expect(parsed(res)).toEqual({ error: 'bad layout' });
      expect(existsSync(path)).toBe(false);
    }
  });

  it('The new routes keep the host and token checks, and the old routes still answer', async () => {
    const tree = parsed(await hit(layered.port, 'GET', '/api/tree', auth)) as { entries: { name: string }[] };
    expect(tree.entries.map(entry => entry.name)).toEqual(['notes', 'src', 'tsconfig.json']);
    const file = await hit(layered.port, 'GET', '/api/file?path=src/domain/model.ts', auth);
    expect(file.status).toBe(200);
    expect(parsed(file)).toEqual({ path: 'src/domain/model.ts', text: 'export interface Model { id: number }\n' });
    const notes = await hit(layered.port, 'GET', '/api/graph?at=notes', auth);
    expect(notes.status).toBe(404);
    expect(parsed(notes)).toEqual({ error: 'no such directory' });
    const missing = await hit(layered.port, 'GET', '/api/detail?id=missing&at=src', auth);
    expect(missing.status).toBe(404);
    expect(parsed(missing)).toEqual({ error: 'no such node' });
    const noId = await hit(layered.port, 'GET', '/api/detail?at=src', auth);
    expect(noId.status).toBe(404);
    expect(parsed(noId)).toEqual({ error: 'no such node' });
    const rootDetail = await detail('/api/detail?id=src');
    expect(rootDetail.files).toBe(6);
  });

  it('Host, token and method', async () => {
    const wrong = { Authorization: `Bearer ${'0'.repeat(32)}` };
    const missing = { error: 'missing or wrong token' };
    const host = { error: 'bad host' };
    const lost = { error: 'not found' };
    const cases = [
      ['GET', '/api/layout', {}, 401, missing],
      ['PUT', '/api/layout', {}, 401, missing],
      ['GET', '/api/detail?id=src', {}, 401, missing],
      ['GET', '/api/graph', {}, 401, missing],
      ['POST', '/api/rescan', {}, 401, missing],
      ['GET', `/api/layout?token=${layered.token}`, { Host: `evil.example:${layered.port}` }, 403, host],
      ['PUT', `/api/layout?token=${layered.token}`, { Host: `evil.example:${layered.port}` }, 403, host],
      ['GET', `/api/detail?token=${layered.token}`, { Host: `evil.example:${layered.port}` }, 403, host],
      ['POST', '/api/layout', auth, 404, lost],
      ['GET', '/api/rescan', auth, 404, lost],
      ['POST', '/api/graph', auth, 404, lost],
    ] as const;
    for (const [method, path, headers, status, body] of cases) {
      const res = await hit(layered.port, method, path, headers);
      expect(res.status).toBe(status);
      expect(parsed(res)).toEqual(body);
    }
    const denied = await hit(layered.port, 'GET', '/api/layout', wrong);
    expect(parsed(denied)).toEqual(missing);
    const page = await hit(layered.port, 'GET', '/', {});
    expect(page.status).toBe(401);
    expect(page.body.toString()).toBe('bindweed: use the link bindweed printed in the terminal');
  });

  it("infra's package lists domain and app", async () => {
    expect(normDetail(await detail('/api/detail?id=src/infra&at=src'))).toEqual({
      id: 'src/infra',
      name: 'infra',
      path: 'src/infra',
      kind: 'package',
      files: 2,
      ca: 2,
      ce: 2,
      i: '0.50',
      a: '0.00',
      d: '0.50',
      zone: 'healthy',
      ...normDetail(INFRA),
    });
  });

  it("domain's detail says abstract and lists both importers", async () => {
    const body = await detail('/api/detail?id=src/domain&at=src');
    expect(body.abstract).toBe(true);
    expect(body.files).toBe(2);
    expect(body.imports).toEqual([]);
    expect(sortBy(body.importedBy, entry => entry.id)).toEqual([
      { id: 'src/app', name: 'app', kind: 'package', runtime: 0, type: 1, heritage: 0 },
      { id: 'src/infra', name: 'infra', kind: 'package', runtime: 2, type: 0, heritage: 1 },
    ]);
  });

  it("a.ts lists the files outside the app view", async () => {
    const body = await detail('/api/detail?id=src/app/a.ts&at=src/app');
    expect(body.files).toBeUndefined();
    expect(body.abstract).toBeUndefined();
    expect(sortBy(body.imports, entry => entry.id)).toEqual([
      { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/domain/model.ts', name: 'model.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
      { id: 'src/infra/db.ts', name: 'db.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/infra/repo.ts', name: 'repo.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
    ]);
    expect(body.importedBy).toEqual([{ id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }]);
    for (const path of ['/api/detail?id=src/app/a.test.ts&at=src/app', '/api/detail?id=node:fs&at=src', '/api/detail?id=react&at=src']) {
      const res = await hit(layered.port, 'GET', path, auth);
      expect(res.status).toBe(404);
      expect(parsed(res)).toEqual({ error: 'no such node' });
    }
  });

  it('shape.ts and db.ts list files outside their own views', async () => {
    expect(await detail('/api/detail?id=src/domain/shape.ts&at=src/domain')).toEqual({
      id: 'src/domain/shape.ts',
      name: 'shape.ts',
      path: 'src/domain/shape.ts',
      kind: 'file',
      abstract: true,
      ca: 1,
      ce: 0,
      i: '0.00',
      a: '1.00',
      d: '0.00',
      hot: [],
      imports: [],
      importedBy: [{ id: 'src/infra/repo.ts', name: 'repo.ts', kind: 'file', runtime: 1, type: 0, heritage: 1 }],
    });
    expect(normDetail(await detail('/api/detail?id=src/infra/db.ts&at=src/infra'))).toEqual(
      normDetail({
        id: 'src/infra/db.ts',
        name: 'db.ts',
        path: 'src/infra/db.ts',
        kind: 'file',
        ca: 2,
        ce: 1,
        i: '0.33',
        a: '0.00',
        d: '0.67',
        hot: [],
        imports: [{ id: 'src/domain/model.ts', name: 'model.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
        importedBy: [
          { id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
          { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
        ],
      }),
    );
  });

  it('external=1 lists node:fs and react, and tests=1 lists a.test.ts', async () => {
    const infra = await detail('/api/detail?id=src/infra&at=src&external=1');
    expect(infra.files).toBe(2);
    expect(infra.abstract).toBeUndefined();
    expect(sortBy(infra.imports, entry => entry.id)).toEqual([
      { id: 'node:fs', name: 'node:fs', kind: 'external', runtime: 1, type: 0, heritage: 0 },
      { id: 'react', name: 'react', kind: 'external', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/domain', name: 'domain', kind: 'package', runtime: 2, type: 0, heritage: 1 },
    ]);
    expect(infra.importedBy).toEqual(INFRA.importedBy);
    const file = await detail('/api/detail?id=src/app/a.ts&at=src/app&tests=1');
    expect(file.files).toBeUndefined();
    expect(sortBy(file.importedBy, entry => entry.id)).toEqual([
      { id: 'src/app/a.test.ts', name: 'a.test.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
      { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    ]);
    expect(await detail('/api/detail?id=node:fs&at=src&external=1')).toEqual({
      id: 'node:fs',
      name: 'node:fs',
      path: 'node:fs',
      kind: 'external',
      imports: [],
      importedBy: [{ id: 'src/infra', name: 'infra', kind: 'package', runtime: 1, type: 0, heritage: 0 }],
    });
    expect(await detail('/api/detail?id=react&at=src&external=1')).toEqual({
      id: 'react',
      name: 'react',
      path: 'react',
      kind: 'external',
      imports: [],
      importedBy: [{ id: 'src/infra', name: 'infra', kind: 'package', runtime: 1, type: 0, heritage: 0 }],
    });
    expect(await detail('/api/detail?id=src/app/a.test.ts&at=src/app&tests=1')).toEqual({
      id: 'src/app/a.test.ts',
      name: 'a.test.ts',
      path: 'src/app/a.test.ts',
      kind: 'file',
      ca: 0,
      ce: 0,
      i: '–',
      a: '0.00',
      d: '–',
      hot: [],
      imports: [{ id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
      importedBy: [],
    });
  });

  it('A cycle of abstract files is drawn red, and the cycle tooltip stays the cycle text', async () => {
    const view = await graph('/api/graph?at=cyc', kinds, kindAuth);
    expect(view.nodes.map(node => node.name)).toEqual(['a.ts', 'b.ts']);
    for (const node of view.nodes) expect(node).toMatchObject({ abstract: true, cycle: true, row: 0 });
    expect(view.edges).toEqual([
      { from: 'cyc/a.ts', to: 'cyc/b.ts', runtime: 0, type: 1, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
      { from: 'cyc/b.ts', to: 'cyc/a.ts', runtime: 0, type: 1, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
    ]);
  });

  it('A type-only heritage arrow is dashed and hollow', async () => {
    const view = await graph('/api/graph?at=typed', kinds, kindAuth);
    expect(view.nodes.find(node => node.name === 'repo.ts')).toMatchObject({ row: 0, order: 0 });
    expect(view.nodes.find(node => node.name === 'repo.ts')?.abstract).toBeUndefined();
    expect(view.nodes.find(node => node.name === 'shape.ts')).toMatchObject({ row: 1, order: 0, abstract: true });
    expect(view.edges).toEqual([
      { from: 'typed/repo.ts', to: 'typed/shape.ts', runtime: 0, type: 1, heritage: 1, cycle: false },
    ]);
  });

  it('The pin survives a new page load, a rescan and a restart, and a token-less refresh still fails', async () => {
    const doc = {
      version: 1,
      views: { src: { 'src/domain': { x: 0, y: -400 } } },
      settings: { tests: false, external: false },
    };
    const put = await hit(layered.port, 'PUT', '/api/layout', auth, JSON.stringify(doc));
    expect(put.status).toBe(200);
    const rescan = await hit(layered.port, 'POST', '/api/rescan', auth);
    expect(rescan.status).toBe(200);
    expect(parsed(await hit(layered.port, 'GET', '/api/layout', auth))).toEqual(doc);
    const page = await hit(layered.port, 'GET', '/', {});
    expect(page.status).toBe(401);
    expect(page.body.toString()).toBe('bindweed: use the link bindweed printed in the terminal');
    const again = await boundOn(layered.root, PORT_BASE + 2);
    const headers = { Authorization: `Bearer ${again.token}` };
    expect(parsed(await hit(again.port, 'GET', '/api/layout', headers))).toEqual(doc);
    await shut(again.server);
  });

  it('A new box that would land on a pinned box steps right', async () => {
    const main = join(layered.root, 'src/main.ts');
    await writeFile(main, "import { a } from './app/a';\n");
    try {
      const rescan = await hit(layered.port, 'POST', '/api/rescan', auth);
      expect(rescan.status).toBe(200);
      expect(parsed(rescan)).toMatchObject({ files: 8 });
      const view = await graph('/api/graph?at=src');
      expect(view.nodes.find(node => node.name === 'main.ts')).toMatchObject({ row: 0, order: 0 });
      expect(view.nodes.find(node => node.name === 'app')).toMatchObject({ row: 1 });
      expect(view.nodes.find(node => node.name === 'infra')).toMatchObject({ row: 2 });
      expect(view.nodes.find(node => node.name === 'domain')).toMatchObject({ row: 3 });
    } finally {
      await rm(main, { force: true });
      const back = await hit(layered.port, 'POST', '/api/rescan', auth);
      expect(parsed(back)).toMatchObject({ files: 7 });
    }
  });
});
