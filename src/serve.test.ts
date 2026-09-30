import { request as httpRequest, createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createAppServer,
  type AppDeps,
  bindOnce,
  listenErrorMessage,
  listenForChoice,
  listenRange,
  newToken,
  requestHasToken,
  tokenFromAuth,
  tokensEqual,
  readRepoFile,
  httpMethod,
  httpPath,
  rawAssetName,
  fileQueryPath,
  isAddrInUse,
  safeAssetPath,
  isAssetPath,
  assetRouteKey,
  matchRoute,
  readAssetBytes,
} from './serve.ts';
import { runGit } from './repo.ts';

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
  await writeFile(join(dir, 'assets', 'page.html'), '<p>a</p>');
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

  it('refuses Host with the loopback address on the wrong port', async () => {
    const res = await hit(port, 'GET', `/api/tree?token=${token}`, { Host: '127.0.0.1:9999' });
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

  it('checks the token before matching any API route', async () => {
    for (const [method, path] of [
      ['POST', '/api/nope'],
      ['GET', '/api/file?path=src/a.ts'],
    ]) {
      const res = await hit(port, method, path);
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body.toString())).toEqual({ error: 'missing or wrong token' });
    }
  });

  it('accepts the token in the header or query and localhost Host', async () => {
    const byHeader = await hit(port, 'GET', '/api/tree', { Authorization: `Bearer ${token}` });
    expect(byHeader.status).toBe(200);
    expect(byHeader.headers['content-type']).toBe('application/json; charset=utf-8');
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
    const html = await hit(port, 'GET', '/assets/page.html');
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(html.body.toString()).toBe('<p>a</p>');
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
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    }
    expect((await hit(port, 'GET', '/api/nope', { Authorization: `Bearer ${token}` })).status).toBe(404);
    expect((await hit(port, 'POST', '/api/tree', { Authorization: `Bearer ${token}` })).status).toBe(404);
  });

  it('rejects asset names that contain .. or % even when the file exists', async () => {
    await writeFile(join(ui, 'assets', 'foo..bar.js'), 'evil');
    await writeFile(join(ui, 'assets', 'a%25b.js'), 'pct');
    expect((await hit(port, 'GET', '/assets/foo..bar.js')).status).toBe(404);
    expect((await hit(port, 'GET', '/assets/a%25b.js')).status).toBe(404);
    expect((await hit(port, 'GET', '/nope')).status).toBe(404);
  });

  it('serves an index.html that is not plain ASCII', async () => {
    await writeFile(join(ui, 'index.html'), '<html>bindweed — ui</html>');
    const ok = await hit(port, 'GET', `/?token=${token}`);
    expect(ok.body.toString('utf8')).toBe('<html>bindweed — ui</html>');
    await writeFile(join(ui, 'index.html'), '<html>bindweed-ui</html>');
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

  it('does not list the repository for an empty file path', async () => {
    let lists = 0;
    const counting = async (args: string[], cwd: string) => {
      if (args[0] === 'ls-files') lists += 1;
      return runGit(args, cwd);
    };
    const emptyUi = await uiDir();
    const started = await start({
      repoRoot: root,
      uiDir: emptyUi,
      token,
      port: 0,
      git: counting,
    });
    const res = await hit(started.port, 'GET', '/api/file', { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
    expect(lists).toBe(0);
    await new Promise<void>(resolve => started.server.close(() => resolve()));
    await rm(emptyUi, { recursive: true, force: true });
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

async function hold(port: number): Promise<{ close(): Promise<void> }> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      }),
  };
}

describe('listenErrorMessage', () => {
  it('names a taken explicit port', () => {
    expect(listenErrorMessage({ kind: 'in-use', port: 4555 })).toBe('bindweed: port 4555 is in use');
  });

  it('names the exhausted range', () => {
    expect(listenErrorMessage({ kind: 'none-free', from: 4477, to: 4497 })).toBe(
      'bindweed: no free port between 4477 and 4497',
    );
  });
});

describe('listenRange', () => {
  it('binds the first free port in a range', async () => {
    const held = await hold(19001);
    const server = createServer();
    const result = await listenRange(server, 19001, 19003, false);
    expect(result).toEqual({ port: 19002 });
    server.close();
    await held.close();
  });

  it('errors at once for a fixed taken port', async () => {
    const held = await hold(19011);
    const server = createServer();
    const result = await listenRange(server, 19011, 19011, true);
    expect(result).toEqual({ error: { kind: 'in-use', port: 19011 } });
    server.close();
    await held.close();
  });

  it('errors when every port in the range is taken', async () => {
    const a = await hold(19021);
    const b = await hold(19022);
    const server = createServer();
    const result = await listenRange(server, 19021, 19022, false);
    expect(result).toEqual({ error: { kind: 'none-free', from: 19021, to: 19022 } });
    server.close();
    await a.close();
    await b.close();
  });
});

describe('listenForChoice', () => {
  it('uses a fixed port or a twenty-wide range', async () => {
    const server = createServer();
    const fixed = await listenForChoice(server, { mode: 'fixed', port: 19031 });
    expect(fixed).toEqual({ port: 19031 });
    server.close();
    await new Promise(r => setTimeout(r, 10));
    const server2 = createServer();
    const ranged = await listenForChoice(server2, { mode: 'range', port: 19041 });
    expect(ranged).toEqual({ port: 19041 });
    server2.close();
  });

  it('tries the next port when the range start is taken', async () => {
    const held = await hold(19061);
    const server = createServer();
    const ranged = await listenForChoice(server, { mode: 'range', port: 19061 });
    expect(ranged).toEqual({ port: 19062 });
    server.close();
    await held.close();
  });

  it('ends the range twenty ports after the first one', async () => {
    const first = 19101;
    const held = await Promise.all(Array.from({ length: 20 }, (_, i) => hold(first + i)));
    const server = createServer();
    expect(await listenForChoice(server, { mode: 'range', port: first })).toEqual({ port: first + 20 });
    await new Promise<void>(resolve => server.close(() => resolve()));
    const last = await hold(first + 20);
    const server2 = createServer();
    expect(await listenForChoice(server2, { mode: 'range', port: first })).toEqual({
      error: { kind: 'none-free', from: first, to: first + 20 },
    });
    server2.close();
    await last.close();
    await Promise.all(held.map(h => h.close()));
  });
});

describe('isAddrInUse', () => {
  it('detects EADDRINUSE and rejects other values', () => {
    expect(isAddrInUse({ code: 'EADDRINUSE' })).toBe(true);
    expect(isAddrInUse({ code: 'EACCES' })).toBe(false);
    expect(isAddrInUse({})).toBe(false);
    expect(isAddrInUse(null)).toBe(false);
    expect(isAddrInUse('x')).toBe(false);
    expect(isAddrInUse(undefined)).toBe(false);
  });
});

describe('rawAssetName', () => {
  it('rejects empty, traversal, and percent-encoded segments', () => {
    expect(rawAssetName('/assets/')).toBeUndefined();
    expect(rawAssetName('/assets/app.js')).toBe('app.js');
    expect(rawAssetName('/assets/foo..bar.js')).toBeUndefined();
    expect(rawAssetName('/assets/a%25b.js')).toBeUndefined();
    expect(rawAssetName('/assets/%2e%2e/x.js')).toBeUndefined();
  });
});

describe('isAssetPath and assetRouteKey', () => {
  it('recognises only the assets prefix and builds the route key', () => {
    expect(isAssetPath('/assets/app.js')).toBe(true);
    expect(isAssetPath('/assets/')).toBe(true);
    expect(isAssetPath('/nope')).toBe(false);
    expect(isAssetPath('/api/tree')).toBe(false);
    expect(isAssetPath('assets/app.js')).toBe(false);
    expect(assetRouteKey('GET')).toBe('GET /assets/');
    expect(assetRouteKey('HEAD')).toBe('HEAD /assets/');
  });
});

describe('matchRoute', () => {
  it('returns the asset handler only for asset paths', async () => {
    const asset = async () => undefined;
    const tree = async () => undefined;
    const routes = new Map<string, typeof asset>([
      ['GET /assets/', asset],
      ['GET /api/tree', tree],
    ]);
    expect(matchRoute(routes, 'GET', '/api/tree')).toBe(tree);
    expect(matchRoute(routes, 'GET', '/assets/app.js')).toBe(asset);
    expect(matchRoute(routes, 'GET', '/nope')).toBeUndefined();
    expect(matchRoute(routes, 'POST', '/assets/app.js')).toBeUndefined();
  });
});

describe('readAssetBytes', () => {
  it('returns bytes for a real asset and a nul fallback for a bad name', async () => {
    const ui = await mkdtemp(join(tmpdir(), 'bw-asset-'));
    await mkdir(join(ui, 'assets'), { recursive: true });
    await writeFile(join(ui, 'assets', 'app.js'), 'ok');
    const hit = await readAssetBytes(ui, '/assets/app.js');
    expect(hit.body.toString()).toBe('ok');
    expect(hit.full).toBe(join(ui, 'assets', 'app.js'));
    const injected = await readAssetBytes(ui, '/assets/app.js', async () => Buffer.from('injected'));
    expect(injected.body.toString()).toBe('injected');
    let seen = '';
    await readAssetBytes(ui, '/assets/', async path => {
      seen = path;
      return Buffer.alloc(0);
    });
    expect(seen).toBe(join(ui, 'assets', '\0'));
    await expect(readAssetBytes(ui, '/assets/missing.js')).rejects.toThrow();
    await rm(ui, { recursive: true, force: true });
  });
});

describe('safeAssetPath', () => {
  it('joins a safe name under the ui assets folder', () => {
    expect(safeAssetPath('/ui', '/assets/app.js')).toBe('/ui/assets/app.js');
    expect(safeAssetPath('/ui', '/assets/')).toBeUndefined();
    expect(safeAssetPath('/ui', '/assets/foo..bar.js')).toBeUndefined();
  });
});

describe('fileQueryPath', () => {
  it('requires a non-empty path query', () => {
    expect(fileQueryPath(new URL('http://x/api/file'))).toBeUndefined();
    expect(fileQueryPath(new URL('http://x/api/file?path='))).toBeUndefined();
    expect(fileQueryPath(new URL('http://x/api/file?path=a.ts'))).toBe('a.ts');
  });
});

describe('bindOnce', () => {
  it('listens on 127.0.0.1 only', async () => {
    const server = createServer();
    await bindOnce(server, 19051);
    const addr = server.address();
    expect(addr).toMatchObject({ address: '127.0.0.1', port: 19051 });
    server.close();
  });

  it('rethrows errors that are not EADDRINUSE from the range loop', async () => {
    const server = createServer();
    const err = Object.assign(new Error('boom'), { code: 'EACCES' });
    server.listen = ((..._ignored: unknown[]) => {
      void _ignored;
      queueMicrotask(() => server.emit('error', err));
      return server;
    }) as typeof server.listen;
    await expect(listenRange(server, 19071, 19071, false)).rejects.toBe(err);
  });
});

describe('newToken', () => {
  it('returns 32 lowercase hex characters', () => {
    const token = newToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(token);
  });
});

describe('tokensEqual', () => {
  it('compares equal tokens as true', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
  });

  it('rejects wrong or differently sized tokens', () => {
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'ab')).toBe(false);
    expect(tokensEqual('', 'x')).toBe(false);
  });
});

