import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import { graphView } from './domain/graph.ts';
import type { ScanResult } from './domain/scan.ts';
import { buildTree, filePathSet, type TreeRoot } from './domain/tree.ts';
import { listedRegularFiles } from './repo.ts';

export type PortChoice = { mode: 'fixed' | 'range'; port: number };

type AppDeps = { repoRoot: string; uiDir: string };

type App = AppDeps & { token: string };

type ListenError = { kind: 'in-use'; port: number } | { kind: 'none-free'; from: number; to: number };

type Bound = { server: Server; port: number; token: string };

type FileBody = { path: string; text: string } | { path: string; binary: true };

type FileResult = { status: 200; body: FileBody } | { status: 404 | 413; body: { error: string } };

type Handler = (res: ServerResponse, url: URL) => Promise<void>;

type Routes = Map<string, Handler>;

type GraphHolder = { scan?: ScanResult };

const MAX_BYTES = 1048576;
const NUL_WINDOW = 8192;
const RANGE_WIDTH = 20;
const BEARER = 'Bearer ';
const ASSETS_PREFIX = '/assets/';
const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';
const NOT_FOUND = { error: 'not found' };
const NO_SUCH_FILE: FileResult = { status: 404, body: { error: 'no such file' } };
const TOO_LARGE: FileResult = { status: 413, body: { error: 'file too large to show' } };
const ADDR_IN_USE = z.object({ code: z.literal('EADDRINUSE') });
const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': HTML_TYPE,
  '.svg': 'image/svg+xml',
};

