import { JSDOM } from 'jsdom';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { edgePairs, graphView, nodeDetail, type GraphView } from '../domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from '../domain/layout.ts';
import { freeSlug, planNameFrom, PLAN_SLUG_PATTERN, parsePlan, slugOf, summarisePlan, type PlanDoc, type PlanEdit, type PlanSummary } from '../domain/plan.ts';
import { applyPlan, staleReasons } from '../domain/planned.ts';

vi.mock('@xyflow/react', async () => {
  const { createElement: ce, useEffect, useState } = await import('react');

  type FakeNode = {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    draggable?: boolean;
    measured?: { width: number; height: number };
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
        'data-draggable': String(node.draggable),
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
    return ce(
      'div',
      {
        className: 'fake-flow',
        'data-stamp': String(stamp),
        'data-connectable': String(props.nodesConnectable),
        onClick: (event: { target?: unknown; currentTarget?: unknown }) => paneClick(props, event),
      },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge)), probe, probeCut),
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
    planUiArmDrop: (shift: { x: number; y: number } | null) => {
      dropAt = shift;
    },
    planUiCenters: centers,
    planUiConnect: (source: string, target: string) => {
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

const BASE = 'http://127.0.0.1';
const HEAD = 'a'.repeat(40);
const sheet = process.getBuiltinModule('node:fs').readFileSync(new URL('./app.css', import.meta.url), 'utf8');

const LAYERED_FILES: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}',
  'notes/readme.md': '# notes\n',
  'src/app/a.ts':
    "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n",
  'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  'src/app/a.test.ts': "import { a } from './a';\n",
  'src/app/save.ts': 'export const save = 1;\n',
  'src/domain/model.ts': 'export interface Model { id: number }\n',
  'src/domain/shape.ts': 'export interface Shape { draw(): void }\n',
  'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
  'src/infra/repo.ts':
    "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n",
};

const MOVE: PlanEdit = { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' };
const CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const ADD: PlanEdit = { kind: 'add-edge', from: 'src/infra', to: 'src/app' };
const NOTE: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' };

const BASE_SCAN = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/app/a.test.ts', test: true },
    { path: 'src/app/save.ts', test: false },
    { path: 'src/domain/model.ts', test: false, abstract: true as const },
    { path: 'src/domain/shape.ts', test: false, abstract: true as const },
    { path: 'src/infra/db.ts', test: false },
    { path: 'src/infra/repo.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' as const },
    { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' as const },
    { from: 'src/app/a.ts', to: 'src/infra/repo.ts', kind: 'type' as const },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' as const },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' as const },
    { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' as const },
    { from: 'src/app/a.test.ts', to: 'src/app/a.ts', kind: 'runtime' as const },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' as const },
    { from: 'src/infra/repo.ts', to: 'src/domain/shape.ts', kind: 'runtime' as const, heritage: 1 },
  ],
  externals: [
    { from: 'src/infra/repo.ts', name: 'node:fs', kind: 'runtime' as const },
    { from: 'src/infra/repo.ts', name: 'react', kind: 'runtime' as const },
  ],
  workspaces: [] as { dir: string; name: string }[],
};

const TREE = {
  root: 'layered',
  entries: [{ name: 'src', path: 'src', kind: 'dir' as const, children: [{ name: 'app', path: 'src/app', kind: 'dir' as const, children: [{ name: 'a.ts', path: 'src/app/a.ts', kind: 'file' as const }] }] }],
};

type Hit = { status: number; body: unknown };

const graphFields = z.object({
  stale: z.array(z.string().nullable()).optional(),
  nodes: z.array(z.object({ id: z.string(), files: z.number().optional() })),
});

function readGraph(body: unknown): z.infer<typeof graphFields> {
  return graphFields.parse(body);
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(body);
}

let scan = structuredClone(BASE_SCAN);
const plans = new Map<string, PlanDoc>();
let corrupt = new Set<string>();
let layout: LayoutDoc = emptyLayout();
let deletes = 0;
let puts = 0;
let pairsCalls = 0;
let layoutCalls = 0;
let failPlain = false;
let windowErrors = 0;

function resetWorld(): void {
  scan = structuredClone(BASE_SCAN);
  layout = emptyLayout();
  corrupt = new Set();
  failPlain = false;
}

function plainBroken(load: PlanDoc | null | false): boolean {
  return failPlain && load === null;
}

function hidePath(path: string): void {
  scan = { ...scan, files: scan.files.filter(file => file.path !== path), edges: keptEdges(path) };
}

function keptEdges(path: string): typeof scan.edges {
  return scan.edges.filter(edge => edge.from !== path && edge.to !== path);
}

function markCorrupt(slug: string): void {
  corrupt.add(slug);
}

function erasePlan(slug: string): void {
  plans.delete(slug);
  corrupt.delete(slug);
}

