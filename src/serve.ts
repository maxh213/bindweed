import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';
import type { CruiserFile } from './cruiser.ts';
import { contractRules } from './domain/contract.ts';
import { cycleTexts, edgePairs, graphView, nodeDetail, type GraphFlags, type GraphView } from './domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from './domain/layout.ts';
import { contractNamesFrom, PLAN_SLUG_PATTERN, parsePlan, planNameFrom, slugOf, type ContractRule, type PlanDoc } from './domain/plan.ts';
import { applyPlan, plannedShape, planReport, type PlanReport } from './domain/planned.ts';
import type { ScanResult } from './domain/scan.ts';
import { buildTree, filePathSet, type TreeRoot } from './domain/tree.ts';
import { freePlanSlug, listPlans, readPlan, removePlan, writePlan } from './plans.ts';
import { readHealth } from './reports.ts';
import { gitHead, listedRegularFiles } from './repo.ts';

export type PortChoice = { mode: 'fixed' | 'range'; port: number };

type AppDeps = { repoRoot: string; uiDir: string };

type App = AppDeps & { token: string };

type ListenError = { kind: 'in-use'; port: number } | { kind: 'none-free'; from: number; to: number };

type Bound = { server: Server; port: number; token: string };

type FileBody = { path: string; text: string } | { path: string; binary: true };

type FileResult = { status: 200; body: FileBody } | { status: 404 | 413; body: { error: string } };

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

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
const NO_SUCH_PLAN = { error: 'no such plan' };
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

function queryFlag(url: URL, name: string): boolean {
  return url.searchParams.get(name) === '1';
}

function graphFlags(url: URL): GraphFlags {
  return { tests: queryFlag(url, 'tests'), external: queryFlag(url, 'external') };
}

async function readyScan(app: App, graphs: GraphHolder): Promise<ScanResult> {
  if (graphs.scan !== undefined) return graphs.scan;
  graphs.scan = await scanFor(app);
  return graphs.scan;
}

function healthOf(root: string, scan: ScanResult) {
  return readHealth(root, scan.files.map(file => file.path));
}

type PlanLoad = { ok: true; doc: PlanDoc } | { ok: false };

function planQueryOf(url: URL): string | null {
  const plan = url.searchParams.get('plan');
  return plan === null || plan === '' ? null : plan;
}

async function loadPlan(app: App, url: URL): Promise<PlanLoad | null> {
  const slug = planQueryOf(url);
  if (slug === null) return null;
  if (!PLAN_SLUG_PATTERN.test(slug)) return { ok: false };
  const doc = await readPlan(app.repoRoot, slug);
  return doc === undefined ? { ok: false } : { ok: true, doc };
}

function planFailed(load: PlanLoad | null): boolean {
  return load !== null && load.ok === false;
}

function plannedScanOf(scan: ScanResult, load: PlanLoad | null): ScanResult {
  return load !== null && load.ok === true ? applyPlan(scan, load.doc.edits) : scan;
}

type GraphPlan = { scan: ScanResult; report: PlanReport | null };

function graphPlanOf(scan: ScanResult, load: PlanLoad | null): GraphPlan {
  if (load === null || load.ok === false) return { scan, report: null };
  const report = planReport(scan, load.doc.edits, cycleTexts);
  return { scan: report.scan, report };
}

function warningsField(report: PlanReport): { warnings?: PlanReport['warnings'] } {
  if (report.warnings.every(list => list.length === 0)) return {};
  return { warnings: report.warnings };
}

function viewBody(view: GraphView, report: PlanReport | null): GraphView {
  if (report === null) return view;
  return { ...view, stale: report.stale, ...warningsField(report) };
}

async function serveGraph(app: App, graphs: GraphHolder, res: ServerResponse, url: URL): Promise<void> {
  const scan = await readyScan(app, graphs);
  const load = await loadPlan(app, url);
  if (planFailed(load)) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  const plan = graphPlanOf(scan, load);
  const view = graphView(plan.scan, url.searchParams.get('at') ?? '', basename(app.repoRoot), graphFlags(url), healthOf(app.repoRoot, plan.scan));
  if (view === null) {
    sendJson(res, 404, { error: 'no such directory' });
    return;
  }
  sendJson(res, 200, viewBody(view, plan.report));
}

function layoutFile(root: string): string {
  return join(root, '.bindweed', 'layout.json');
}

async function readLayout(root: string): Promise<LayoutDoc> {
  try {
    const bytes = await readFile(layoutFile(root));
    return parseLayout(JSON.parse(bytes.toString('utf8'))) ?? emptyLayout();
  } catch {
    return emptyLayout();
  }
}

