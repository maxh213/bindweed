import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { buildTree, filePathSet } from './domain/tree.ts';
import { listedRegularFiles, type GitRunner } from './git.ts';
import { readRepoFile } from './files.ts';
import { requestHasToken } from './token.ts';
import { httpMethod, httpPath } from './http-parts.ts';

export type AppDeps = {
  repoRoot: string;
  uiDir: string;
  token: string;
  port: number;
  git?: GitRunner;
};

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

type RouteTable = Map<string, Handler>;

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

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
};

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

function sendFileResult(res: ServerResponse, result: Awaited<ReturnType<typeof readRepoFile>>): void {
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
