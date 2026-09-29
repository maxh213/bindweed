import { randomBytes, timingSafeEqual } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, join } from 'node:path';
import { buildTree, filePathSet } from './domain/tree.ts';
import { listedRegularFiles, type GitRunner } from './repo.ts';

export type AppDeps = {
  repoRoot: string;
  uiDir: string;
  token: string;
  port: number;
  git?: GitRunner;
};

export type ListenError = { kind: 'in-use'; port: number } | { kind: 'none-free'; from: number; to: number };

export type PortChoice = { mode: 'fixed' | 'range'; port: number };

type FileResult =
  | { ok: true; path: string; text: string }
  | { ok: true; path: string; binary: true }
  | { ok: false; status: 404 | 413; error: string };

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

type RouteTable = Map<string, Handler>;

const MAX_BYTES = 1048576;
const NUL_WINDOW = 8192;

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function newToken(): string {
  return randomBytes(16).toString('hex');
}

export function tokensEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenFromAuth(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return undefined;
  return header.slice(prefix.length);
}

export function requestHasToken(
  authHeader: string | undefined,
  queryToken: string | null,
  expected: string,
): boolean {
  const bearer = tokenFromAuth(authHeader);
  if (bearer !== undefined) return tokensEqual(bearer, expected);
  if (queryToken === null) return false;
  return tokensEqual(queryToken, expected);
}

export function listenErrorMessage(err: ListenError): string {
  if (err.kind === 'in-use') return `bindweed: port ${err.port} is in use`;
  return `bindweed: no free port between ${err.from} and ${err.to}`;
}

function isAddrInUse(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EADDRINUSE';
}

export function bindOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function tryPort(
  server: Server,
  port: number,
  fixed: boolean,
): Promise<'ok' | 'next' | ListenError> {
  try {
    await bindOnce(server, port);
    return 'ok';
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    if (fixed) return { kind: 'in-use', port };
    return 'next';
  }
}

export async function listenRange(
  server: Server,
  start: number,
  end: number,
  fixed: boolean,
): Promise<{ port: number } | { error: ListenError }> {
  for (let port = start; port <= end; port += 1) {
    const result = await tryPort(server, port, fixed);
    if (result === 'ok') return { port };
    if (result !== 'next') return { error: result };
  }
  return { error: { kind: 'none-free', from: start, to: end } };
}

export async function listenForChoice(
  server: Server,
  choice: PortChoice,
): Promise<{ port: number } | { error: ListenError }> {
  if (choice.mode === 'fixed') return listenRange(server, choice.port, choice.port, true);
  return listenRange(server, choice.port, choice.port + 20, false);
}

function hasNul(buf: Buffer): boolean {
  return buf.includes(0);
}

export async function readRepoFile(repoRoot: string, relPath: string, allowed: Set<string>): Promise<FileResult> {
  if (!allowed.has(relPath)) return { ok: false, status: 404, error: 'no such file' };
  const handle = await open(join(repoRoot, relPath), 'r');
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_BYTES) return { ok: false, status: 413, error: 'file too large to show' };
    const headSize = Math.min(stat.size, NUL_WINDOW);
    const head = Buffer.alloc(headSize);
    const { bytesRead } = await handle.read(head, 0, headSize, 0);
    if (hasNul(head.subarray(0, bytesRead))) return { ok: true, path: relPath, binary: true };
    const all = Buffer.alloc(stat.size);
    await handle.read(all, 0, stat.size, 0);
    return { ok: true, path: relPath, text: all.toString('utf8') };
  } finally {
    await handle.close();
  }
}

export function httpPath(url: string | undefined): string {
  if (url === undefined) return '/';
  if (url.length === 0) return '/';
  return url;
}

export function httpMethod(method: string | undefined): string {
  if (method === undefined) return 'GET';
  return method;
}