function newToken(): string {
  return randomBytes(16).toString('hex');
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function tokensEqual(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

export function listenErrorMessage(err: ListenError): string {
  if (err.kind === 'in-use') return `bindweed: port ${err.port} is in use`;
  return `bindweed: no free port between ${err.from} and ${err.to}`;
}

function isAddrInUse(err: unknown): boolean {
  return ADDR_IN_USE.safeParse(err).success;
}

async function tryPort(server: Server, port: number, fixed: boolean): Promise<'ok' | 'next' | ListenError> {
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return 'ok';
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    return fixed ? { kind: 'in-use', port } : 'next';
  }
}

async function listenRange(
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

function listenForChoice(server: Server, choice: PortChoice): Promise<{ port: number } | { error: ListenError }> {
  if (choice.mode === 'fixed') return listenRange(server, choice.port, choice.port, true);
  return listenRange(server, choice.port, choice.port + RANGE_WIDTH, false);
}

async function readRepoFile(full: string, relPath: string): Promise<FileResult> {
  if ((await stat(full)).size > MAX_BYTES) return TOO_LARGE;
  const bytes = await readFile(full);
  if (bytes.subarray(0, NUL_WINDOW).includes(0)) return { status: 200, body: { path: relPath, binary: true } };
  return { status: 200, body: { path: relPath, text: bytes.toString() } };
}

function send(res: ServerResponse, status: number, type: string, body: Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON_TYPE, Buffer.from(JSON.stringify(body)));
}

function hostAllowed(req: IncomingMessage): boolean {
  const port = req.socket.localPort;
  return req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
}

function bearerToken(header: string | undefined): string | null {
  if (header?.startsWith(BEARER)) return header.slice(BEARER.length);
  return null;
}

function apiTokenOk(token: string, req: IncomingMessage, url: URL): boolean {
  const given = bearerToken(req.headers.authorization) ?? url.searchParams.get('token');
  return given !== null && tokensEqual(given, token);
}

function apiDenied(app: App, req: IncomingMessage, url: URL): boolean {
  return url.pathname.startsWith('/api/') && !apiTokenOk(app.token, req, url);
}

async function serveIndex(app: App, res: ServerResponse, url: URL): Promise<void> {
  const given = url.searchParams.get('token');
  if (given === null || !tokensEqual(given, app.token)) {
    send(res, 401, TEXT_TYPE, Buffer.from('bindweed: use the link bindweed printed in the terminal'));
    return;
  }
  send(res, 200, HTML_TYPE, await readFile(join(app.uiDir, 'index.html')));
}

function assetType(filePath: string): string {
  return ASSET_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

async function serveAsset(app: App, res: ServerResponse, url: URL): Promise<void> {
  try {
    const full = join(app.uiDir, 'assets', url.pathname.slice(ASSETS_PREFIX.length));
    send(res, 200, assetType(full), await readFile(full));
  } catch {
    sendJson(res, 404, NOT_FOUND);
  }
}

async function treeOf(app: App): Promise<TreeRoot> {
  return buildTree(basename(app.repoRoot), await listedRegularFiles(app.repoRoot));
}

async function serveTree(app: App, res: ServerResponse): Promise<void> {
  sendJson(res, 200, await treeOf(app));
}

async function serveFile(app: App, res: ServerResponse, url: URL): Promise<void> {
  const requested = url.searchParams.get('path');
  const listed = filePathSet((await treeOf(app)).entries);
  const path = [...listed].find(file => file === requested);
  const result = path === undefined ? NO_SUCH_FILE : await readRepoFile(join(app.repoRoot, path), path);
  sendJson(res, result.status, result.body);
}

async function scanFor(app: App): Promise<ScanResult> {
  const { scanRepo } = await import('./scan.ts');
  return scanRepo(app.repoRoot, await listedRegularFiles(app.repoRoot));
}

async function serveGraph(app: App, graphs: GraphHolder, res: ServerResponse, url: URL): Promise<void> {
  graphs.scan ??= await scanFor(app);
  const view = graphView(graphs.scan, url.searchParams.get('at') ?? '', basename(app.repoRoot));
  if (view === null) {
    sendJson(res, 404, { error: 'no such directory' });
    return;
  }
  sendJson(res, 200, view);
}

async function serveRescan(app: App, graphs: GraphHolder, res: ServerResponse): Promise<void> {
  const started = Date.now();
  graphs.scan = await scanFor(app);
  sendJson(res, 200, { files: graphs.scan.files.length, ms: Date.now() - started });
}

function routesFor(app: App, graphs: GraphHolder): Routes {
  const table: Routes = new Map();
  const router = {
    get(path: string, handler: Handler) {
      table.set(`GET ${path}`, handler);
    },
    post(path: string, handler: Handler) {
      table.set(`POST ${path}`, handler);
    },
  };
  router.get('/', (res, url) => serveIndex(app, res, url));
  router.get('/assets/', (res, url) => serveAsset(app, res, url));
  router.get('/api/tree', res => serveTree(app, res));
  router.get('/api/file', (res, url) => serveFile(app, res, url));
  router.get('/api/graph', (res, url) => serveGraph(app, graphs, res, url));
  router.post('/api/rescan', res => serveRescan(app, graphs, res));
  return table;
}

function routeFor(routes: Routes, method: string, pathname: string): Handler | undefined {
  const route = pathname.startsWith(ASSETS_PREFIX) ? ASSETS_PREFIX : pathname;
  return routes.get(`${method} ${route}`);
}

async function dispatch(app: App, routes: Routes, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!hostAllowed(req)) {
    sendJson(res, 403, { error: 'bad host' });
    return;
  }
  const url = new URL(String(req.url), 'http://127.0.0.1');
  if (apiDenied(app, req, url)) {
    sendJson(res, 401, { error: 'missing or wrong token' });
    return;
  }
  const handler = routeFor(routes, String(req.method), url.pathname);
  if (handler === undefined) {
    sendJson(res, 404, NOT_FOUND);
    return;
  }
  await handler(res, url);
}

function createAppServer(app: App): Server {
  const graphs: GraphHolder = {};
  const routes = routesFor(app, graphs);
  return createServer((req, res) => {
    dispatch(app, routes, req, res).catch(() => sendJson(res, 500, { error: 'internal error' }));
  });
}

export async function bindApp(deps: AppDeps, choice: PortChoice): Promise<Bound | { error: ListenError }> {
  const app: App = { ...deps, token: newToken() };
  const server = createAppServer(app);
  const listened = await listenForChoice(server, choice);
  if ('error' in listened) return { error: listened.error };
  return { server, port: listened.port, token: app.token };
}
