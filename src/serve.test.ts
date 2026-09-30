import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20035 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);
const A_TS = "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n";
const NOT_FOUND = { error: 'not found' };
const NO_SUCH_FILE = { error: 'no such file' };
const BAD_HOST = { error: 'bad host' };
const NO_TOKEN = { error: 'missing or wrong token' };

type Deps = Parameters<typeof bindApp>[0];

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; type: string | undefined; body: Buffer };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function fixtureRepo(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-srv-')), 'demo-repo');
  await mkdir(join(root, 'src', 'lib'), { recursive: true });
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'build'));
  await writeFile(join(root, '.gitignore'), '*.log\n');
  await writeFile(join(root, 'README.md'), '# demo\n');
  await writeFile(join(root, 'Zebra.txt'), 'z\n');
  await writeFile(join(root, 'apple.txt'), 'a\n');
  await writeFile(join(root, 'docs', 'guide.md'), '# guide\n');
  await writeFile(join(root, 'src', 'a.ts'), A_TS);
  await writeFile(join(root, 'src', 'lib', 'util.ts'), 'export const id = 1;\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  await writeFile(join(root, 'debug.log'), 'secret\n');
  await writeFile(join(root, 'build', 'out.log'), 'out\n');
  return root;
}

async function builtUi(): Promise<string> {
  const install = await mkdtemp(join(tmpdir(), 'bw-ui-'));
  const dir = join(install, 'dist', 'ui');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(install, 'package.json'), '{"name":"bindweed"}');
  await writeFile(join(dir, 'index.html'), '<html>bindweed — ui</html>');
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(dir, 'assets', 'app.css'), 'body{}');
  await writeFile(join(dir, 'assets', 'page.html'), '<p>a</p>');
  await writeFile(join(dir, 'assets', 'icon.svg'), '<svg></svg>');
  await writeFile(join(dir, 'assets', 'data.bin'), 'x');
  return dir;
}

async function boundOn(deps: Deps, port: number): Promise<Bound> {
  const result = await bindApp(deps, { mode: 'fixed', port });
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
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: Buffer.concat(chunks) }),
        );
      },
    );
    req.setTimeout(2000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

function otherHexDigit(digit: string): string {
  return digit === '0' ? '1' : '0';
}

function nearMisses(token: string): string[] {
  return [
    `${token.slice(0, -1)}${otherHexDigit(token.slice(-1))}`,
    `${otherHexDigit(token.slice(0, 1))}${token.slice(1)}`,
    token.slice(0, -1),
    `${token}0`,
  ];
}

async function hold(port: number): Promise<{ release(): Promise<void> }> {
  const server = createNetServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    release: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

function connectionOutcome(port: number): Promise<string> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (err: NodeJS.ErrnoException) => resolve(String(err.code)));
  });
}