describe('tokenFromAuth', () => {
  it('reads a bearer token', () => {
    expect(tokenFromAuth('Bearer deadbeef')).toBe('deadbeef');
    expect(tokenFromAuth('Basic x')).toBeUndefined();
    expect(tokenFromAuth(undefined)).toBeUndefined();
  });
});

describe('requestHasToken', () => {
  const token = 'a'.repeat(32);
  const wrong = '0'.repeat(32);

  it('accepts a bearer header or query token', () => {
    expect(requestHasToken(`Bearer ${token}`, null, token)).toBe(true);
    expect(requestHasToken(undefined, token, token)).toBe(true);
  });

  it('rejects missing or wrong tokens', () => {
    expect(requestHasToken(undefined, null, token)).toBe(false);
    expect(requestHasToken(`Bearer ${wrong}`, null, token)).toBe(false);
    expect(requestHasToken(undefined, wrong, token)).toBe(false);
    expect(requestHasToken(undefined, 'abc', token)).toBe(false);
    expect(requestHasToken(undefined, '', token)).toBe(false);
  });
});

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bw-files-'));
}

describe('readRepoFile', () => {
  it('returns text for a listed file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'a.ts'), "export const a = 1;\n");
    const result = await readRepoFile(root, 'a.ts', new Set(['a.ts']));
    expect(result).toEqual({ ok: true, path: 'a.ts', text: 'export const a = 1;\n' });
  });

  it('returns 404 when the path is not listed', async () => {
    const root = await scratch();
    expect(await readRepoFile(root, 'nope.ts', new Set())).toEqual({
      ok: false,
      status: 404,
      error: 'no such file',
    });
  });

  it('returns 413 when the file is larger than 1 MiB', async () => {
    const root = await scratch();
    await writeFile(join(root, 'big.txt'), 'x'.repeat(1048577));
    expect(await readRepoFile(root, 'big.txt', new Set(['big.txt']))).toEqual({
      ok: false,
      status: 413,
      error: 'file too large to show',
    });
  });

  it('returns text for a file of exactly 1 MiB', async () => {
    const root = await scratch();
    const text = 'x'.repeat(1048576);
    await writeFile(join(root, 'exact.txt'), text);
    const result = await readRepoFile(root, 'exact.txt', new Set(['exact.txt']));
    expect(result).toEqual({ ok: true, path: 'exact.txt', text });
  });

  it('marks a file binary when a NUL sits in the first 8 KiB', async () => {
    const root = await scratch();
    await writeFile(join(root, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
    expect(await readRepoFile(root, 'blob.bin', new Set(['blob.bin']))).toEqual({
      ok: true,
      path: 'blob.bin',
      binary: true,
    });
  });

  it('marks binary when NUL is at byte 8191', async () => {
    const root = await scratch();
    await writeFile(join(root, 'edge.bin'), Buffer.concat([Buffer.alloc(8191, 0x78), Buffer.from([0])]));
    expect(await readRepoFile(root, 'edge.bin', new Set(['edge.bin']))).toEqual({
      ok: true,
      path: 'edge.bin',
      binary: true,
    });
  });

  it('returns text when NUL is only after the first 8 KiB', async () => {
    const root = await scratch();
    const buf = Buffer.concat([Buffer.alloc(8192, 0x78), Buffer.from([0])]);
    await writeFile(join(root, 'late.txt'), buf);
    const result = await readRepoFile(root, 'late.txt', new Set(['late.txt']));
    expect(result).toEqual({ ok: true, path: 'late.txt', text: buf.toString('utf8') });
  });

  it('returns empty text for an empty file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'empty.txt'), '');
    expect(await readRepoFile(root, 'empty.txt', new Set(['empty.txt']))).toEqual({
      ok: true,
      path: 'empty.txt',
      text: '',
    });
  });

  it('prefers 413 over binary for an oversized NUL file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(1048577, 0));
    expect(await readRepoFile(root, 'huge.bin', new Set(['huge.bin']))).toEqual({
      ok: false,
      status: 413,
      error: 'file too large to show',
    });
  });
});

describe('httpPath', () => {
  it('defaults missing or empty paths', () => {
    expect(httpPath(undefined)).toBe('/');
    expect(httpPath('')).toBe('/');
    expect(httpPath('/api/tree')).toBe('/api/tree');
  });
});

describe('httpMethod', () => {
  it('defaults a missing method to GET', () => {
    expect(httpMethod(undefined)).toBe('GET');
    expect(httpMethod('POST')).toBe('POST');
  });
});
