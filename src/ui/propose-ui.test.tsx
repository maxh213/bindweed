import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { cycleTexts, edgePairs, graphView, nodeDetail, type GraphView } from '../domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from '../domain/layout.ts';
import { freshTurn, parseChat, proposeFrom, reviewFrom, type ChatTurn } from '../domain/chat.ts';
import { freeSlug, parsePlan, parsePlanEdit, planNameFrom, PLAN_SLUG_PATTERN, slugOf, summarisePlan, type PlanDoc, type PlanEdit } from '../domain/plan.ts';
import { applyPlan, planReport, reviewProposed } from '../domain/planned.ts';

vi.mock('@xyflow/react', async () => {
  const { createElement: ce, useEffect, useState } = await import('react');

  type FakeNode = {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    draggable?: boolean;
  };
  type FakeEdge = { id: string; source: string; target: string; type: string; data?: Record<string, unknown>; markerEnd?: unknown };
  type FakeFlowProps = {
    nodes: FakeNode[];
    edges: FakeEdge[];
    nodeTypes: Record<string, (props: never) => ReactElement | null>;
    edgeTypes: Record<string, (props: never) => ReactElement | null>;
    nodesConnectable?: boolean;
    onNodeClick?: (event: unknown, node: FakeNode) => void;
    onNodeDoubleClick?: (event: unknown, node: FakeNode) => void;
    onNodeDragStop?: (event: unknown, node: FakeNode) => void;
    onEdgeClick?: (event: unknown, edge: FakeEdge) => void;
    onPaneClick?: (event: unknown) => void;
    onConnect?: (connection: { source: string; target: string }) => void;
  };

  let dropAt: { x: number; y: number } | null = null;
  let lastFlow: FakeFlowProps | null = null;
  const centers: { x: number; y: number }[] = [];

  function dropPosition(node: FakeNode): { x: number; y: number } {
    return dropAt ?? node.position;
  }

  function onMouseUp(props: FakeFlowProps, node: FakeNode, event: { altKey: boolean; nativeEvent?: unknown }): void {
    if (!event.altKey) return;
    props.onNodeDragStop?.(event.nativeEvent ?? {}, { ...node, position: dropPosition(node) });
  }

  function fakeNodeView(props: FakeFlowProps, node: FakeNode) {
    const Box = props.nodeTypes[node.type];
    return ce(
      'div',
      {
        key: node.id,
        className: 'fake-node',
        'data-node': node.id,
        'data-px': String(node.position.x),
        'data-py': String(node.position.y),
        onClick: () => props.onNodeClick?.({}, node),
        onDoubleClick: (event: unknown) => props.onNodeDoubleClick?.(event, node),
        onMouseUp: (event: { altKey: boolean; nativeEvent?: unknown }) => onMouseUp(props, node, event),
      },
      ce(Box as (props: { id: string; data: Record<string, unknown> }) => ReactElement | null, { id: node.id, data: node.data }),
    );
  }

  function fakeEdgeView(props: FakeFlowProps, edge: FakeEdge) {
    const Arrow = props.edgeTypes[edge.type];
    return ce(
      'g',
      { key: edge.id, onClick: () => props.onEdgeClick?.({}, edge) },
      ce(Arrow as (props: Record<string, unknown>) => ReactElement | null, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: edge.data,
        sourceX: 0,
        sourceY: 0,
        targetX: 0,
        targetY: 140,
        sourcePosition: 'bottom',
        targetPosition: 'top',
        markerEnd: edge.markerEnd,
      }),
    );
  }

  function paneClick(props: FakeFlowProps, event: { target?: unknown; currentTarget?: unknown }): void {
    if (event.target !== event.currentTarget) return;
    props.onPaneClick?.(event);
  }

  function ReactFlow(props: FakeFlowProps) {
    const [stamp] = useState(() => centers.length);
    useEffect(() => {
      lastFlow = props;
    });
    const probe = fakeEdgeView(props, { id: 'probe', source: '', target: '', type: 'arrow' });
    const probeCut = fakeEdgeView(props, { id: 'probe-cut', source: '', target: '', type: 'cutmark' });
    const probeProposalCut = fakeEdgeView(props, { id: 'probe-proposal-cut', source: '', target: '', type: 'proposalcut' });
    const probeProposalArrow = fakeEdgeView(props, { id: 'probe-proposal-arrow', source: '', target: '', type: 'proposalarrow' });
    return ce(
      'div',
      {
        className: 'fake-flow',
        'data-stamp': String(stamp),
        'data-connectable': String(props.nodesConnectable),
        onClick: (event: { target?: unknown; currentTarget?: unknown }) => paneClick(props, event),
      },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge)), probe, probeCut, probeProposalCut, probeProposalArrow),
    );
  }

  function dashText(style: { strokeDasharray?: string } | undefined): string {
    return style?.strokeDasharray ?? '';
  }

  function baseEdge(props: { id: string; path: string; style?: { stroke?: string; strokeWidth?: number; strokeDasharray?: string }; markerEnd?: unknown }) {
    return ce('path', {
      className: 'fake-edge-path',
      'data-edge': props.id,
      d: props.path,
      'data-stroke': props.style?.stroke ?? '',
      'data-stroke-width': String(props.style?.strokeWidth),
      'data-dash': dashText(props.style),
      'data-marker': JSON.stringify(props.markerEnd),
    });
  }

  function ReactFlowProvider(props: { children: ReactElement }) {
    return props.children;
  }

  const flowApi = {
    setCenter: (x: number, y: number) => {
      centers.push({ x, y });
      return Promise.resolve(true);
    },
  };

  function useReactFlow() {
    return flowApi;
  }

  Object.assign(globalThis, {
    proposeUiArmDrop: (shift: { x: number; y: number } | null) => {
      dropAt = shift;
    },
    proposeUiCenters: centers,
    proposeUiConnect: (source: string, target: string) => {
      lastFlow?.onConnect?.({ source, target });
    },
  });

  return {
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    BaseEdge: baseEdge,
    Handle: (props: { type?: string; 'aria-label'?: string; isConnectable?: boolean }) =>
      ce('span', { 'data-handle': props.type ?? '', 'data-connectable': String(props.isConnectable), 'aria-label': props['aria-label'] }),
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
    ConnectionMode: { Loose: 'loose', Strict: 'strict' },
    EdgeLabelRenderer: (props: { children: ReactElement }) => props.children,
    getBezierPath: () => ['M0,0 L0,140', 0, 70],
  };
});

const PURPLE = 'rgb(124, 58, 237)';
const DASH = '\u2014';
const sheet = process.getBuiltinModule('node:fs').readFileSync(new URL('./app.css', import.meta.url), 'utf8');

const CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const PACKAGE: PlanEdit = { kind: 'create-package', path: 'src/ports' };
const MOVE: PlanEdit = { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' };
const MISSING: PlanEdit = { kind: 'move-file', file: 'src/no-such.ts', to: 'src/ports' };
const KEEP: PlanEdit = { kind: 'add-edge', from: 'src/domain', to: 'src/app' };
const FOUR: PlanEdit[] = [CUT, PACKAGE, MOVE, MISSING];
const FOLD = { kind: 'fold', file: 'src/app/a.ts' };
const JOBS: unknown[] = [
  { kind: 'split-package', package: 'src/app', parts: [{ name: 'scan', files: ['src/app/a.ts'] }, { name: 'jobs', files: ['src/app/b.ts'] }] },
  { kind: 'move-file', file: 'src/app/scan/a.ts', to: 'src/infra' },
  { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' },
  { kind: 'note', target: { node: 'src/app' }, text: 'three jobs' },
];
const RENAME: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/store' };
const MERGE: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/domain'], into: 'src/domain' };
const RENAME_FILE: PlanEdit = { kind: 'rename-file', from: 'src/infra/db.ts', to: 'store.ts' };
const FOLD_FILE: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/a.ts' };
const MOVE_IN: PlanEdit = { kind: 'move-file', file: 'src/infra/db.ts', to: 'src/app' };

const CUT_SENTENCE = 'src/app must not import src/domain (1 import)';
const PACKAGE_SENTENCE = 'Create package src/ports';
const MOVE_SENTENCE = 'Move src/app/b.ts to src/ports';
const MISSING_SENTENCE = 'Move src/no-such.ts to src/ports';
const KEEP_SENTENCE = 'src/domain should use src/app';
const loose = z.record(z.string(), z.unknown());
const SUMMARY = 'Pull scanning out of the ui so app has one job.';
const KEEP_SUMMARY = 'Leave scanning in app.';
const MISSING_LINE = `dropped: ${MISSING_SENTENCE} ${DASH} no such file src/no-such.ts`;
const MOVE_EARLY = `dropped: ${MOVE_SENTENCE} ${DASH} no such directory src/ports`;
const STALE_CUT = `dropped: ${CUT_SENTENCE} ${DASH} src/app/a.ts no longer imports src/domain/model.ts`;
const FOLD_JSON = JSON.stringify(FOLD);
const FOLD_LINE = `dropped: ${FOLD_JSON} ${DASH} not an edit`;
const SPLIT_SENTENCE = 'Split src/app into src/app/scan (1 file) and src/app/jobs (1 file)';
const JOB_MOVE = 'Move src/app/scan/a.ts to src/infra';
const DELETE_SENTENCE = 'Delete src/infra/db.ts';
const NOTE_SENTENCE = 'Note on src/app: "three jobs"';

const QUESTIONS = {
  questions: [
    { id: 'q1', text: 'Must a.ts keep exporting a?', why: 'Other code may import it.' },
    { id: 'q2', text: 'Should b.ts move before the cut?', why: 'The order decides which slice breaks the build.' },
  ],
};
const PROPOSALS = { summary: SUMMARY, edits: FOUR };
const KEEP_REPLY = { summary: KEEP_SUMMARY, edits: [KEEP] };
const JOBS_REPLY = { summary: 'Give each job its own package.', edits: JOBS };

type Hit = { status: number; body: unknown };
type Example = { edit: PlanEdit; at: string; sentence: string; check: () => void };
type Report = ReturnType<typeof planReport>;

const HEAD = 'a'.repeat(40);
const TREE = { root: 'layered', entries: [{ name: 'src', path: 'src', kind: 'dir' as const, children: [] }] };
type ScanShape = Parameters<typeof applyPlan>[0];

const SCAN: ScanShape = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/domain/model.ts', test: false },
    { path: 'src/infra/db.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' },
    { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' },
  ],
  externals: [],
  workspaces: [],
};

const plans = new Map<string, PlanDoc>();
const chats = new Map<string, string>();
let layout: LayoutDoc = emptyLayout();
let running: ((body: unknown) => void) | null = null;

const held: { fault: string; command: string; ran: number; dom?: JSDOM; reactRoot?: Root } = { fault: 'none', command: 'fake', ran: 0 };

const FAULTS: Record<string, (method: string, path: string) => boolean> = {
  down: (method, path) => method === 'POST' && path.includes('/propose'),
  review: (method, path) => method === 'POST' && path.includes('/review'),
  chat: (method, path) => method === 'PUT' && path.includes('/chat'),
  plan: (method, path) => method === 'PUT' && path.endsWith('/api/plans/gate'),
  'plan-get': (method, path) => method === 'GET' && path.endsWith('/api/plans/gate'),
  'chat-get': (method, path) => method === 'GET' && path.includes('/chat'),
  proposal: (method, path) => method === 'GET' && path.includes('proposals='),
};

function resetWorld(): void {
  plans.clear();
  chats.clear();
  layout = emptyLayout();
  running = null;
  held.fault = 'none';
  held.command = 'fake';
  held.ran = 0;
}

function missing(): Hit {
  return { status: 404, body: { error: 'no such plan' } };
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function editsOf(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return [];
  const edits: PlanEdit[] = [];
  for (const item of raw) {
    const edit = parsePlanEdit(item);
    if (edit !== undefined) edits.push(edit);
  }
  return edits;
}

function proposalEdits(raw: string | null): PlanEdit[] {
  if (raw === null) return [];
  return editsOf(parsedJson(raw));
}

function flagsOf(url: URL): { tests: boolean; external: boolean } {
  return { tests: url.searchParams.get('tests') === '1', external: url.searchParams.get('external') === '1' };
}

function queryText(url: URL, name: string): string {
  return url.searchParams.get(name) ?? '';
}

function storedPlan(slug: string | null): PlanDoc | null | false {
  if (slug === null || slug === '') return null;
  return planBySlug(slug);
}

function planBySlug(slug: string): PlanDoc | false {
  if (!PLAN_SLUG_PATTERN.test(slug)) return false;
  const doc = plans.get(slug);
  return doc === undefined ? false : doc;
}

function baseScan(doc: PlanDoc | null): ScanShape {
  if (doc === null) return SCAN;
  return planReport(SCAN, doc.edits, cycleTexts).scan;
}

function withProposals(scan: ScanShape, extra: PlanEdit[]): ScanShape {
  if (extra.length === 0) return scan;
  return applyPlan(scan, extra);
}

function reportOf(doc: PlanDoc | null): Report | null {
  if (doc === null) return null;
  return planReport(SCAN, doc.edits, cycleTexts);
}

function quietReport(report: Report): boolean {
  return report.warnings.every(list => list.length === 0);
}

function viewBody(view: GraphView, report: Report | null): GraphView {
  if (report === null) return view;
  if (quietReport(report)) return { ...view, stale: report.stale };
  return { ...view, stale: report.stale, warnings: report.warnings };
}

function drawnHit(url: URL, doc: PlanDoc | null): Hit {
  const report = reportOf(doc);
  const scan = withProposals(report === null ? SCAN : report.scan, proposalEdits(url.searchParams.get('proposals')));
  const view = graphView(scan, queryText(url, 'at'), 'layered', flagsOf(url));
  if (view === null) return { status: 404, body: { error: 'no such directory' } };
  return { status: 200, body: viewBody(view, report) };
}

function graphHit(url: URL): Hit {
  const doc = storedPlan(url.searchParams.get('plan'));
  if (doc === false) return missing();
  return drawnHit(url, doc);
}

function detailHit(url: URL): Hit {
  const doc = storedPlan(url.searchParams.get('plan'));
  if (doc === false) return missing();
  const detail = nodeDetail(baseScan(doc), url.searchParams.get('id'), queryText(url, 'at'), 'layered', flagsOf(url));
  if (detail === null) return { status: 404, body: { error: 'no such node' } };
  return { status: 200, body: detail };
}

function pairsHit(url: URL): Hit {
  const doc = storedPlan(url.searchParams.get('plan'));
  if (doc === false) return missing();
  const pairs = edgePairs(baseScan(doc), queryText(url, 'at'), queryText(url, 'from'), queryText(url, 'to'), flagsOf(url));
  return { status: 200, body: { pairs } };
}

function layoutPut(raw: unknown): Hit {
  const doc = parseLayout(raw);
  if (doc === undefined) return { status: 400, body: { error: 'bad layout' } };
  layout = doc;
  return { status: 200, body: doc };
}

function listHit(): Hit {
  return { status: 200, body: { plans: [...plans.values()].map(summarisePlan) } };
}

function createHit(raw: unknown): Hit {
  const name = planNameFrom(raw);
  if (name === undefined) return { status: 400, body: { error: 'bad name' } };
  const slug = freeSlug(slugOf(name), candidate => plans.has(candidate));
  const doc: PlanDoc = { version: 1, name, slug, createdAt: new Date().toISOString(), baseCommit: HEAD, edits: [], redo: [] };
  plans.set(slug, doc);
  return { status: 201, body: doc };
}

function getPlan(slug: string): Hit {
  const doc = plans.get(slug);
  if (doc === undefined) return missing();
  return { status: 200, body: doc };
}

function putPlanDoc(slug: string, raw: unknown): Hit {
  if (!plans.has(slug)) return missing();
  const doc = parsePlan(raw);
  if (doc === undefined || doc.slug !== slug) return { status: 400, body: { error: 'bad plan' } };
  plans.set(slug, doc);
  return { status: 200, body: doc };
}

function deletePlanDoc(slug: string): Hit {
  if (!plans.has(slug)) return missing();
  plans.delete(slug);
  chats.delete(slug);
  return { status: 200, body: { ok: true } };
}

function planDocHit(method: string, slug: string, raw: unknown): Hit | null {
  if (method === 'GET') return getPlan(slug);
  if (method === 'PUT') return putPlanDoc(slug, raw);
  if (method === 'DELETE') return deletePlanDoc(slug);
  return null;
}

function planSlugHit(method: string, slug: string, raw: unknown): Hit {
  if (!PLAN_SLUG_PATTERN.test(slug)) return missing();
  const found = planDocHit(method, slug, raw);
  return found === null ? missing() : found;
}

function turnsFrom(text: string): ChatTurn[] {
  return parseChat(parsedJson(text)) ?? [];
}

function readTurns(slug: string): ChatTurn[] {
  const text = chats.get(slug);
  if (text === undefined) return [];
  return turnsFrom(text);
}

function writeTurns(slug: string, turns: ChatTurn[]): void {
  chats.set(slug, JSON.stringify(turns));
}

function getChat(slug: string): Hit {
  return { status: 200, body: readTurns(slug) };
}

function putChatDoc(slug: string, raw: unknown): Hit {
  const chat = parseChat(raw);
  if (chat === undefined) return { status: 400, body: { error: 'bad chat' } };
  writeTurns(slug, chat);
  return { status: 200, body: chat };
}

function chatHit(method: string, doc: PlanDoc, raw: unknown): Hit {
  if (method === 'GET') return getChat(doc.slug);
  if (method === 'PUT') return putChatDoc(doc.slug, raw);
  return { status: 404, body: { error: 'not found' } };
}

function postReview(doc: PlanDoc, raw: unknown): Hit {
  const edits = reviewFrom(raw);
  if (edits === undefined) return { status: 400, body: { error: 'bad review' } };
  return { status: 200, body: { stale: reviewProposed(SCAN, doc.edits, edits) } };
}

function reviewHit(method: string, doc: PlanDoc, raw: unknown): Hit {
  if (method !== 'POST') return { status: 404, body: { error: 'not found' } };
  return postReview(doc, raw);
}

function canned(text: string): { summary: string; edits: unknown[] } | null {
  if (text.includes('keep scan where it is')) return KEEP_REPLY;
  if (text.includes('the ui knows about the scanner')) return { summary: PROPOSALS.summary, edits: PROPOSALS.edits };
  if (text.includes('app is doing three jobs')) return JOBS_REPLY;
  return null;
}

function refused(command: string): Record<string, unknown> | null {
  if (command !== 'echo nope') return null;
  return { error: "the LLM's reply was not usable: it is not valid JSON", raw: 'nope\n', ran: 'command: echo nope' };
}

function unusable(): Hit {
  return { status: 200, body: { error: "the LLM's reply was not usable: it needs a summary and an edits array", raw: '', ran: 'command: fake' } };
}

function proposeBody(doc: PlanDoc, text: string, reply: { summary: string; edits: unknown[] }): Record<string, unknown> {
  const chat = [...readTurns(doc.slug), freshTurn(text, reply.summary, reply.edits, new Date().toISOString())];
  writeTurns(doc.slug, chat);
  held.ran += 1;
  return { ran: 'command: fake', summary: reply.summary, edits: reply.edits, stale: reviewProposed(SCAN, doc.edits, reply.edits), chat };
}

function answeredPropose(doc: PlanDoc, text: string): Hit {
  const refusedBody = refused(held.command);
  if (refusedBody !== null) return { status: 200, body: refusedBody };
  const reply = canned(text);
  if (reply === null) return unusable();
  return { status: 200, body: proposeBody(doc, text, reply) };
}

function viewOk(doc: PlanDoc, at: string): boolean {
  return graphView(applyPlan(SCAN, doc.edits), at, 'layered') !== null;
}

function sleepHit(): Promise<Hit> {
  return new Promise(resolve => {
    running = body => resolve({ status: 200, body });
  });
}

function openPropose(doc: PlanDoc, ask: { text: string; at: string }): Promise<Hit> {
  if (!viewOk(doc, ask.at)) return Promise.resolve({ status: 400, body: { error: 'bad propose' } });
  if (running !== null) return Promise.resolve({ status: 409, body: { error: 'already running' } });
  if (ask.text.includes('SLEEP-NOW')) return sleepHit();
  return Promise.resolve(answeredPropose(doc, ask.text));
}

function proposeHit(doc: PlanDoc, raw: unknown): Promise<Hit> {
  const ask = proposeFrom(raw);
  if (ask === undefined) return Promise.resolve({ status: 400, body: { error: 'bad propose' } });
  return openPropose(doc, ask);
}

function nextRound(doc: PlanDoc): PlanDoc {
  const interview = doc.interview ?? [];
  return { ...doc, interview: [...interview, { round: interview.length + 1, questions: QUESTIONS.questions, answers: [] }] };
}

function recordStep(raw: object): unknown {
  return 'step' in raw ? raw.step : undefined;
}

function stepOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const step = recordStep(raw);
  return typeof step === 'string' ? step : undefined;
}

function askedPlan(doc: PlanDoc): Hit {
  if (running !== null) return { status: 409, body: { error: 'already running' } };
  const next = nextRound(doc);
  plans.set(doc.slug, next);
  return { status: 200, body: { ran: 'command: fake', plan: next } };
}

function generateHit(method: string, doc: PlanDoc, raw: unknown): Hit {
  if (method !== 'POST' || stepOf(raw) === undefined) return { status: 404, body: { error: 'not found' } };
  return askedPlan(doc);
}

function cancelHit(method: string): Hit {
  if (method !== 'POST') return { status: 404, body: { error: 'not found' } };
  const current = running;
  if (current === null) return { status: 200, body: { cancelled: false } };
  running = null;
  current({ error: 'cancelled', ran: 'command: fake' });
  return { status: 200, body: { cancelled: true } };
}

function otherAction(method: string, doc: PlanDoc, action: string, raw: unknown): Hit {
  if (action === 'generate') return generateHit(method, doc, raw);
  if (action === 'cancel') return cancelHit(method);
  return { status: 404, body: { error: 'not found' } };
}

function runAction(method: string, doc: PlanDoc, action: string, raw: unknown): Promise<Hit> {
  if (action === 'propose') return proposeHit(doc, raw);
  if (action === 'chat') return Promise.resolve(chatHit(method, doc, raw));
  if (action === 'review') return Promise.resolve(reviewHit(method, doc, raw));
  return Promise.resolve(otherAction(method, doc, action, raw));
}

function actionOf(pathname: string): { slug: string; action: string } | null {
  const match = /^\/api\/plans\/([^/]+)\/(propose|chat|review|generate|cancel)$/.exec(pathname);
  if (match === null) return null;
  return { slug: match[1] ?? '', action: match[2] ?? '' };
}

function actionHit(method: string, slug: string, action: string, raw: unknown): Promise<Hit> {
  if (!PLAN_SLUG_PATTERN.test(slug) || !plans.has(slug)) return Promise.resolve(missing());
  return runAction(method, plans.get(slug) as PlanDoc, action, raw);
}

function slugOfPath(pathname: string): string | null {
  const prefix = '/api/plans/';
  if (!pathname.startsWith(prefix)) return null;
  const slug = pathname.slice(prefix.length);
  if (slug.includes('/')) return null;
  return slug;
}

function namedGet(pathname: string): Hit | null {
  if (pathname === '/api/tree') return { status: 200, body: TREE };
  if (pathname === '/api/repo') return { status: 200, body: { root: 'layered' } };
  if (pathname === '/api/config') return { status: 200, body: { llm: { backend: 'command', command: held.command } } };
  return null;
}

function getLeaf(url: URL): Hit | null {
  if (url.pathname === '/api/pairs') return pairsHit(url);
  if (url.pathname === '/api/layout') return { status: 200, body: layout };
  return namedGet(url.pathname);
}

function getDirect(url: URL): Hit | null {
  if (url.pathname === '/api/plans') return listHit();
  if (url.pathname === '/api/graph') return graphHit(url);
  if (url.pathname === '/api/detail') return detailHit(url);
  return getLeaf(url);
}

function postDirect(url: URL, raw: unknown): Hit | null {
  if (url.pathname === '/api/plans') return createHit(raw);
  if (url.pathname === '/api/rescan') return { status: 200, body: { files: SCAN.files.length, ms: 1 } };
  return null;
}

function putDirect(url: URL, raw: unknown): Hit | null {
  if (url.pathname !== '/api/layout') return null;
  const saved = layoutPut(raw);
  return saved;
}

function directHit(method: string, url: URL, raw: unknown): Hit | null {
  if (method === 'GET') return getDirect(url);
  if (method === 'POST') return postDirect(url, raw);
  if (method === 'PUT') return putDirect(url, raw);
  return null;
}

async function dispatch(method: string, url: URL, raw: unknown): Promise<Hit> {
  const direct = directHit(method, url, raw);
  if (direct !== null) return direct;
  const action = actionOf(url.pathname);
  if (action !== null) return actionHit(method, action.slug, action.action, raw);
  const slug = slugOfPath(url.pathname);
  if (slug === null) return { status: 404, body: { error: 'not found' } };
  return planSlugHit(method, slug, raw);
}

function faultHit(kind: string, method: string, path: string): boolean {
  const check = FAULTS[kind];
  if (check === undefined) return false;
  return check(method, path);
}

function blockedResponse(method: string, path: string): Response | null {
  if (held.fault === 'down' && faultHit('down', method, path)) throw new Error('down');
  if (!faultHit(held.fault, method, path)) return null;
  return jsonResponse(500, { error: 'down' });
}

function addressOf(url: string | URL | Request): URL {
  if (typeof url === 'string') return new URL(url, 'http://127.0.0.1');
  if (url instanceof URL) return url;
  return new URL(url.url, 'http://127.0.0.1');
}

function rawBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return parsedJson(init.body);
}