describe('the app on localhost', () => {
  let root = '';
  let ui = '';
  let app: Bound;
  let bearer: Record<string, string> = {};
  const port = PORT_BASE;
  const wrong = '0'.repeat(32);

  beforeAll(async () => {
    root = await fixtureRepo();
    ui = await builtUi();
    app = await boundOn({ repoRoot: root, uiDir: ui }, port);
    bearer = { Authorization: `Bearer ${app.token}` };
  });

  afterAll(async () => {
    await closeServer(app.server);
    await rm(dirname(root), { recursive: true, force: true });
    await rm(dirname(dirname(ui)), { recursive: true, force: true });
  });

  it('starts with a fresh 32-hex token', () => {
    expect(app.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses a foreign Host header on every route before anything else', async () => {
    for (const path of [`/api/tree?token=${app.token}`, '/api/tree', `/?token=${app.token}`, '/assets/app.js']) {
      const res = await hit(port, 'GET', path, { Host: `evil.example:${port}` });
      expect(res.status).toBe(403);
      expect(json(res)).toEqual(BAD_HOST);
      expect(res.type).toBe('application/json; charset=utf-8');
    }
    const lookAlikes = [
      `127.0.0.1.evil.example:${port}`,
      `localhost.evil.example:${port}`,
      `evil.127.0.0.1:${port}`,
      `evil-localhost:${port}`,
    ];
    for (const host of ['127.0.0.1:9999', '127.0.0.1', `localhost:${port + 1}`, ...lookAlikes]) {
      const res = await hit(port, 'GET', `/api/tree?token=${app.token}`, { Host: host });
      expect(res.status).toBe(403);
      expect(json(res)).toEqual(BAD_HOST);
    }
  });

  it('needs the token for the API, in the header or in the address', async () => {
    const denied: [string, string, Record<string, string>][] = [
      ['GET', '/api/tree', {}],
      ['GET', '/api/tree', { Authorization: `Bearer ${wrong}` }],
      ['GET', '/api/tree', { Authorization: `Basic ${app.token}` }],
      ['GET', `/api/tree?token=${wrong}`, {}],
      ['GET', '/api/tree?token=abc', {}],
      ['GET', '/api/tree?token=', {}],
      ['GET', '/api/file?path=src/a.ts', {}],
      ['POST', '/api/nope', {}],
    ];
    for (const almost of nearMisses(app.token)) {
      denied.push(['GET', `/api/tree?token=${almost}`, {}], ['GET', '/api/tree', { Authorization: `Bearer ${almost}` }]);
    }
    for (const [method, path, headers] of denied) {
      const res = await hit(port, method, path, headers);
      expect(res.status).toBe(401);
      expect(json(res)).toEqual(NO_TOKEN);
      expect(res.type).toBe('application/json; charset=utf-8');
    }
    const allowed: [string, Record<string, string>][] = [
      ['/api/tree', bearer],
      [`/api/tree?token=${app.token}`, {}],
      [`/api/tree?token=${app.token}`, { Host: `localhost:${port}` }],
      [`/api/tree?token=${app.token}`, { Authorization: 'Basic x' }],
    ];
    for (const [path, headers] of allowed) {
      const res = await hit(port, 'GET', path, headers);
      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json; charset=utf-8');
    }
  });

  it('serves the page only to the link with the token', async () => {
    await mkdir(join(root, 'dist', 'ui'), { recursive: true });
    await writeFile(join(root, 'dist', 'ui', 'index.html'), '<html>the repository page</html>');
    const ok = await hit(port, 'GET', `/?token=${app.token}`);
    expect(ok.status).toBe(200);
    expect(ok.type).toBe('text/html; charset=utf-8');
    expect(ok.body.toString()).toBe('<html>bindweed — ui</html>');
    const almostRight = nearMisses(app.token).map(almost => `/?token=${almost}`);
    for (const path of ['/', `/?token=${wrong}`, '/?token=', ...almostRight]) {
      const res = await hit(port, 'GET', path, bearer);
      expect(res.status).toBe(401);
      expect(res.type).toBe('text/plain; charset=utf-8');
      expect(res.body.toString()).toBe('bindweed: use the link bindweed printed in the terminal');
    }
    await rm(join(root, 'dist'), { recursive: true });
  });

  it('serves assets without a token, typed by extension', async () => {
    const assets: [string, string, string][] = [
      ['app.js', 'text/javascript; charset=utf-8', 'console.log(1)'],
      ['app.css', 'text/css; charset=utf-8', 'body{}'],
      ['page.html', 'text/html; charset=utf-8', '<p>a</p>'],
      ['icon.svg', 'image/svg+xml', '<svg></svg>'],
      ['data.bin', 'application/octet-stream', 'x'],
    ];
    for (const [file, type, content] of assets) {
      const res = await hit(port, 'GET', `/assets/${file}`);
      expect(res.status).toBe(200);
      expect(res.type).toBe(type);
      expect(res.body.toString()).toBe(content);
    }
  });

  it('answers 404 for any other address', async () => {
    const unknown: [string, string, Record<string, string>][] = [
      ['GET', '/nope', {}],
      ['GET', '/index.html', {}],
      ['GET', '/assets', {}],
      ['GET', '/assets/', {}],
      ['GET', '/assets/missing.js', {}],
      ['GET', '/assets/../index.html', {}],
      ['GET', '/assets/%2e%2e/index.html', {}],
      ['GET', '/assets/..%2F..%2F..%2Fpackage.json', {}],
      ['GET', '/api/nope', bearer],
      ['POST', '/api/tree', bearer],
      ['POST', '/assets/app.js', {}],
      ['POST', '/', {}],
    ];
    for (const [method, path, headers] of unknown) {
      const res = await hit(port, method, path, headers);
      expect(res.status).toBe(404);
      expect(json(res)).toEqual(NOT_FOUND);
      expect(res.type).toBe('application/json; charset=utf-8');
    }
  });

  it('lists folders first and then files in byte order, without ignored paths', async () => {
    const res = await hit(port, 'GET', '/api/tree', bearer);
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({
      root: 'demo-repo',
      entries: [
        { name: 'docs', path: 'docs', kind: 'dir', children: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'file' }] },
        {
          name: 'src',
          path: 'src',
          kind: 'dir',
          children: [
            { name: 'lib', path: 'src/lib', kind: 'dir', children: [{ name: 'util.ts', path: 'src/lib/util.ts', kind: 'file' }] },
            { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
          ],
        },
        { name: '.gitignore', path: '.gitignore', kind: 'file' },
        { name: 'README.md', path: 'README.md', kind: 'file' },
        { name: 'Zebra.txt', path: 'Zebra.txt', kind: 'file' },
        { name: 'apple.txt', path: 'apple.txt', kind: 'file' },
      ],
    });
  });

  it('lists no entries for a repository without files', async () => {
    const empty = join(await mkdtemp(join(tmpdir(), 'bw-srv-')), 'empty-repo');
    await mkdir(empty);
    git(empty, 'init', '-q');
    const bound = await boundOn({ repoRoot: empty, uiDir: ui }, PORT_BASE + 29);
    const res = await hit(bound.port, 'GET', '/api/tree', { Authorization: `Bearer ${bound.token}` });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('{"root":"empty-repo","entries":[]}');
    await closeServer(bound.server);
    await rm(dirname(empty), { recursive: true, force: true });
  });

  it('follows the working tree on every request', async () => {
    await writeFile(join(root, 'notes.txt'), 'todo\n');
    await unlink(join(root, 'apple.txt'));
    const tree = json(await hit(port, 'GET', '/api/tree', bearer)) as { entries: { name: string; kind: string }[] };
    expect(tree.entries.filter(e => e.kind === 'file').map(e => e.name)).toEqual(['.gitignore', 'README.md', 'Zebra.txt', 'notes.txt']);
    const gone = await hit(port, 'GET', '/api/file?path=apple.txt', bearer);
    expect(gone.status).toBe(404);
    expect(json(gone)).toEqual(NO_SUCH_FILE);
    const added = await hit(port, 'GET', '/api/file?path=notes.txt', bearer);
    expect(json(added)).toEqual({ path: 'notes.txt', text: 'todo\n' });
  });

  it('leaves out what is not a regular file', async () => {
    const plain = join(dirname(root), 'plain');
    await mkdir(plain);
    await writeFile(join(plain, 'outside.txt'), 'outside\n');
    await symlink('README.md', join(root, 'link.txt'));
    await symlink(join(plain, 'outside.txt'), join(root, 'out.txt'));
    await symlink(plain, join(root, 'linkdir'));
    await mkdir(join(root, 'vendor'));
    await writeFile(join(root, 'vendor', 'v.txt'), 'v\n');
    git(join(root, 'vendor'), 'init', '-q');
    git(join(root, 'vendor'), 'add', '-A');
    git(join(root, 'vendor'), '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'v');
    const names = JSON.stringify(json(await hit(port, 'GET', '/api/tree', bearer)));
    for (const name of ['link.txt', 'out.txt', 'linkdir', 'vendor']) expect(names).not.toContain(name);
    for (const path of ['link.txt', 'out.txt', 'linkdir', 'vendor/v.txt', 'linkdir/outside.txt']) {
      const res = await hit(port, 'GET', `/api/file?path=${path}`, bearer);
      expect(res.status).toBe(404);
      expect(json(res)).toEqual(NO_SUCH_FILE);
    }
  });

  it('lists and reads a name with spaces and non-ASCII letters', async () => {
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'żółw i zając.md'), 'cześć\n');
    const tree = json(await hit(port, 'GET', '/api/tree', bearer)) as { entries: { name: string; children?: unknown[] }[] };
    expect(tree.entries.find(e => e.name === 'notes')?.children).toEqual([
      { name: 'żółw i zając.md', path: 'notes/żółw i zając.md', kind: 'file' },
    ]);
    const res = await hit(port, 'GET', '/api/file?path=notes%2F%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md', bearer);
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({ path: 'notes/żółw i zając.md', text: 'cześć\n' });
  });

  it('returns a text file whole', async () => {
    const res = await hit(port, 'GET', '/api/file?path=src/a.ts', bearer);
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json; charset=utf-8');
    expect(json(res)).toEqual({ path: 'src/a.ts', text: A_TS });
  });

  it('does not serve a path that is not in the tree', async () => {
    const queries = [
      '',
      '?path=',
      '?path=nope.ts',
      '?path=readme.md',
      '?path=src',
      '?path=debug.log',
      '?path=build/out.log',
      '?path=.git/config',
      '?path=../plain/outside.txt',
      '?path=src/../README.md',
      `?path=${encodeURIComponent(join(root, 'README.md'))}`,
    ];
    for (const query of queries) {
      const res = await hit(port, 'GET', `/api/file${query}`, bearer);
      expect(res.status).toBe(404);
      expect(json(res)).toEqual(NO_SUCH_FILE);
    }
  });

  it('does not return large or binary files as text', async () => {
    await writeFile(join(root, 'exact.txt'), 'x'.repeat(1048576));
    await writeFile(join(root, 'big.txt'), 'x'.repeat(1048577));
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(1048577, 0));
    await writeFile(join(root, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
    await writeFile(join(root, 'edge.bin'), Buffer.concat([Buffer.alloc(8191, 0x78), Buffer.from([0])]));
    await writeFile(join(root, 'late.txt'), Buffer.concat([Buffer.alloc(8192, 0x78), Buffer.from([0])]));
    await writeFile(join(root, 'empty.txt'), '');
    const exact = await hit(port, 'GET', '/api/file?path=exact.txt', bearer);
    expect(exact.status).toBe(200);
    expect(json(exact)).toEqual({ path: 'exact.txt', text: 'x'.repeat(1048576) });
    for (const file of ['big.txt', 'huge.bin']) {
      const res = await hit(port, 'GET', `/api/file?path=${file}`, bearer);
      expect(res.status).toBe(413);
      expect(json(res)).toEqual({ error: 'file too large to show' });
    }
    for (const file of ['blob.bin', 'edge.bin']) {
      const res = await hit(port, 'GET', `/api/file?path=${file}`, bearer);
      expect(res.status).toBe(200);
      expect(json(res)).toEqual({ path: file, binary: true });
    }
    const late = await hit(port, 'GET', '/api/file?path=late.txt', bearer);
    expect(json(late)).toEqual({ path: 'late.txt', text: `${'x'.repeat(8192)}\0` });
    expect(json(await hit(port, 'GET', '/api/file?path=empty.txt', bearer))).toEqual({ path: 'empty.txt', text: '' });
  });

  it('answers 500 and stays up when the repository is gone', async () => {
    const gone = await boundOn({ repoRoot: join(ui, 'removed-repo'), uiDir: ui }, PORT_BASE + 1);
    const res = await hit(gone.port, 'GET', '/api/tree', { Authorization: `Bearer ${gone.token}` });
    expect(res.status).toBe(500);
    expect(json(res)).toEqual({ error: 'internal error' });
    expect(res.type).toBe('application/json; charset=utf-8');
    expect((await hit(gone.port, 'GET', '/assets/app.js')).status).toBe(200);
    await closeServer(gone.server);
  });
});