async function serveLayout(app: App, res: ServerResponse): Promise<void> {
  sendJson(res, 200, await readLayout(app.repoRoot));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

async function writeLayout(root: string, doc: LayoutDoc): Promise<void> {
  await mkdir(dirname(layoutFile(root)), { recursive: true });
  await writeFile(layoutFile(root), JSON.stringify(doc));
}

type AcceptedLayout = { ok: true; doc: LayoutDoc } | { ok: false };

function layoutFromText(text: string): AcceptedLayout {
  try {
    const doc = parseLayout(JSON.parse(text));
    if (doc === undefined) return { ok: false };
    return { ok: true, doc };
  } catch {
    return { ok: false };
  }
}

async function putLayout(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const read = layoutFromText(await readBody(req));
  if (read.ok === false) {
    sendJson(res, 400, { error: 'bad layout' });
    return;
  }
  await writeLayout(app.repoRoot, read.doc);
  sendJson(res, 200, read.doc);
}

function detailFor(scan: ScanResult, url: URL, rootName: string, health: ReturnType<typeof healthOf>): ReturnType<typeof nodeDetail> {
  const id = url.searchParams.get('id');
  if (typeof id !== 'string') return null;
  return nodeDetail(scan, id, url.searchParams.get('at') ?? '', rootName, graphFlags(url), health);
}

function sendDetail(res: ServerResponse, detail: ReturnType<typeof nodeDetail>): void {
  if (detail === null) {
    sendJson(res, 404, { error: 'no such node' });
    return;
  }
  sendJson(res, 200, detail);
}

async function serveDetail(app: App, graphs: GraphHolder, res: ServerResponse, url: URL): Promise<void> {
  const scan = await readyScan(app, graphs);
  const load = await loadPlan(app, url);
  if (planFailed(load)) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  const planned = plannedScanOf(scan, load);
  sendDetail(res, detailFor(planned, url, basename(app.repoRoot), healthOf(app.repoRoot, planned)));
}

function pairEnds(url: URL): { from: string; to: string } | null {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  return from === null || to === null ? null : { from, to };
}

async function servePairs(app: App, graphs: GraphHolder, res: ServerResponse, url: URL): Promise<void> {
  const ends = pairEnds(url);
  if (ends === null) {
    sendJson(res, 404, NOT_FOUND);
    return;
  }
  const scan = await readyScan(app, graphs);
  const load = await loadPlan(app, url);
  if (planFailed(load)) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  const planned = plannedScanOf(scan, load);
  sendJson(res, 200, { pairs: edgePairs(planned, url.searchParams.get('at') ?? '', ends.from, ends.to, graphFlags(url)) });
}

async function serveRescan(app: App, graphs: GraphHolder, res: ServerResponse): Promise<void> {
  const started = Date.now();
  graphs.scan = await scanFor(app);
  sendJson(res, 200, { files: graphs.scan.files.length, ms: Date.now() - started });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return readBody(req)
    .then(JSON.parse)
    .catch(() => undefined);
}

async function servePlanList(app: App, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { plans: await listPlans(app.repoRoot) });
}

async function postPlan(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const name = planNameFrom(await readJsonBody(req));
  if (name === undefined) {
    sendJson(res, 400, { error: 'bad name' });
    return;
  }
  const head = await gitHead(app.repoRoot);
  if (head === undefined) {
    sendJson(res, 400, { error: 'no commit' });
    return;
  }
  const doc: PlanDoc = {
    version: 1,
    name,
    slug: await freePlanSlug(app.repoRoot, slugOf(name)),
    createdAt: new Date().toISOString(),
    baseCommit: head,
    edits: [],
    redo: [],
  };
  await writePlan(app.repoRoot, doc);
  sendJson(res, 201, doc);
}

async function getPlan(app: App, req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
  const doc = await readPlan(app.repoRoot, slug);
  if (doc === undefined) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  sendJson(res, 200, doc);
}

async function putPlan(app: App, req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
  const doc = parsePlan(await readJsonBody(req));
  if (doc?.slug !== slug) {
    sendJson(res, 400, { error: 'bad plan' });
    return;
  }
  if ((await readPlan(app.repoRoot, slug)) === undefined) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  await writePlan(app.repoRoot, doc);
  sendJson(res, 200, doc);
}

async function deletePlan(app: App, req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
  if (!(await removePlan(app.repoRoot, slug))) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  sendJson(res, 200, { ok: true });
}

type PlanVerb = (app: App, req: IncomingMessage, res: ServerResponse, slug: string) => Promise<void>;

const PLAN_DOC_VERBS: Record<string, PlanVerb> = { GET: getPlan, PUT: putPlan, DELETE: deletePlan };

