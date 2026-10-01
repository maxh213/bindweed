import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { utimesSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20750 + 40 * (WORKER === undefined ? 0 : Number(WORKER) + 1);

const GREEN = 'export function keep(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n';
const AMBER = 'export function mid(n: number): number {\n  if (n > 0 && n < 10) return 1;\n  if (n < 0) return -1;\n  const spare = 0;\n  return spare;\n}\n';
const RED = 'export function bad(n: number): number {\n  if (n > 0 && n < 3) return 1;\n  if (n > 3 || n < 0) return 2;\n  if (n === 9) return 9;\n  return 0;\n}\n';

const HEALTHY: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{}}',
  'src/green.ts': GREEN,
  'src/amber.ts': AMBER,
  'src/red.ts': RED,
  'src/plain.ts': 'export const n = 1;\n',
  'src/clean.ts': 'export const n = 1;\n',
  'marestail.toml': '[ts]\ncrap_max = 4\n',
};

const COVERAGE = JSON.stringify({
  'src/green.ts': { statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 3 } }, 2: { start: { line: 4 } } }, s: { 0: 1, 1: 1, 2: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {} },
  'src/amber.ts': { statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 3 } }, 2: { start: { line: 4 } }, 3: { start: { line: 5 } } }, s: { 0: 1, 1: 0, 2: 1, 3: 0 }, fnMap: {}, f: {}, branchMap: {}, b: {} },
  'src/red.ts': { statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 3 } }, 2: { start: { line: 4 } }, 3: { start: { line: 5 } } }, s: { 0: 0, 1: 0, 2: 0, 3: 0 }, fnMap: {}, f: {}, branchMap: {}, b: {} },
  'src/plain.ts': { statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {} },
  'src/clean.ts': { statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {} },
});

const MUTATION = JSON.stringify({
  files: {
    'src/plain.ts': { mutants: [{ status: 'Survived' }, { status: 'NoCoverage' }, { status: 'Survived' }] },
    'src/clean.ts': { mutants: [{ status: 'Killed' }, { status: 'Timeout' }] },
    'src/green.ts': { mutants: [{ status: 'Killed' }] },
  },
});

const ZONES: Record<string, string> = {
  'src/pain/a.ts': 'export const a = 1;\n',
  'src/use/b.ts': 'export interface B { n: number }\n',
  'src/use/c.ts': "import type { B } from './b';\nimport type { D } from '../mid/d';\nexport type C = B | D;\n",
  'src/mid/d.ts': "import { a } from '../pain/a';\nexport const d = a;\nexport type D = typeof a;\n",
};

type Bound = { server: Server; port: number; token: string; root: string };
type Hit = { status: number; body: Buffer };
type Node = Record<string, unknown>;
type View = { at: string; crumbs: { name: string; at: string }[]; nodes: Node[]; edges: unknown[]; crapMax: number; coverage: string; mutation: string };
type Detail = Record<string, unknown>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function writeAt(root: string, path: string, text: string): Promise<string> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
  return full;
}

