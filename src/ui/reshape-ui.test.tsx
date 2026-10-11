import { JSDOM } from 'jsdom';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleTexts, edgePairs, graphView, nodeDetail } from '../domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from '../domain/layout.ts';
import { freeSlug, parsePlan, planNameFrom, slugOf, summarisePlan, type PlanDoc, type PlanEdit } from '../domain/plan.ts';
import { applyPlan, planReport } from '../domain/planned.ts';

vi.mock('@xyflow/react', async () => {
  const { createElement: ce } = await import('react');

  type FakeNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> };
  type FakeEdge = { id: string; source: string; target: string; type: string; data?: Record<string, unknown>; markerEnd?: unknown };
  type FakeFlowProps = {
    nodes: FakeNode[];
    edges: FakeEdge[];
    nodeTypes: Record<string, (props: never) => ReactElement | null>;
    edgeTypes: Record<string, (props: never) => ReactElement | null>;
    onNodeClick?: (event: { shiftKey: boolean }, node: FakeNode) => void;
    onNodeDoubleClick?: (event: unknown, node: FakeNode) => void;
    onEdgeClick?: (event: unknown, edge: FakeEdge) => void;
    onConnect?: (connection: { source: string; target: string }) => void;
    onPaneClick?: (event: unknown) => void;
  };

  const centers: { x: number; y: number }[] = [];
  let lastFlow: FakeFlowProps | null = null;

  function fakeNodeView(props: FakeFlowProps, node: FakeNode) {
    const Box = props.nodeTypes[node.type];
    return ce(
      'div',
      {
        key: node.id,
        className: 'fake-node',
        'data-node': node.id,
        onClick: (event: { shiftKey: boolean }) => props.onNodeClick?.({ shiftKey: event.shiftKey }, node),
        onDoubleClick: (event: unknown) => props.onNodeDoubleClick?.(event, node),
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
    if (event.target === event.currentTarget) props.onPaneClick?.(event);
  }

  function ReactFlow(props: FakeFlowProps) {
    lastFlow = props;
    return ce(
      'div',
      { className: 'fake-flow', onClick: (event: { target?: unknown; currentTarget?: unknown }) => paneClick(props, event) },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge))),
    );
  }

  const flowApi = {
    setCenter: (x: number, y: number) => {
      centers.push({ x, y });
      return Promise.resolve(true);
    },
  };

  Object.assign(globalThis, {
    reshapeCenters: centers,
    reshapeConnect: (source: string, target: string) => {
      lastFlow?.onConnect?.({ source, target });
    },
  });

  return {
    ReactFlow,
    ReactFlowProvider: (props: { children: ReactElement }) => props.children,
    useReactFlow: () => flowApi,
    BaseEdge: (props: { id: string; style?: { strokeDasharray?: string } }) =>
      ce('path', { className: 'fake-edge-path', 'data-edge': props.id, 'data-dash': props.style?.strokeDasharray ?? '' }),
    Handle: () => ce('span'),
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

let extraFiles: { path: string; test: boolean }[] = [];
let extraEdges: { from: string; to: string; kind: 'runtime' }[] = [];

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

function workspaceScan() {
  return { ...BASE_SCAN, files: [...BASE_SCAN.files, ...extraFiles], edges: [...BASE_SCAN.edges, ...extraEdges] };
}

type Hit = { status: number; body: unknown };

const plans = new Map<string, PlanDoc>();
let layout: LayoutDoc = emptyLayout();

function planSlug(url: URL): string | null {
  const plan = url.searchParams.get('plan');
  return plan === null || plan === '' ? null : plan;
}

function flagsOf(url: URL): { tests: boolean; external: boolean } {
  return { tests: url.searchParams.get('tests') === '1', external: url.searchParams.get('external') === '1' };
}

function atOf(url: URL): string {
  return url.searchParams.get('at') ?? '';
}

function loaded(url: URL): PlanDoc | null | false {
  const slug = planSlug(url);
  if (slug === null) return null;
  return plans.get(slug) ?? false;
}

function warned(report: ReturnType<typeof planReport>): { warnings?: unknown } {
  return report.warnings.every(list => list.length === 0) ? {} : { warnings: report.warnings };
}

function graphFor(url: URL, edits: PlanEdit[]): Hit {
  const report = planReport(workspaceScan(), edits, cycleTexts);
  const view = graphView(report.scan, atOf(url), 'layered', flagsOf(url));
  if (view === null) return { status: 404, body: { error: 'no such directory' } };
  return { status: 200, body: { ...view, stale: report.stale, ...warned(report) } };
}

function graphBody(url: URL): Hit {
  const load = loaded(url);
  if (load === false) return { status: 404, body: { error: 'no such plan' } };
  if (load !== null) return graphFor(url, load.edits);
  return { status: 200, body: graphView(workspaceScan(), atOf(url), 'layered', flagsOf(url)) };
}

function plannedScan(url: URL) {
  const load = loaded(url);
  return applyPlan(workspaceScan(), load === null || load === false ? [] : load.edits);
}

function detailBody(url: URL): Hit {
  const detail = nodeDetail(plannedScan(url), url.searchParams.get('id'), atOf(url), 'layered', flagsOf(url));
  return detail === null ? { status: 404, body: { error: 'no such node' } } : { status: 200, body: detail };
}

function pairsBody(url: URL): Hit {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  return { status: 200, body: { pairs: edgePairs(plannedScan(url), atOf(url), from, to, flagsOf(url)) } };
}

function createStored(raw: unknown): Hit {
  const name = planNameFrom(raw);
  if (name === undefined) return { status: 400, body: { error: 'bad name' } };
  const doc: PlanDoc = { version: 1, name, slug: freeSlug(slugOf(name), slug => plans.has(slug)), createdAt: '2026-10-01T00:00:00.000Z', baseCommit: HEAD, edits: [], redo: [] };
  plans.set(doc.slug, doc);
  return { status: 201, body: doc };
}

function putStored(slug: string, raw: unknown): Hit {
  const doc = parsePlan(raw);
  if (doc?.slug !== slug) return { status: 400, body: { error: 'bad plan' } };
  plans.set(slug, doc);
  return { status: 200, body: doc };
}

function putLayout(raw: unknown): Hit {
  layout = parseLayout(raw) ?? layout;
  return { status: 200, body: layout };
}

const ROUTES: Record<string, (url: URL, raw: unknown) => Hit> = {
  'GET /api/graph': graphBody,
  'GET /api/detail': detailBody,
  'GET /api/pairs': pairsBody,
  'GET /api/layout': () => ({ status: 200, body: layout }),
  'GET /api/plans': () => ({ status: 200, body: { plans: [...plans.values()].map(summarisePlan) } }),
  'POST /api/plans': (_url, raw) => createStored(raw),
  'PUT /api/layout': (_url, raw) => putLayout(raw),
};

function planVerb(method: string, slug: string, raw: unknown): Hit {
  if (method === 'PUT') return putStored(slug, raw);
  return { status: 200, body: plans.get(slug) };
}

function dispatch(method: string, url: URL, raw: unknown): Hit {
  const route = ROUTES[`${method} ${url.pathname}`];
  if (route !== undefined) return route(url, raw);
  return planVerb(method, url.pathname.slice('/api/plans/'.length), raw);
}

function readRaw(body: BodyInit | null | undefined): unknown {
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const hit = dispatch(init?.method ?? 'GET', new URL(String(url), BASE), readRaw(init?.body));
  return { ok: hit.status < 300, status: hit.status, json: async () => hit.body } as Response;
}) as typeof fetch;