function createRouter(): { get(path: string, handler: Handler): void; routes: RouteTable } {
  const routes: RouteTable = new Map();
  return {
    routes,
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function assetType(filePath: string): string {
  return ASSET_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

function rawAssetName(pathname: string): string | undefined {
  const raw = pathname.slice('/assets/'.length);
  if (raw.length === 0) return undefined;
  if (raw.includes('..') || raw.includes('%')) return undefined;
  return raw;
}

function safeAssetPath(uiDir: string, pathname: string): string | undefined {
  const raw = rawAssetName(pathname);
  if (raw === undefined) return undefined;
  return join(uiDir, 'assets', raw);
}

async function serveAssetFile(uiDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const full = safeAssetPath(uiDir, pathname);
  if (full === undefined) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  try {
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': assetType(full),
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

async function serveIndex(deps: AppDeps, res: ServerResponse, url: URL): Promise<void> {
  if (!requestHasToken(undefined, url.searchParams.get('token'), deps.token)) {
    sendText(res, 401, 'text/plain; charset=utf-8', 'bindweed: use the link bindweed printed in the terminal');
    return;
  }
  const html = await readFile(join(deps.uiDir, 'index.html'), 'utf8');
  sendText(res, 200, 'text/html; charset=utf-8', html);
}

async function serveTree(deps: AppDeps, res: ServerResponse): Promise<void> {
  const files = await listedRegularFiles(deps.repoRoot, deps.git);
  sendJson(res, 200, buildTree(basename(deps.repoRoot), files));
}

function sendFileResult(res: ServerResponse, result: FileResult): void {
  if (!result.ok) {
    sendJson(res, result.status, { error: result.error });
    return;
  }
  if ('binary' in result) {
    sendJson(res, 200, { path: result.path, binary: true });
    return;
  }
  sendJson(res, 200, { path: result.path, text: result.text });
}

async function serveFile(deps: AppDeps, res: ServerResponse, url: URL): Promise<void> {
  const path = url.searchParams.get('path');
  if (path === null || path.length === 0) {
    sendJson(res, 404, { error: 'no such file' });
    return;
  }
  const files = await listedRegularFiles(deps.repoRoot, deps.git);
  const allowed = filePathSet(buildTree(basename(deps.repoRoot), files).entries);
  sendFileResult(res, await readRepoFile(deps.repoRoot, path, allowed));
}

function mountApp(router: ReturnType<typeof createRouter>, deps: AppDeps): void {
  router.get('/', async (_req, res, url) => serveIndex(deps, res, url));
  router.get('/assets/', async (_req, res, url) => serveAssetFile(deps.uiDir, url.pathname, res));
  router.get('/api/tree', async (_req, res) => serveTree(deps, res));
  router.get('/api/file', async (_req, res, url) => serveFile(deps, res, url));
}

function matchRoute(routes: RouteTable, method: string, pathname: string): Handler | undefined {
  const exact = routes.get(`${method} ${pathname}`);
  if (exact) return exact;
  if (pathname.startsWith('/assets/')) return routes.get(`${method} /assets/`);
  return undefined;
}

function needsApiToken(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

async function checkToken(deps: AppDeps, req: IncomingMessage, url: URL, res: ServerResponse): Promise<boolean> {
  if (!needsApiToken(url.pathname)) return true;
  const ok = requestHasToken(req.headers.authorization, url.searchParams.get('token'), deps.token);
  if (ok) return true;
  sendJson(res, 401, { error: 'missing or wrong token' });
  return false;
}

async function runHandler(
  handler: Handler | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (!handler) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  await handler(req, res, url);
}

async function afterHostOk(
  deps: AppDeps,
  routes: RouteTable,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(httpPath(req.url), `http://127.0.0.1:${deps.port}`);
  if (!(await checkToken(deps, req, url, res))) return;
  await runHandler(matchRoute(routes, httpMethod(req.method), url.pathname), req, res, url);
}

async function dispatch(
  deps: AppDeps,
  routes: RouteTable,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!hostAllowed(req.headers.host, deps.port)) {
    sendJson(res, 403, { error: 'bad host' });
    return;
  }
  await afterHostOk(deps, routes, req, res);
}

export function createAppServer(deps: AppDeps): Server {
  const router = createRouter();
  mountApp(router, deps);
  return createServer((req, res) => {
    void dispatch(deps, router.routes, req, res);
  });
}

export async function bindApp(
  deps: AppDeps,
  portChoice: PortChoice,
): Promise<{ server: Server; port: number } | { error: ListenError }> {
  const server = createAppServer(deps);
  const listened = await listenForChoice(server, portChoice);
  if ('error' in listened) {
    server.close();
    return { error: listened.error };
  }
  deps.port = listened.port;
  return { server, port: listened.port };
}