describe('bindApp ports', () => {
  const deps: Deps = { repoRoot: '/nowhere', uiDir: '/nowhere' };

  it('fails at once for a fixed port that is taken', async () => {
    const port = PORT_BASE + 2;
    const held = await hold(port);
    const result = await bindApp(deps, { mode: 'fixed', port });
    expect(result).toEqual({ error: { kind: 'in-use', port } });
    expect(listenErrorMessage({ kind: 'in-use', port })).toBe(`bindweed: port ${port} is in use`);
    await held.release();
  });

  it('moves to the next port when the first of a range is taken', async () => {
    const first = PORT_BASE + 3;
    const held = await hold(first);
    const result = await bindApp(deps, { mode: 'range', port: first });
    expect(result).toMatchObject({ port: first + 1 });
    if ('error' in result) throw new Error('bound');
    await closeServer(result.server);
    await held.release();
  });

  it('walks the range from the first port to twenty above it', async () => {
    const first = PORT_BASE + 5;
    const held = await Promise.all(Array.from({ length: 20 }, (_, i) => hold(first + i)));
    const bound = await bindApp(deps, { mode: 'range', port: first });
    expect(bound).toMatchObject({ port: first + 20 });
    if ('error' in bound) throw new Error('bound');
    expect(bound.server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4', port: first + 20 });
    await closeServer(bound.server);
    const last = await hold(first + 20);
    const exhausted = await bindApp(deps, { mode: 'range', port: first });
    expect(exhausted).toEqual({ error: { kind: 'none-free', from: first, to: first + 20 } });
    expect(listenErrorMessage({ kind: 'none-free', from: first, to: first + 20 })).toBe(
      `bindweed: no free port between ${first} and ${first + 20}`,
    );
    await last.release();
    await Promise.all(held.map(h => h.release()));
  });

  it('listens on 127.0.0.1 only and frees the port on close', async () => {
    const port = PORT_BASE + 26;
    const bound = await boundOn(deps, port);
    expect(bound.server.address()).toEqual({ address: '127.0.0.1', family: 'IPv4', port });
    expect(await connectionOutcome(port)).toBe('connected');
    await closeServer(bound.server);
    expect(await connectionOutcome(port)).toBe('ECONNREFUSED');
  });

  it('gives every start its own token', async () => {
    const one = await boundOn(deps, PORT_BASE + 27);
    const two = await boundOn(deps, PORT_BASE + 28);
    expect(one.token).toMatch(/^[0-9a-f]{32}$/);
    expect(two.token).toMatch(/^[0-9a-f]{32}$/);
    expect(one.token).not.toBe(two.token);
    await closeServer(one.server);
    await closeServer(two.server);
  });

  it('passes on listen errors that are not a taken port', async () => {
    await expect(bindApp(deps, { mode: 'fixed', port: 70000 })).rejects.toThrow(/port/i);
  });
});
