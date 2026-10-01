import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20175 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);

const LAYERED_FILES: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}',
  'notes/readme.md': '# notes\n',
  'src/app/a.ts': "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\n",
  'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  'src/domain/model.ts': 'export class Model { id = 0; }\n',
  'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
};

const WORKSPACE_FILES: Record<string, string> = {
  'package.json': '{"name":"acme","private":true,"workspaces":["packages/*"]}',
  'packages/core/package.json': '{"name":"@acme/core","version":"1.0.0","main":"src/index.ts"}',
  'packages/core/src/index.ts': "export const greet = 'hi';\n",
  'packages/web/package.json': '{"name":"@acme/web","version":"1.0.0","main":"src/index.ts"}',
  'packages/web/src/index.ts': "import { greet } from '@acme/core';\nexport const msg = greet;\n",
};

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; body: Buffer };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function gitRepo(name: string, files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-graph-')), name);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(
    root,
    '-c',
    'user.name=qa',
    '-c',
    'user.email=qa@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'gc.auto=0',
    'commit',
    '-qm',
    'fixture',
  );
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

function hit(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.setTimeout(4000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

describe('the graph api over the layered fixture', () => {
  let root = '';
  let app: Bound;
  let bearer: Record<string, string> = {};
  const port = PORT_BASE;

  beforeAll(async () => {
    root = await gitRepo('layered', LAYERED_FILES);
    await prepareBindweed(root);
    app = await boundOn(root, port);
    bearer = { Authorization: `Bearer ${app.token}` };
  });

  afterAll(async () => {
    await closeServer(app.server);
    await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('answers the root view and the empty-at view identically', async () => {
    const expected = {
      at: '',
      crumbs: [{ name: 'layered', at: '' }],
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 4, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' }],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    };
    expect(json(await hit(port, 'GET', '/api/graph', bearer))).toEqual(expected);
    expect(json(await hit(port, 'GET', '/api/graph?at=', bearer))).toEqual(expected);
  });

  it('answers the src view in three layers', async () => {
    const res = await hit(port, 'GET', '/api/graph?at=src', bearer);
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({
      at: 'src',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
      ],
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false, ca: 2, ce: 1, i: '0.33', a: '0.00', d: '0.67', zone: 'pain' },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 2, order: 0, cycle: false, ca: 2, ce: 0, i: '0.00', a: '0.00', d: '1.00', zone: 'pain' },
      ],
      edges: [
        { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
        { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
        { from: 'src/infra', to: 'src/domain', runtime: 1, type: 0, cycle: false },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('answers the app view as a red cycle of two files', async () => {
    const res = await hit(port, 'GET', '/api/graph?at=src/app', bearer);
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({
      at: 'src/app',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
        { name: 'app', at: 'src/app' },
      ],
      nodes: [
        { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true, ca: 1, ce: 3, i: '0.75', a: '0.00', d: '0.25' },
        { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true, ca: 1, ce: 2, i: '0.67', a: '0.00', d: '0.33' },
      ],
      edges: [
        { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
        { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('answers 404 for an at that names no view', async () => {
    for (const at of ['notes', 'tsconfig.json', 'src/app/a.ts', '..', '/tmp/qa/layered/src']) {
      const res = await hit(port, 'GET', `/api/graph?at=${encodeURIComponent(at)}`, bearer);
      expect(res.status).toBe(404);
      expect(json(res)).toEqual({ error: 'no such directory' });
    }
  });

  it('keeps the host and token checks on the new routes', async () => {
    const wrong = '0'.repeat(32);
    const denied: [string, string][] = [
      ['GET', '/api/graph'],
      ['GET', `/api/graph?token=${wrong}`],
      ['POST', '/api/rescan'],
    ];
    for (const [method, path] of denied) {
      const res = await hit(port, method, path);
      expect(res.status).toBe(401);
      expect(json(res)).toEqual({ error: 'missing or wrong token' });
    }
    const badHost: [string, string][] = [
      ['GET', `/api/graph?token=${app.token}`],
      ['POST', `/api/rescan?token=${app.token}`],
    ];
    for (const [method, path] of badHost) {
      const res = await hit(port, method, path, { Host: `evil.example:${port}` });
      expect(res.status).toBe(403);
      expect(json(res)).toEqual({ error: 'bad host' });
    }
    const wrongMethod: [string, string][] = [
      ['GET', '/api/rescan'],
      ['POST', '/api/graph'],
    ];
    for (const [method, path] of wrongMethod) {
      const res = await hit(port, method, path, bearer);
      expect(res.status).toBe(404);
      expect(json(res)).toEqual({ error: 'not found' });
    }
  });

  it('rescans and reports the scanned file count and duration', async () => {
    const res = await hit(port, 'POST', '/api/rescan', bearer);
    expect(res.status).toBe(200);
    const body = json(res) as { files: number; ms: number };
    expect(body.files).toBe(4);
    expect(typeof body.ms).toBe('number');
    expect(body.ms).toBeGreaterThanOrEqual(0);
    expect(body.ms).toBeLessThan(60000);
  });

  it('answers the tree and file routes on the same server', async () => {
    const tree = await hit(port, 'GET', '/api/tree', bearer);
    expect(tree.status).toBe(200);
    const entries = json(tree) as { entries: { name: string }[] };
    expect(entries.entries.map(entry => entry.name)).toEqual(['notes', 'src', 'tsconfig.json']);
    const file = await hit(port, 'GET', '/api/file?path=src/domain/model.ts', bearer);
    expect(file.status).toBe(200);
    expect(json(file)).toEqual({ path: 'src/domain/model.ts', text: 'export class Model { id = 0; }\n' });
  });

  it('picks up a new file and its arrow on rescan', async () => {
    await writeFile(join(root, 'src', 'main.ts'), "import { a } from './app/a';\n");
    const before = json(await hit(port, 'GET', '/api/graph?at=src', bearer)) as { nodes: { id: string }[] };
    expect(before.nodes.map(node => node.id)).not.toContain('src/main.ts');
    const rescan = json(await hit(port, 'POST', '/api/rescan', bearer)) as { files: number };
    expect(rescan.files).toBe(5);
    const view = json(await hit(port, 'GET', '/api/graph?at=src', bearer)) as {
      nodes: { id: string; kind: string; row: number }[];
      edges: { from: string; to: string }[];
    };
    const main = view.nodes.find(node => node.id === 'src/main.ts');
    expect(main).toMatchObject({ kind: 'file', row: 0 });
    expect(view.nodes.find(node => node.id === 'src/app')).toMatchObject({ row: 1 });
    expect(view.edges).toContainEqual({ from: 'src/main.ts', to: 'src/app', runtime: 1, type: 0, cycle: false });
  });

  it('scans a test file without showing it', async () => {
    await writeFile(join(root, 'src', 'app', 'a.test.ts'), "import { a } from './a';\n");
    const rescan = json(await hit(port, 'POST', '/api/rescan', bearer)) as { files: number };
    expect(rescan.files).toBe(6);
    const view = json(await hit(port, 'GET', '/api/graph?at=src/app', bearer)) as {
      nodes: { name: string }[];
      edges: unknown[];
    };
    expect(view.nodes).toHaveLength(2);
    expect(view.edges).toHaveLength(2);
    expect(view.nodes.map(node => node.name)).not.toContain('a.test.ts');
  });

  it('scans an external import without drawing it', async () => {
    await writeFile(join(root, 'src', 'infra', 'env.ts'), "import { readFileSync } from 'node:fs';\nexport const rf = readFileSync;\n");
    const rescan = json(await hit(port, 'POST', '/api/rescan', bearer)) as { files: number };
    expect(rescan.files).toBe(7);
    const view = json(await hit(port, 'GET', '/api/graph?at=src', bearer)) as {
      nodes: { id: string }[];
      edges: unknown[];
    };
    expect(view.nodes).toHaveLength(4);
    expect(view.edges).toHaveLength(4);
    expect(JSON.stringify(view)).not.toContain('node:fs');
  });
});

describe('the graph api over the workspace fixture', () => {
  it('shows the workspace packages at the root with the app above the library', async () => {
    const root = await gitRepo('workspace', WORKSPACE_FILES);
    const app = await boundOn(root, PORT_BASE + 1);
    try {
      const res = await hit(app.port, 'GET', '/api/graph', { Authorization: `Bearer ${app.token}` });
      expect(res.status).toBe(200);
      expect(json(res)).toEqual({
        at: '',
        crumbs: [{ name: 'workspace', at: '' }],
        nodes: [
          {
            id: 'packages/web',
            kind: 'package',
            name: '@acme/web',
            path: 'packages/web',
            files: 1,
            row: 0,
            order: 0,
            cycle: false,
            ca: 0,
            ce: 1,
            i: '1.00',
            a: '0.00',
            d: '0.00',
            zone: 'healthy',
          },
          {
            id: 'packages/core',
            kind: 'package',
            name: '@acme/core',
            path: 'packages/core',
            files: 1,
            row: 1,
            order: 0,
            cycle: false,
            ca: 1,
            ce: 0,
            i: '0.00',
            a: '0.00',
            d: '1.00',
            zone: 'pain',
          },
        ],
        edges: [{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }],
        crapMax: 4,
        coverage: 'off',
        mutation: 'off',
      });
      const detail = await hit(app.port, 'GET', '/api/detail?id=packages/web', { Authorization: `Bearer ${app.token}` });
      expect(detail.status).toBe(200);
      expect(json(detail)).toMatchObject({
        imports: [{ id: 'packages/core', name: '@acme/core', kind: 'package', runtime: 1, type: 0, heritage: 0 }],
      });
    } finally {
      await closeServer(app.server);
      await rm(dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