function stored(slug: string): PlanDoc | undefined {
  if (corrupt.has(slug)) return undefined;
  return plans.get(slug);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function byCreated(left: PlanSummary, right: PlanSummary): number {
  const byTime = compareText(left.createdAt, right.createdAt);
  return byTime === 0 ? compareText(left.slug, right.slug) : byTime;
}

function listSummaries(): PlanSummary[] {
  return [...plans.values()].filter(doc => !corrupt.has(doc.slug)).map(summarisePlan).sort(byCreated);
}

function takenSlug(slug: string): boolean {
  return plans.has(slug);
}

function createStored(raw: unknown): Hit {
  const name = planNameFrom(raw);
  if (name === undefined) return { status: 400, body: { error: 'bad name' } };
  const doc: PlanDoc = { version: 1, name, slug: freeSlug(slugOf(name), takenSlug), createdAt: new Date().toISOString(), baseCommit: HEAD, edits: [], redo: [] };
  plans.set(doc.slug, doc);
  return { status: 201, body: doc };
}

function getStored(slug: string): Hit {
  const doc = stored(slug);
  if (doc === undefined) return { status: 404, body: { error: 'no such plan' } };
  return { status: 200, body: doc };
}

function putStored(slug: string, raw: unknown): Hit {
  const doc = parsePlan(raw);
  if (doc === undefined || doc.slug !== slug) return { status: 400, body: { error: 'bad plan' } };
  if (stored(slug) === undefined) return { status: 404, body: { error: 'no such plan' } };
  plans.set(slug, doc);
  corrupt.delete(slug);
  return { status: 200, body: doc };
}

function deleteStored(slug: string): Hit {
  if (stored(slug) === undefined) return { status: 404, body: { error: 'no such plan' } };
  erasePlan(slug);
  return { status: 200, body: { ok: true } };
}

function planSlug(url: URL): string | null {
  const plan = url.searchParams.get('plan');
  if (plan === null || plan === '') return null;
  return plan;
}

function loadedPlan(slug: string | null): PlanDoc | null | false {
  if (slug === null) return null;
  if (!PLAN_SLUG_PATTERN.test(slug)) return false;
  const doc = stored(slug);
  return doc === undefined ? false : doc;
}

function flagsOf(url: URL): { tests: boolean; external: boolean } {
  return { tests: url.searchParams.get('tests') === '1', external: url.searchParams.get('external') === '1' };
}

function atOf(url: URL): string {
  return url.searchParams.get('at') ?? '';
}

function scanFor(load: PlanDoc | null): ReturnType<typeof applyPlan> {
  if (load !== null) return applyPlan(scan, load.edits);
  return applyPlan(scan, []);
}

function missingPlan(): Hit {
  return { status: 404, body: { error: 'no such plan' } };
}

function withStale(view: GraphView, load: PlanDoc | null): GraphView {
  if (load === null) return view;
  return { ...view, stale: staleReasons(scan, load.edits) };
}

function graphBody(url: URL): Hit {
  const load = loadedPlan(planSlug(url));
  if (load === false || plainBroken(load)) return missingPlan();
  const view = graphView(scanFor(load), atOf(url), 'layered', flagsOf(url));
  if (view === null) return { status: 404, body: { error: 'no such directory' } };
  return { status: 200, body: withStale(view, load) };
}

function detailBody(url: URL): Hit {
  const load = loadedPlan(planSlug(url));
  if (load === false) return missingPlan();
  const detail = nodeDetail(scanFor(load), url.searchParams.get('id'), atOf(url), 'layered', flagsOf(url));
  if (detail === null) return { status: 404, body: { error: 'no such node' } };
  return { status: 200, body: detail };
}

function pairsBody(url: URL): Hit {
  pairsCalls += 1;
  const load = loadedPlan(planSlug(url));
  if (load === false) return missingPlan();
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  return { status: 200, body: { pairs: edgePairs(scanFor(load), atOf(url), from, to, flagsOf(url)) } };
}

function fileBody(url: URL): Hit {
  const path = url.searchParams.get('path') ?? '';
  const text = LAYERED_FILES[path];
  if (text === undefined) return { status: 404, body: { error: 'no such file' } };
  return { status: 200, body: { path, text } };
}

function layoutPut(raw: unknown): Hit {
  const doc = parseLayout(raw);
  if (doc === undefined) return { status: 400, body: { error: 'bad layout' } };
  layout = doc;
  return { status: 200, body: doc };
}

function listBody(): Hit {
  return { status: 200, body: { plans: listSummaries() } };
}

function rescanBody(): Hit {
  return { status: 200, body: { files: scan.files.length, ms: 1 } };
}

function postRoute(url: URL, raw: unknown): Hit | null {
  if (url.pathname === '/api/plans') return createStored(raw);
  if (url.pathname === '/api/rescan') return rescanBody();
  return null;
}

function getRest(url: URL): Hit | null {
  if (url.pathname === '/api/pairs') return pairsBody(url);
  if (url.pathname === '/api/layout') {
    layoutCalls += 1;
    return { status: 200, body: layout };
  }
  return getLeaf(url);
}

function getLeaf(url: URL): Hit | null {
  if (url.pathname === '/api/file') return fileBody(url);
  if (url.pathname === '/api/tree') return { status: 200, body: TREE };
  return null;
}

function getRoute(url: URL): Hit | null {
  if (url.pathname === '/api/plans') return listBody();
  if (url.pathname === '/api/graph') return graphBody(url);
  if (url.pathname === '/api/detail') return detailBody(url);
  return getRest(url);
}

function putDirect(url: URL, raw: unknown): Hit | null {
  if (url.pathname !== '/api/layout') return null;
  return layoutPut(raw);
}

function directRoute(method: string, url: URL, raw: unknown): Hit | null {
  if (method === 'POST') return postRoute(url, raw);
  if (method === 'PUT') return putDirect(url, raw);
  if (method === 'GET') return getRoute(url);
  return null;
}

function slugFrom(pathname: string): string | null {
  const prefix = '/api/plans/';
  if (!pathname.startsWith(prefix)) return null;
  const slug = pathname.slice(prefix.length);
  if (slug.includes('/')) return null;
  return slug;
}

function planVerb(method: string, slug: string, raw: unknown): Hit {
  if (method === 'GET') return getStored(slug);
  if (method === 'PUT') return putStored(slug, raw);
  if (method === 'DELETE') return deleteStored(slug);
  return { status: 404, body: { error: 'not found' } };
}

function dispatch(method: string, url: URL, raw: unknown): Hit {
  const direct = directRoute(method, url, raw);
  if (direct !== null) return direct;
  const slug = slugFrom(url.pathname);
  if (slug === null) return { status: 404, body: { error: 'not found' } };
  if (!PLAN_SLUG_PATTERN.test(slug)) return missingPlan();
  return planVerb(method, slug, raw);
}

function countWrite(method: string, pathname: string): void {
  if (method === 'DELETE') deletes += 1;
  if (method === 'PUT' && pathname.includes('/api/plans/')) puts += 1;
}

function readRaw(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function answered(url: string | URL | Request, init: RequestInit | undefined): Response {
  const address = new URL(String(url), BASE);
  const method = init?.method ?? 'GET';
  countWrite(method, address.pathname);
  const hit = dispatch(method, address, readRaw(init?.body));
  return jsonResponse(hit.status, hit.body);
}

async function api(_token: string, method: string, path: string, body?: unknown): Promise<Hit> {
  return dispatch(method, new URL(path, BASE), body);
}

function staleAttr(row: HTMLElement | undefined): string | null {
  if (row === undefined) return null;
  return row.getAttribute('data-stale');
}

function centers(): { x: number; y: number }[] {
  const found = (globalThis as { planUiCenters?: { x: number; y: number }[] }).planUiCenters;
  if (found === undefined) throw new Error('missing centers');
  return found;
}

function connect(source: string, target: string): void {
  const hook = (globalThis as { planUiConnect?: (source: string, target: string) => void }).planUiConnect;
  if (hook === undefined) throw new Error('missing connect');
  hook(source, target);
}

function armDrop(shift: { x: number; y: number } | null): void {
  const hook = (globalThis as { planUiArmDrop?: (value: { x: number; y: number } | null) => void }).planUiArmDrop;
  if (hook === undefined) throw new Error('missing arm');
  hook(shift);
}

function installDom(url: string): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const w = dom.window;
  w.addEventListener('error', () => {
    windowErrors += 1;
  });
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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  return dom;
}

describe('the plan canvas over a real server', () => {
  const token = 'tok';
  const head = HEAD;
  let dom: JSDOM;
  let reactRoot: Root;

  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => answered(url, init)) as typeof fetch;

  async function actRun(action: () => void): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      action();
    });
  }

  async function settle(): Promise<void> {
    const { act } = await import('react');
    await act(async () => undefined);
  }

  async function waitForText(check: () => void): Promise<void> {
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(check, { timeout: 4000 });
  }

  async function showApp(hash: string): Promise<void> {
    dom = installDom(`${BASE}/?token=${token}${hash}`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    await act(async () => {
      reactRoot.render(createElement(App, { token, location: window.location, historyApi: window.history, fetcher }));
    });
  }

  function nodeEls(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.fake-node'));
  }

  function nodeById(id: string): HTMLElement {
    const el = nodeEls().find(node => node.dataset.node === id);
    if (el === undefined) throw new Error(`missing node ${id}`);
    return el;
  }

  function boxOf(id: string): HTMLElement {
    const box = nodeById(id).querySelector('.box');
    if (box === null) throw new Error(`missing box ${id}`);
    return box as HTMLElement;
  }

  function rowPathsOf(id: string): string[] {
    return Array.from(boxOf(id).querySelectorAll('.box-row:not([data-ghost="true"])')).map(row => (row as HTMLElement).dataset.path ?? '');
  }

  function ghostRowsOf(id: string): string[] {
    return Array.from(boxOf(id).querySelectorAll('.box-row[data-ghost="true"]')).map(row => (row as HTMLElement).dataset.path ?? '');
  }

  function edgeEls(): HTMLElement[] {
    return Array.from(document.querySelectorAll('g.arrow[data-from]'));
  }

  function edgeBetween(from: string, to: string): HTMLElement {
    const el = edgeEls().find(edge => edge.dataset.from === from && edge.dataset.to === to);
    if (el === undefined) throw new Error(`missing edge ${from} -> ${to}`);
    return el;
  }

  function cutBetween(from: string, to: string): HTMLElement {
    const el = Array.from(document.querySelectorAll('g.cutmark[data-from]')).find(
      edge => (edge as HTMLElement).dataset.from === from && (edge as HTMLElement).dataset.to === to,
    );
    if (el === undefined) throw new Error(`missing cut ${from} -> ${to}`);
    return el as HTMLElement;
  }

  function pathStroke(id: string): string {
    return document.querySelector(`.fake-edge-path[data-edge="${id}"]`)?.getAttribute('data-stroke') ?? '';
  }

  function pathDash(id: string): string {
    return document.querySelector(`.fake-edge-path[data-edge="${id}"]`)?.getAttribute('data-dash') ?? '';
  }

  function button(text: string): HTMLElement {
    const el = Array.from(document.querySelectorAll('button')).find(item => item.textContent === text);
    if (el === undefined) throw new Error(`missing button ${text}`);
    return el;
  }

  function entries(): HTMLElement[] {
    return Array.from(document.querySelectorAll('aside[aria-label="changes"] li.change'));
  }

  function entrySentences(): string[] {
    return entries().map(row => row.querySelector('.change-sentence')?.textContent ?? '');
  }

  function entryRow(sentence: string): HTMLElement {
    const row = entries().find(item => item.querySelector('.change-sentence')?.textContent === sentence);
    if (row === undefined) throw new Error(`missing entry ${sentence}`);
    return row;
  }

  function noticeText(): string {
    return document.querySelector('output[aria-label="notice"]')?.textContent ?? '';
  }

  function planSelect(): HTMLSelectElement {
    const el = document.querySelector('select[aria-label="Plan"]');
    if (el === null) throw new Error('missing plan select');
    return el as HTMLSelectElement;
  }

  function crumb(name: string): HTMLElement {
    const el = Array.from(document.querySelectorAll('nav[aria-label="breadcrumb"] button')).find(item => item.textContent === name);
    if (el === undefined) throw new Error(`missing crumb ${name}`);
    return el as HTMLElement;
  }

  async function click(el: Element): Promise<void> {
    await actRun(() => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  }

  async function dblclick(el: Element): Promise<void> {
    await actRun(() => {
      el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    });
  }

  async function key(key: string, init: { ctrl?: boolean; shift?: boolean; target?: Element } = {}): Promise<void> {
    await actRun(() => {
      const event = new window.KeyboardEvent('keydown', { key, ctrlKey: init.ctrl ?? false, shiftKey: init.shift ?? false, bubbles: true });
      (init.target ?? window).dispatchEvent(event);
    });
  }

  async function dropRow(target: Element, path: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    await actRun(() => {
      fireEvent.drop(target, { dataTransfer: { getData: () => path } });
    });
  }

  async function dropPrevented(target: Element, path: string): Promise<boolean> {
    const { fireEvent } = await import('@testing-library/dom');
    let prevented = false;
    await actRun(() => {
      prevented = !fireEvent.drop(target, { dataTransfer: { getData: () => path } });
    });
    return prevented;
  }

  async function dragOverPrevented(target: Element): Promise<boolean> {
    const { fireEvent } = await import('@testing-library/dom');
    let prevented = false;
    await actRun(() => {
      prevented = !fireEvent.dragOver(target);
    });
    return prevented;
  }

  async function dragBox(id: string, under: Element[]): Promise<void> {
    document.elementsFromPoint = () => under;
    await actRun(() => {
      nodeById(id).dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, altKey: true, clientX: 3, clientY: 4 }));
    });
    document.elementsFromPoint = () => [];
  }

  async function typeInto(label: string, value: string): Promise<void> {
    const field = document.querySelector(`input[aria-label="${label}"]`);
    if (field === null) throw new Error(`missing input ${label}`);
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const setter = proto?.set;
    if (setter === undefined) throw new Error('missing setter');
    await actRun(() => {
      setter.call(field, value);
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  function planDocOf(edits: PlanEdit[], redo: PlanEdit[] = []): unknown {
    return { version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: head, edits, redo };
  }

  async function setPlan(edits: PlanEdit[], redo: PlanEdit[] = []): Promise<void> {
    const existing = await api(token, 'GET', '/api/plans/split-app');
    if (existing.status === 404) await api(token, 'POST', '/api/plans', { name: 'Split app' });
    await api(token, 'PUT', '/api/plans/split-app', planDocOf(edits, redo));
  }

  async function serverDoc(): Promise<{ edits: PlanEdit[]; redo: PlanEdit[] }> {
    const res = await api(token, 'GET', '/api/plans/split-app');
    const doc = parsePlan(res.body);
    if (doc === undefined) throw new Error('not a plan');
    return { edits: doc.edits, redo: doc.redo };
  }

  async function waitForDoc(edits: PlanEdit[], redo: PlanEdit[] = []): Promise<void> {
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(
      async () => {
        expect(await serverDoc()).toEqual({ edits, redo });
      },
      { timeout: 4000 },
    );
  }

  beforeAll(async () => {
    await api(token, 'POST', '/api/plans', { name: 'Split app' });
  });

  beforeEach(async () => {
    await import('@xyflow/react');
    resetWorld();
    windowErrors = 0;
    await api(token, 'PUT', '/api/layout', { version: 1, views: {}, settings: { tests: false, external: false } });
    await setPlan([]);
    centers().length = 0;
  });

  afterEach(async () => {
    reactRoot.unmount();
    dom.window.close();
  });

  async function choosePlan(value: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    await actRun(() => {
      fireEvent.change(planSelect(), { target: { value } });
    });
  }

  async function chooseShown(label: string): Promise<void> {
    const radio = Array.from(document.querySelectorAll('input[name="shown-graph"]')).find(el => el.parentElement?.textContent === label);
    if (radio === undefined) throw new Error(`missing radio ${label}`);
    await click(radio);
  }

  function shownChecks(): boolean[] {
    return Array.from(document.querySelectorAll('input[name="shown-graph"]')).map(el => (el as HTMLInputElement).checked);
  }

  function cycleFlags(): (string | null)[] {
    return nodeEls().map(node => node.querySelector('.box')?.getAttribute('data-cycle') ?? null);
  }

  function optionText(select: HTMLSelectElement, index: number): string | null {
    const option = select.options.item(index);
    if (option === null) return null;
    return option.textContent;
  }

  function disabledFlag(selector: string): boolean {
    const el = document.querySelector(selector);
    if (el === null) return false;
    return el.hasAttribute('disabled');
  }

  function titleOf(selector: string): string | null {
    const el = document.querySelector(selector);
    if (el === null) return null;
    return el.getAttribute('title');
  }

  function ariaOf(selector: string): string | null {
    const el = document.querySelector(selector);
    if (el === null) return null;
    return el.getAttribute('aria-label');
  }

  function textAt(selector: string): string | null {
    const el = document.querySelector(selector);
    if (el === null) return null;
    return el.textContent;
  }

  function mustQuery(root: Element, selector: string, name: string): Element {
    const el = root.querySelector(selector);
    if (el === null) throw new Error(name);
    return el;
  }

  function menuItem(root: Element, label: string): HTMLElement {
    const found = Array.from(root.querySelectorAll('[role="menu"] button')).find(el => el.textContent === label);
    if (found === undefined) throw new Error(label);
    return found as HTMLElement;
  }

  function attrOf(el: Element | null, name: string): string | null {
    if (el === null) return null;
    return el.getAttribute(name);
  }

  function textOf(el: Element | null): string | null {
    if (el === null) return null;
    return el.textContent;
  }

  function rootPins(body: unknown): Record<string, { x: number; y: number }> {
    const doc = parseLayout(body);
    if (doc === undefined) return {};
    return doc.views[''] ?? {};
  }

  function pinNumber(pins: Record<string, { x: number; y: number }>, id: string, axis: 'x' | 'y'): unknown {
    const pin = pins[id];
    if (pin === undefined) return undefined;
    return pin[axis];
  }

  function ghostAttr(id: string): string | null {
    return attrOf(nodeById(id).querySelector('.box'), 'data-ghost');
  }

  function noteAttr(root: Element, name: string): string | null {
    return attrOf(root.querySelector('.note-marker'), name);
  }

  function noteTitle(root: Element): string | null {
    return textOf(root.querySelector('.note-marker title'));
  }

  function arrowMark(root: Element, index: number, name: string): string | null {
    const mark = root.querySelectorAll('g.note-marker')[index];
    if (mark === undefined) return null;
    return mark.getAttribute(name);
  }

  function edgeTitle(edge: Element): string | null {
    return textOf(edge.querySelector('title'));
  }

  function drawerRows(): Element[] {
    return Array.from(document.querySelectorAll('aside[aria-label="metrics"] tbody tr'));
  }

  function firstCell(row: Element): string | null {
    return textOf(row.querySelector('td'));
  }

  function cellsOf(name: string): (string | null)[] {
    const row = drawerRows().find(item => firstCell(item) === name);
    if (row === undefined) return [];
    return Array.from(row.querySelectorAll('td')).map(cell => cell.textContent);
  }

  function headingOf(section: Element): string | null {
    return textOf(section.querySelector('h3'));
  }

  function sectionButtons(heading: string): (string | null)[] {
    const panel = document.querySelector('aside[aria-label="details"]');
    if (panel === null) return [];
    return buttonsIn(panel, heading);
  }

  function buttonsIn(panel: Element, heading: string): (string | null)[] {
    const section = Array.from(panel.querySelectorAll('section')).find(item => headingOf(item) === heading);
    if (section === undefined) return [];
    return Array.from(section.querySelectorAll('button')).map(el => el.textContent);
  }

  function entryAt(index: number): HTMLElement | undefined {
    return entries()[index];
  }

  function reasonText(row: HTMLElement | undefined): string | null {
    if (row === undefined) return null;
    return textOf(row.querySelector('.change-reason'));
  }

  function filesOf(nodes: { id: string; files?: number }[], id: string): number | undefined {
    const node = nodes.find(item => item.id === id);
    if (node === undefined) return undefined;
    return node.files;
  }

  function sentenceOf(row: HTMLElement): Element {
    const el = row.querySelector('.change-sentence');
    if (el === null) throw new Error('missing sentence');
    return el;
  }

  it('opens a plan from the hash with rows, the switch and an empty change list', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => {
      expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']);
      expect(rowPathsOf('src/infra')).toEqual(['src/infra/db.ts', 'src/infra/repo.ts']);
      expect(rowPathsOf('src/domain')).toEqual(['src/domain/model.ts', 'src/domain/shape.ts']);
    });
    expect(planSelect().value).toBe('split-app');
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(shownChecks()).toEqual([false, true]);
    expect(entries()).toHaveLength(0);
    await key('z', { ctrl: true });
    await settle();
    expect(entries()).toHaveLength(0);
    expect(noticeText()).toBe('');
    await key('Delete');
    await settle();
    expect(entries()).toHaveLength(0);
    expect(noticeText()).toBe('');
    expect(windowErrors).toBe(0);
    expect((button('Delete plan') as HTMLButtonElement).disabled).toBe(false);
    expect((button('Undo') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Redo') as HTMLButtonElement).disabled).toBe(true);
    expect(ariaOf('[data-handle="source"]')).toBe('Draw dependency');
    expect(attrOf(document.querySelector('[data-handle="source"]'), 'data-connectable')).toBe('true');
    expect(attrOf(document.querySelector('.fake-flow'), 'data-connectable')).toBe('true');
    expect(boxOf('src/app').textContent).toContain('3 files');
    expect(boxOf('src/app').querySelector('.box-menu')).toBeNull();
    await choosePlan('');
    expect(window.location.hash).toBe('#at=src');
    expect(planSelect().value).toBe('');
    expect(document.querySelectorAll('input[name="shown-graph"]')).toHaveLength(0);
    expect(document.querySelector('aside[aria-label="changes"]')).toBeNull();
    expect(boxOf('src/app').querySelectorAll('.box-row')).toHaveLength(0);
    await choosePlan('split-app');
    await waitForText(() => expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
    await waitForText(() => expect(ghostRowsOf('src/app')).toEqual([]));
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(shownChecks()).toEqual([false, true]);
  });

  it('rows include test files when the tests flag is on', async () => {
    await api(token, 'PUT', '/api/layout', { version: 1, views: {}, settings: { tests: true, external: false } });
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(rowPathsOf('src/app')).toEqual(['src/app/a.test.ts', 'src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
  });

  it('ghosts a moved test file only once when the tests flag is on', async () => {
    await api(token, 'PUT', '/api/layout', { version: 1, views: {}, settings: { tests: true, external: false } });
    await setPlan([{ kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/infra' }]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(rowPathsOf('src/infra')).toEqual(['src/infra/a.test.ts', 'src/infra/db.ts', 'src/infra/repo.ts']));
    expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']);
    expect(ghostRowsOf('src/app')).toEqual(['src/app/a.test.ts']);
  });

  it('creates a plan through the dialogue and refuses empty and bad names', async () => {
    await api(token, 'DELETE', '/api/plans/split-app');
    await showApp('#at=src');
    await waitForText(() => expect(boxOf('src/app').textContent).toContain('3 files'));
    expect(optionText(planSelect(), 0)).toBe('No plan');
    expect(planSelect().value).toBe('');
    expect((button('Delete plan') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelectorAll('input[name="shown-graph"]')).toHaveLength(0);
    expect(document.querySelector('aside[aria-label="changes"]')).toBeNull();
    expect(document.querySelectorAll('.box-row')).toHaveLength(0);
    expect(document.querySelector('.box-menu')).toBeNull();
    expect(document.querySelector('[aria-label="Draw dependency"]')).toBeNull();
    expect(boxOf('src/infra').textContent).toContain('2 files');
    expect(boxOf('src/domain').textContent).toContain('2 files');
    expect(boxOf('src/domain').getAttribute('data-abstract')).toBe('true');
    expect(window.getComputedStyle(boxOf('src/domain')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(cycleFlags()).not.toContain('true');
    await click(edgeBetween('src/app', 'src/domain'));
    await key('Delete');
    await settle();
    expect(document.querySelector('aside[aria-label="changes"]')).toBeNull();
    expect(edgeBetween('src/app', 'src/domain')).not.toBeNull();
    expect(disabledFlag('option[value="crap"]')).toBe(true);
    expect(titleOf('option[value="crap"]')).toBe('no coverage data: run marestail gate');
    expect(document.querySelector('output[aria-label="notice"]')).toBeNull();
    expect(document.querySelectorAll('.box-rows')).toHaveLength(0);
    expect(document.querySelectorAll('g.arrow')).toHaveLength(3);
    expect(document.querySelectorAll('g.cutmark')).toHaveLength(1);
    expect(document.querySelector('g.cutmark')?.getAttribute('data-selected')).toBe('false');
    expect(ariaOf('[data-handle="source"]')).toBeNull();
    expect(attrOf(document.querySelector('[data-handle="source"]'), 'data-connectable')).toBe('false');
    expect(attrOf(document.querySelector('.fake-flow'), 'data-connectable')).toBe('false');
    await click(boxOf('src/app'));
    expect(boxOf('src/app').querySelector('.box-menu')).toBeNull();
    await click(edgeBetween('src/app', 'src/domain'));
    expect(document.querySelector('.arrow-menu')).toBeNull();
    await actRun(() => connect('src/app', 'src/domain'));
    await settle();
    expect(document.querySelector('.arrow-menu')).toBeNull();
    expect(await dropPrevented(crumb('src'), 'src/app/save.ts')).toBe(false);
    expect(await dropPrevented(boxOf('src/infra'), 'src/app/save.ts')).toBe(false);
    expect(windowErrors).toBe(0);
    const pairsAtStart = pairsCalls;
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    await key('Delete');
    await settle();
    await new Promise(resolve => setTimeout(resolve, 50));
    process.off('unhandledRejection', onRejection);
    expect(rejections).toEqual([]);
    expect(pairsCalls).toBe(pairsAtStart);
    expect(entries()).toHaveLength(0);
    expect(windowErrors).toBe(0);
    armDrop({ x: 12, y: -200 });
    await dragBox('src/domain', []);
    await waitForText(() => expect(boxOf('src/domain').getAttribute('data-y')).toBe('-200'));
    const listed = await api(token, 'GET', '/api/plans');
    expect(listed.body).toEqual({ plans: [] });
    await click(button('Reset layout'));
    await waitForText(() => {
      const y = (id: string) => Number(boxOf(id).getAttribute('data-y'));
      expect(y('src/app')).toBeLessThan(y('src/infra'));
      expect(y('src/infra')).toBeLessThan(y('src/domain'));
    });
    armDrop(null);
    await key('z', { ctrl: true });
    expect(entries()).toHaveLength(0);
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(nodeById('src/app/a.ts')).not.toBeNull());
    await dragBox('src/app/a.ts', [crumb('src')]);
    const pinnedLayout = parseLayout((await api(token, 'GET', '/api/layout')).body);
    expect(pinnedLayout?.views['src/app']?.['src/app/a.ts']).toBeDefined();
    expect(entries()).toHaveLength(0);
    reactRoot.unmount();
    dom.window.close();
    await showApp('#at=src&plan=missing');
    await waitForText(() => expect(textAt('.arch-canvas')).toBe('no such plan'));
    expect(planSelect().value).toBe('');
    await choosePlan('');
    await waitForText(() => expect(boxOf('src/app').textContent).toContain('3 files'));
    expect(window.location.hash).toBe('#at=src');
    await click(button('New plan…'));
    expect(ariaOf('dialog')).toBe('New plan');
    await click(button('Cancel'));
    expect(document.querySelector('dialog')).toBeNull();
    await click(button('New plan…'));
    await click(button('Create'));
    expect(textAt('.plan-dialog-error')).toBe('write a name');
    await typeInto('Name', '!!!');
    await click(button('Create'));
    await waitForText(() => expect(textAt('.plan-dialog-error')).toBe('bad name'));
    await click(button('Cancel'));
    await click(button('New plan…'));
    expect(document.querySelector('.plan-dialog-error')).toBeNull();
    await typeInto('Name', '  Split app  ');
    await click(button('Create'));
    await waitForText(() => expect(planSelect().value).toBe('split-app'));
    expect(document.querySelector('dialog')).toBeNull();
    expect(optionText(planSelect(), 1)).toBe('Split app');
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(shownChecks()).toEqual([false, true]);
    expect(entries()).toHaveLength(0);
    await waitForText(() => expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
    const created = await api(token, 'GET', '/api/plans/split-app');
    expect(created.status).toBe(200);
  });

  it('moves save.ts onto infra by a row drag, ghosts it in app and opens the disk path', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => {
      expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']);
      expect(ghostRowsOf('src/app')).toEqual([]);
    });
    expect(await dragOverPrevented(boxOf('src/infra'))).toBe(true);
    expect(await dragOverPrevented(crumb('src'))).toBe(true);
    expect(await dropPrevented(crumb('src'), '')).toBe(true);
    await settle();
    expect(entries()).toHaveLength(0);
    expect(await serverDoc()).toEqual({ edits: [], redo: [] });
    await dropRow(crumb('src'), 'src/app/save.ts');
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to src']));
    await click(button('Undo'));
    await waitForText(() => {
      expect(entries()).toHaveLength(0);
      expect(rowPathsOf('src/app')).toContain('src/app/save.ts');
    });
    const row = mustQuery(boxOf('src/app'), '.box-row[data-path="src/app/save.ts"]:not([data-ghost="true"])', 'missing row');
    const seen: string[][] = [];
    const { fireEvent } = await import('@testing-library/dom');
    await actRun(() => {
      fireEvent.dragStart(row, { dataTransfer: { setData: (mime: string, value: string) => seen.push([mime, value]), getData: () => '' } });
    });
    expect(seen).toEqual([['text/x-bindweed-file', 'src/app/save.ts']]);
    await dropRow(boxOf('src/app'), 'src/app/save.ts');
    await settle();
    expect(entries()).toHaveLength(0);
    expect(await dropPrevented(boxOf('src/domain'), '')).toBe(true);
    expect(await serverDoc()).toEqual({ edits: [], redo: [{ kind: 'move-file', file: 'src/app/save.ts', to: 'src' }] });
    const layoutBefore = layoutCalls;
    await dropRow(boxOf('src/infra'), 'src/app/save.ts');
    await waitForText(() => {
      expect(entrySentences()).toEqual(['Move src/app/save.ts to src/infra']);
      expect(rowPathsOf('src/infra')).toEqual(['src/infra/db.ts', 'src/infra/repo.ts', 'src/infra/save.ts']);
    });
    expect(boxOf('src/infra').textContent).toContain('3 files');
    expect(boxOf('src/app').textContent).toContain('2 files');
    expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts']);
    expect(ghostRowsOf('src/app')).toEqual(['src/app/save.ts']);
    await waitForDoc([MOVE]);
    expect(layoutCalls).toBe(layoutBefore);
    const ghostRow = mustQuery(boxOf('src/app'), '.box-row[data-ghost="true"]', 'missing ghost row');
    expect(window.getComputedStyle(ghostRow).opacity).toBe('0.35');
    await dblclick(ghostRow);
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    const moved = mustQuery(boxOf('src/infra'), '.box-row[data-path="src/infra/save.ts"]', 'missing moved row');
    await dblclick(moved);
    await waitForText(() => expect(textAt('main')).toContain('export const save = 1;'));
    expect(textAt('main header')).toBe('src/app/save.ts');
    expect(window.location.hash).toBe('#file=src/app/save.ts');
    await click(button('Architecture'));
    await waitForText(() => expect(ghostRowsOf('src/app')).toEqual(['src/app/save.ts']));
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    await click(sentenceOf(entryRow('Move src/app/save.ts to src/infra')));
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src/infra&plan=split-app');
      expect(boxOf('src/infra/save.ts').getAttribute('data-selected')).toBe('true');
    });
    expect(boxOf('src/infra/save.ts').getAttribute('data-x')).toBe('520');
    expect(centers()).toContainEqual({ x: 520, y: 0 });
    await dblclick(boxOf('src/infra/save.ts'));
    await waitForText(() => expect(textAt('main header')).toBe('src/app/save.ts'));
    await click(button('Architecture'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src/infra&plan=split-app'));
    await click(crumb('src'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src&plan=split-app'));
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(ghostAttr('src/app/save.ts')).toBe('true'));
    expect(boxOf('src/app/a.ts').getAttribute('data-x')).toBe('0');
    expect(boxOf('src/app/a.ts').getAttribute('data-y')).toBe('0');
    expect(boxOf('src/app/b.ts').getAttribute('data-x')).toBe('260');
    expect(boxOf('src/app/b.ts').getAttribute('data-y')).toBe('0');
    expect(boxOf('src/app/save.ts').getAttribute('data-x')).toBe('520');
    expect(boxOf('src/app/save.ts').getAttribute('data-y')).toBe('0');
  });

  it('moves a file box onto breadcrumbs and the root, with ghosts in the drilled view', async () => {
    await showApp('#at=src/app&plan=split-app');
    await waitForText(() => expect(nodeEls().map(node => node.dataset.node)).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
    await dragBox('src/app/save.ts', [crumb('src')]);
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to src']));
    await waitForDoc([{ kind: 'move-file', file: 'src/app/save.ts', to: 'src' }]);
    const appViewPins = parseLayout((await api(token, 'GET', '/api/layout')).body)?.views['src/app'];
    expect(appViewPins).toBeUndefined();
    await click(button('Undo'));
    await waitForText(() => {
      expect(entries()).toHaveLength(0);
      expect(nodeEls().map(node => node.dataset.node)).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']);
      expect(nodeById('src/app/save.ts').getAttribute('data-draggable')).toBe('true');
    });
    await dragBox('src/app/save.ts', [crumb('layered')]);
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to .']));
    await waitForDoc([{ kind: 'move-file', file: 'src/app/save.ts', to: '.' }]);
    const rooted = await api(token, 'GET', '/api/graph?at=&plan=split-app');
    expect(readGraph(rooted.body).stale).toEqual([null]);
    await click(entryRow('Move src/app/save.ts to .').querySelector('.change-sentence') as Element);
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=&plan=split-app');
      expect(boxOf('save.ts').getAttribute('data-selected')).toBe('true');
    });
    expect(boxOf('src').textContent).toContain('6 files');
    expect(boxOf('src').querySelector('.box-rows')).toBeNull();
    await click(button('Undo'));
    await waitForText(() => expect(entries()).toHaveLength(0));
    await click(button('Redo'));
    await waitForText(() => expect(boxOf('save.ts')).not.toBeNull());
    await dragBox('save.ts', [crumb('layered')]);
    await settle();
    expect(entrySentences()).toEqual(['Move src/app/save.ts to .']);
    const layout = await api(token, 'GET', '/api/layout');
    const pins = rootPins(layout.body);
    expect(typeof pinNumber(pins, 'save.ts', 'x')).toBe('number');
    expect(typeof pinNumber(pins, 'save.ts', 'y')).toBe('number');
    await dragBox('save.ts', [boxOf('src')]);
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to .', 'Move save.ts to src']));
    await dblclick(boxOf('src'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src&plan=split-app'));
    await waitForText(() => expect(nodeById('src/app')).not.toBeNull());
    await dragBox('src/app', [crumb('layered')]);
    expect(entrySentences()).toHaveLength(2);
    await dblclick(boxOf('src/app'));
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src/app&plan=split-app');
      expect(ghostAttr('src/app/save.ts')).toBe('true');
    });
    const ghost = mustQuery(nodeById('src/app/save.ts'), '.box', 'missing ghost box');
    expect(ghost.getAttribute('data-ghost')).toBe('true');
    expect(ghost.getAttribute('data-x')).toBe('520');
    expect(ghost.getAttribute('data-y')).toBe('0');
    expect(nodeById('src/app/save.ts').getAttribute('data-px')).toBe('520');
    expect(nodeById('src/app/save.ts').getAttribute('data-py')).toBe('0');
    expect(nodeById('src/app/save.ts').getAttribute('data-draggable')).toBe('false');
    await dropRow(boxOf('src/app/a.ts'), 'src/app/b.ts');
    expect(await serverDoc()).toEqual({
      edits: [
        { kind: 'move-file', file: 'src/app/save.ts', to: '.' },
        { kind: 'move-file', file: 'save.ts', to: 'src' },
      ],
      redo: [],
    });
    await dblclick(nodeById('src/app/save.ts'));
    expect(window.location.hash).toBe('#at=src/app&plan=split-app');
  });

  it('cuts an arrow with Delete and with the menu, and refuses a second cut', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(edgeBetween('src/app', 'src/domain')).not.toBeNull());
    await click(edgeBetween('src/app', 'src/infra'));
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('true');
    expect(edgeBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('false');
    expect(edgeBetween('src/infra', 'src/domain').getAttribute('data-selected')).toBe('false');
    await key('x');
    await settle();
    expect(entries()).toHaveLength(0);
    await click(edgeBetween('src/infra', 'src/domain'));
    expect(edgeBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('false');
    await click(edgeBetween('src/app', 'src/domain'));
    expect(edgeBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('true');
    await key('Delete');
    await waitForText(() => {
      expect(entrySentences()).toEqual(['src/app must not import src/domain (1 import)']);
      expect(edgeEls().filter(edge => edge.dataset.from === 'src/app' && edge.dataset.to === 'src/domain')).toEqual([]);
    });
    expect(cutBetween('src/app', 'src/domain').getAttribute('data-cut')).toBe('true');
    expect(cutBetween('src/app', 'src/domain').textContent).toContain('✂');
    expect(pathStroke('cut:src/app->src/domain')).toBe('#94a3b8');
    expect(pathDash('cut:src/app->src/domain')).toBe('4 4');
    await waitForDoc([CUT]);
    expect(cutBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('false');
    await click(cutBetween('src/app', 'src/domain'));
    expect(cutBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('true');
    await key('Delete');
    await settle();
    expect(entrySentences()).toEqual(['src/app must not import src/domain (1 import)']);
    expect(windowErrors).toBe(0);
    await click(edgeBetween('src/infra', 'src/domain'));
    const arrow = edgeBetween('src/infra', 'src/domain');
    const menuButton = arrow.querySelector('button');
    if (menuButton === null) throw new Error('missing arrow menu');
    await click(menuButton);
    expect((arrow.querySelector('.arrow-menu') as HTMLElement | null)?.style.transform).toBe('translate(-50%, -100%) translate(0px, 70px)');
    const cutItem = Array.from(arrow.querySelectorAll('[role="menu"] button')).find(el => el.textContent === 'Cut');
    if (cutItem === undefined) throw new Error('missing Cut');
    await click(cutItem);
    await waitForText(() => expect(entrySentences()).toEqual([
      'src/app must not import src/domain (1 import)',
      'src/infra must not import src/domain (2 imports)',
    ]));
    const pairsBefore = pairsCalls;
    await key('Delete');
    await waitForText(() => expect(noticeText()).toBe('no such arrow src/infra → src/domain'));
    expect(pairsCalls).toBe(pairsBefore);
    await click(button('Undo'));
    await waitForText(() => expect(entrySentences()).toEqual(['src/app must not import src/domain (1 import)']));
    expect(cutBetween('src/app', 'src/domain')).not.toBeNull();
    await click(edgeBetween('src/app', 'src/infra'));
    await key('Delete');
    await waitForText(() => expect(entrySentences()).toContain('src/app must not import src/infra (3 imports)'));
    await click(edgeBetween('src/infra', 'src/domain'));
    await key('Delete');
    await waitForText(() => expect(entrySentences()).toHaveLength(3));
    await click(cutBetween('src/app', 'src/domain'));
    expect(cutBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('false');
    expect(cutBetween('src/infra', 'src/domain').getAttribute('data-selected')).toBe('false');
  });

  it('refuses a repeat cut without asking the pairs endpoint', async () => {
    await setPlan([ADD]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(edgeBetween('src/infra', 'src/domain')).not.toBeNull());
    await click(edgeBetween('src/infra', 'src/domain'));
    await key('Delete');
    await waitForText(() => expect(entrySentences()).toEqual(['src/infra should use src/app', 'src/infra must not import src/domain (2 imports)']));
    const pairsBefore = pairsCalls;
    await key('Delete');
    await waitForText(() => expect(noticeText()).toBe('no such arrow src/infra → src/domain'));
    expect(pairsCalls).toBe(pairsBefore);
    expect(entrySentences()).toHaveLength(2);
  });

  it('cuts with pairs from the planned graph after a move', async () => {
    await setPlan([{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(edgeBetween('src/infra', 'src/app')).not.toBeNull());
    await click(edgeBetween('src/infra', 'src/app'));
    await key('Delete');
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/b.ts to src/infra', 'src/infra must not import src/app (1 import)']));
    await waitForDoc([
      { kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' },
      { kind: 'cut-edge', from: 'src/infra', to: 'src/app', files: [['src/infra/b.ts', 'src/app/a.ts']] },
    ]);
  });

  it('unsubscribes the key handler when the pane unmounts', async () => {
    await setPlan([MOVE, CUT]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(2));
    await choosePlan('');
    await choosePlan('split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(2));
    const before = puts;
    await key('z', { ctrl: true });
    await waitForDoc([MOVE], [CUT]);
    expect(puts).toBe(before + 1);
  });

  it('draws an edge that cycles in red and refuses repeats and self-drops', async () => {
    await setPlan([MOVE, CUT]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(edgeBetween('src/app', 'src/infra')).not.toBeNull());
    await actRun(() => connect('src/infra', 'src/app'));
    await waitForText(() => {
      expect(entrySentences()).toEqual([
        'Move src/app/save.ts to src/infra',
        'src/app must not import src/domain (1 import)',
        'src/infra should use src/app',
      ]);
      expect(boxOf('src/app').getAttribute('data-cycle')).toBe('true');
      expect(boxOf('src/infra').getAttribute('data-cycle')).toBe('true');
    });
    expect(window.getComputedStyle(boxOf('src/app')).backgroundColor).toBe('rgb(254, 226, 226)');
    expect(window.getComputedStyle(boxOf('src/infra')).backgroundColor).toBe('rgb(254, 226, 226)');
    expect(boxOf('src/domain').getAttribute('data-cycle')).toBe('false');
    expect(window.getComputedStyle(boxOf('src/domain')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(boxOf('src/app').getAttribute('data-x')).toBe('0');
    expect(boxOf('src/infra').getAttribute('data-x')).toBe('260');
    expect(boxOf('src/infra').getAttribute('data-y')).toBe('0');
    const added = edgeBetween('src/infra', 'src/app');
    expect(added.getAttribute('data-planned')).toBe('true');
    expect(added.getAttribute('data-line')).toBe('dashed');
    expect(added.getAttribute('data-cycle')).toBe('true');
    expect(added.getAttribute('data-up')).toBe('false');
    expect(added.querySelector('title')?.textContent).toBe('infra → app → infra');
    expect(pathStroke('src/infra->src/app')).toBe('#dc2626');
    expect(pathStroke('src/app->src/infra')).toBe('#dc2626');
    expect(edgeBetween('src/app', 'src/infra').querySelector('.arrow-label')?.textContent).toBe('3');
    expect(edgeBetween('src/app', 'src/infra').querySelector('title')?.textContent).toBe('app → infra → app');
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-planned')).toBeNull();
    await actRun(() => connect('src/infra', 'src/app'));
    await waitForText(() => expect(noticeText()).toBe('src/infra already imports src/app'));
    expect(entrySentences()).toHaveLength(3);
    await actRun(() => connect('src/app', 'src/app'));
    await waitForText(() => expect(noticeText()).toBe('a box cannot depend on itself'));
    expect(entrySentences()).toHaveLength(3);
    await actRun(() => connect('src/app', 'src/domain'));
    await waitForDoc([MOVE, CUT, ADD, { kind: 'add-edge', from: 'src/app', to: 'src/domain' }]);
    expect(noticeText()).toBe('');
    await waitForText(() => expect(edgeBetween('src/app', 'src/domain')).not.toBeNull());
    await actRun(() => connect('src/app', 'src/domain'));
    await waitForText(() => expect(noticeText()).toBe('src/app already imports src/domain'));
    await click(button('Undo'));
    await waitForDoc([MOVE, CUT, ADD], [{ kind: 'add-edge', from: 'src/app', to: 'src/domain' }]);
    expect(noticeText()).toBe('');
    await actRun(() => connect('src/infra', 'src/app'));
    await waitForText(() => expect(noticeText()).toBe('src/infra already imports src/app'));
    await click(button('Redo'));
    await waitForDoc([MOVE, CUT, ADD, { kind: 'add-edge', from: 'src/app', to: 'src/domain' }]);
    expect(noticeText()).toBe('');
    await actRun(() => connect('src/infra', 'src/app'));
    await waitForText(() => expect(noticeText()).toBe('src/infra already imports src/app'));
    await click(entryRow('src/app should use src/domain').querySelector('[aria-label="Remove"]') as Element);
    await waitForDoc([MOVE, CUT, ADD]);
    expect(noticeText()).toBe('');
  });

  it('removes the add-edge edit when the planned arrow is cut, keeping redo', async () => {
    await setPlan([MOVE, CUT, ADD], [NOTE]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => {
      expect(entrySentences()).toHaveLength(3);
      expect(edgeBetween('src/infra', 'src/app')).not.toBeNull();
    });
    await click(edgeBetween('src/infra', 'src/app'));
    await key('Delete');
    await waitForText(() => {
      expect(entrySentences()).toEqual(['Move src/app/save.ts to src/infra', 'src/app must not import src/domain (1 import)']);
      expect(cycleFlags()).not.toContain('true');
      expect(edgeEls().filter(edge => edge.dataset.from === 'src/infra' && edge.dataset.to === 'src/app')).toEqual([]);
    });
    expect(noticeText()).toBe('');
    await waitForDoc([MOVE, CUT], [NOTE]);
    await key('z', { ctrl: true, shift: true });
    await waitForText(() => expect(entrySentences()).toContain('Note on src/domain: "pull an interface out here"'));
    await actRun(() => connect('src/infra', 'src/app'));
    await waitForText(() => {
      expect(entrySentences()).toContain('src/infra should use src/app');
      expect(edgeBetween('src/infra', 'src/app')).not.toBeNull();
    });
    await waitForDoc([MOVE, CUT, NOTE, ADD]);
    await click(edgeBetween('src/infra', 'src/app'));
    const arrow = edgeBetween('src/infra', 'src/app');
    const menuButton = arrow.querySelector('button');
    if (menuButton === null) throw new Error('missing arrow menu');
    await click(menuButton);
    const cutItem = Array.from(arrow.querySelectorAll('[role="menu"] button')).find(el => el.textContent === 'Cut');
    if (cutItem === undefined) throw new Error('missing Cut');
    await click(cutItem);
    await waitForText(() => {
      expect(entrySentences()).toEqual(['Move src/app/save.ts to src/infra', 'src/app must not import src/domain (1 import)', 'Note on src/domain: "pull an interface out here"']);
      expect(cycleFlags()).not.toContain('true');
    });
    await waitForDoc([MOVE, CUT, NOTE]);
  });

  it('undoes and redoes by keys and buttons and a new edit clears redo', async () => {
    await setPlan([MOVE, CUT, ADD]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(3));
    await key('z', { ctrl: true });
    await waitForText(() => {
      expect(entrySentences()).toHaveLength(2);
      expect(cycleFlags()).not.toContain('true');
    });
    expect(boxOf('src/app').getAttribute('data-y')).toBe('0');
    expect(boxOf('src/infra').getAttribute('data-y')).toBe('140');
    expect(boxOf('src/domain').getAttribute('data-y')).toBe('280');
    await waitForDoc([MOVE, CUT], [ADD]);
    await key('z', { ctrl: true, shift: true });
    await waitForText(() => {
      expect(entrySentences()).toHaveLength(3);
      expect(boxOf('src/infra').getAttribute('data-cycle')).toBe('true');
    });
    await click(button('Undo'));
    await waitForText(() => expect(entrySentences()).toHaveLength(2));
    await click(button('Redo'));
    await waitForText(() => expect(entrySentences()).toHaveLength(3));
    await key('z', { ctrl: true });
    await waitForText(() => expect(entrySentences()).toHaveLength(2));
    await click(boxOf('src/domain'));
    const boxMenuButton = boxOf('src/domain').querySelector('.box-menu button');
    if (boxMenuButton === null) throw new Error('missing box menu');
    await click(boxMenuButton);
    const addNoteItem = Array.from(boxOf('src/domain').querySelectorAll('[role="menu"] button')).find(el => el.textContent === 'Add note');
    if (addNoteItem === undefined) throw new Error('missing Add note');
    await click(addNoteItem);
    await typeInto('Note', 'pull an interface out here');
    await click(button('Add'));
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to src/infra', 'src/app must not import src/domain (1 import)', 'Note on src/domain: "pull an interface out here"']));
    await waitForDoc([MOVE, CUT, NOTE]);
    await key('z', { ctrl: true, shift: true });
    await settle();
    expect(entrySentences()).toHaveLength(3);
    await key('z');
    await settle();
    expect(entrySentences()).toHaveLength(3);
    await key('Delete', { target: planSelect() });
    await settle();
    expect(entrySentences()).toHaveLength(3);
    const beforeEmptyRedo = puts;
    await key('z', { ctrl: true, shift: true });
    await settle();
    expect(puts).toBe(beforeEmptyRedo);
    await click(button('Undo'));
    await waitForText(() => expect(entries()).toHaveLength(2));
    await click(button('Undo'));
    await waitForText(() => expect(entries()).toHaveLength(1));
    await click(button('Undo'));
    await waitForText(() => expect(entries()).toHaveLength(0));
    const beforeEmptyUndo = puts;
    await key('z', { ctrl: true });
    await settle();
    expect(puts).toBe(beforeEmptyUndo);
    expect(entries()).toHaveLength(0);
  });

  it('pins notes on a box and on an arrow and shows them on hover', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(boxOf('src/domain')).not.toBeNull());
    await click(boxOf('src/domain'));
    await click(mustQuery(boxOf('src/domain'), '.box-menu button', 'missing box menu'));
    await click(menuItem(boxOf('src/domain'), 'Add note'));
    await click(button('Cancel'));
    expect(document.querySelector('dialog')).toBeNull();
    await click(mustQuery(boxOf('src/domain'), '.box-menu button', 'missing box menu'));
    await click(menuItem(boxOf('src/domain'), 'Add note'));
    await click(button('Add'));
    expect(textAt('.plan-dialog-error')).toBe('write a note');
    expect(entries()).toHaveLength(0);
    await typeInto('Note', 'pull an interface out here');
    await click(button('Add'));
    await waitForText(() => expect(entrySentences()).toEqual(['Note on src/domain: "pull an interface out here"']));
    expect(document.querySelector('dialog')).toBeNull();
    expect(noteAttr(boxOf('src/domain'), 'aria-label')).toBe('note');
    expect(noteAttr(boxOf('src/domain'), 'title')).toBe('pull an interface out here');
    expect(edgeBetween('src/infra', 'src/domain').querySelectorAll('.note-marker')).toHaveLength(0);
    await click(edgeBetween('src/app', 'src/infra'));
    const arrow = edgeBetween('src/app', 'src/infra');
    await click(mustQuery(arrow, 'button', 'missing arrow menu'));
    await click(menuItem(arrow, 'Add note'));
    expect(arrow.querySelector('[role="menu"]')).toBeNull();
    await typeInto('Note', 'keep this');
    await click(button('Add'));
    await waitForText(() => expect(entrySentences()).toHaveLength(2));
    expect(entrySentences()[1]).toBe('Note on src/app → src/infra: "keep this"');
    expect(document.querySelector('dialog')).toBeNull();
    expect(arrowMark(arrow, 0, 'transform')).toBe('translate(14 70)');
    expect(arrowMark(arrow, 0, 'title')).toBe('keep this');
    expect(noteTitle(edgeBetween('src/app', 'src/infra'))).toBe('keep this');
    expect(boxOf('src/app').querySelectorAll('.note-marker')).toHaveLength(0);
    await click(mustQuery(arrow, 'button', 'missing arrow menu'));
    await click(menuItem(arrow, 'Add note'));
    await typeInto('Note', 'second thought');
    await click(button('Add'));
    await waitForText(() => expect(edgeBetween('src/app', 'src/infra').querySelectorAll('g.note-marker')).toHaveLength(2));
    expect(arrowMark(edgeBetween('src/app', 'src/infra'), 1, 'transform')).toBe('translate(28 70)');
    expect(arrowMark(edgeBetween('src/app', 'src/infra'), 1, 'title')).toBe('second thought');
  });

  it('selects and centres the target of a clicked entry, drilling when needed', async () => {
    const fileEdgeNote: PlanEdit = { kind: 'note', target: { edge: ['src/app/a.ts', 'src/infra/db.ts'] }, text: 'file edge' };
    await setPlan([MOVE, CUT, ADD, NOTE, fileEdgeNote]);
    await showApp('#at=src/app&plan=split-app');
    await waitForText(() => expect(nodeById('src/app/a.ts')).not.toBeNull());
    await click(entryRow('src/app must not import src/domain (1 import)').querySelector('.change-sentence') as Element);
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src&plan=split-app');
      expect(cutBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('true');
      expect(centers()).toContainEqual({ x: 0, y: 70 });
    });
    centers().length = 0;
    const historyBefore = window.history.length;
    await click(entryRow('src/app must not import src/domain (1 import)').querySelector('.change-sentence') as Element);
    await settle();
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(window.history).toHaveLength(historyBefore);
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src/app&plan=split-app'));
    await click(entryRow('src/infra should use src/app').querySelector('.change-sentence') as Element);
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src&plan=split-app');
      expect(edgeBetween('src/infra', 'src/app').getAttribute('data-selected')).toBe('true');
      expect(centers()).toContainEqual({ x: 130, y: 0 });
    });
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src/app&plan=split-app'));
    await click(entryRow('Note on src/domain: "pull an interface out here"').querySelector('.change-sentence') as Element);
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src&plan=split-app');
      expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true');
      expect(centers()).toContainEqual({ x: 0, y: 140 });
    });
    centers().length = 0;
    await click(sentenceOf(entryRow('Note on src/domain: "pull an interface out here"')));
    await settle();
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true');
    expect(centers()).toContainEqual({ x: 0, y: 140 });
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src/app&plan=split-app'));
    const centresBefore = centers().length;
    await click(entryRow('Note on src/app/a.ts → src/infra/db.ts: "file edge"').querySelector('.change-sentence') as Element);
    await waitForText(() => expect(window.location.hash).toBe('#at=&plan=split-app'));
    expect(centers()).toHaveLength(centresBefore);
  });

  it('stales the note on a moved file when the move is removed', async () => {
    const movedNote: PlanEdit = { kind: 'note', target: { node: 'src/infra/save.ts' }, text: 'keep the writer here' };
    await setPlan([MOVE, CUT, ADD, NOTE, movedNote]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(5));
    expect(entrySentences()[4]).toBe('Note on src/infra/save.ts: "keep the writer here"');
    await click(entryRow('Move src/app/save.ts to src/infra').querySelector('[aria-label="Remove"]') as Element);
    await waitForText(() => expect(entrySentences()).toHaveLength(4));
    const staleRow = entryRow('Note on src/infra/save.ts: "keep the writer here"');
    expect(staleRow.getAttribute('data-stale')).toBe('true');
    expect(window.getComputedStyle(staleRow).backgroundColor).toBe('rgb(254, 249, 195)');
    expect(staleRow.querySelector('.change-reason')?.textContent).toBe('no such box src/infra/save.ts');
    expect(entryRow('src/app must not import src/domain (1 import)').getAttribute('data-stale')).toBeNull();
    expect(entryRow('src/infra should use src/app').getAttribute('data-stale')).toBeNull();
    expect(entryRow('Note on src/domain: "pull an interface out here"').getAttribute('data-stale')).toBeNull();
    expect(boxOf('src/app').getAttribute('data-cycle')).toBe('true');
    expect(boxOf('src/infra').getAttribute('data-cycle')).toBe('true');
    const graph = await api(token, 'GET', '/api/graph?at=src&plan=split-app');
    expect(readGraph(graph.body).stale).toEqual([null, null, null, 'no such box src/infra/save.ts']);
    await waitForDoc([CUT, ADD, NOTE, { kind: 'note', target: { node: 'src/infra/save.ts' }, text: 'keep the writer here' }]);
    await click(staleRow.querySelector('.change-sentence') as Element);
    await settle();
    expect(noticeText()).toBe('no such box src/infra/save.ts');
    expect(window.location.hash).toBe('#at=src&plan=split-app');
  });

  it('shows the current graph with markers in Now and the metrics follow the switch', async () => {
    await setPlan([MOVE, CUT, ADD, NOTE]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(4));
    await chooseShown('Now');
    await waitForText(() => {
      expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']);
      expect(ghostRowsOf('src/infra')).toEqual(['src/infra/save.ts']);
    });
    expect(boxOf('src/app').textContent).toContain('3 files');
    expect(boxOf('src/app').getAttribute('data-y')).toBe('0');
    expect(boxOf('src/infra').getAttribute('data-y')).toBe('140');
    expect(boxOf('src/domain').getAttribute('data-y')).toBe('280');
    expect(ghostRowsOf('src/infra')).toEqual(['src/infra/save.ts']);
    expect(cycleFlags()).not.toContain('true');
    expect(edgeBetween('src/app', 'src/domain')).not.toBeNull();
    expect(cutBetween('src/app', 'src/domain')).not.toBeNull();
    const marker = edgeBetween('src/infra', 'src/app');
    expect(marker.getAttribute('data-planned')).toBe('true');
    expect(marker.getAttribute('data-cycle')).toBe('false');
    expect(marker.getAttribute('data-up')).toBe('false');
    expect(edgeTitle(marker)).toBe('0 runtime · 0 type-only · 0 extends/implements');
    expect(pathStroke('added:src/infra->src/app')).toBe('#2563eb');
    expect(noteAttr(boxOf('src/domain'), 'title')).toBe('pull an interface out here');
    await click(boxOf('src/domain'));
    await waitForText(() => expect(sectionButtons('Imported by')).toEqual(['app 0 runtime · 1 type-only · 0 extends/implements', 'infra 2 runtime · 0 type-only · 1 extends/implements']));
    await click(edgeBetween('src/app', 'src/infra'));
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('true');
    await click(button('Metrics'));
    await waitForText(() => expect(drawerRows().map(firstCell)).toEqual(['infra', 'app', 'domain']));
    await click(drawerRows()[0] as Element);
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('false');
    expect(cellsOf('app')).toEqual(['app', '3', '0', '2', '1.00', '0.00', '0.00', 'healthy', '–', '–', '–']);
    expect(cellsOf('domain')).toEqual(['domain', '2', '3', '0', '0.00', '1.00', '0.00', 'healthy', '–', '–', '–']);
    await chooseShown('Planned');
    await waitForText(() => expect(cellsOf('app')[1]).toBe('2'));
    expect(drawerRows()).not.toHaveLength(0);
    expect(cellsOf('infra')).toEqual(['infra', '3', '2', '2', '0.50', '0.00', '0.50', 'healthy', '–', '–', '–']);
    expect(cellsOf('domain')[2]).toBe('2');
    await click(boxOf('src/domain'));
    await waitForText(() => expect(sectionButtons('Imported by')).toEqual(['infra 2 runtime · 0 type-only · 1 extends/implements']));
  });

  it('marks the move stale after a rescan without the file and clears it when restored', async () => {
    await setPlan([MOVE]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toEqual(['Move src/app/save.ts to src/infra']));
    expect(staleAttr(entryAt(0))).toBeNull();
    hidePath('src/app/save.ts');
    await click(button('Rescan'));
    await waitForText(() => expect(staleAttr(entryAt(0))).toBe('true'));
    expect(reasonText(entryAt(0))).toBe('no such file src/app/save.ts');
    const planned = await api(token, 'GET', '/api/graph?at=src&plan=split-app');
    const plannedBody = readGraph(planned.body);
    expect(plannedBody.stale).toEqual(['no such file src/app/save.ts']);
    expect(filesOf(plannedBody.nodes, 'src/app')).toBe(2);
    expect(filesOf(plannedBody.nodes, 'src/infra')).toBe(2);
    const plain = await api(token, 'GET', '/api/graph?at=src');
    expect(bodyRecord(plain.body)).not.toHaveProperty('stale');
    expect(filesOf(readGraph(plain.body).nodes, 'src/app')).toBe(2);
    await waitForDoc([MOVE]);
    resetWorld();
    await click(button('Rescan'));
    await waitForText(() => expect(staleAttr(entryAt(0))).toBeNull());
    const restored = await api(token, 'GET', '/api/graph?at=src&plan=split-app');
    const restoredBody = readGraph(restored.body);
    expect(restoredBody.stale).toEqual([null]);
    expect(filesOf(restoredBody.nodes, 'src/app')).toBe(2);
    expect(filesOf(restoredBody.nodes, 'src/infra')).toBe(3);
  });

  it('keeps the plan over a reload and opens no plan from a file hash', async () => {
    await setPlan([MOVE, CUT, ADD, NOTE]);
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(entrySentences()).toHaveLength(4));
    reactRoot.unmount();
    dom.window.close();
    await showApp('#at=src&plan=split-app');
    await waitForText(() => {
      expect(entrySentences()).toHaveLength(4);
      expect(rowPathsOf('src/infra')).toContain('src/infra/save.ts');
    });
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    expect(shownChecks()).toEqual([false, true]);
    expect(boxOf('src/app').getAttribute('data-cycle')).toBe('true');
    expect(boxOf('src/infra').getAttribute('data-cycle')).toBe('true');
    expect(boxOf('src/domain').querySelector('.note-marker')?.getAttribute('title')).toBe('pull an interface out here');
    reactRoot.unmount();
    dom.window.close();
    await showApp('#file=src/app/a.ts');
    await waitForText(() => expect(document.querySelector('main')?.textContent).toContain('export const a'));
    const filesTab = Array.from(document.querySelectorAll('[role="tab"]')).find(el => el.textContent === 'Files');
    expect(filesTab?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('select[aria-label="Plan"]')).toBeNull();
  });

  it('deletes the plan after asking and labels duplicate names with the slug', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(planSelect().value).toBe('split-app'));
    await click(button('Delete plan'));
    expect(document.querySelector('dialog')?.textContent).toContain('Delete Split app?');
    await click(button('Cancel'));
    expect(document.querySelector('dialog')).toBeNull();
    expect(planSelect().value).toBe('split-app');
    expect(window.location.hash).toContain('plan=split-app');
    await click(button('Delete plan'));
    await click(button('Delete'));
    await waitForText(() => expect(planSelect().value).toBe(''));
    expect(document.querySelector('dialog')).toBeNull();
    await waitForText(() => expect(Array.from(planSelect().options).map(option => option.textContent)).toEqual(['No plan']));
    expect(window.location.hash).toBe('#at=src');
    expect(boxOf('src/app').textContent).toContain('3 files');
    expect(boxOf('src/app').querySelectorAll('.box-row')).toHaveLength(0);
    const gone = await api(token, 'GET', '/api/plans/split-app');
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ error: 'no such plan' });
    await api(token, 'POST', '/api/plans', { name: 'Split app' });
    await api(token, 'POST', '/api/plans', { name: 'Split app' });
    reactRoot.unmount();
    dom.window.close();
    await showApp('#at=src');
    await waitForText(() => expect(boxOf('src/app')).not.toBeNull());
    expect(Array.from(planSelect().options).map(option => option.textContent)).toEqual(['No plan', 'Split app', 'Split app (split-app-2)']);
    await choosePlan('split-app-2');
    await waitForText(() => expect(window.location.hash).toBe('#at=src&plan=split-app-2'));
    expect(planSelect().value).toBe('split-app-2');
    await api(token, 'DELETE', '/api/plans/split-app-2');
    await api(token, 'DELETE', '/api/plans/split-app');
  });

  it('keeps the open plan when a save is refused', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(boxOf('src/domain')).not.toBeNull());
    markCorrupt('split-app');
    const putsBefore = puts;
    await click(boxOf('src/domain'));
    const boxMenuButton = boxOf('src/domain').querySelector('.box-menu button');
    if (boxMenuButton === null) throw new Error('missing box menu');
    await click(boxMenuButton);
    const addNoteItem = Array.from(boxOf('src/domain').querySelectorAll('[role="menu"] button')).find(el => el.textContent === 'Add note');
    if (addNoteItem === undefined) throw new Error('missing Add note');
    await click(addNoteItem);
    await typeInto('Note', 'nope');
    await click(button('Add'));
    await waitForText(() => {
      expect(puts).toBe(putsBefore + 1);
      expect(noticeText()).toBe('no such plan');
    });
    expect(entries()).toHaveLength(0);
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    await key('z', { ctrl: true });
    await settle();
    expect(entries()).toHaveLength(0);
    expect(noticeText()).toBe('no such plan');
    erasePlan('split-app');
    await api(token, 'POST', '/api/plans', { name: 'Split app' });
  });

  it('keeps the open plan when a delete is refused', async () => {
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(boxOf('src/domain')).not.toBeNull());
    markCorrupt('split-app');
    const deletesBefore = deletes;
    await click(button('Delete plan'));
    await click(button('Delete'));
    await waitForText(() => {
      expect(deletes).toBe(deletesBefore + 1);
      expect(noticeText()).toBe('no such plan');
    });
    expect(document.querySelector('dialog')).not.toBeNull();
    expect(window.location.hash).toBe('#at=src&plan=split-app');
    erasePlan('split-app');
    await api(token, 'POST', '/api/plans', { name: 'Split app' });
  });

  it('shows the plan and directory errors on the canvas', async () => {
    await showApp('#at=src&plan=missing');
    await waitForText(() => expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such plan'));
    expect(planSelect().value).toBe('');
    await key('z', { ctrl: true });
    await settle();
    expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such plan');
    expect(windowErrors).toBe(0);
    await choosePlan('');
    await waitForText(() => expect(boxOf('src/app').textContent).toContain('3 files'));
    expect(window.location.hash).toBe('#at=src');
    reactRoot.unmount();
    dom.window.close();
    await setPlan([MOVE]);
    await showApp('#at=notes&plan=split-app');
    await waitForText(() => expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such directory'));
    expect(document.querySelectorAll('.fake-node')).toHaveLength(0);
    expect(entries()).toHaveLength(0);
  });

  it('draws the planned rows when the current graph fails', async () => {
    failPlain = true;
    await showApp('#at=src&plan=split-app');
    await waitForText(() => expect(rowPathsOf('src/app')).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
    expect(ghostRowsOf('src/app')).toEqual([]);
    await click(boxOf('src/domain'));
    await click(mustQuery(document.body, '.fake-flow', 'missing flow'));
    await settle();
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
  });

  it('refuses to cut an arrow the pairs endpoint cannot back', async () => {
    const doc = { version: 1, name: 'P', slug: 'p', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] };
    const graph = {
      at: 'src',
      crumbs: [{ name: 'layered', at: '' }, { name: 'src', at: 'src' }],
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 1, row: 0, order: 0, cycle: false },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 1, order: 0, cycle: false },
      ],
      edges: [{ from: 'src/app', to: 'src/domain', runtime: 1, type: 0, cycle: false }],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
      stale: [],
    };
    const routes: Record<string, unknown> = {
      '/api/layout': { version: 1, views: {}, settings: { tests: false, external: false } },
      '/api/plans': { plans: [{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }] },
      '/api/plans/p': doc,
      '/api/graph': graph,
      '/api/pairs': { pairs: [] },
    };
    const fake = (async (url: string | URL | Request) => {
      const body = routes[String(url).split('?')[0]];
      if (body === undefined) return { ok: false, json: async () => ({ error: 'no such node' }) } as Response;
      return { ok: true, json: async () => body } as Response;
    }) as typeof fetch;
    dom = installDom(`${BASE}/?token=tok#at=src`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const { ArchView } = await import('./ArchView.tsx');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { act } = await import('react');
    await act(async () => {
      reactRoot.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } }) },
          createElement(ArchView, { token: 'tok', at: 'src', plan: 'p', fetcher: fake, onDrill: () => undefined, onOpenFile: () => undefined }),
        ),
      );
    });
    await waitForText(() => expect(edgeBetween('src/app', 'src/domain')).not.toBeNull());
    await click(edgeBetween('src/app', 'src/domain'));
    await key('Delete');
    await waitForText(() => expect(noticeText()).toBe('no such arrow src/app → src/domain'));
    expect(entries()).toHaveLength(0);
    routes['/api/pairs'] = { error: 'nope' };
    await click(edgeBetween('src/app', 'src/domain'));
    const arrowAgain = edgeBetween('src/app', 'src/domain');
    await click(mustQuery(arrowAgain, 'button', 'missing arrow menu'));
    await click(menuItem(arrowAgain, 'Cut'));
    await waitForText(() => expect(noticeText()).toBe('cannot reach bindweed'));
    expect(arrowAgain.querySelector('[role="menu"]')).toBeNull();
    expect(entries()).toHaveLength(0);
    await choosePlan('');
    await settle();
    expect(planSelect().value).toBe('p');
  });

  it('moves the selection between boxes, arrows, cut marks and entry targets', async () => {
    await setPlan([CUT, ADD, NOTE]);
    await showApp('#at=src/app&plan=split-app');
    await waitForText(() => expect(nodeById('src/app/a.ts')).not.toBeNull());
    const noteEntry = () => sentenceOf(entryRow('Note on src/domain: "pull an interface out here"'));
    const cutEntry = () => sentenceOf(entryRow('src/app must not import src/domain (1 import)'));
    await click(noteEntry());
    await waitForText(() => {
      expect(window.location.hash).toBe('#at=src&plan=split-app');
      expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true');
    });
    await click(cutEntry());
    await waitForText(() => expect(cutBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('true'));
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
    await click(noteEntry());
    await waitForText(() => expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true'));
    expect(cutBetween('src/app', 'src/domain').getAttribute('data-selected')).toBe('false');
    await click(boxOf('src/app'));
    expect(boxOf('src/app').getAttribute('data-selected')).toBe('true');
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
    await click(noteEntry());
    await waitForText(() => expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true'));
    expect(boxOf('src/app').getAttribute('data-selected')).toBe('false');
    await click(sentenceOf(entryRow('src/infra should use src/app')));
    await waitForText(() => expect(edgeBetween('src/infra', 'src/app').getAttribute('data-selected')).toBe('true'));
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
    await click(boxOf('src/domain'));
    await click(edgeBetween('src/app', 'src/infra'));
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('true');
    await click(boxOf('src/infra'));
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('false');
    expect(boxOf('src/infra').getAttribute('data-selected')).toBe('true');
    await click(edgeBetween('src/app', 'src/infra'));
    await click(mustQuery(document.body, '.fake-flow', 'missing flow'));
    expect(edgeBetween('src/app', 'src/infra').getAttribute('data-selected')).toBe('false');
    await dblclick(boxOf('src/app'));
    await waitForText(() => expect(window.location.hash).toBe('#at=src/app&plan=split-app'));
    await click(noteEntry());
    await waitForText(() => expect(boxOf('src/domain').getAttribute('data-selected')).toBe('true'));
    await click(edgeBetween('src/app', 'src/infra'));
    expect(boxOf('src/domain').getAttribute('data-selected')).toBe('false');
  });

  it('centres a focus request and refires when the node set changes', async () => {
    const { ArchCanvas, CanvasProvider } = await import('./ArchCanvas.tsx');
    const viewFor = (ids: string[]): GraphView => ({
      at: 'src',
      crumbs: [{ name: 'layered', at: '' }],
      nodes: ids.map(id => ({ id, kind: 'package' as const, name: id, path: id, files: 1, row: 0, order: 0, cycle: false })),
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
    const spots = [
      { id: 'src/app', x: 0, y: 0 },
      { id: 'src/infra', x: 260, y: 0 },
    ];
    const focusArrow = { kind: 'arrow' as const, from: 'src/app', to: 'src/infra' };
    dom = installDom(`${BASE}/?token=tok#at=src`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const render = (ids: string[], focus: { kind: 'arrow'; from: string; to: string }): void => {
      reactRoot.render(
        createElement(
          CanvasProvider,
          null,
          createElement(ArchCanvas, {
            view: viewFor(ids),
            spots,
            hover: null,
            chosen: null,
            also: [],
            marked: null,
            overlay: 'none',
            crapMax: 4,
            planning: null,
            focus,
            onHover: () => undefined,
            onSelect: () => undefined,
            onSelectMark: () => undefined,
            onClear: () => undefined,
            onOpen: () => undefined,
            onDropNode: () => undefined,
          }),
        ),
      );
    };
    await actRun(() => render(['src/app', 'src/infra'], focusArrow));
    expect(centers()).toContainEqual({ x: 130, y: 0 });
    const before = centers().length;
    await actRun(() => render(['src/app', 'src/infra'], { kind: 'arrow', from: 'src/app', to: 'src/gone' }));
    expect(centers()).toHaveLength(before);
    await actRun(() => render(['src/app', 'src/infra'], { kind: 'arrow', from: 'src/gone', to: 'src/infra' }));
    expect(centers()).toHaveLength(before);
    await actRun(() => render(['a', 'bc'], focusArrow));
    expect(centers()).toHaveLength(before + 1);
    await actRun(() => render(['ab', 'c'], focusArrow));
    expect(centers()).toHaveLength(before + 2);
  });

  it('gates the planned fetch on the layout and never queries rows for files', async () => {
    const doc = { version: 1, name: 'P', slug: 'p', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] };
    const node = (id: string, kind: 'package' | 'file') => ({ id, kind, name: id, path: id, files: 1, row: 0, order: 0, cycle: false });
    const graphFor = (at: string) => ({
      at,
      crumbs: [{ name: 'layered', at: '' }],
      nodes: at === 'src' ? [node('src/app', 'package')] : [node('src/app/a.ts', 'file')],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
      stale: [],
    });
    const bodies: Record<string, unknown> = {
      '/api/layout': { version: 1, views: {}, settings: { tests: true, external: false } },
      '/api/plans': { plans: [{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }] },
      '/api/plans/p': doc,
    };
    const calls: { at: string | null; tests: string | null; plan: string | null }[] = [];
    const planDocCalls: string[] = [];
    const bodyFor = (u: URL): unknown => {
      if (u.pathname === '/api/graph') return graphFor(u.searchParams.get('at') ?? '');
      return bodies[u.pathname] ?? { error: 'no such node' };
    };
    const fake = (async (url: string | URL | Request) => {
      const u = new URL(String(url), BASE);
      if (u.pathname === '/api/graph') calls.push({ at: u.searchParams.get('at'), tests: u.searchParams.get('tests'), plan: u.searchParams.get('plan') });
      if (u.pathname.startsWith('/api/plans/')) planDocCalls.push(u.pathname);
      return { ok: true, json: async () => bodyFor(u) } as Response;
    }) as typeof fetch;
    dom = installDom(`${BASE}/?token=tok#at=src`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const { ArchView } = await import('./ArchView.tsx');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });
    const render = (at: string, plan: string | undefined): void => {
      reactRoot.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ArchView, { token: 'tok', at, plan, fetcher: fake, onDrill: () => undefined, onOpenFile: () => undefined }),
        ),
      );
    };
    await actRun(() => render('src', 'p'));
    await waitForText(() => expect(nodeById('src/app')).not.toBeNull());
    const viewCalls = calls.filter(call => call.at === 'src' && call.plan === 'p');
    expect(viewCalls.length).toBeGreaterThan(0);
    for (const call of viewCalls) expect(call.tests).toBe('1');
    await actRun(() => render('src/app', 'p'));
    await waitForText(() => expect(nodeById('src/app/a.ts')).not.toBeNull());
    expect(calls.filter(call => call.at !== 'src' && call.at !== 'src/app')).toEqual([]);
    await actRun(() => render('src', undefined));
    await settle();
    expect(planDocCalls).toEqual(['/api/plans/p', '/api/plans/p/chat']);
  });

  it('pins a file dragged onto a package box when no plan is open', async () => {
    const layoutWrites: unknown[] = [];
    const graph = {
      at: 'src',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
      ],
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 1, row: 0, order: 0, cycle: false },
        { id: 'src/loose.ts', kind: 'file', name: 'loose.ts', path: 'src/loose.ts', row: 1, order: 0, cycle: false },
      ],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    };
    const routes: Record<string, unknown> = {
      '/api/layout': { version: 1, views: {}, settings: { tests: false, external: false } },
      '/api/plans': { plans: [] },
      '/api/graph': graph,
    };
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url), BASE);
      if (u.pathname === '/api/layout' && init?.method === 'PUT') layoutWrites.push(readRaw(init.body));
      return { ok: true, json: async () => routes[u.pathname] ?? { error: 'no such node' } } as Response;
    }) as typeof fetch;
    dom = installDom(`${BASE}/?token=tok#at=src`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const { ArchView } = await import('./ArchView.tsx');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { act } = await import('react');
    await act(async () => {
      reactRoot.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } }) },
          createElement(ArchView, { token: 'tok', at: 'src', fetcher: fake, onDrill: () => undefined, onOpenFile: () => undefined }),
        ),
      );
    });
    await waitForText(() => expect(nodeById('src/loose.ts')).not.toBeNull());
    await dragBox('src/loose.ts', [boxOf('src/app')]);
    await waitForText(() => expect(layoutWrites).toHaveLength(1));
    expect(parseLayout(layoutWrites[0])?.views['src']?.['src/loose.ts']).toBeDefined();
    expect(document.querySelector('aside[aria-label="changes"]')).toBeNull();
  });
});
