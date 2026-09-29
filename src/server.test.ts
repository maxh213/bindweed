import { request as httpRequest, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createAppServer, type AppDeps } from './server.ts';
import { runGit } from './git.ts';

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bw-srv-'));
  await mkdir(join(root, 'src', 'lib'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '*.log\n');
  await writeFile(join(root, 'README.md'), '# demo\n');
  await writeFile(join(root, 'Zebra.txt'), 'z\n');
  await writeFile(join(root, 'apple.txt'), 'a\n');
  await writeFile(join(root, 'docs', 'guide.md'), '# guide\n');
  await writeFile(
    join(root, 'src', 'a.ts'),
    "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
  );
  await writeFile(join(root, 'src', 'lib', 'util.ts'), 'export const id = 1;\n');
  await runGit(['init'], root);
  await runGit(['config', 'user.name', 'qa'], root);
  await runGit(['config', 'user.email', 'qa@t'], root);
  await runGit(['config', 'commit.gpgsign', 'false'], root);
  await runGit(['add', '-A'], root);
  await runGit(['commit', '-m', 'fixture'], root);
  await writeFile(join(root, 'debug.log'), 'secret\n');
  return root;
}

async function uiDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bw-ui-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), '<html>bindweed-ui</html>');
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

async function start(deps: AppDeps): Promise<{ server: Server; port: number }> {
  const server = createAppServer(deps);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  deps.port = addr.port;
  return { server, port: addr.port };
}

type Hit = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

function hit(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createAppServer', () => {
  let root = '';
  let ui = '';
  let server: Server;
  let port = 0;
  const token = 'a'.repeat(32);
  const wrong = '0'.repeat(32);

  beforeAll(async () => {
    root = await fixtureRepo();
    ui = await uiDir();
    const started = await start({ repoRoot: root, uiDir: ui, token, port: 0 });
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    await rm(ui, { recursive: true, force: true });
  });

  it('refuses a foreign Host header', async () => {
    const res = await hit(port, 'GET', `/api/tree?token=${token}`, { Host: `evil.example:${port}` });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body.toString())).toEqual({ error: 'bad host' });
  });

  it('refuses Host without the listening port', async () => {
    const res = await hit(port, 'GET', `/api/tree?token=${token}`, { Host: '127.0.0.1' });
    expect(res.status).toBe(403);
  });

  it('requires the token for API routes', async () => {
    expect((await hit(port, 'GET', '/api/tree')).status).toBe(401);
    expect(JSON.parse((await hit(port, 'GET', '/api/tree')).body.toString())).toEqual({
      error: 'missing or wrong token',
    });
    expect((await hit(port, 'GET', '/api/tree', { Authorization: `Bearer ${wrong}` })).status).toBe(401);
    expect((await hit(port, 'GET', `/api/tree?token=${wrong}`)).status).toBe(401);
    expect((await hit(port, 'GET', '/api/tree?token=abc')).status).toBe(401);
    expect((await hit(port, 'GET', '/api/tree?token=')).status).toBe(401);
  });

  it('accepts the token in the header or query and localhost Host', async () => {
    expect((await hit(port, 'GET', '/api/tree', { Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await hit(port, 'GET', `/api/tree?token=${token}`)).status).toBe(200);
    expect(
      (await hit(port, 'GET', `/api/tree?token=${token}`, { Host: `localhost:${port}` })).status,
    ).toBe(200);
  });

  it('serves the page only with a valid token query', async () => {
    const ok = await hit(port, 'GET', `/?token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(ok.body.toString()).toBe('<html>bindweed-ui</html>');
    const missing = await hit(port, 'GET', '/');
    expect(missing.status).toBe(401);
    expect(missing.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(missing.body.toString()).toBe('bindweed: use the link bindweed printed in the terminal');
    expect((await hit(port, 'GET', `/?token=${wrong}`)).status).toBe(401);
  });

  it('serves assets without a token', async () => {
    const js = await hit(port, 'GET', '/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.body.toString()).toBe('console.log(1)');
    const css = await hit(port, 'GET', '/assets/app.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
  });

  it('answers 404 for unknown addresses', async () => {
    for (const path of [
      '/nope',
      '/assets/missing.js',
      '/assets/../index.html',
      '/assets/..%2F..%2F..%2Fpackage.json',
      '/assets/',
    ]) {
      const res = await hit(port, 'GET', path);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body.toString())).toEqual({ error: 'not found' });
    }
    expect((await hit(port, 'GET', '/api/nope', { Authorization: `Bearer ${token}` })).status).toBe(404);
    expect((await hit(port, 'POST', '/api/tree', { Authorization: `Bearer ${token}` })).status).toBe(404);
  });

  it('returns the tree JSON without ignored paths', async () => {
    const res = await hit(port, 'GET', '/api/tree', { Authorization: `Bearer ${token}` });
    const body = JSON.parse(res.body.toString());
    expect(body.root).toBe(root.split('/').pop());
    expect(JSON.stringify(body)).not.toContain('debug.log');
    expect(JSON.stringify(body)).not.toContain('.bindweed');
  });

  it('returns file text and rejects bad paths', async () => {
    const ok = await hit(port, 'GET', '/api/file?path=src/a.ts', { Authorization: `Bearer ${token}` });
    expect(JSON.parse(ok.body.toString())).toEqual({
      path: 'src/a.ts',
      text: "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
    });
    for (const q of [
      '',
      '?path=',
      '?path=nope.ts',
      '?path=src',
      '?path=debug.log',
      '?path=.git/config',
      '?path=../x',
      '?path=src/../README.md',
      '?path=/tmp/x',
    ]) {
      const res = await hit(port, 'GET', `/api/file${q}`, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body.toString())).toEqual({ error: 'no such file' });
    }
  });

  it('returns binary JSON for a NUL file', async () => {
    await writeFile(join(root, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
    const res = await hit(port, 'GET', '/api/file?path=blob.bin', { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({ path: 'blob.bin', binary: true });
  });

  it('reads a non-ASCII path', async () => {
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'żółw i zając.md'), 'cześć\n');
    const res = await hit(port, 'GET', '/api/file?path=notes%2F%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md', {
      Authorization: `Bearer ${token}`,
    });
    expect(JSON.parse(res.body.toString())).toEqual({ path: 'notes/żółw i zając.md', text: 'cześć\n' });
  });

  it('serves svg and unknown asset types', async () => {
    await writeFile(join(ui, 'assets', 'icon.svg'), '<svg></svg>');
    await writeFile(join(ui, 'assets', 'data.bin'), 'x');
    const svg = await hit(port, 'GET', '/assets/icon.svg');
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    const bin = await hit(port, 'GET', '/assets/data.bin');
    expect(bin.headers['content-type']).toBe('application/octet-stream');
  });
});