function notePath(method: string, path: string, status: number): boolean {
  if (method !== 'POST') return false;
  if (!path.includes('/propose')) return false;
  return status === 200;
}

function withNote(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  return { ...(body as Record<string, unknown>), note: 'kept' };
}

function noted(method: string, path: string, status: number, body: unknown): unknown {
  if (held.fault !== 'note' || !notePath(method, path, status)) return body;
  return withNote(body);
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

async function proxy(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const address = addressOf(url);
  const method = init?.method ?? 'GET';
  const path = `${address.pathname}${address.search}`;
  const blocked = blockedResponse(method, path);
  if (blocked !== null) return blocked;
  const found = await dispatch(method, address, rawBody(init));
  return jsonResponse(found.status, noted(method, path, found.status, found.body));
}

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => proxy(url, init)) as typeof fetch;


function installDom(url: string): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const w = dom.window;
  const style = w.document.createElement('style');
  style.textContent = sheet;
  w.document.head.appendChild(style);
  Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: w.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: w.Node, configurable: true });
  Object.defineProperty(globalThis, 'DocumentFragment', { value: w.DocumentFragment, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: w.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, 'MouseEvent', { value: w.MouseEvent, configurable: true });
  Object.defineProperty(globalThis, 'KeyboardEvent', { value: w.KeyboardEvent, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: w.getComputedStyle.bind(w), configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  return dom;
}

async function closePage(): Promise<void> {
  const current = held.reactRoot;
  if (current === undefined) return;
  held.reactRoot = undefined;
  const { act } = await import('react');
  await act(async () => {
    current.unmount();
  });
  held.dom?.window.close();
}

async function show(hash: string): Promise<void> {
  await closePage();
  held.dom = installDom(`http://127.0.0.1/?token=tok${hash}`);
  const el = document.getElementById('root');
  if (el === null) throw new Error('missing root');
  const { App } = await import('./App.tsx');
  const { act } = await import('react');
  held.reactRoot = createRoot(el);
  await act(async () => {
    held.reactRoot?.render(createElement(App, { token: 'tok', location: window.location, historyApi: window.history, fetcher }));
  });
}

async function until(check: () => Promise<void> | void): Promise<void> {
  const { waitFor } = await import('@testing-library/dom');
  await waitFor(check, { timeout: 4000 });
}

async function press(el: HTMLElement): Promise<void> {
  const { act } = await import('react');
  await act(async () => {
    el.click();
  });
}

function buttonOrNull(text: string): HTMLElement | null {
  const el = Array.from(document.querySelectorAll('button')).find(item => item.textContent === text);
  return el ?? null;
}

function button(text: string): HTMLElement {
  const el = buttonOrNull(text);
  if (el === null) throw new Error(`missing button ${text}`);
  return el;
}

function askRoot(): HTMLElement {
  const el = document.querySelector('aside[aria-label="ask"]');
  if (el === null) throw new Error('ask');
  return el as HTMLElement;
}

function askButton(text: string): HTMLElement {
  const el = Array.from(askRoot().querySelectorAll('button')).find(item => item.textContent === text);
  if (el === undefined) throw new Error(text);
  return el as HTMLElement;
}

function changeHandler(box: HTMLTextAreaElement): ((event: { currentTarget: HTMLTextAreaElement }) => void) | undefined {
  const key = Object.keys(box).find(name => name.startsWith('__reactProps'));
  if (key === undefined) return undefined;
  const props = (box as unknown as Record<string, { onChange?: (event: { currentTarget: HTMLTextAreaElement }) => void }>)[key];
  return props.onChange;
}

function askBox(): HTMLTextAreaElement {
  const box = document.querySelector('textarea[aria-label="Ask"]');
  if (!(box instanceof window.HTMLTextAreaElement)) throw new Error('ask');
  return box;
}

function writeValue(box: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('setter');
  setter.call(box, value);
}

async function typeAsk(value: string): Promise<void> {
  const box = askBox();
  const onChange = changeHandler(box);
  if (onChange === undefined) throw new Error('ask change');
  const { act } = await import('react');
  await act(async () => {
    writeValue(box, value);
    onChange({ currentTarget: box });
  });
}

function pressedEnter(el: HTMLElement): boolean {
  return el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

async function hoverText(text: string): Promise<void> {
  const { act } = await import('react');
  await act(async () => {
    rowOf(text).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

async function leaveText(text: string): Promise<void> {
  const { act } = await import('react');
  await act(async () => {
    rowOf(text).dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });
}

function proposalItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll('aside[aria-label="proposals"] li'));
}

function proposalTexts(): string[] {
  return proposalItems().map(item => item.querySelector('span')?.textContent ?? '');
}

function rowOf(text: string): HTMLElement {
  const row = proposalItems().find(item => item.querySelector('span')?.textContent === text);
  if (row === undefined) throw new Error(text);
  return row;
}

function buttonsOf(text: string): string[] {
  return Array.from(rowOf(text).querySelectorAll('button')).map(item => item.textContent ?? '');
}

function changeSentences(): string[] {
  return Array.from(document.querySelectorAll('aside[aria-label="changes"] .change-sentence')).map(el => el.textContent ?? '');
}

function isProbe(el: Element): boolean {
  return el.getAttribute('data-from') === '';
}

function proposalMarks(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-proposal="true"]')).filter(el => !isProbe(el)) as HTMLElement[];
}

function box(id: string): HTMLElement {
  const el = document.querySelector(`.box[data-id="${id}"]`);
  if (el === null) throw new Error(`missing box ${id}`);
  return el as HTMLElement;
}

function coord(value: string | undefined): string {
  return value ?? '';
}

function spot(id: string): string {
  const el = box(id);
  return `${coord(el.dataset.x)},${coord(el.dataset.y)}`;
}

function rowPath(row: Element): string {
  return row.getAttribute('data-path') ?? '';
}

function rowPaths(id: string): string[] {
  return Array.from(box(id).querySelectorAll('.box-row')).map(rowPath);
}

function boxName(id: string): HTMLElement {
  const el = box(id).querySelector('.box-name');
  if (el === null) throw new Error(`missing name ${id}`);
  return el as HTMLElement;
}

function pathRow(id: string, path: string): HTMLElement {
  const el = box(id).querySelector(`[data-path="${path}"]`);
  if (el === null) throw new Error(path);
  return el as HTMLElement;
}

function nodeKey(el: Element): string {
  const id = el.getAttribute('data-id');
  if (id !== null) return id;
  return el.getAttribute('data-path') ?? '';
}

function drawnIds(): string[] {
  return Array.from(document.querySelectorAll('[data-id], [data-path]')).map(nodeKey);
}

function strikeKey(el: Element): string {
  const id = el.closest('.box')?.getAttribute('data-id');
  return `strike:${id ?? ''}`;
}

function markKey(el: Element): string {
  const id = el.getAttribute('data-id');
  if (id !== null) return `id:${id}`;
  const path = el.getAttribute('data-path');
  if (path !== null) return `path:${path}`;
  return strikeKey(el);
}

function highlighted(): string[] {
  return Array.from(document.querySelectorAll('[data-highlight="true"]')).map(markKey).sort();
}

function styleOf(el: Element): CSSStyleDeclaration {
  return window.getComputedStyle(el);
}

function expectPurple(el: Element): void {
  expect(styleOf(el).color).toBe(PURPLE);
}

function expectDashed(el: Element): void {
  const style = styleOf(el);
  expect(style.borderTopStyle).toBe('dashed');
  expect(style.color).toBe(PURPLE);
  expect(style.opacity).toBe('1');
}

function expectStrike(el: Element): void {
  const style = styleOf(el);
  expect(style.textDecorationLine).toBe('line-through');
  expect(style.textDecorationColor).toBe(PURPLE);
}

function scissors(): HTMLElement {
  const el = document.querySelector('g.proposal-cut[data-from="src/app"][data-to="src/domain"]');
  if (el === null) throw new Error('scissors');
  return el as HTMLElement;
}

function proposalArrow(from: string, to: string): HTMLElement {
  const el = document.querySelector(`g[data-proposal="true"][data-from="${from}"][data-to="${to}"]`);
  if (el === null) throw new Error(`${from}->${to}`);
  return el as HTMLElement;
}

function arrowDash(from: string, to: string): string {
  const el = document.querySelector(`.fake-edge-path[data-edge="proposal-arrow:${from}->${to}"]`);
  return el?.getAttribute('data-dash') ?? '';
}

function arrowStroke(from: string, to: string): string {
  const el = document.querySelector(`.fake-edge-path[data-edge="proposal-arrow:${from}->${to}"]`);
  return el?.getAttribute('data-stroke') ?? '';
}

const REGION: Record<string, string> = { proposals: 'proposals', changes: 'changes', ask: 'ask' };

function namedRegion(label: string | null): string | null {
  if (label === null) return null;
  return REGION[label] ?? null;
}

function regionName(el: Element): string | null {
  const named = namedRegion(el.getAttribute('aria-label'));
  if (named !== null) return named;
  const text = el.querySelector('button')?.textContent;
  if (text === 'Conversation') return 'Conversation';
  return null;
}

function regionOf(el: Element): string[] {
  const name = regionName(el);
  if (name === null) return [];
  return [name];
}

function askOrder(): string[] {
  const body = document.querySelector('.arch-body');
  if (body === null) return [];
  return Array.from(body.children).flatMap(regionOf);
}

function chatLineText(el: Element): string {
  return el.textContent ?? '';
}

function chatLinesShown(): string[] {
  return Array.from(document.querySelectorAll('.chat-line')).map(chatLineText);
}

function askText(): string {
  return askRoot().textContent ?? '';
}

function noticeText(): string {
  return document.querySelector('output[aria-label="notice"]')?.textContent ?? '';
}

function summaryText(): string {
  return document.querySelector('aside[aria-label="proposals"] p')?.textContent ?? '';
}

function realArrow(from: string, to: string): HTMLElement | null {
  return document.querySelector(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function radioFor(label: string): HTMLElement {
  const radio = Array.from(document.querySelectorAll('input[name="shown-graph"]')).find(el => el.parentElement?.textContent === label);
  if (radio === undefined) throw new Error(label);
  return radio as HTMLElement;
}

async function chooseShown(label: string): Promise<void> {
  await press(radioFor(label));
}

function oneTurn(edits: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: '2026-10-21T09:00:00.000Z', text: 'x', summary: 'y', edits, decisions: {}, ...extra };
}

function chatBytes(slug: string): string | undefined {
  return chats.get(slug);
}

function setChatBytes(slug: string, text: string): void {
  chats.set(slug, text);
}

function planFileNames(): string[] {
  const names = [...plans.keys()].map(slug => `${slug}.json`);
  return names.concat([...chats.keys()].map(slug => `${slug}.chat.json`));
}

async function afterPage(): Promise<void> {
  held.fault = 'none';
  const current = running;
  if (current !== null) {
    running = null;
    current({ error: 'cancelled', ran: 'command: fake' });
  }
  await closePage();
}

function pokeFault(kind: string): void {
  held.fault = kind;
}

type World = {
  read(path: string): Promise<Hit>;
  call(method: string, path: string, body?: unknown): Promise<Hit>;
  plan(edits: PlanEdit[]): Promise<void>;
  propose(text: string, at?: string): Promise<Hit>;
  backend(command: string): Promise<void>;
};

function callHit(method: string, path: string, body?: unknown): Promise<Hit> {
  return dispatch(method, new URL(path, 'http://127.0.0.1'), body);
}

function worldFor(): () => World {
  beforeEach(resetWorld);
  return () => ({
    read: path => callHit('GET', path),
    call: (method, path, body) => callHit(method, path, body),
    async plan(edits) {
      if (!plans.has('gate')) {
        const created = await callHit('POST', '/api/plans', { name: 'Gate' });
        expect(created.status).toBe(201);
      }
      const current = plans.get('gate');
      const put = await callHit('PUT', '/api/plans/gate', { ...current, edits, redo: [] });
      expect(put.status).toBe(200);
    },
    propose: (text, at = 'src') => callHit('POST', '/api/plans/gate/propose', { text, at }),
    async backend(command) {
      held.command = command;
    },
  });
}

let world: () => World = () => {
  throw new Error('not ready');
};

async function savedPlan(): Promise<{ edits: unknown; redo: unknown }> {
  const body = loose.parse((await world().read('/api/plans/gate')).body);
  return { edits: body.edits, redo: body.redo };
}

async function turnAt(index: number): Promise<Record<string, unknown>> {
  const chat = z.array(loose).parse((await world().read('/api/plans/gate/chat')).body);
  const turn = chat[index];
  if (turn === undefined) throw new Error(`turn ${index}`);
  return turn;
}

function parsed(hit: Hit): unknown {
  return hit.body;
}


function expectRename(): void {
  expect(proposalMarks()).toHaveLength(3);
  const name = boxName('src/infra');
  expect(name.getAttribute('data-strike')).toBe('true');
  expect(name.getAttribute('data-proposal')).toBe('true');
  expectStrike(name);
  const store = box('src/store');
  expect(spot('src/store')).toBe('260,140');
  expect(store.getAttribute('data-proposal')).toBe('true');
  expectDashed(store);
  const row = pathRow('src/store', 'src/store/db.ts');
  expect(row.textContent).toBe('db.ts');
  expectDashed(row);
}

function expectMerge(): void {
  expect(proposalMarks()).toHaveLength(2);
  expectStrike(boxName('src/infra'));
  const row = pathRow('src/domain', 'src/domain/db.ts');
  expect(row.textContent).toBe('db.ts');
  expectDashed(row);
}

function expectRenameFile(): void {
  expect(proposalMarks()).toHaveLength(2);
  const old = pathRow('src/infra', 'src/infra/db.ts');
  expect(old.getAttribute('data-strike')).toBe('true');
  expectStrike(old);
  const row = pathRow('src/infra', 'src/infra/store.ts');
  expect(row.textContent).toBe('store.ts');
  expectDashed(row);
}

function expectFold(): void {
  expect(proposalMarks()).toHaveLength(1);
  const row = pathRow('src/app', 'src/app/b.ts');
  expect(row.getAttribute('data-strike')).toBe('true');
  expectStrike(row);
}

function expectMoveIn(): void {
  expect(proposalMarks()).toHaveLength(1);
  const moved = box('src/app/db.ts');
  expect(moved.textContent).toContain('db.ts');
  expect(spot('src/app/db.ts')).toBe('0,140');
  expectDashed(moved);
  expect(moved.querySelector('.box-row')).toBeNull();
}

const EXAMPLES: Example[] = [
  { edit: RENAME, at: 'src', sentence: 'Rename src/infra to src/store', check: expectRename },
  { edit: MERGE, at: 'src', sentence: 'Merge src/infra and src/domain into src/domain', check: expectMerge },
  { edit: RENAME_FILE, at: 'src', sentence: 'Rename src/infra/db.ts to store.ts', check: expectRenameFile },
  { edit: FOLD_FILE, at: 'src', sentence: 'Fold src/app/b.ts into src/app/a.ts', check: expectFold },
  { edit: MOVE_IN, at: 'src/app', sentence: 'Move src/infra/db.ts to src/app', check: expectMoveIn },
];

async function drawExample(example: Example): Promise<void> {
  await world().plan([]);
  expect((await world().call('PUT', '/api/plans/gate/chat', [oneTurn([example.edit])])).status).toBe(200);
  await show(`#at=${example.at}&plan=gate`);
  await until(() => {
    expect(proposalTexts()).toEqual([example.sentence]);
    expect(buttonsOf(example.sentence)).toEqual([`Accept ${example.sentence}`, `Reject ${example.sentence}`]);
    example.check();
  });
}

function expectScannerCanvas(): void {
  const cut = scissors();
  expect(cut.getAttribute('data-proposal')).toBe('true');
  expect(cut.textContent).toContain('\u2702');
  expect(styleOf(cut.querySelector('.proposal-cut-label') as Element).fill).toBe(PURPLE);
  expect(realArrow('src/app', 'src/domain')).not.toBeNull();
  const ports = box('src/ports');
  expect(spot('src/ports')).toBe('260,0');
  expect(ports.getAttribute('data-proposal')).toBe('true');
  expectDashed(ports);
  const row = pathRow('src/ports', 'src/ports/b.ts');
  expect(row.textContent).toBe('b.ts');
  expectDashed(row);
  expect(spot('src/app')).toBe('0,0');
  expect(spot('src/infra')).toBe('0,140');
  expect(spot('src/domain')).toBe('0,280');
  expect(rowPaths('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts']);
  expect(document.querySelectorAll('[data-strike="true"]')).toHaveLength(0);
  expect(drawnIds().some(id => id.includes('no-such'))).toBe(false);
  expectPurple(ports);
}

function expectJobsCanvas(): void {
  const jobs = box('src/app/jobs');
  const scan = box('src/app/scan');
  expect(spot('src/app/jobs')).toBe('260,0');
  expect(spot('src/app/scan')).toBe('260,140');
  expectDashed(jobs);
  expectDashed(scan);
  expect(pathRow('src/app/jobs', 'src/app/jobs/b.ts').textContent).toBe('b.ts');
  expect(scan.querySelector('.box-row')).toBeNull();
  expect(rowPaths('src/infra')).toEqual(['src/infra/db.ts', 'src/infra/a.ts']);
  expectDashed(pathRow('src/infra', 'src/infra/a.ts'));
  expectStrike(pathRow('src/infra', 'src/infra/db.ts'));
  expectStrike(boxName('src/app'));
  expect(spot('src/app')).toBe('0,0');
  expect(spot('src/infra')).toBe('0,140');
  expect(rowPaths('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts']);
  expect(pathRow('src/app', 'src/app/a.ts').getAttribute('data-strike')).toBeNull();
  expect(pathRow('src/app', 'src/app/b.ts').getAttribute('data-strike')).toBeNull();
  expect(proposalMarks().some(el => (el.textContent ?? '').includes('three jobs'))).toBe(false);
}

const TALK = [
  'They said: the ui knows about the scanner',
  `Summary: ${SUMMARY}`,
  `0 accepted: ${CUT_SENTENCE}`,
  `1 rejected: ${PACKAGE_SENTENCE}`,
  `2 rejected: ${MOVE_SENTENCE}`,
  `3 rejected: ${MISSING_SENTENCE}`,
  'They said: keep scan where it is',
  `Summary: ${KEEP_SUMMARY}`,
  `0 open: ${KEEP_SENTENCE}`,
];

const SPLIT_TALK = [
  'They said: the ui knows about the scanner',
  `Summary: ${SUMMARY}`,
  `0 accepted: ${CUT_SENTENCE}`,
  `1 rejected: ${PACKAGE_SENTENCE}`,
  `2 rejected: ${MOVE_SENTENCE}`,
  `3 rejected: ${MISSING_SENTENCE}`,
  'They said: split it',
  '  by job',
  'Summary: Split app.',
  `0 rejected: ${KEEP_SENTENCE}`,
  `1 open: ${FOLD_JSON}`,
];

describe('proposals on the planned canvas', () => {
  world = worldFor();
  afterEach(afterPage);

  it('Propose, accept the cut, undo it, and reject the rest', async () => {
    await world().plan([]);
    await show('#at=src&plan=gate');
    await until(() => {
      expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull();
      expect(buttonOrNull('Propose')).not.toBeNull();
      expect(buttonOrNull('Conversation')).toBeNull();
      expect(askOrder()).toEqual(['changes', 'ask']);
    });
    await press(button('Propose'));
    await until(() => expect(askText()).toContain('write what you dislike'));
    expect(held.ran).toBe(0);
    await typeAsk('the ui knows about the scanner');
    expect(pressedEnter(document.querySelector('textarea[aria-label="Ask"]') as HTMLElement)).toBe(true);
    expect(held.ran).toBe(0);
    await press(button('Propose'));
    await until(() => {
      expect(summaryText()).toBe(SUMMARY);
      expect(proposalTexts()).toEqual([CUT_SENTENCE, PACKAGE_SENTENCE, MOVE_SENTENCE, MISSING_LINE]);
      expect(buttonsOf(CUT_SENTENCE)).toEqual([`Accept ${CUT_SENTENCE}`, `Reject ${CUT_SENTENCE}`]);
      expect(buttonsOf(MISSING_LINE)).toEqual([`Reject ${MISSING_SENTENCE}`]);
      expect(changeSentences()).toEqual([]);
      expect(askOrder()).toEqual(['proposals', 'changes', 'Conversation', 'ask']);
      expectScannerCanvas();
    });
    await hoverText(CUT_SENTENCE);
    expect(scissors().getAttribute('data-highlight')).toBe('true');
    expect(box('src/ports').getAttribute('data-highlight')).toBeNull();
    await leaveText(CUT_SENTENCE);
    expect(scissors().getAttribute('data-highlight')).toBeNull();
    await press(button(`Accept ${CUT_SENTENCE}`));
    await until(async () => {
      expect(changeSentences()).toEqual([CUT_SENTENCE]);
      expect(proposalTexts()).not.toContain(CUT_SENTENCE);
      expect((await savedPlan()).edits).toEqual([CUT]);
      expect((await savedPlan()).redo).toEqual([]);
    });
    await press(button('Undo'));
    await until(async () => {
      expect(changeSentences()).toEqual([]);
      const saved = await savedPlan();
      expect(saved.edits).toEqual([]);
      expect(saved.redo).toEqual([CUT]);
      expect(proposalTexts()).not.toContain(CUT_SENTENCE);
    });
    await press(button('Redo'));
    await until(() => expect(changeSentences()).toEqual([CUT_SENTENCE]));
    await press(button('Undo'));
    await until(() => expect(changeSentences()).toEqual([]));
    await press(button('Reject all'));
    await until(async () => {
      expect(document.querySelector('aside[aria-label="proposals"]')).toBeNull();
      expect(changeSentences()).toEqual([]);
      expect((await turnAt(0)).decisions).toEqual({ '0': 'accepted', '1': 'rejected', '2': 'rejected', '3': 'rejected' });
      const saved = await savedPlan();
      expect(saved.edits).toEqual([]);
      expect(saved.redo).toEqual([CUT]);
    });
    await typeAsk('keep scan where it is');
    await press(button('Propose'));
    await until(async () => {
      expect(proposalTexts()).toEqual([KEEP_SENTENCE]);
      expect(arrowDash('src/domain', 'src/app')).toBe('6 4');
      expect(arrowStroke('src/domain', 'src/app')).toBe('#7c3aed');
      expect(proposalArrow('src/domain', 'src/app').getAttribute('data-proposal')).toBe('true');
      expect(document.querySelector('g.proposal-cut[data-from="src/app"]')).toBeNull();
      expect(document.querySelector('.box[data-id="src/ports"]')).toBeNull();
      expect(document.querySelector('[data-path="src/ports/b.ts"]')).toBeNull();
      const chat = z.array(loose).parse(parsed(await world().read('/api/plans/gate/chat')));
      expect(chat).toHaveLength(2);
      expect(chat[0]?.decisions).toEqual({ '0': 'accepted', '1': 'rejected', '2': 'rejected', '3': 'rejected' });
      expect(chat[1]).toMatchObject({ text: 'keep scan where it is', summary: KEEP_SUMMARY, edits: [KEEP], decisions: {} });
    });
    await show('#at=src&plan=gate');
    await until(() => expect(button('Conversation').getAttribute('aria-expanded')).toBe('false'));
    await press(button('Conversation'));
    await until(() => {
      expect(button('Conversation').getAttribute('aria-expanded')).toBe('true');
      expect(chatLinesShown()).toEqual(TALK);
      expect(styleOf(document.querySelector('.chat-line') as Element).whiteSpace).toBe('pre');
      expect(proposalArrow('src/domain', 'src/app')).not.toBeNull();
    });
  }, 30000);

  it('Accept all takes the three applicable edits, one undo each', async () => {
    await world().plan([]);
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    await typeAsk('the ui knows about the scanner');
    await press(button('Propose'));
    await until(() => expect(proposalTexts()).toContain(MISSING_LINE));
    await press(button('Accept all'));
    await until(async () => {
      expect(changeSentences()).toEqual([CUT_SENTENCE, PACKAGE_SENTENCE, MOVE_SENTENCE]);
      expect(proposalTexts()).toEqual([MISSING_LINE]);
      expect((await savedPlan()).edits).toEqual([CUT, PACKAGE, MOVE]);
      expect((await savedPlan()).redo).toEqual([]);
    });
    await press(button('Undo'));
    await until(async () => {
      expect(changeSentences()).toEqual([CUT_SENTENCE, PACKAGE_SENTENCE]);
      expect(proposalTexts()).toEqual([MISSING_LINE]);
      expect((await savedPlan()).edits).toEqual([CUT, PACKAGE]);
    });
  }, 30000);

  it('Accepting the move before its package writes nothing until the package is accepted', async () => {
    await world().plan([]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    await show('#at=src&plan=gate');
    await until(() => {
      expect(proposalTexts()).toEqual([CUT_SENTENCE, PACKAGE_SENTENCE, MOVE_SENTENCE, MISSING_LINE]);
      expect(spot('src/ports')).toBe('260,0');
    });
    await press(button(`Accept ${MOVE_SENTENCE}`));
    await until(async () => {
      const saved = await savedPlan();
      expect(saved.edits).toEqual([]);
      expect(saved.redo).toEqual([]);
      expect(proposalTexts()).toEqual([CUT_SENTENCE, PACKAGE_SENTENCE, MOVE_EARLY, MISSING_LINE]);
      expect(buttonsOf(MOVE_EARLY)).toEqual([`Reject ${MOVE_SENTENCE}`]);
      expect((await turnAt(0)).decisions).toEqual({});
      expect(box('src/ports')).not.toBeNull();
      expect(document.querySelector('[data-path="src/ports/b.ts"]')).toBeNull();
    });
    await press(button(`Accept ${PACKAGE_SENTENCE}`));
    await until(async () => {
      expect((await savedPlan()).edits).toEqual([PACKAGE]);
      expect((await turnAt(0)).decisions).toEqual({ '1': 'accepted' });
      expect(proposalTexts()).toContain(MOVE_SENTENCE);
      expect(buttonsOf(MOVE_SENTENCE)).toEqual([`Accept ${MOVE_SENTENCE}`, `Reject ${MOVE_SENTENCE}`]);
    });
    await press(button(`Accept ${MOVE_SENTENCE}`));
    await until(async () => {
      expect((await savedPlan()).edits).toEqual([PACKAGE, MOVE]);
      expect((await turnAt(0)).decisions).toEqual({ '1': 'accepted', '2': 'accepted' });
    });
  }, 30000);

  it('Conversation shows a two-line text as the prompt does', async () => {
    await world().plan([CUT]);
    const turns = [
      oneTurn(FOUR, { text: 'the ui knows about the scanner', summary: SUMMARY, decisions: { '0': 'accepted', '1': 'rejected', '2': 'rejected', '3': 'rejected' } }),
      { at: '2026-10-21T09:05:00.000Z', text: 'split it\nby job', summary: 'Split app.', edits: [KEEP, FOLD], decisions: { '0': 'rejected' } },
    ];
    expect((await world().call('PUT', '/api/plans/gate/chat', turns)).status).toBe(200);
    await show('#at=src&plan=gate');
    await until(() => {
      expect(summaryText()).toBe('Split app.');
      expect(proposalTexts()).toEqual([FOLD_LINE]);
    });
    await press(button('Conversation'));
    await until(() => {
      expect(chatLinesShown()).toEqual(SPLIT_TALK);
      expect(styleOf(document.querySelectorAll('.chat-line')[7] as Element).whiteSpace).toBe('pre');
    });
  }, 30000);

  it('A reply element that is not an edit is shown by its JSON', async () => {
    await world().plan([]);
    expect((await world().call('PUT', '/api/plans/gate/chat', [oneTurn([FOLD])])).status).toBe(200);
    await show('#at=src&plan=gate');
    await until(() => {
      expect(proposalTexts()).toEqual([FOLD_LINE]);
      expect(buttonsOf(FOLD_LINE)).toEqual([`Reject ${FOLD_JSON}`]);
      expect(proposalMarks()).toEqual([]);
    });
    await press(button('Accept all'));
    await until(async () => {
      expect(proposalTexts()).toEqual([FOLD_LINE]);
      expect((await turnAt(0)).decisions).toEqual({});
    });
    await press(button('Conversation'));
    expect(chatLinesShown()).toContain(`0 open: ${FOLD_JSON}`);
    await press(button(`Reject ${FOLD_JSON}`));
    await until(async () => {
      expect(document.querySelector('aside[aria-label="proposals"]')).toBeNull();
      expect((await turnAt(0)).decisions).toEqual({ '0': 'rejected' });
    });
  }, 30000);

  it('Rejecting the new package drops the move, and Now draws no proposal', async () => {
    await world().plan([]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    await show('#at=src&plan=gate');
    await until(() => expect(box('src/ports')).not.toBeNull());
    await press(button(`Reject ${PACKAGE_SENTENCE}`));
    await until(async () => {
      expect((await savedPlan()).edits).toEqual([]);
      expect(proposalTexts()).toContain(MOVE_EARLY);
      expect(buttonsOf(CUT_SENTENCE)).toContain(`Accept ${CUT_SENTENCE}`);
      expect(document.querySelector('.box[data-id="src/ports"]')).toBeNull();
    });
    await chooseShown('Now');
    await until(() => expect(proposalMarks()).toEqual([]));
    await chooseShown('Planned');
    await until(() => expect(scissors().getAttribute('data-proposal')).toBe('true'));
  }, 30000);

  it('A split, a move into an existing package, a deletion and a note', async () => {
    await world().plan([]);
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    await typeAsk('app is doing three jobs');
    await press(button('Propose'));
    await until(() => {
      expect(summaryText()).toBe('Give each job its own package.');
      expect(proposalTexts()).toEqual([SPLIT_SENTENCE, JOB_MOVE, DELETE_SENTENCE, NOTE_SENTENCE]);
      expect(buttonsOf(NOTE_SENTENCE)).toEqual([`Accept ${NOTE_SENTENCE}`, `Reject ${NOTE_SENTENCE}`]);
      expect(proposalTexts().some(line => line.startsWith('dropped:'))).toBe(false);
      expectJobsCanvas();
    });
    await hoverText(NOTE_SENTENCE);
    expect(highlighted()).toEqual([]);
    await hoverText(SPLIT_SENTENCE);
    expect(highlighted()).toEqual(['id:src/app/jobs', 'id:src/app/scan', 'path:src/app/jobs/b.ts', 'strike:src/app']);
    await hoverText(JOB_MOVE);
    expect(highlighted()).toEqual(['path:src/infra/a.ts']);
    await press(button('Reject all'));
    await until(async () => {
      expect(proposalMarks()).toEqual([]);
      expect((await savedPlan()).edits).toEqual([]);
    });
  }, 30000);

  it('Renames, merges, folds and moves into a file view are drawn', async () => {
    for (const example of EXAMPLES) await drawExample(example);
  }, 30000);

  it('No plan means no Ask, and a failed reply leaves the proposals', async () => {
    await show('#at=src');
    await until(() => expect(document.querySelector('.arch-body')).not.toBeNull());
    expect(document.querySelector('textarea[aria-label="Ask"]')).toBeNull();
    expect(buttonOrNull('Propose')).toBeNull();
    expect(document.querySelector('aside[aria-label="changes"]')).toBeNull();
    await world().plan([]);
    expect((await world().propose('keep scan where it is')).status).toBe(200);
    await world().backend('echo nope');
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts()).toEqual([KEEP_SENTENCE]));
    await typeAsk('hello');
    await press(button('Propose'));
    await until(() => {
      expect(askText()).toContain("the LLM's reply was not usable: it is not valid JSON");
      expect(document.querySelector('section[aria-label="Raw output"]')?.textContent).toContain('nope');
      expect(proposalTexts()).toEqual([KEEP_SENTENCE]);
      expect((document.querySelector('textarea[aria-label="Ask"]') as HTMLTextAreaElement).value).toBe('hello');
    });
  }, 30000);

  it('Generate still interviews, and Cancel stops a proposal', async () => {
    await world().plan([CUT]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts()).toContain(STALE_CUT));
    const before = chatBytes('gate');
    await press(button('Tasks'));
    await press(button('Generate'));
    await until(() => expect(document.querySelector('dialog[aria-label="Tasks"]')?.textContent).toContain('Must a.ts keep exporting a?'));
    expect(chatBytes('gate')).toBe(before);
    await press(button('Close'));
    await until(() => expect(askButton('Propose').hasAttribute('disabled')).toBe(false));
    await typeAsk('SLEEP-NOW');
    await press(askButton('Propose'));
    await until(() => {
      expect(askText()).toContain('running for');
      expect(askButton('Propose').hasAttribute('disabled')).toBe(true);
    });
    await until(() => expect(askText()).toContain('running for 1 s'));
    await press(askButton('Cancel'));
    await until(() => expect(askText()).toContain('cancelled'));
    expect(proposalTexts()).toContain(STALE_CUT);
    expect(chatBytes('gate')).toBe(before);
  }, 30000);

  it('Deleting a plan deletes its chat, so a new plan of the same name starts clean', async () => {
    await world().plan([]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    expect(parsed(await world().call('DELETE', '/api/plans/gate'))).toEqual({ ok: true });
    expect(planFileNames()).not.toContain('gate.json');
    expect(planFileNames()).not.toContain('gate.chat.json');
    const created = loose.parse(parsed(await world().call('POST', '/api/plans', { name: 'Gate' })));
    expect(created.slug).toBe('gate');
    expect(parsed(await world().read('/api/plans/gate/chat'))).toEqual([]);
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    expect(buttonOrNull('Conversation')).toBeNull();
    expect(document.querySelector('aside[aria-label="proposals"]')).toBeNull();
    expect(proposalMarks()).toEqual([]);
  }, 30000);

  it('A chat file that is not a chat document reads as empty and is replaced by the next turn', async () => {
    await world().plan([]);
    setChatBytes('gate', '{not json');
    const read = await world().read('/api/plans/gate/chat');
    expect([read.status, parsed(read)]).toEqual([200, []]);
    expect(chatBytes('gate')).toBe('{not json');
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    expect(buttonOrNull('Conversation')).toBeNull();
    expect(document.querySelector('aside[aria-label="proposals"]')).toBeNull();
    expect(document.querySelector('.plan-dialog-error')).toBeNull();
    expect(noticeText()).toBe('');
    expect(chatBytes('gate')).toBe('{not json');
    expect((await world().propose('keep scan where it is')).status).toBe(200);
    const saved = z.array(loose).parse(JSON.parse(chatBytes('gate') ?? ''));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ text: 'keep scan where it is', edits: [KEEP] });
  }, 30000);

  it('a failed check, a missed write and a note stay off the saved decisions', async () => {
    await world().plan([]);
    expect((await world().propose('the ui knows about the scanner')).status).toBe(200);
    await pokeFault('review');
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts()).toContain(CUT_SENTENCE));
    await press(button(`Accept ${CUT_SENTENCE}`));
    await until(async () => {
      expect(noticeText()).toBe('cannot reach bindweed');
      expect((await savedPlan()).edits).toEqual([]);
    });
    held.fault = 'none';
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts()).toContain(MISSING_LINE));
    await pokeFault('plan');
    await press(button(`Accept ${CUT_SENTENCE}`));
    await until(async () => {
      expect(noticeText()).toBe('down');
      expect((await savedPlan()).edits).toEqual([]);
    });
    held.fault = 'none';
    await show('#at=src&plan=gate');
    await until(() => expect(buttonOrNull('Accept all')).not.toBeNull());
    await pokeFault('plan');
    await press(button('Accept all'));
    await until(async () => {
      expect(noticeText()).toBe('down');
      expect((await savedPlan()).edits).toEqual([]);
      expect((await turnAt(0)).decisions).toEqual({});
    });
    held.fault = 'plan-get';
    await show('#at=src&plan=gate');
    await until(() => expect(buttonOrNull(`Accept ${CUT_SENTENCE}`)).not.toBeNull());
    await press(button(`Accept ${CUT_SENTENCE}`));
    held.fault = 'none';
    await until(async () => {
      expect((await savedPlan()).edits).toEqual([]);
      expect((await turnAt(0)).decisions).toEqual({});
    });
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts()).toContain(CUT_SENTENCE));
    await pokeFault('chat');
    await press(button(`Reject ${CUT_SENTENCE}`));
    await until(async () => {
      expect(noticeText()).toBe('down');
      expect((await turnAt(0)).decisions).toEqual({});
    });
    held.fault = 'none';
    await show('#at=src&plan=gate');
    await until(() => expect(buttonOrNull('Accept all')).not.toBeNull());
    await pokeFault('chat');
    await press(button('Accept all'));
    await until(async () => {
      expect((await savedPlan()).edits).toEqual([CUT, PACKAGE, MOVE]);
      expect((await turnAt(0)).decisions).toEqual({});
    });
    held.fault = 'note';
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    await typeAsk('keep scan where it is');
    await press(button('Propose'));
    await until(() => expect(document.querySelector('output[aria-label="note"]')?.textContent).toBe('kept'));
    held.fault = 'down';
    await pokeFault('down');
    await typeAsk('hello');
    await press(button('Propose'));
    await until(() => {
      expect(askText()).toContain('cannot reach bindweed');
      expect(document.querySelector('output[aria-label="ran"]')).toBeNull();
      expect((document.querySelector('textarea[aria-label="Ask"]') as HTMLTextAreaElement).value).toBe('hello');
    });
    held.fault = 'proposal';
    await show('#at=src&plan=gate');
    await until(() => expect(proposalTexts().length).toBeGreaterThan(0));
    expect(proposalMarks()).toEqual([]);
    held.fault = 'chat-get';
    await show('#at=src&plan=gate');
    await until(() => expect(document.querySelector('textarea[aria-label="Ask"]')).not.toBeNull());
    expect(document.querySelector('aside[aria-label="proposals"]')).toBeNull();
  }, 30000);
});