function installDom(url: string): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const w = dom.window;
  const style = w.document.createElement('style');
  style.textContent = sheet;
  w.document.head.appendChild(style);
  for (const name of ['HTMLElement', 'Node', 'DocumentFragment', 'MutationObserver', 'MouseEvent', 'KeyboardEvent', 'navigator'] as const) {
    Object.defineProperty(globalThis, name, { value: w[name], configurable: true });
  }
  Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  return dom;
}

const SPLIT_SENTENCE = 'Split src/app into src/app/read (2 files) and src/app/write (2 files)';
const CYCLE_LINE = 'this plan adds a cycle: read → write → read';
const SEVEN = [
  'Create package src/ports',
  'Move src/domain/shape.ts to src/ports',
  'Rename src/infra to src/adapters',
  SPLIT_SENTENCE,
  'Merge src/app/read and src/app/write into src/app',
  'Delete src/domain/model.ts',
  'Fold src/adapters/repo.ts into src/ports/shape.ts',
];

describe('the page reshapes packages and files', () => {
  const token = 'tok';
  let dom: JSDOM;
  let reactRoot: Root;

  async function act(action: () => void): Promise<void> {
    const react = await import('react');
    await react.act(async () => {
      action();
    });
  }

  async function waitFor(check: () => void | Promise<void>): Promise<void> {
    const { waitFor: wait } = await import('@testing-library/dom');
    await wait(check, { timeout: 4000 });
  }

  async function showApp(hash: string): Promise<void> {
    dom = installDom(`${BASE}/?token=${token}${hash}`);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    reactRoot = createRoot(el);
    const { App } = await import('./App.tsx');
    await act(() => reactRoot.render(createElement(App, { token, location: window.location, historyApi: window.history, fetcher })));
  }

  async function reload(): Promise<void> {
    const hash = window.location.hash;
    reactRoot.unmount();
    dom.window.close();
    await showApp(hash);
  }

  function nodeById(id: string): HTMLElement {
    const el = Array.from(document.querySelectorAll<HTMLElement>('.fake-node')).find(node => node.dataset.node === id);
    if (el === undefined) throw new Error(`missing node ${id}`);
    return el;
  }

  function boxIds(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.fake-node .box:not(.ghost)')).map(box => box.dataset.id ?? '');
  }

  function ghostBoxIds(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.fake-node .box.ghost')).map(box => box.dataset.id ?? '');
  }

  function boxOf(id: string): HTMLElement {
    const box = nodeById(id).querySelector<HTMLElement>('.box');
    if (box === null) throw new Error(`missing box ${id}`);
    return box;
  }

  function rowOf(id: string, path: string): HTMLElement {
    const row = Array.from(boxOf(id).querySelectorAll<HTMLElement>('.box-row')).find(item => item.dataset.path === path);
    if (row === undefined) throw new Error(`missing row ${path}`);
    return row;
  }

  function rowNames(id: string): string[] {
    return Array.from(boxOf(id).querySelectorAll('.box-row:not([data-ghost="true"])')).map(row => row.textContent ?? '');
  }

  function ghostNames(id: string): string[] {
    return Array.from(boxOf(id).querySelectorAll('.box-row[data-ghost="true"]')).map(row => row.textContent ?? '');
  }

  function button(text: string, root: ParentNode = document): HTMLElement {
    const el = Array.from(root.querySelectorAll<HTMLElement>('button')).find(item => item.textContent === text);
    if (el === undefined) throw new Error(`missing button ${text}`);
    return el;
  }

  function hasButton(text: string): boolean {
    return Array.from(document.querySelectorAll('button')).some(item => item.textContent === text);
  }

  function entries(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('aside[aria-label="changes"] li.change'));
  }

  function sentences(): string[] {
    return entries().map(row => row.querySelector('.change-sentence')?.textContent ?? '');
  }

  function entryRow(sentence: string): HTMLElement {
    const row = entries().find(item => item.querySelector('.change-sentence')?.textContent === sentence);
    if (row === undefined) throw new Error(`missing entry ${sentence}`);
    return row;
  }

  function warningsOf(sentence: string): string[] {
    return Array.from(entryRow(sentence).querySelectorAll('.change-warning-text')).map(item => item.textContent ?? '');
  }

  function badge(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.changes-heading .warning-badge');
  }

  function notice(): string {
    return document.querySelector('output[aria-label="notice"]')?.textContent ?? '';
  }

  function dialogError(): string | null {
    return document.querySelector('.plan-dialog-error')?.textContent ?? null;
  }

  function dialogLabel(): string | null {
    return document.querySelector('dialog')?.getAttribute('aria-label') ?? null;
  }

  async function click(el: Element, shift = false): Promise<void> {
    await act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: shift })));
  }

  async function crumb(name: string): Promise<void> {
    const el = Array.from(document.querySelectorAll('nav[aria-label="breadcrumb"] button')).find(item => item.textContent === name);
    if (el === undefined) throw new Error(`missing crumb ${name}`);
    await click(el);
  }

  async function drill(id: string): Promise<void> {
    await act(() => nodeById(id).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => expect(window.location.hash).toContain(`at=${id}&`));
  }

  async function menu(id: string, item: string): Promise<void> {
    await click(boxOf(id));
    await click(button('Menu', boxOf(id)));
    await click(button(item, boxOf(id)));
  }

  async function typeInto(label: string, value: string): Promise<void> {
    const field = document.querySelector(`input[aria-label="${label}"]`);
    if (field === null) throw new Error(`missing input ${label}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(() => {
      setter?.call(field, value);
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  async function choose(label: string, value: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    const select = document.querySelector(`select[aria-label="${label}"]`);
    if (select === null) throw new Error(`missing select ${label}`);
    await act(() => fireEvent.change(select, { target: { value } }));
  }

  async function named(value: string, submit: string): Promise<void> {
    await typeInto('Name', value);
    await click(button(submit));
  }

  async function key(name: string, shift = false): Promise<void> {
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, ctrlKey: true, shiftKey: shift, bubbles: true })));
  }

  async function pressDelete(): Promise<void> {
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
  }

  function menuLabels(id: string): (string | null)[] {
    return Array.from(boxOf(id).querySelectorAll('[role="menu"] button')).map(item => item.textContent);
  }

  async function chooseShown(label: string): Promise<void> {
    const radio = Array.from(document.querySelectorAll('input[name="shown-graph"]')).find(el => el.parentElement?.textContent === label);
    if (radio === undefined) throw new Error(`missing radio ${label}`);
    await click(radio);
  }

  function boxCentre(id: string): { x: number; y: number } {
    return { x: Number(boxOf(id).dataset.x), y: Number(boxOf(id).dataset.y) };
  }

  function storedEdits(): PlanEdit[] {
    return plans.get('reshape')?.edits ?? [];
  }

  function centres(): { x: number; y: number }[] {
    return (globalThis as unknown as { reshapeCenters: { x: number; y: number }[] }).reshapeCenters;
  }

  async function seed(name: string, slug: string, edits: PlanEdit[]): Promise<void> {
    plans.set(slug, { version: 1, name, slug, createdAt: '2026-10-01T00:00:00.000Z', baseCommit: HEAD, edits, redo: [] });
  }

  beforeEach(async () => {
    plans.clear();
    extraFiles = [];
    extraEdges = [];
    layout = emptyLayout();
    await seed('Reshape', 'reshape', []);
  });

  afterEach(() => {
    reactRoot.unmount();
    dom.window.close();
  });

  it('The canvas asks for a package, refuses a bad name, and lists the warning', async () => {
    await showApp('#at=src');
    await waitFor(() => expect(boxIds()).toContain('src/app'));
    expect(hasButton('Canvas')).toBe(false);
    reactRoot.unmount();
    dom.window.close();
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(rowNames('src/app')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    expect(document.querySelector('.changes-heading')?.textContent).toBe('Changes ');
    await click(button('Canvas'));
    await click(button('New package'));
    expect(dialogLabel()).toBe('New package');
    await click(button('Create'));
    expect(dialogError()).toBe('write a name');
    expect(entries()).toHaveLength(0);
    await named('has space', 'Create');
    expect(dialogError()).toBe('bad name');
    await named('infra', 'Create');
    expect(dialogError()).toBe('src/infra already exists');
    await named('ports', 'Create');
    await waitFor(() => expect(sentences()).toEqual(['Create package src/ports']));
    expect(document.querySelector('dialog')).toBeNull();
    await waitFor(() => expect(boxOf('src/ports').textContent).toContain('0 files'));
    expect(boxOf('src/ports').dataset.x).toBe('260');
    expect(boxOf('src/ports').dataset.y).toBe('280');
    expect(boxOf('src/ports').querySelectorAll('.box-row')).toHaveLength(0);
    await waitFor(() => expect(badgeText()).toBe('1'));
    expect(badge()?.getAttribute('aria-label')).toBe('1 warning');
    expect(warningsOf('Create package src/ports')).toEqual(['src/ports is empty']);
    expect(storedEdits()).toEqual([{ kind: 'create-package', path: 'src/ports' }]);
    await click(button('Canvas'));
    await click(button('New package'));
    await click(button('Cancel'));
    expect(document.querySelector('dialog')).toBeNull();
  });

  function badgeText(): string | null {
    return badge()?.textContent ?? null;
  }

  function selects(): HTMLSelectElement[] {
    return Array.from(document.querySelectorAll<HTMLSelectElement>('dialog select'));
  }

  function optionsOf(label: string): string[] {
    return Array.from(document.querySelectorAll(`select[aria-label="${label}"] option`)).map(item => item.textContent ?? '');
  }

  function sentenceButton(sentence: string): Element {
    return entryRow(sentence).querySelector('.change-sentence') as Element;
  }

  function lastSentence(): string | undefined {
    return sentences().at(-1);
  }

  function spot(id: string): [string | undefined, string | undefined] {
    return [boxOf(id).dataset.x, boxOf(id).dataset.y];
  }

  function importerList(sentence: string): string[] {
    return Array.from(entryRow(sentence).querySelectorAll('.change-importers li')).map(item => item.textContent ?? '');
  }

  async function renameSaveAndUndo(): Promise<void> {
    await drill('src/app');
    await waitFor(() => expect(boxIds()).toContain('src/app/save.ts'));
    await menu('src/app/save.ts', 'Rename');
    expect(dialogLabel()).toBe('Rename');
    await named('b', 'Rename');
    expect(dialogError()).toBe('src/app/b.ts already exists');
    expect(sentences()).toEqual(['Create package src/ports']);
    await named('writer', 'Rename');
    await waitFor(() => expect(lastSentence()).toBe('Rename src/app/save.ts to writer.ts'));
    await waitFor(() => expect(boxIds()).toContain('src/app/writer.ts'));
    expect(storedEdits().at(-1)).toEqual({ kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' });
    await click(button('Undo'));
    await waitFor(() => expect(boxIds()).toContain('src/app/save.ts'));
    expect(sentences()).toEqual(['Create package src/ports']);
  }

  async function moveShapeAndRenameInfra(): Promise<void> {
    await crumb('src');
    await waitFor(() => expect(rowNames('src/domain')).toEqual(['model.ts', 'shape.ts']));
    const { fireEvent } = await import('@testing-library/dom');
    await act(() => fireEvent.drop(boxOf('src/ports'), { dataTransfer: { getData: () => 'src/domain/shape.ts' } }));
    await waitFor(() => expect(rowNames('src/ports')).toEqual(['shape.ts']));
    expect(badge()).toBeNull();
    expect(warningsOf('Create package src/ports')).toEqual([]);
    expect(boxOf('src/ports').textContent).toContain('1 file');
    expect(window.getComputedStyle(boxOf('src/ports')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(boxOf('src/domain').textContent).toContain('1 file');
    expect(ghostNames('src/domain')).toEqual(['shape.ts']);
    await menu('src/infra', 'Rename');
    await named('adapters', 'Rename');
    await waitFor(() => expect(lastSentence()).toBe('Rename src/infra to src/adapters'));
    await waitFor(() => expect(rowNames('src/adapters')).toEqual(['db.ts', 'repo.ts']));
    expect(boxIds()).not.toContain('src/infra');
    expect(sentences()).toContain('Move src/domain/shape.ts to src/ports');
  }

  async function splitRefusals(): Promise<void> {
    await click(button('Split'));
    expect(dialogError()).toBe('name at least two parts');
    await typeInto('Part 1', 'has space');
    await typeInto('Part 2', 'write');
    await click(button('Split'));
    expect(dialogError()).toBe('bad name');
    await typeInto('Part 1', 'read');
    await typeInto('Part 2', 'read');
    await click(button('Split'));
    expect(dialogError()).toBe('duplicate part');
    await typeInto('Part 2', 'write');
    expect(optionsOf('a.ts')).toEqual(['choose', 'read', 'write']);
    await choose('a.test.ts', 'read');
    await choose('b.ts', 'write');
    await choose('save.ts', 'write');
    await click(button('Split'));
    expect(dialogError()).toBe('assign every file');
    await typeInto('Part 1', 'a.ts');
    await choose('a.test.ts', 'a.ts');
    await choose('a.ts', 'a.ts');
    await click(button('Split'));
    expect(dialogError()).toBe('src/app/a.ts already exists');
    expect(sentences()).not.toContain(SPLIT_SENTENCE);
  }

  async function splitApp(): Promise<void> {
    await menu('src/app', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(document.querySelector('input[aria-label="Part 2"]')).not.toBeNull();
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual(['a.test.ts', 'a.ts', 'b.ts', 'save.ts']);
    expect(selects().map(item => item.value)).toEqual(['', '', '', '']);
    expect(optionsOf('a.ts')).toEqual(['choose']);
    await click(button('Add part'));
    expect(document.querySelector('input[aria-label="Part 3"]')).not.toBeNull();
    await splitRefusals();
    await typeInto('Part 1', 'read');
    await choose('a.test.ts', 'read');
    await choose('a.ts', 'read');
    await click(button('Split'));
    await waitFor(() => expect(lastSentence()).toBe(SPLIT_SENTENCE));
    await waitFor(() => expect(boxIds()).toContain('src/app/read'));
    expect(boxIds()).not.toContain('src/app');
    expect(spot('src/app/read')).toEqual(['0', '0']);
    expect(spot('src/app/write')).toEqual(['260', '0']);
    expect([boxOf('src/app/read').dataset.cycle, boxOf('src/app/write').dataset.cycle]).toEqual(['true', 'true']);
    await waitFor(() => expect(warningsOf(SPLIT_SENTENCE)).toEqual([CYCLE_LINE]));
    expect(badgeText()).toBe('1');
  }

  async function visitRoot(): Promise<void> {
    await crumb('layered');
    await waitFor(() => expect(boxIds()).toEqual(['src']));
    expect(window.location.hash).toBe('#at=&plan=reshape');
    await waitFor(() => expect(badgeText()).toBe('1'));
    expect(warningsOf(SPLIT_SENTENCE)).toEqual([CYCLE_LINE]);
    await drill('src');
    await waitFor(() => expect(boxIds()).toContain('src/app/write'));
    expect(window.location.hash).toBe('#at=src&plan=reshape');
  }

  async function openMerge(on: string): Promise<void> {
    await click(boxOf('src/app/read'));
    await click(boxOf('src/app/write'), true);
    await click(button('Menu', boxOf(on)));
    await click(button('Merge', boxOf(on)));
  }

  async function mergeIntoReadThenApp(): Promise<void> {
    await openMerge('src/app/write');
    expect(dialogLabel()).toBe('Merge packages');
    await click(button('Merge'));
    expect(dialogError()).toBe('write a name');
    await named('has space', 'Merge');
    expect(dialogError()).toBe('bad name');
    await named('read', 'Merge');
    await waitFor(() => expect(lastSentence()).toBe('Merge src/app/read and src/app/write into src/app/read'));
    await waitFor(() => expect(boxIds()).not.toContain('src/app/write'));
    await waitFor(() => expect(rowNames('src/app/read')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    expect(boxOf('src/app/read').textContent).toContain('3 files');
    expect(badge()).toBeNull();
    await click(button('Undo'));
    await waitFor(() => expect(boxIds()).toContain('src/app/write'));
    expect(lastSentence()).toBe(SPLIT_SENTENCE);
    await waitFor(() => expect(badgeText()).toBe('1'));
    await openMerge('src/app/read');
    await named('adapters', 'Merge');
    expect(dialogError()).toBe('src/adapters already exists');
    await named('app', 'Merge');
    await waitFor(() => expect(lastSentence()).toBe('Merge src/app/read and src/app/write into src/app'));
    await waitFor(() => expect(rowNames('src/app')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    expect(boxOf('src/app').textContent).toContain('3 files');
    expect(badge()).toBeNull();
  }

  async function deleteModel(): Promise<void> {
    const sentence = 'Delete src/domain/model.ts';
    await drill('src/domain');
    await waitFor(() => expect(boxIds()).toContain('src/domain/model.ts'));
    const before = storedEdits();
    await click(boxOf('src/domain/model.ts'));
    await pressDelete();
    expect(storedEdits()).toEqual(before);
    expect(sentences()).toHaveLength(before.length);
    await click(button('Menu', boxOf('src/domain/model.ts')));
    expect(menuLabels('src/domain/model.ts')).toEqual(['Add note', 'Rename', 'Delete', 'Fold into…']);
    await click(button('Delete', boxOf('src/domain/model.ts')));
    await waitFor(() => expect(lastSentence()).toBe(sentence));
    await waitFor(() => expect(boxOf('src/domain/model.ts').dataset.fate).toBe('delete'));
    expect(window.getComputedStyle(boxOf('src/domain/model.ts')).textDecorationLine).toBe('line-through');
    await chooseShown('Now');
    await waitFor(() => expect(boxOf('src/domain/model.ts').dataset.fate).toBeUndefined());
    expect(window.getComputedStyle(boxOf('src/domain/model.ts')).textDecorationLine).not.toBe('line-through');
    await chooseShown('Planned');
    await waitFor(() => expect(boxOf('src/domain/model.ts').dataset.fate).toBe('delete'));
    await waitFor(() => expect(warningsOf(sentence)).toEqual(['2 files still import src/domain/model.ts, which this plan deletes']));
    expect(importerList(sentence)).toEqual([]);
    await click(button('Show importers'));
    expect(importerList(sentence)).toEqual(['src/adapters/db.ts', 'src/app/a.ts']);
    await click(button('Hide importers'));
    expect(importerList(sentence)).toEqual([]);
  }

  async function foldRepo(): Promise<void> {
    await crumb('src');
    await waitFor(() => expect(boxIds()).toContain('src/adapters'));
    await drill('src/adapters');
    await waitFor(() => expect(boxIds()).toContain('src/adapters/repo.ts'));
    await menu('src/adapters/repo.ts', 'Fold into…');
    expect(notice()).toBe('click a file to fold src/adapters/repo.ts into');
    await click(boxOf('src/adapters/repo.ts'));
    expect(notice()).toBe('a file cannot fold into itself');
    expect(sentences()).toHaveLength(6);
    await crumb('src');
    await waitFor(() => expect(rowNames('src/ports')).toEqual(['shape.ts']));
    await click(rowOf('src/ports', 'src/ports/shape.ts').querySelector('button') as Element);
    await waitFor(() => expect(lastSentence()).toBe('Fold src/adapters/repo.ts into src/ports/shape.ts'));
    await waitFor(() => expect(rowNames('src/adapters')).toEqual(['db.ts']));
    expect(boxOf('src/adapters').textContent).toContain('1 file');
    expect(document.querySelector('g.arrow[data-from="src/adapters"][data-to="src/ports"]')).toBeNull();
    const toPorts = document.querySelector('g.arrow[data-from="src/app"][data-to="src/ports"]') as Element;
    expect(toPorts.getAttribute('data-line')).toBe('dashed');
    expect(toPorts.querySelector('title')?.textContent).toBe('0 runtime · 1 type-only · 0 extends/implements');
    expect(badgeText()).toBe('1');
  }

  async function undoAllRedoAllReload(): Promise<void> {
    await click(document.querySelector('.fake-flow') as Element);
    for (let left = 6; left >= 0; left -= 1) {
      await key('z');
      await waitFor(() => expect(entries()).toHaveLength(left));
    }
    await waitFor(() => expect(boxIds()).toContain('src/infra'));
    expect(badge()).toBeNull();
    expect(boxOf('src/app').textContent).toContain('3 files');
    expect(boxOf('src/infra').textContent).toContain('2 files');
    expect(boxIds()).not.toContain('src/ports');
    for (let count = 1; count <= 7; count += 1) {
      await key('Z', true);
      await waitFor(() => expect(entries()).toHaveLength(count));
    }
    expect(sentences()).toEqual(SEVEN);
    await waitFor(() => expect(rowOf('src/domain', 'src/domain/model.ts').dataset.fate).toBe('delete'));
    expect(window.getComputedStyle(rowOf('src/domain', 'src/domain/model.ts')).textDecorationLine).toBe('line-through');
    await waitFor(() => expect(badgeText()).toBe('1'));
    await reload();
    await waitFor(() => expect(entries()).toHaveLength(7));
    expect(sentences()).toEqual(SEVEN);
    expect(window.location.hash).toBe('#at=src&plan=reshape');
    await waitFor(() => expect(rowOf('src/domain', 'src/domain/model.ts').dataset.fate).toBe('delete'));
    expect(badgeText()).toBe('1');
    await chooseShown('Now');
    await waitFor(() => expect(boxIds()).toContain('src/infra'));
    expect(rowOf('src/domain', 'src/domain/model.ts').dataset.fate).toBeUndefined();
    expect(window.getComputedStyle(rowOf('src/domain', 'src/domain/model.ts')).textDecorationLine).not.toBe('line-through');
    await chooseShown('Planned');
    await waitFor(() => expect(rowOf('src/domain', 'src/domain/model.ts').dataset.fate).toBe('delete'));
  }

  async function clickTargetsAndRemoveRename(): Promise<void> {
    await drill('src/app');
    await waitFor(() => expect(boxIds()).toContain('src/app/a.ts'));
    centres().length = 0;
    await click(sentenceButton('Rename src/infra to src/adapters'));
    await waitFor(() => expect(window.location.hash).toBe('#at=src&plan=reshape'));
    await waitFor(() => expect(boxOf('src/adapters').dataset.selected).toBe('true'));
    await waitFor(() => expect(centres()).toContainEqual(boxCentre('src/adapters')));
    await drill('src/app');
    await waitFor(() => expect(boxIds()).toContain('src/app/a.ts'));
    await click(sentenceButton('Fold src/adapters/repo.ts into src/ports/shape.ts'));
    await waitFor(() => expect(window.location.hash).toBe('#at=src/ports&plan=reshape'));
    await waitFor(() => expect(boxOf('src/ports/shape.ts').dataset.selected).toBe('true'));
    await waitFor(() => expect(centres()).toContainEqual(boxCentre('src/ports/shape.ts')));
    await click(sentenceButton(SPLIT_SENTENCE));
    await waitFor(() => expect(notice()).toBe('no such box src/app/read'));
    expect(window.location.hash).toBe('#at=src/ports&plan=reshape');
    await crumb('src');
    await click(entryRow('Rename src/infra to src/adapters').querySelector('button[aria-label="Remove"]') as Element);
    await waitFor(() => expect(sentences()).not.toContain('Rename src/infra to src/adapters'));
    const fold = entryRow('Fold src/adapters/repo.ts into src/ports/shape.ts');
    await waitFor(() => expect(fold.dataset.stale).toBe('true'));
    expect(fold.querySelector('.change-reason')?.textContent).toBe('no such file src/adapters/repo.ts');
    expect(entryRow('Delete src/domain/model.ts').dataset.stale).toBeUndefined();
  }

  it('Rename, split, merge, delete and fold, then undo, redo and a stale fold', async () => {
    await seed('Reshape', 'reshape', [{ kind: 'create-package', path: 'src/ports' }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(rowNames('src/app')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    await renameSaveAndUndo();
    await moveShapeAndRenameInfra();
    await splitApp();
    await visitRoot();
    await mergeIntoReadThenApp();
    await deleteModel();
    await foldRepo();
    await undoAllRedoAllReload();
    await clickTargetsAndRemoveRename();
  }, 20000);

  it('lists a deleted file and its test neighbour when their package is split', async () => {
    await showApp('#at=src/app&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/b.ts'));
    await menu('src/app/b.ts', 'Delete');
    await waitFor(() => expect(boxOf('src/app/b.ts').dataset.fate).toBe('delete'));
    await crumb('src');
    await waitFor(() => expect(boxIds()).toContain('src/app'));
    await menu('src/app', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual(['a.test.ts', 'a.ts', 'b.ts', 'save.ts']);
  });

  it('keeps the edge gestures quiet', async () => {
    layout = { version: 1, views: {}, settings: { tests: false, external: true } };
    await seed('Reshape', 'reshape', [{ kind: 'create-package', path: 'src/ports' }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(rowNames('src/app')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    await click(rowOf('src/app', 'src/app/a.ts').querySelector('button') as Element);
    expect(boxOf('src/app').dataset.selected).toBe('true');
    await click(button('Menu', boxOf('src/app')));
    expect(menuLabels('src/app')).toEqual(['Add note', 'Rename', 'Split']);
    await click(button('Menu', boxOf('src/app')));
    await click(boxOf('src/infra'), true);
    await click(boxOf('src/infra'), true);
    expect([boxOf('src/app').dataset.selected, boxOf('src/infra').dataset.selected]).toEqual(['true', 'true']);
    await waitFor(() => expect(boxIds()).toContain('react'));
    await click(boxOf('react'));
    await click(button('Menu', boxOf('react')));
    expect(Array.from(boxOf('react').querySelectorAll('[role="menu"] button')).map(item => item.textContent)).toEqual(['Add note']);
    await menu('src/app', 'Rename');
    await named('app', 'Rename');
    expect(document.querySelector('dialog')).toBeNull();
    await menu('src/ports', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(document.querySelectorAll('dialog select')).toHaveLength(0);
    await click(button('Cancel'));
    await drill('src/app');
    await waitFor(() => expect(boxIds()).toContain('src/app/a.ts'));
    await menu('src/app/a.ts', 'Rename');
    await named('a', 'Rename');
    expect(document.querySelector('dialog')).toBeNull();
    expect(storedEdits()).toEqual([{ kind: 'create-package', path: 'src/ports' }]);
    await crumb('layered');
    await waitFor(() => expect(boxIds()).toContain('src'));
    await menu('src', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual([
      'app/a.test.ts',
      'app/a.ts',
      'app/b.ts',
      'app/save.ts',
      'domain/model.ts',
      'domain/shape.ts',
      'infra/db.ts',
      'infra/repo.ts',
    ]);
  });

  it('folds a file into a deleted file box', async () => {
    await showApp('#at=src/domain&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/domain/shape.ts'));
    await menu('src/domain/model.ts', 'Delete');
    await waitFor(() => expect(boxOf('src/domain/model.ts').dataset.fate).toBe('delete'));
    await menu('src/domain/shape.ts', 'Fold into…');
    await click(boxOf('src/domain/model.ts'));
    await waitFor(() => expect(sentences()).toEqual(['Delete src/domain/model.ts', 'Fold src/domain/shape.ts into src/domain/model.ts']));
    expect(storedEdits()).toEqual([
      { kind: 'fate', file: 'src/domain/model.ts', fate: 'delete' },
      { kind: 'fate', file: 'src/domain/shape.ts', fate: 'fold', into: 'src/domain/model.ts' },
    ]);
  });

  it('folds a file into the file box clicked next', async () => {
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/infra/repo.ts'));
    await menu('src/infra/repo.ts', 'Fold into…');
    await click(boxOf('src/infra/db.ts'));
    await waitFor(() => expect(sentences()).toEqual(['Fold src/infra/repo.ts into src/infra/db.ts']));
    expect(storedEdits()).toEqual([{ kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' }]);
    await waitFor(() => expect(boxIds()).not.toContain('src/infra/repo.ts'));
    await chooseShown('Now');
    await waitFor(() => expect(boxIds()).toContain('src/infra/repo.ts'));
    await chooseShown('Planned');
    await waitFor(() => expect(boxIds()).not.toContain('src/infra/repo.ts'));
    expect(ghostBoxIds()).toEqual([]);
    await click(boxOf('src/infra/db.ts'));
    expect(storedEdits()).toEqual([{ kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' }]);
    expect(sentences()).toEqual(['Fold src/infra/repo.ts into src/infra/db.ts']);
    await crumb('src');
    await waitFor(() => expect(rowNames('src/infra')).toEqual(['db.ts']));
    expect(ghostNames('src/infra')).toEqual([]);
  });

  it('does not fold a file into a package box', async () => {
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/infra/repo.ts'));
    await menu('src/infra/repo.ts', 'Fold into…');
    await crumb('src');
    await waitFor(() => expect(boxIds()).toContain('src/domain'));
    await click(boxOf('src/domain'));
    expect(storedEdits()).toEqual([]);
    expect(sentences()).toEqual([]);
    expect(notice()).toBe('click a file to fold src/infra/repo.ts into');
  });

  it('hides Merge when a package and a file are both selected', async () => {
    await seed('Reshape', 'reshape', [{
      kind: 'split-package',
      package: 'src/app',
      parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: [] }],
    }]);
    await showApp('#at=src/app&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/b.ts'));
    expect(boxIds()).toContain('src/app/read');
    await click(boxOf('src/app/read'));
    await click(boxOf('src/app/b.ts'), true);
    await click(button('Menu', boxOf('src/app/read')));
    expect(menuLabels('src/app/read')).toEqual(['Add note', 'Rename', 'Split']);
  });

  it('a plain click replaces the shift selection a merge uses', async () => {
    await seed('Reshape', 'reshape', [{
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts', 'src/app/a.test.ts'] },
        { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
      ],
    }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/write'));
    await click(boxOf('src/app/read'));
    await click(boxOf('src/app/write'), true);
    await click(boxOf('src/domain'));
    await click(boxOf('src/infra'), true);
    await click(button('Menu', boxOf('src/infra')));
    await click(button('Merge', boxOf('src/infra')));
    await named('core', 'Merge');
    await waitFor(() => expect(lastSentence()).toBe('Merge src/domain and src/infra into src/core'));
  });

  it('creates a package in a view the plan has emptied', async () => {
    await seed('Reshape', 'reshape', [{ kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }]);
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such directory'));
    await click(button('Canvas'));
    await click(button('New package'));
    await named('x', 'Create');
    await waitFor(() => expect(storedEdits().at(-1)).toEqual({ kind: 'create-package', path: 'src/infra/x' }));
  });

  it('refuses a hidden package name and still merges into it', async () => {
    await seed('Reshape', 'reshape', [{
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts', 'src/app/a.test.ts'] },
        { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
      ],
    }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/read'));
    expect(boxIds()).not.toContain('src/app');
    await click(button('Canvas'));
    await click(button('New package'));
    await named('app', 'Create');
    expect(dialogError()).toBe('src/app already exists');
    expect(storedEdits()).toHaveLength(1);
    expect(sentences()).toHaveLength(1);
    await click(button('Cancel'));
    await menu('src/domain', 'Rename');
    await named('app', 'Rename');
    expect(dialogError()).toBe('src/app already exists');
    expect(storedEdits()).toHaveLength(1);
    expect(sentences()).toHaveLength(1);
    await click(button('Cancel'));
    await click(boxOf('src/app/read'));
    await click(boxOf('src/app/write'), true);
    await click(button('Menu', boxOf('src/app/read')));
    await click(button('Merge', boxOf('src/app/read')));
    await named('app', 'Merge');
    await waitFor(() => expect(lastSentence()).toBe('Merge src/app/read and src/app/write into src/app'));
    expect(entryRow('Merge src/app/read and src/app/write into src/app').dataset.stale).toBeUndefined();
    await waitFor(() => expect(boxIds()).toContain('src/app'));
    expect(boxIds()).not.toContain('src/app/read');
  });

  it('merges into an empty package the plan created', async () => {
    await seed('Reshape', 'reshape', [{ kind: 'create-package', path: 'src/ports' }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxOf('src/ports').textContent).toContain('0 files'));
    await click(boxOf('src/app'));
    await click(boxOf('src/infra'), true);
    await click(button('Menu', boxOf('src/app')));
    await click(button('Merge', boxOf('src/app')));
    await named('ports', 'Merge');
    await waitFor(() => expect(lastSentence()).toBe('Merge src/app and src/infra into src/ports'));
    expect(storedEdits()).toEqual([
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/ports' },
    ]);
    expect(entryRow('Merge src/app and src/infra into src/ports').dataset.stale).toBeUndefined();
    await waitFor(() => expect(boxOf('src/ports').textContent).toContain('5 files'));
  });

  it('lists a nested test file when splitting a package', async () => {
    extraFiles = [
      { path: 'src/app/sub/a.test.ts', test: true },
      { path: 'src/app/sub/deep/x.ts', test: false },
      { path: 'src/app/sub/deep/y.test.ts', test: true },
    ];
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app'));
    await menu('src/app', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual([
      'a.test.ts',
      'a.ts',
      'b.ts',
      'save.ts',
      'sub/a.test.ts',
      'sub/deep/x.ts',
      'sub/deep/y.test.ts',
    ]);
  });

  it('stores a fold when the next click is a shift-click on a file box', async () => {
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/infra/repo.ts'));
    await menu('src/infra/repo.ts', 'Fold into…');
    await click(boxOf('src/infra/db.ts'), true);
    await waitFor(() => expect(sentences()).toEqual(['Fold src/infra/repo.ts into src/infra/db.ts']));
    expect(storedEdits()).toEqual([{ kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' }]);
  });

  it('stores a fold when the next click is a shift-click on a file row', async () => {
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/infra/repo.ts'));
    await menu('src/infra/repo.ts', 'Fold into…');
    await crumb('src');
    await waitFor(() => expect(rowNames('src/infra')).toEqual(['db.ts', 'repo.ts']));
    await click(button('db.ts', rowOf('src/infra', 'src/infra/db.ts')), true);
    await waitFor(() => expect(sentences()).toEqual(['Fold src/infra/repo.ts into src/infra/db.ts']));
    expect(storedEdits()).toEqual([{ kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' }]);
  });

  it('stores nothing when a file is renamed to the same name', async () => {
    await showApp('#at=src/app&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/save.ts'));
    await menu('src/app/save.ts', 'Rename');
    await named('save', 'Rename');
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(notice()).toBe('');
    expect(sentences()).toEqual([]);
    expect(storedEdits()).toEqual([]);
  });

  it('refuses a split part that names a declared empty package', async () => {
    await seed('Reshape', 'reshape', [{ kind: 'create-package', path: 'src/app/spare' }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(rowNames('src/app')).toEqual(['a.ts', 'b.ts', 'save.ts']));
    await menu('src/app', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual(['a.test.ts', 'a.ts', 'b.ts', 'save.ts']);
    await typeInto('Part 1', 'spare');
    await typeInto('Part 2', 'write');
    for (const label of ['a.test.ts', 'a.ts', 'b.ts', 'save.ts']) await choose(label, 'write');
    await click(button('Split'));
    expect(dialogError()).toBe('src/app/spare already exists');
    expect(sentences()).toEqual(['Create package src/app/spare']);
    await typeInto('Part 1', 'read');
    await choose('a.test.ts', 'read');
    await choose('a.ts', 'read');
    await click(button('Split'));
    await waitFor(() => expect(lastSentence()).toBe(SPLIT_SENTENCE));
    expect(storedEdits()).toHaveLength(2);
  });

  it('lets a split name a grouped ancestor and still refuses the declared package under it', async () => {
    extraFiles = [{ path: 'src/infra/deep/nested/x.ts', test: false }];
    await seed('Reshape', 'reshape', [
      { kind: 'create-package', path: 'src/infra/de' },
      { kind: 'create-package', path: 'src/infra/deep/empty' },
      { kind: 'move-file', file: 'src/infra/deep/nested/x.ts', to: 'src/domain' },
    ]);
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxOf('src/infra/deep').textContent).toContain('0 files'));
    await menu('src/infra/deep', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    await typeInto('Part 1', 'empty');
    await typeInto('Part 2', 'other');
    await click(button('Split'));
    expect(dialogError()).toBe('src/infra/deep/empty already exists');
    expect(sentences()).toEqual([
      'Create package src/infra/de',
      'Create package src/infra/deep/empty',
      'Move src/infra/deep/nested/x.ts to src/domain',
    ]);
    await click(button('Cancel'));
    await crumb('src');
    await waitFor(() => expect(boxIds()).toContain('src/infra'));
    await menu('src/infra', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    await typeInto('Part 1', 'de');
    await typeInto('Part 2', 'other');
    await choose('db.ts', 'other');
    await choose('repo.ts', 'other');
    await click(button('Split'));
    expect(dialogError()).toBe('src/infra/de already exists');
    expect(sentences()).toHaveLength(3);
    await typeInto('Part 1', 'deep');
    await click(button('Split'));
    const sentence = 'Split src/infra into src/infra/deep (0 files) and src/infra/other (2 files)';
    await waitFor(() => expect(lastSentence()).toBe(sentence));
    expect(entryRow(sentence).dataset.stale).toBeUndefined();
    expect(storedEdits().at(-1)).toEqual({
      kind: 'split-package',
      package: 'src/infra',
      parts: [
        { name: 'deep', files: [] },
        { name: 'other', files: ['src/infra/db.ts', 'src/infra/repo.ts'] },
      ],
    });
  });

  const SRC_FILES = ['app/a.test.ts', 'app/a.ts', 'app/b.ts', 'app/save.ts', 'domain/model.ts', 'domain/shape.ts', 'infra/db.ts', 'infra/repo.ts'];

  it('refuses a split part that names a declared package above an empty one', async () => {
    await seed('Reshape', 'reshape', [
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'create-package', path: 'src/ports/deep' },
    ]);
    await showApp('#at=&plan=reshape');
    await waitFor(() => expect(boxIds()).toEqual(['src']));
    await menu('src', 'Split');
    await waitFor(() => expect(dialogLabel()).toBe('Split package'));
    expect(selects().map(item => item.getAttribute('aria-label'))).toEqual(SRC_FILES);
    await typeInto('Part 1', 'ports');
    await typeInto('Part 2', 'other');
    for (const label of SRC_FILES) await choose(label, 'other');
    await click(button('Split'));
    expect(dialogError()).toBe('src/ports already exists');
    expect(sentences()).toEqual(['Create package src/ports', 'Create package src/ports/deep']);
    expect(storedEdits()).toHaveLength(2);
  });

  async function groupedAncestors(): Promise<void> {
    extraFiles = [{ path: 'src/infra/deep/nested/x.ts', test: false }];
    await seed('Reshape', 'reshape', [
      { kind: 'create-package', path: 'src/infra/de' },
      { kind: 'create-package', path: 'src/infra/deep/empty' },
      { kind: 'move-file', file: 'src/infra/deep/nested/x.ts', to: 'src/domain' },
    ]);
    await showApp('#at=src/infra&plan=reshape');
    await waitFor(() => expect(boxOf('src/infra/deep').textContent).toContain('0 files'));
  }

  it('does not treat a grouped ancestor as a taken name', async () => {
    await groupedAncestors();
    await click(button('Canvas'));
    await click(button('New package'));
    await named('de', 'Create');
    expect(dialogError()).toBe('src/infra/de already exists');
    expect(sentences()).toHaveLength(3);
    await click(button('Cancel'));
    await click(button('Canvas'));
    await click(button('New package'));
    await named('deep', 'Create');
    await waitFor(() => expect(lastSentence()).toBe('Create package src/infra/deep'));
    expect(entryRow('Create package src/infra/deep').dataset.stale).toBeUndefined();
    expect(storedEdits().at(-1)).toEqual({ kind: 'create-package', path: 'src/infra/deep' });
    await click(button('Undo'));
    await waitFor(() => expect(sentences()).toHaveLength(3));
    await menu('src/infra/de', 'Rename');
    await named('deep', 'Rename');
    await waitFor(() => expect(lastSentence()).toBe('Rename src/infra/de to src/infra/deep'));
    expect(entryRow('Rename src/infra/de to src/infra/deep').dataset.stale).toBeUndefined();
    expect(storedEdits().at(-1)).toEqual({ kind: 'rename-package', from: 'src/infra/de', to: 'src/infra/deep' });
  });

  it('The cycle badge stays at the root and inside app', async () => {
    await seed('Split app', 'split-app', [
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' },
      { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
      { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
    ]);
    const line = 'this plan adds a cycle: app → infra → app';
    await showApp('#at=src&plan=split-app');
    await waitFor(() => expect(badgeText()).toBe('1'));
    expect(warningsOf('src/infra should use src/app')).toEqual([line]);
    await crumb('layered');
    await waitFor(() => expect(boxIds()).toEqual(['src']));
    expect(window.location.hash).toBe('#at=&plan=split-app');
    await waitFor(() => expect(badgeText()).toBe('1'));
    expect(warningsOf('src/infra should use src/app')).toEqual([line]);
    await drill('src');
    await waitFor(() => expect(boxIds()).toContain('src/app'));
    await drill('src/app');
    await waitFor(() => expect(boxIds()).toEqual(['src/app/a.ts', 'src/app/b.ts']));
    expect(window.location.hash).toBe('#at=src/app&plan=split-app');
    await waitFor(() => expect(badgeText()).toBe('1'));
    expect(warningsOf('src/infra should use src/app')).toEqual([line]);
    expect(document.querySelector('aside[aria-label="changes"]')?.textContent).not.toContain('a.ts → b.ts → a.ts');
  });

  it('refuses create and rename against test files with tests off', async () => {
    await showApp('#at=src/app&plan=reshape');
    await waitFor(() => expect(boxIds()).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts']));
    await click(button('Canvas'));
    await click(button('New package'));
    await named('a.test.ts', 'Create');
    expect(dialogError()).toBe('src/app/a.test.ts already exists');
    expect(storedEdits()).toHaveLength(0);
    await click(button('Cancel'));
    await menu('src/app/save.ts', 'Rename');
    await named('a.test.ts', 'Rename');
    expect(dialogError()).toBe('src/app/a.test.ts already exists');
    expect(storedEdits()).toHaveLength(0);
  });

  it('refuses a merge into a test-only directory with tests off', async () => {
    extraFiles = [{ path: 'src/probe/only.test.ts', test: true }];
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toEqual(['src/app', 'src/infra', 'src/domain']));
    await click(boxOf('src/app'));
    await click(boxOf('src/infra'), true);
    await click(button('Menu', boxOf('src/infra')));
    await click(button('Merge', boxOf('src/infra')));
    await named('probe', 'Merge');
    expect(dialogError()).toBe('src/probe already exists');
    expect(storedEdits()).toHaveLength(0);
  });

  function connect(source: string, target: string): void {
    const hook = (globalThis as { reshapeConnect?: (source: string, target: string) => void }).reshapeConnect;
    if (hook === undefined) throw new Error('missing connect');
    hook(source, target);
  }

  function edgeOf(from: string, to: string): Element {
    const el = document.querySelector(`[data-from="${from}"][data-to="${to}"]`);
    if (el === null) throw new Error(`missing edge ${from} ${to}`);
    return el;
  }

  async function cutDrawn(from: string, to: string): Promise<void> {
    const edge = edgeOf(from, to);
    await click(edge);
    await click(button('Menu', edge));
    await click(button('Cut', edge));
  }

  it('cuts a planned arrow after a merge moves it, storing no cut', async () => {
    const merge: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' };
    await seed('Reshape', 'reshape', [{ kind: 'add-edge', from: 'src/domain', to: 'src/infra' }, merge]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/core'));
    await cutDrawn('src/domain', 'src/core');
    await waitFor(() => expect(sentences()).toEqual(['Merge src/infra and src/app into src/core']));
    expect(notice()).toBe('');
    expect(storedEdits()).toEqual([merge]);
    expect(document.querySelector('[data-from="src/domain"][data-to="src/core"]')).toBeNull();
  });

  it('cuts the real pairs when a planned edge groups onto the same arrow', async () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/save.ts', to: 'src/app/b.ts' };
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/save.ts', 'src/app/a.ts'] },
        { name: 'write', files: ['src/app/b.ts'] },
      ],
    };
    await seed('Reshape', 'reshape', [add, split]);
    await showApp('#at=src/app&plan=reshape');
    await waitFor(() => expect(boxIds()).toEqual(['src/app/read', 'src/app/write']));
    const twins = Array.from(document.querySelectorAll<HTMLElement>('[data-from="src/app/read"][data-to="src/app/write"]'));
    expect(twins.filter(edge => edge.dataset.planned === 'true')).toHaveLength(1);
    expect(twins.filter(edge => edge.dataset.planned !== 'true')).toHaveLength(1);
    await cutDrawn('src/app/read', 'src/app/write');
    const cut: PlanEdit = {
      kind: 'cut-edge',
      from: 'src/app/read',
      to: 'src/app/write',
      files: [['src/app/read/a.ts', 'src/app/write/b.ts']],
    };
    await waitFor(() => expect(storedEdits()).toEqual([add, split, cut]));
    expect(notice()).toBe('');
    expect(sentences()).toEqual([
      'src/app/save.ts should use src/app/b.ts',
      'Split src/app into src/app/read (2 files) and src/app/write (1 file)',
      'src/app/read must not import src/app/write (1 import)',
    ]);
    expect(document.querySelector('[data-from="src/app/read"][data-to="src/app/write"][data-planned="true"]')).not.toBeNull();
  });

  it('cuts a planned arrow after a split groups it, storing no cut', async () => {
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/save.ts'] },
        { name: 'write', files: ['src/app/a.ts', 'src/app/b.ts', 'src/app/a.test.ts'] },
      ],
    };
    await seed('Reshape', 'reshape', [{ kind: 'add-edge', from: 'src/app/save.ts', to: 'src/app/b.ts' }, split]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/app/read'));
    await cutDrawn('src/app/read', 'src/app/write');
    await waitFor(() => expect(sentences()).toEqual(['Split src/app into src/app/read (1 file) and src/app/write (3 files)']));
    expect(notice()).toBe('');
    expect(storedEdits()).toEqual([split]);
    expect(document.querySelector('[data-from="src/app/read"][data-to="src/app/write"]')).toBeNull();
  });

  it('refuses an external the planned graph already draws, and cuts that arrow', async () => {
    layout = { version: 1, views: {}, settings: { tests: false, external: true } };
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('react'));
    await act(() => connect('src/infra', 'react'));
    await waitFor(() => expect(notice()).toBe('src/infra already imports react'));
    expect(storedEdits()).toEqual([]);
    expect(sentences()).toEqual([]);
    await click(edgeOf('src/infra', 'react'));
    await pressDelete();
    await waitFor(() => expect(sentences()).toEqual(['src/infra must not import react (1 import)']));
    expect(notice()).toBe('');
    expect(storedEdits()).toEqual([{ kind: 'cut-edge', from: 'src/infra', to: 'react', files: [['src/infra/repo.ts', 'react']] }]);
  });

  it('draws across a test-only edge while tests are off', async () => {
    extraFiles = [{ path: 'src/domain/only.test.ts', test: true }];
    extraEdges = [{ from: 'src/domain/only.test.ts', to: 'src/infra/db.ts', kind: 'runtime' }];
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toEqual(['src/app', 'src/infra', 'src/domain']));
    expect(document.querySelector('[data-from="src/domain"][data-to="src/infra"]')).toBeNull();
    await act(() => connect('src/domain', 'src/infra'));
    await waitFor(() => expect(sentences()).toEqual(['src/domain should use src/infra']));
    expect(notice()).toBe('');
    expect(storedEdits()).toEqual([{ kind: 'add-edge', from: 'src/domain', to: 'src/infra' }]);
  });

  it('refuses a package name taken in planned while now is shown', async () => {
    await seed('Reshape', 'reshape', [{ kind: 'create-package', path: 'src/ports' }]);
    await showApp('#at=src&plan=reshape');
    await waitFor(() => expect(boxIds()).toContain('src/ports'));
    await chooseShown('Now');
    await waitFor(() => expect(boxIds()).not.toContain('src/ports'));
    await click(button('Canvas'));
    await click(button('New package'));
    await named('ports', 'Create');
    expect(dialogError()).toBe('src/ports already exists');
    expect(storedEdits()).toEqual([{ kind: 'create-package', path: 'src/ports' }]);
  });
});