async function gitRepo(name: string, files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-health-')), name);
  for (const [path, text] of Object.entries(files)) await writeAt(root, path, text);
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

async function shut(server: Server): Promise<void> {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
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

function nodeOf(view: View, id: string): Node {
  const found = view.nodes.find(item => item.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

function stamp(full: string, seconds: number): void {
  utimesSync(full, seconds, seconds);
}

async function stampSources(root: string, seconds: number): Promise<void> {
  for (const name of ['green.ts', 'amber.ts', 'red.ts', 'plain.ts', 'clean.ts']) stamp(join(root, 'src', name), seconds);
}

async function tracked(root: string): Promise<string> {
  return git(root, 'status', '--porcelain');
}

describe('health reports over HTTP', () => {
  let app: Bound;
  let auth: Record<string, string> = {};
  const kept: Bound[] = [];

  beforeAll(async () => {
    const root = await gitRepo('healthy', HEALTHY);
    const coverage = await writeAt(root, '.marestail/ts-coverage/coverage-final.json', COVERAGE);
    const mutation = await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    await stampSources(root, 1_000);
    stamp(coverage, 2_000);
    stamp(mutation, 2_000);
    app = await boundOn(root, PORT_BASE);
    auth = { Authorization: `Bearer ${app.token}` };
  });

  afterAll(async () => {
    await shut(app.server);
    for (const extra of kept) await shut(extra.server);
    await rm(dirname(app.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    for (const extra of kept) await rm(dirname(extra.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function view(path: string, target: Bound = app): Promise<View> {
    const res = await hit(target.port, 'GET', path, { Authorization: `Bearer ${target.token}` });
    expect(res.status).toBe(200);
    return parsed(res) as View;
  }

  async function detail(path: string, target: Bound = app): Promise<Detail> {
    const res = await hit(target.port, 'GET', path, { Authorization: `Bearer ${target.token}` });
    expect(res.status).toBe(200);
    return parsed(res) as Detail;
  }

  async function open(name: string, files: Record<string, string>, port: number): Promise<Bound> {
    const bound = await boundOn(await gitRepo(name, files), port);
    kept.push(bound);
    return bound;
  }

  it('The src view reports CRAP, coverage and surviving mutants for every file', async () => {
    const body = await view('/api/graph?at=src');
    expect(body.coverage).toBe('on');
    expect(body.mutation).toBe('on');
    expect(body.crapMax).toBe(4);
    expect(body.edges).toEqual([]);
    expect(nodeOf(body, 'src/green.ts')).toMatchObject({ crap: 3, coverage: '1.00', mutants: 0 });
    expect(nodeOf(body, 'src/amber.ts')).toMatchObject({ crap: 6, coverage: '0.50', mutants: 0 });
    expect(nodeOf(body, 'src/red.ts')).toMatchObject({ crap: 42, coverage: '0.00', mutants: 0 });
    const plain = nodeOf(body, 'src/plain.ts');
    expect(plain.crap).toBeUndefined();
    expect(plain).toMatchObject({ coverage: '1.00', mutants: 3 });
    const clean = nodeOf(body, 'src/clean.ts');
    expect(clean.crap).toBeUndefined();
    expect(clean).toMatchObject({ coverage: '1.00', mutants: 0 });
    expect(body.nodes.map(item => item.id).sort()).toEqual(['src/amber.ts', 'src/clean.ts', 'src/green.ts', 'src/plain.ts', 'src/red.ts']);
  });

  it('The root package takes the worst CRAP, the summed coverage and the summed mutants', async () => {
    const body = await view('/api/graph');
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toEqual([]);
    expect(body.at).toBe('');
    expect(body.crumbs).toEqual([{ name: 'healthy', at: '' }]);
    expect(nodeOf(body, 'src')).toEqual({ id: 'src', kind: 'package', name: 'src', path: 'src', files: 5, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–', crap: 42, coverage: '0.54', mutants: 3 });
  });

  it('A file detail lists only the functions over the CRAP limit', async () => {
    const amber = await detail('/api/detail?id=src/amber.ts&at=src');
    expect(amber.files).toBeUndefined();
    expect(amber).toMatchObject({ crap: 6, coverage: '0.50', mutants: 0 });
    expect(amber.hot).toEqual([{ name: 'mid', line: 1, cc: 4, coverage: '0.50', crap: 6 }]);
    expect((await detail('/api/detail?id=src/red.ts&at=src')).hot).toEqual([{ name: 'bad', line: 1, cc: 6, coverage: '0.00', crap: 42 }]);
    const green = await detail('/api/detail?id=src/green.ts&at=src');
    expect(green.hot).toEqual([]);
    expect(green.crap).toBe(3);
    const plain = await detail('/api/detail?id=src/plain.ts&at=src');
    expect(plain.crap).toBeUndefined();
    expect(plain.hot).toEqual([]);
    expect(plain.mutants).toBe(3);
  });

  it('The package detail carries the same numbers and no function list', async () => {
    const body = await detail('/api/detail?id=src&at=');
    expect(body).toMatchObject({ crap: 42, coverage: '0.54', mutants: 3, files: 5 });
    expect(body.hot).toBeUndefined();
    expect(body.crapMax).toBeUndefined();
    expect(body.coverage).toBe('0.54');
  });

  it('A missing coverage entry leaves CRAP blank and drops out of the sum', async () => {
    const parsedCoverage = JSON.parse(COVERAGE) as Record<string, unknown>;
    delete parsedCoverage['src/red.ts'];
    const root = await gitRepo('missing-entry', HEALTHY);
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', JSON.stringify(parsedCoverage));
    await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    const bound = await boundOn(root, PORT_BASE + 1);
    kept.push(bound);
    const src = await view('/api/graph?at=src', bound);
    const red = nodeOf(src, 'src/red.ts');
    expect(red).toMatchObject({ crap: '–', mutants: 0 });
    expect(red.coverage).toBeUndefined();
    expect(src.nodes.map(item => item.id)).not.toContain('src');
    expect(nodeOf(await view('/api/graph', bound), 'src')).toMatchObject({ crap: 6, coverage: '0.78', mutants: 3 });
    const file = await detail('/api/detail?id=src/red.ts&at=src', bound);
    expect(file).toMatchObject({ crap: '–', mutants: 0 });
    expect(file.coverage).toBeUndefined();
    expect(file.hot).toEqual([]);
  });

  it('A coverage entry with no statements counts as fully covered', async () => {
    const parsedCoverage = JSON.parse(COVERAGE) as Record<string, { statementMap: object; s: object }>;
    parsedCoverage['src/green.ts'] = { ...parsedCoverage['src/green.ts'], statementMap: {}, s: {} };
    const root = await gitRepo('empty-statements', HEALTHY);
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', JSON.stringify(parsedCoverage));
    await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    const bound = await boundOn(root, PORT_BASE + 2);
    kept.push(bound);
    const body = await detail('/api/detail?id=src/green.ts&at=src', bound);
    expect(body).toMatchObject({ crap: 3, coverage: '1.00', mutants: 0 });
    expect(body.hot).toEqual([]);
  });

  it('An unparsable report disables that overlay and nothing else', async () => {
    const root = await gitRepo('bad-coverage', HEALTHY);
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', 'not json');
    await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    const bound = await boundOn(root, PORT_BASE + 3);
    kept.push(bound);
    const src = await view('/api/graph?at=src', bound);
    expect(src.coverage).toBe('off');
    expect(src.mutation).toBe('on');
    for (const item of src.nodes) {
      expect(item.crap).toBeUndefined();
      expect(item.coverage).toBeUndefined();
    }
    expect(nodeOf(src, 'src/plain.ts').mutants).toBe(3);
    expect(nodeOf(src, 'src/clean.ts').mutants).toBe(0);
    const amber = await detail('/api/detail?id=src/amber.ts&at=src', bound);
    expect(amber.crap).toBeUndefined();
    expect(amber.coverage).toBeUndefined();
    expect(amber.mutants).toBe(0);
    expect(amber.hot).toEqual([]);
  });

  it('A missing mutation report leaves mutants off and CRAP on', async () => {
    const root = await gitRepo('no-mutation', HEALTHY);
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', COVERAGE);
    const bound = await boundOn(root, PORT_BASE + 4);
    kept.push(bound);
    const src = await view('/api/graph?at=src', bound);
    expect(src.coverage).toBe('on');
    expect(src.mutation).toBe('off');
    const green = nodeOf(src, 'src/green.ts');
    expect(green).toMatchObject({ crap: 3, coverage: '1.00' });
    expect(green.mutants).toBeUndefined();
  });

  it('Both reports missing leaves the 003 graph intact', async () => {
    const bound = await open('no-reports', HEALTHY, PORT_BASE + 5);
    const src = await view('/api/graph?at=src', bound);
    expect(src.coverage).toBe('off');
    expect(src.mutation).toBe('off');
    expect(src.edges).toEqual([]);
    for (const item of src.nodes) {
      expect(item.crap).toBeUndefined();
      expect(item.coverage).toBeUndefined();
      expect(item.mutants).toBeUndefined();
      expect(item).toMatchObject({ ca: 0, ce: 0, i: '–', a: '0.00', d: '–' });
      expect(item.zone).toBeUndefined();
    }
    const tree = parsed(await hit(bound.port, 'GET', '/api/tree', { Authorization: `Bearer ${bound.token}` })) as { entries: { name: string }[] };
    expect(tree.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['src', 'tsconfig.json']));
  });

  it('A report older than a scanned source is marked stale', async () => {
    const root = await gitRepo('stale', HEALTHY);
    const coverage = await writeAt(root, '.marestail/ts-coverage/coverage-final.json', COVERAGE);
    const mutation = await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    await stampSources(root, 5_000);
    stamp(coverage, 4_000);
    stamp(mutation, 6_000);
    const bound = await boundOn(root, PORT_BASE + 6);
    kept.push(bound);
    const src = await view('/api/graph?at=src', bound);
    expect(src.coverage).toBe('stale');
    expect(src.mutation).toBe('on');
    expect(nodeOf(src, 'src/green.ts').crap).toBe(3);
  });

  it('Equal mtimes are not stale', async () => {
    const root = await gitRepo('equal-mtime', HEALTHY);
    const coverage = await writeAt(root, '.marestail/ts-coverage/coverage-final.json', COVERAGE);
    const mutation = await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    await stampSources(root, 3_000);
    stamp(coverage, 3_000);
    stamp(mutation, 3_000);
    const bound = await boundOn(root, PORT_BASE + 7);
    kept.push(bound);
    const body = await view('/api/graph', bound);
    expect(body.coverage).toBe('on');
    expect(body.mutation).toBe('on');
  });

  it('The CRAP limit comes from marestail.toml and is 4 when that file is absent', async () => {
    const raised = { ...HEALTHY, 'marestail.toml': '[ts]\ncrap_max = 6\n' };
    const root = await gitRepo('limit', raised);
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', COVERAGE);
    await writeAt(root, 'reports/mutation/mutation.json', MUTATION);
    const bound = await boundOn(root, PORT_BASE + 8);
    kept.push(bound);
    const body = await view('/api/graph', bound);
    expect(body.crapMax).toBe(6);
    expect(nodeOf(body, 'src').crap).toBe(42);
    const bare = await open('bare', { 'src/only.ts': 'export const n = 1;\n' }, PORT_BASE + 9);
    const empty = await view('/api/graph', bare);
    expect(empty).toMatchObject({ crapMax: 4, coverage: 'off', mutation: 'off' });
  });

  it('An absolute key inside the repository counts and a key outside it does not', async () => {
    const root = await gitRepo('absolute', HEALTHY);
    const parsedCoverage = JSON.parse(COVERAGE) as Record<string, unknown>;
    parsedCoverage[join(root, 'src/green.ts')] = parsedCoverage['src/green.ts'];
    delete parsedCoverage['src/green.ts'];
    parsedCoverage['/tmp/elsewhere/amber.ts'] = parsedCoverage['src/amber.ts'];
    delete parsedCoverage['src/amber.ts'];
    const parsedMutation = JSON.parse(MUTATION) as { files: Record<string, unknown> };
    parsedMutation.files[join(root, 'src/plain.ts')] = parsedMutation.files['src/plain.ts'];
    delete parsedMutation.files['src/plain.ts'];
    await writeAt(root, '.marestail/ts-coverage/coverage-final.json', JSON.stringify(parsedCoverage));
    await writeAt(root, 'reports/mutation/mutation.json', JSON.stringify(parsedMutation));
    const bound = await boundOn(root, PORT_BASE + 10);
    kept.push(bound);
    const src = await view('/api/graph?at=src', bound);
    expect(nodeOf(src, 'src/green.ts')).toMatchObject({ crap: 3, coverage: '1.00' });
    const amber = nodeOf(src, 'src/amber.ts');
    expect(amber).toMatchObject({ crap: '–' });
    expect(amber.coverage).toBeUndefined();
    expect(nodeOf(src, 'src/plain.ts').mutants).toBe(3);
  });

  it('Rescan reads the reports again and writes nothing but the cache', async () => {
    const before = await tracked(app.root);
    const coverage = await readFile(join(app.root, '.marestail/ts-coverage/coverage-final.json'));
    const res = await hit(app.port, 'POST', '/api/rescan', auth);
    const body = parsed(res) as { files: number; ms: number };
    expect(res.status).toBe(200);
    expect(body.files).toBe(5);
    expect(typeof body.ms).toBe('number');
    expect(await tracked(app.root)).toBe(before);
    expect(await readFile(join(app.root, '.marestail/ts-coverage/coverage-final.json'))).toEqual(coverage);
    const names = await readdir(app.root);
    expect(names).not.toContain('stray.txt');
    expect(nodeOf(await view('/api/graph'), 'src')).toMatchObject({ crap: 42, coverage: '0.54', mutants: 3 });
  });

  it('A package nothing imports is pain, a pure-abstraction consumer is useless, and D of 0.5 is healthy', async () => {
    const bound = await open('zones', ZONES, PORT_BASE + 11);
    const src = await view('/api/graph?at=src', bound);
    expect(nodeOf(src, 'src/pain')).toMatchObject({ files: 1, ca: 1, ce: 0, i: '0.00', a: '0.00', d: '1.00', zone: 'pain' });
    expect(nodeOf(src, 'src/use')).toMatchObject({ files: 2, ca: 0, ce: 1, i: '1.00', a: '1.00', d: '1.00', zone: 'useless' });
    expect(nodeOf(src, 'src/mid')).toMatchObject({ files: 1, ca: 1, ce: 1, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' });
  });

  it('A saved overlay is returned and a 003 document still reads', async () => {
    const doc = { version: 1, views: {}, settings: { tests: false, external: false, overlay: 'crap' } };
    const put = await hit(app.port, 'PUT', '/api/layout', auth, JSON.stringify(doc));
    expect(put.status).toBe(200);
    expect(parsed(put)).toEqual(doc);
    expect(parsed(await hit(app.port, 'GET', '/api/layout', auth))).toEqual(doc);
    const legacy = '{"version":1,"views":{},"settings":{"tests":true,"external":false}}';
    const path = join(app.root, '.bindweed', 'layout.json');
    await writeFile(path, legacy);
    const got = await hit(app.port, 'GET', '/api/layout', auth);
    expect(got.status).toBe(200);
    expect(parsed(got)).toEqual({ version: 1, views: {}, settings: { tests: true, external: false } });
    expect(await readFile(path, 'utf8')).toBe(legacy);
  });

  it('An unknown overlay is refused and the file is left as it was', async () => {
    const none = { version: 1, views: {}, settings: { tests: false, external: false, overlay: 'none' } };
    expect((await hit(app.port, 'PUT', '/api/layout', auth, JSON.stringify(none))).status).toBe(200);
    const zones = await hit(app.port, 'PUT', '/api/layout', auth, JSON.stringify({ version: 1, views: {}, settings: { tests: false, external: false, overlay: 'zones' } }));
    expect(zones.status).toBe(400);
    expect(parsed(zones)).toEqual({ error: 'bad layout' });
    expect(parsed(await hit(app.port, 'GET', '/api/layout', auth))).toEqual(none);
    const extra = await hit(app.port, 'PUT', '/api/layout', auth, JSON.stringify({ version: 1, views: {}, settings: { tests: false, external: false, overlay: 'crap', zones: 1 } }));
    expect(extra.status).toBe(400);
    expect(parsed(extra)).toEqual({ error: 'bad layout' });
    expect(parsed(await hit(app.port, 'GET', '/api/layout', auth))).toEqual(none);
  });

  it('The old routes still answer, and the new fields do not move them', async () => {
    const tree = parsed(await hit(app.port, 'GET', '/api/tree', auth)) as { entries: { name: string }[] };
    expect(tree.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['src', 'marestail.toml']));
    const file = await hit(app.port, 'GET', '/api/file?path=src/green.ts', auth);
    expect(file.status).toBe(200);
    expect(parsed(file)).toMatchObject({ path: 'src/green.ts' });
    const notes = await hit(app.port, 'GET', '/api/graph?at=notes', auth);
    expect(notes.status).toBe(404);
    expect(parsed(notes)).toEqual({ error: 'no such directory' });
    const missing = await hit(app.port, 'GET', '/api/detail?id=missing&at=src', auth);
    expect(missing.status).toBe(404);
    expect(parsed(missing)).toEqual({ error: 'no such node' });
  });
});