const PLANS_PREFIX = '/api/plans/';
const CONTRACT_SUFFIX = '/contract';
const CONTRACT_PATH = /^\/api\/plans\/[^/]*\/contract$/;

type ContractVerb = (app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc) => Promise<void>;

async function cruiserSource(root: string): Promise<string | null> {
  return readFile(join(root, '.dependency-cruiser.cjs'), 'utf8').catch(() => null);
}

async function hasTsconfig(root: string): Promise<boolean> {
  return stat(join(root, 'tsconfig.json')).then(
    () => true,
    () => false,
  );
}

type ContractAnswer = { rules: ContractRule[]; cruiser: CruiserFile };

async function contractFor(app: App, graphs: GraphHolder, doc: PlanDoc): Promise<ContractAnswer> {
  const { readCruiser } = await import('./cruiser.ts');
  const cruiser = readCruiser(await cruiserSource(app.repoRoot));
  const shape = plannedShape(await readyScan(app, graphs), doc.edits);
  return { rules: contractRules(shape, !cruiser.keepsCycleRule), cruiser };
}

async function getContract(app: App, graphs: GraphHolder, _req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  sendJson(res, 200, { rules: (await contractFor(app, graphs, doc)).rules });
}

async function postContract(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const names = contractNamesFrom(await readJsonBody(req));
  if (names === undefined) {
    sendJson(res, 400, { error: 'bad contract' });
    return;
  }
  const { rules, cruiser } = await contractFor(app, graphs, doc);
  const chosen = rules.filter(rule => names.includes(rule.name));
  sendJson(res, 200, cruiser.preview(chosen, await hasTsconfig(app.repoRoot)));
}

async function namedPlan(app: App, slug: string): Promise<PlanDoc | undefined> {
  return PLAN_SLUG_PATTERN.test(slug) ? readPlan(app.repoRoot, slug) : undefined;
}

async function servePlanContract(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, url: URL, verb: ContractVerb): Promise<void> {
  const doc = await namedPlan(app, url.pathname.slice(PLANS_PREFIX.length, -CONTRACT_SUFFIX.length));
  if (doc === undefined) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  await verb(app, graphs, req, res, doc);
}

async function servePlanDoc(app: App, req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
  if (!PLAN_SLUG_PATTERN.test(slug)) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  const handler = PLAN_DOC_VERBS[String(req.method)];
  if (handler === undefined) {
    sendJson(res, 404, NOT_FOUND);
    return;
  }
  await handler(app, req, res, slug);
}

function planSlugSegment(pathname: string): string | null {
  if (!pathname.startsWith(PLANS_PREFIX)) return null;
  return pathname.slice(PLANS_PREFIX.length);
}

async function dispatchMiss(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const slug = planSlugSegment(url.pathname);
  if (slug === null || slug.includes('/')) {
    sendJson(res, 404, NOT_FOUND);
    return;
  }
  await servePlanDoc(app, req, res, slug);
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
    put(path: string, handler: Handler) {
      table.set(`PUT ${path}`, handler);
    },
  };
  router.get('/', (_req, res, url) => serveIndex(app, res, url));
  router.get('/assets/', (_req, res, url) => serveAsset(app, res, url));
  router.get('/api/tree', (_req, res) => serveTree(app, res));
  router.get('/api/file', (_req, res, url) => serveFile(app, res, url));
  router.get('/api/graph', (_req, res, url) => serveGraph(app, graphs, res, url));
  router.get('/api/layout', (_req, res) => serveLayout(app, res));
  router.put('/api/layout', (req, res) => putLayout(app, req, res));
  router.get('/api/detail', (_req, res, url) => serveDetail(app, graphs, res, url));
  router.post('/api/rescan', (_req, res) => serveRescan(app, graphs, res));
  router.get('/api/plans', (_req, res) => servePlanList(app, res));
  router.post('/api/plans', (req, res) => postPlan(app, req, res));
  router.get('/api/pairs', (_req, res, url) => servePairs(app, graphs, res, url));
  router.get('/api/plans/<slug>/contract', (req, res, url) => servePlanContract(app, graphs, req, res, url, getContract));
  router.post('/api/plans/<slug>/contract', (req, res, url) => servePlanContract(app, graphs, req, res, url, postContract));
  return table;
}

function routeKey(pathname: string): string {
  if (pathname.startsWith(ASSETS_PREFIX)) return ASSETS_PREFIX;
  return CONTRACT_PATH.test(pathname) ? '/api/plans/<slug>/contract' : pathname;
}

function routeFor(routes: Routes, method: string, pathname: string): Handler | undefined {
  return routes.get(`${method} ${routeKey(pathname)}`);
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
    await dispatchMiss(app, req, res, url);
    return;
  }
  await handler(req, res, url);
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
