import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';
import { launchBody, launchFocus, launchReason } from './domain/launch.ts';
import { inspectLaunch, launchPlan } from './launch.ts';
import type { CruiserFile } from './cruiser.ts';
import { contractRules } from './domain/contract.ts';
import { cycleTexts, edgePairs, graphView, nodeDetail, type GraphFlags, type GraphNode, type GraphView } from './domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from './domain/layout.ts';
import { freshTurn, parseChat, proposeFrom, reviewFrom } from './domain/chat.ts';
import { byStrings, contractNamesFrom, parsePlan, parsePlanEdit, planNameFrom, PLAN_SLUG_PATTERN, slugOf, type ContractRule, type PlanDoc, type PlanEdit } from './domain/plan.ts';
import { applyPlan, plannedShape, planReport, reviewProposed, type PlanReport } from './domain/planned.ts';
import type { ScanResult } from './domain/scan.ts';
import { buildTree, filePathSet, type TreeRoot } from './domain/tree.ts';
import { DEFAULT_LIMITS, generate, propose, readConfig, saveConfig, turnOf, type Limits, type PromptEdge, type PromptNode, type PromptView, type Turn } from './generate.ts';
import { freePlanSlug, listPlans, readChat, readPlan, removePlan, saveTaskFiles, writeChat, writePlan } from './plans.ts';
import { readHealth } from './reports.ts';
import { gitHead, listedRegularFiles } from './repo.ts';

export type PortChoice = { mode: 'fixed' | 'range'; port: number };

type AppDeps = { repoRoot: string; uiDir: string; env?: NodeJS.ProcessEnv; limits?: Limits };

type App = Required<AppDeps> & { token: string; runs: Map<string, AbortController>; launches: Set<string> };

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

function indexToken(req: IncomingMessage, url: URL): string | null {
  return url.searchParams.get('token') ?? bearerToken(req.headers.authorization);
}

function indexAllowed(app: App, req: IncomingMessage, url: URL): boolean {
  const given = indexToken(req, url);
  return given !== null && tokensEqual(given, app.token);
}

async function serveIndex(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!indexAllowed(app, req, url)) {
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

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function planEditsOf(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return [];
  const edits: PlanEdit[] = [];
  for (const item of raw) {
    const edit = parsePlanEdit(item);
    if (edit !== undefined) edits.push(edit);
  }
  return edits;
}

function proposalParam(url: URL): PlanEdit[] {
  const raw = url.searchParams.get('proposals');
  if (raw === null) return [];
  return planEditsOf(parsedJson(raw));
}

function savedEdits(load: PlanLoad | null): PlanEdit[] {
  return load !== null && load.ok === true ? load.doc.edits : [];
}

function drawnScan(scan: ScanResult, planned: ScanResult, saved: PlanEdit[], extra: PlanEdit[]): ScanResult {
  return extra.length === 0 ? planned : applyPlan(scan, [...saved, ...extra]);
}

async function serveGraph(app: App, graphs: GraphHolder, res: ServerResponse, url: URL): Promise<void> {
  const scan = await readyScan(app, graphs);
  const load = await loadPlan(app, url);
  if (planFailed(load)) {
    sendJson(res, 404, NO_SUCH_PLAN);
    return;
  }
  const plan = graphPlanOf(scan, load);
  const planned = drawnScan(scan, plan.scan, savedEdits(load), proposalParam(url));
  const view = graphView(planned, url.searchParams.get('at') ?? '', basename(app.repoRoot), graphFlags(url), healthOf(app.repoRoot, planned));
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
const PLAN_ACTION_PATH = /^\/api\/plans\/[^/]*\/(contract|generate|cancel|files|propose|chat|review|launch)$/;
const CLOSED_FLAGS: GraphFlags = { tests: false, external: false };

type PlanAction = (app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc) => Promise<void>;

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

async function launchContract(app: App, graphs: GraphHolder, root: string, doc: PlanDoc, names: string[]): Promise<{ text: string } | { error: string }> {
  const { readCruiser } = await import('./cruiser.ts');
  const { rules } = await contractFor(app, graphs, doc);
  const chosen = rules.filter(rule => names.includes(rule.name));
  return readCruiser(await cruiserSource(root)).preview(chosen, await hasTsconfig(root));
}

async function getLaunch(app: App, graphs: GraphHolder, _req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const scan = await readyScan(app, graphs);
  const stale = planReport(scan, doc.edits, cycleTexts).stale;
  const focus = launchFocus(scan.files.map(file => file.path), doc.edits, stale);
  sendJson(res, 200, await inspectLaunch({ root: app.repoRoot, env: app.env }, doc.slug, focus));
}

function launchRules(doc: PlanDoc): ContractRule[] {
  return doc.contract?.rules ?? [];
}

async function postLaunch(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const body = launchBody(await readJsonBody(req));
  if (body === undefined) {
    sendJson(res, 400, { error: 'bad launch' });
    return;
  }
  if (app.launches.has(doc.slug)) {
    sendJson(res, 409, { error: 'already running' });
    return;
  }
  app.launches.add(doc.slug);
  try {
    const place = { root: app.repoRoot, env: app.env };
    const reason = launchReason(await inspectLaunch(place, doc.slug, ''), doc, body.tool);
    if (reason !== null) {
      sendJson(res, 409, { error: reason });
      return;
    }
    const names = launchRules(doc).map(rule => rule.name);
    sendJson(res, 200, await launchPlan(place, doc, body, root => launchContract(app, graphs, root, doc, names)));
  } finally {
    app.launches.delete(doc.slug);
  }
}

async function serveConfig(app: App, res: ServerResponse): Promise<void> {
  sendJson(res, 200, await readConfig(app.repoRoot));
}

async function putConfig(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = await saveConfig(app.repoRoot, await readJsonBody(req));
  if (config === undefined) {
    sendJson(res, 400, { error: 'bad config' });
    return;
  }
  sendJson(res, 200, config);
}

async function generated(app: App, graphs: GraphHolder, doc: PlanDoc, turn: Turn, signal: AbortSignal): Promise<Record<string, unknown>> {
  const scan = await readyScan(app, graphs);
  const result = await generate({
    place: { root: app.repoRoot, env: app.env, limits: app.limits, signal },
    doc,
    turn,
    scan,
    warnings: planReport(scan, doc.edits, cycleTexts).warnings.flat(),
    latest: () => readPlan(app.repoRoot, doc.slug),
  });
  if (result.plan !== undefined) await writePlan(app.repoRoot, result.plan);
  return result.body;
}

async function postGenerate(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const turn = turnOf(await readJsonBody(req), doc);
  if (turn === undefined) {
    sendJson(res, 400, { error: 'bad generate' });
    return;
  }
  if (app.runs.has(doc.slug)) {
    sendJson(res, 409, { error: 'already running' });
    return;
  }
  const controller = new AbortController();
  app.runs.set(doc.slug, controller);
  try {
    sendJson(res, 200, await generated(app, graphs, doc, turn, controller.signal));
  } finally {
    app.runs.delete(doc.slug);
  }
}

async function postCancel(app: App, _graphs: GraphHolder, _req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const run = app.runs.get(doc.slug);
  run?.abort();
  sendJson(res, 200, { cancelled: run !== undefined });
}

async function postFiles(app: App, _graphs: GraphHolder, _req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  sendJson(res, 200, { dir: await saveTaskFiles(app.repoRoot, doc) });
}

async function namedPlan(app: App, slug: string): Promise<PlanDoc | undefined> {
  return PLAN_SLUG_PATTERN.test(slug) ? readPlan(app.repoRoot, slug) : undefined;
}

async function servePlanAction(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, url: URL, verb: PlanAction): Promise<void> {
  const doc = await namedPlan(app, url.pathname.slice(PLANS_PREFIX.length, url.pathname.lastIndexOf('/')));
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

function countsOf(node: GraphNode): { ca: number; ce: number } | undefined {
  if (node.ca === undefined || node.ce === undefined) return undefined;
  return { ca: node.ca, ce: node.ce };
}

function ratiosOf(node: GraphNode): { i: string; a: string; d: string } | undefined {
  if (node.i === undefined || node.a === undefined || node.d === undefined) return undefined;
  return { i: node.i, a: node.a, d: node.d };
}

function fileCount(node: GraphNode): number | undefined {
  if (node.kind !== 'package') return undefined;
  return node.files;
}

function promptNode(node: GraphNode): PromptNode | undefined {
  const counts = countsOf(node);
  const ratios = ratiosOf(node);
  if (counts === undefined || ratios === undefined) return undefined;
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    files: fileCount(node),
    ca: counts.ca,
    ce: counts.ce,
    i: ratios.i,
    a: ratios.a,
    d: ratios.d,
    zone: node.zone,
    crap: node.crap,
    coverage: node.coverage,
    mutants: node.mutants,
    cycle: node.cycle,
  };
}

function promptNodes(nodes: GraphNode[]): PromptNode[] {
  const prompts: PromptNode[] = [];
  for (const node of nodes) {
    const prompt = promptNode(node);
    if (prompt === undefined) continue;
    prompts.push(prompt);
  }
  return prompts;
}

function promptEdge(edge: GraphView['edges'][number]): PromptEdge {
  return { from: edge.from, to: edge.to, runtime: edge.runtime, type: edge.type, heritage: edge.heritage, cycle: edge.cycle, cycleText: edge.cycleText };
}

export function toPromptView(view: GraphView, at: string): PromptView {
  return { at, nodes: promptNodes(view.nodes), edges: view.edges.map(promptEdge) };
}

function childIds(view: GraphView): string[] {
  return view.nodes.flatMap(node => (node.kind === 'package' ? [node.id] : [])).sort(byStrings);
}

function viewed(scan: ScanResult, at: string, rootName: string, health: ReturnType<typeof healthOf>): GraphView | null {
  return graphView(scan, at, rootName, CLOSED_FLAGS, health);
}

function childPrompt(scan: ScanResult, id: string, rootName: string, health: ReturnType<typeof healthOf>): PromptView {
  const child = viewed(scan, id, rootName, health);
  if (child === null) return { at: id, nodes: [], edges: [] };
  return toPromptView(child, id);
}

function promptViews(scan: ScanResult, at: string, rootName: string, health: ReturnType<typeof healthOf>): PromptView[] | null {
  const current = viewed(scan, at, rootName, health);
  if (current === null) return null;
  const children = childIds(current).map(id => childPrompt(scan, id, rootName, health));
  return [toPromptView(current, at), ...children];
}

type ProposeAsk = { text: string; at: string };

async function proposed(app: App, graphs: GraphHolder, doc: PlanDoc, ask: ProposeAsk, signal: AbortSignal, views: PromptView[]): Promise<Record<string, unknown>> {
  const turns = await readChat(app.repoRoot, doc.slug);
  const result = await propose({
    place: { root: app.repoRoot, env: app.env, limits: app.limits, signal },
    doc,
    facts: { name: doc.name, text: ask.text, at: ask.at, views, edits: doc.edits, turns },
  });
  if (result.proposal === undefined) return result.body;
  const stale = reviewProposed(await readyScan(app, graphs), doc.edits, result.proposal.edits);
  const chat = [...turns, freshTurn(ask.text, result.proposal.summary, result.proposal.edits, new Date().toISOString())];
  await writeChat(app.repoRoot, doc.slug, chat);
  return { ...result.body, stale, chat };
}

async function postPropose(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const ask = proposeFrom(await readJsonBody(req));
  if (ask === undefined) {
    sendJson(res, 400, { error: 'bad propose' });
    return;
  }
  const scan = applyPlan(await readyScan(app, graphs), doc.edits);
  const views = promptViews(scan, ask.at, basename(app.repoRoot), healthOf(app.repoRoot, scan));
  if (views === null) {
    sendJson(res, 400, { error: 'bad propose' });
    return;
  }
  if (app.runs.has(doc.slug)) {
    sendJson(res, 409, { error: 'already running' });
    return;
  }
  const controller = new AbortController();
  app.runs.set(doc.slug, controller);
  try {
    sendJson(res, 200, await proposed(app, graphs, doc, ask, controller.signal, views));
  } finally {
    app.runs.delete(doc.slug);
  }
}

async function getChat(app: App, _graphs: GraphHolder, _req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  sendJson(res, 200, await readChat(app.repoRoot, doc.slug));
}

async function putChat(app: App, _graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const chat = parseChat(await readJsonBody(req));
  if (chat === undefined) {
    sendJson(res, 400, { error: 'bad chat' });
    return;
  }
  await writeChat(app.repoRoot, doc.slug, chat);
  sendJson(res, 200, chat);
}

async function postReview(app: App, graphs: GraphHolder, req: IncomingMessage, res: ServerResponse, doc: PlanDoc): Promise<void> {
  const edits = reviewFrom(await readJsonBody(req));
  if (edits === undefined) {
    sendJson(res, 400, { error: 'bad review' });
    return;
  }
  sendJson(res, 200, { stale: reviewProposed(await readyScan(app, graphs), doc.edits, edits) });
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
  router.get('/', (req, res, url) => serveIndex(app, req, res, url));
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
  router.get('/api/plans/<slug>/contract', (req, res, url) => servePlanAction(app, graphs, req, res, url, getContract));
  router.post('/api/plans/<slug>/contract', (req, res, url) => servePlanAction(app, graphs, req, res, url, postContract));
  router.post('/api/plans/<slug>/generate', (req, res, url) => servePlanAction(app, graphs, req, res, url, postGenerate));
  router.post('/api/plans/<slug>/cancel', (req, res, url) => servePlanAction(app, graphs, req, res, url, postCancel));
  router.post('/api/plans/<slug>/files', (req, res, url) => servePlanAction(app, graphs, req, res, url, postFiles));
  router.post('/api/plans/<slug>/propose', (req, res, url) => servePlanAction(app, graphs, req, res, url, postPropose));
  router.get('/api/plans/<slug>/chat', (req, res, url) => servePlanAction(app, graphs, req, res, url, getChat));
  router.put('/api/plans/<slug>/chat', (req, res, url) => servePlanAction(app, graphs, req, res, url, putChat));
  router.post('/api/plans/<slug>/review', (req, res, url) => servePlanAction(app, graphs, req, res, url, postReview));
  router.get('/api/plans/<slug>/launch', (req, res, url) => servePlanAction(app, graphs, req, res, url, getLaunch));
  router.post('/api/plans/<slug>/launch', (req, res, url) => servePlanAction(app, graphs, req, res, url, postLaunch));
  router.get('/api/config', (_req, res) => serveConfig(app, res));
  router.put('/api/config', (req, res) => putConfig(app, req, res));
  router.get('/api/repo', async (_req, res) => sendJson(res, 200, { root: app.repoRoot }));
  return table;
}

function routeKey(pathname: string): string {
  if (pathname.startsWith(ASSETS_PREFIX)) return ASSETS_PREFIX;
  return pathname.replace(PLAN_ACTION_PATH, '/api/plans/<slug>/$1');
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
  const app: App = { env: process.env, limits: DEFAULT_LIMITS, ...deps, token: newToken(), runs: new Map(), launches: new Set() };
  const server = createAppServer(app);
  const listened = await listenForChoice(server, choice);
  if ('error' in listened) return { error: listened.error };
  return { server, port: listened.port, token: app.token };
}
