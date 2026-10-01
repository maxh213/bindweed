import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', async () => {
  const { createElement: ce, useState } = await import('react');

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
    nodesDraggable?: boolean;
    nodesConnectable?: boolean;
    edgesFocusable?: boolean;
    fitView?: boolean;
    panOnDrag?: boolean;
    zoomOnScroll?: boolean;
    zoomOnDoubleClick?: boolean;
    onNodeClick?: (event: unknown, node: FakeNode) => void;
    onNodeDoubleClick?: (event: unknown, node: FakeNode) => void;
    onNodeDragStop?: (event: unknown, node: FakeNode) => void;
  };

  let flowMounts = 0;
  let dropAt: { x: number; y: number } | null = null;
  const centers: { x: number; y: number }[] = [];

  function dropPosition(node: FakeNode): { x: number; y: number } {
    return dropAt ?? node.position;
  }

  function onDrop(props: FakeFlowProps, node: FakeNode, event: { altKey: boolean }): void {
    if (!event.altKey) return;
    props.onNodeDragStop?.({}, { ...node, position: dropPosition(node) });
  }

  function fakeNodeView(props: FakeFlowProps, node: FakeNode) {
    const Box = props.nodeTypes[node.type];
    return ce(
      'div',
      {
        key: node.id,
        className: 'fake-node',
        'data-node': node.id,
        'data-x': node.position.x,
        'data-y': node.position.y,
        'data-draggable': String(node.draggable),
        'data-measured-width': node.measured === undefined ? '' : String(node.measured.width),
        onClick: () => props.onNodeClick?.({}, node),
        onDoubleClick: (event: unknown) => props.onNodeDoubleClick?.(event, node),
        onMouseUp: (event: { altKey: boolean }) => onDrop(props, node, event),
      },
      ce(Box as (props: { id: string; data: Record<string, unknown> }) => ReactElement | null, { id: node.id, data: node.data }),
    );
  }

  function fakeEdgeView(props: FakeFlowProps, edge: FakeEdge) {
    const Arrow = props.edgeTypes[edge.type];
    return ce(Arrow as (props: Record<string, unknown>) => ReactElement | null, {
      key: edge.id,
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
    });
  }

  function ReactFlow(props: FakeFlowProps) {
    const [stamp] = useState(() => ++flowMounts);
    const probe = fakeEdgeView(props, { id: 'probe', source: '', target: '', type: 'arrow' });
    return ce(
      'div',
      {
        className: 'fake-flow',
        'data-draggable-nodes': String(props.nodesDraggable),
        'data-nodes-connectable': String(props.nodesConnectable),
        'data-edges-focusable': String(props.edgesFocusable),
        'data-fit-view': String(props.fitView),
        'data-pan-on-drag': String(props.panOnDrag),
        'data-zoom-on-scroll': String(props.zoomOnScroll),
        'data-zoom-on-double-click': String(props.zoomOnDoubleClick),
        'data-mount-stamp': String(stamp),
      },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge)), probe),
    );
  }

  function dashText(style: { strokeDasharray?: string } | undefined): string {
    if (style === undefined) return '';
    if (style.strokeDasharray === undefined) return '';
    return style.strokeDasharray;
  }

  function strokeText(style: { stroke?: string } | undefined): string | undefined {
    if (style === undefined) return undefined;
    return style.stroke;
  }

  function widthText(style: { strokeWidth?: number } | undefined): string {
    if (style === undefined) return String(undefined);
    return String(style.strokeWidth);
  }

  function baseEdge(props: { id: string; path: string; style?: { stroke?: string; strokeWidth?: number; strokeDasharray?: string }; markerEnd?: unknown }) {
    return ce('path', {
      className: 'fake-edge-path',
      'data-edge': props.id,
      d: props.path,
      'data-stroke': strokeText(props.style),
      'data-stroke-width': widthText(props.style),
      'data-dash': dashText(props.style),
      'data-marker': JSON.stringify(props.markerEnd),
    });
  }

  function ReactFlowProvider(props: { children: ReactElement }) {
    return props.children;
  }

  function useReactFlow() {
    return {
      setCenter: (x: number, y: number) => {
        centers.push({ x, y });
        return Promise.resolve(true);
      },
    };
  }

  Object.assign(globalThis, {
    armDrop: (shift: { x: number; y: number } | null) => {
      dropAt = shift;
    },
    flowCenters: centers,
  });

  return {
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    BaseEdge: baseEdge,
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
    getBezierPath: () => ['M0,0 L0,140', 0, 70],
  };
});

function installDom(url = 'http://127.0.0.1:4700/?token=tok'): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: w.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: w.Node, configurable: true });
  Object.defineProperty(globalThis, 'DocumentFragment', { value: w.DocumentFragment, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: w.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  return dom;
}

const TREE = {
  root: 'layered',
  entries: [
    { name: 'notes', path: 'notes', kind: 'dir', children: [{ name: 'readme.md', path: 'notes/readme.md', kind: 'file' }] },
    {
      name: 'src',
      path: 'src',
      kind: 'dir',
      children: [
        {
          name: 'app',
          path: 'src/app',
          kind: 'dir',
          children: [
            { name: 'a.ts', path: 'src/app/a.ts', kind: 'file' },
            { name: 'b.ts', path: 'src/app/b.ts', kind: 'file' },
          ],
        },
        { name: 'domain', path: 'src/domain', kind: 'dir', children: [{ name: 'model.ts', path: 'src/domain/model.ts', kind: 'file' }] },
        { name: 'infra', path: 'src/infra', kind: 'dir', children: [{ name: 'db.ts', path: 'src/infra/db.ts', kind: 'file' }] },
      ],
    },
    { name: 'tsconfig.json', path: 'tsconfig.json', kind: 'file' },
  ],
};

const MODEL_TEXT = 'export class Model { id = 0; }\n';

const GRAPHS: Record<string, unknown> = {
  '': {
    at: '',
    crumbs: [{ name: 'layered', at: '' }],
    nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 4, row: 0, order: 0, cycle: false }],
    edges: [],
  },
  src: {
    at: 'src',
    crumbs: [
      { name: 'layered', at: '' },
      { name: 'src', at: 'src' },
    ],
    nodes: [
      { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
      { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false },
      { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 2, order: 0, cycle: false },
    ],
    edges: [
      { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
      { from: 'src/app', to: 'src/infra', runtime: 1, type: 1, cycle: false },
      { from: 'src/infra', to: 'src/domain', runtime: 1, type: 0, cycle: false },
    ],
  },
  'src/app': {
    at: 'src/app',
    crumbs: [
      { name: 'layered', at: '' },
      { name: 'src', at: 'src' },
      { name: 'app', at: 'src/app' },
    ],
    nodes: [
      { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true },
      { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true },
    ],
    edges: [
      { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
      { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
    ],
  },
  'src/domain': {
    at: 'src/domain',
    crumbs: [
      { name: 'layered', at: '' },
      { name: 'src', at: 'src' },
      { name: 'domain', at: 'src/domain' },
    ],
    nodes: [{ id: 'src/domain/model.ts', kind: 'file', name: 'model.ts', path: 'src/domain/model.ts', row: 0, order: 0, cycle: false }],
    edges: [],
  },
};

type Call = { url: string; method: string };

function ok(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function notOk(body: unknown): Response {
  return { ok: false, json: async () => body } as Response;
}

function record(calls: Call[], url: string, init?: RequestInit): void {
  calls.push({ url, method: init?.method ?? 'GET' });
}

function graphTable(graphs: Record<string, unknown> | (() => Record<string, unknown>)): Record<string, unknown> {
  if (typeof graphs === 'function') return graphs();
  return graphs;
}

function graphBodyFor(url: string, graphs: Record<string, unknown> | (() => Record<string, unknown>)): Response {
  const at = new URL(url, 'http://x').searchParams.get('at') ?? '';
  const body = graphTable(graphs)[at];
  return body === undefined ? notOk({ error: 'no such directory' }) : ok(body);
}

function fileBodyFor(url: string): Response {
  const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
  return ok({ path, text: MODEL_TEXT });
}

function namedDetail(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { id, name: id.split('/').pop() ?? id, path: id, imports: [], importedBy: [], ...extra };
}

function detailForId(id: string): Record<string, unknown> {
  if (id.endsWith('green.ts')) return namedDetail(id, { kind: 'file', crap: 3, coverage: '1.00', mutants: 0, hot: [] });
  if (id.endsWith('red.ts')) return namedDetail(id, { kind: 'file', crap: 42, coverage: '0.00', mutants: 0, hot: [{ name: 'bad', line: 1, cc: 6, coverage: '0.00', crap: 42 }] });
  if (id.endsWith('domain')) return namedDetail(id, { kind: 'package', files: 2, ca: 3, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy' });
  return namedDetail(id, { kind: 'file', hot: [] });
}

function detailBodyFor(url: string): Response {
  return ok(detailForId(new URL(url, 'http://x').searchParams.get('id') ?? ''));
}

function putLayout(body: unknown, layoutRef: { current: unknown }): void {
  if (typeof body === 'string') layoutRef.current = JSON.parse(body);
}

function handleLayout(init: RequestInit | undefined, layoutRef: { current: unknown }): unknown {
  if (init?.method === 'PUT') putLayout(init.body, layoutRef);
  return ok(layoutRef.current);
}

type ApiHandler = (url: string, init?: RequestInit) => unknown;

function dispatchApi(url: string, init: RequestInit | undefined, handlers: Record<string, ApiHandler>): unknown {
  const base = url.split('?')[0];
  const handler = handlers[base];
  return handler ? handler(url, init) : ok({ files: 4, ms: 3 });
}

function archFetcher(calls: Call[], graphs: Record<string, unknown> | (() => Record<string, unknown>), layoutRef = { current: { version: 1, views: {}, settings: { tests: false, external: false, overlay: 'none' } } }): typeof fetch {
  const handlers: Record<string, ApiHandler> = {
    '/api/tree': () => ok(TREE),
    '/api/graph': url => graphBodyFor(url, graphs),
    '/api/file': url => fileBodyFor(url),
    '/api/detail': url => detailBodyFor(url),
    '/api/layout': (_url, init) => handleLayout(init, layoutRef),
  };
  return (async (url: string, init?: RequestInit) => {
    record(calls, url, init);
    return dispatchApi(url, init, handlers);
  }) as typeof fetch;
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });
}

function TreeProbe(props: Readonly<{ token: string; fetcher: typeof fetch }>) {
  useQuery({ queryKey: ['tree', props.token] as const, queryFn: () => props.fetcher('/api/tree') });
  return createElement('div', { className: 'tree-probe' });
}

function FileProbe(props: Readonly<{ token: string; fetcher: typeof fetch }>) {
  useQuery({ queryKey: ['file', props.token, 'src/app/a.ts'] as const, queryFn: () => props.fetcher('/api/file?path=src%2Fapp%2Fa.ts') });
  return createElement('div', { className: 'file-probe' });
}

function nodeEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.fake-node'));
}

function attrOf(selector: string, attr: string): string | null {
  return document.querySelector(selector)?.getAttribute(attr) ?? null;
}

function boxCycleFlag(el: Element): string | null {
  return el.querySelector('.box')?.getAttribute('data-cycle') ?? null;
}

function boxClasses(id: string): DOMTokenList {
  const el = nodeById(id).querySelector('.box');
  if (el === null) throw new Error(`missing box ${id}`);
  return el.classList;
}

function titleTextOf(el: Element): string | null {
  return el.querySelector('title')?.textContent ?? null;
}

function labelTextOf(el: Element): string | null {
  return el.querySelector('.arrow-label')?.textContent ?? null;
}

function nodeById(id: string): HTMLElement {
  const el = nodeEls().find(node => node.dataset.node === id);
  if (el === undefined) throw new Error(`missing node ${id}`);
  return el;
}

function edgeEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll('g[data-from]'));
}

function edgeBetween(from: string, to: string): HTMLElement {
  const el = edgeEls().find(edge => edge.dataset.from === from && edge.dataset.to === to);
  if (el === undefined) throw new Error(`missing edge ${from} -> ${to}`);
  return el;
}

function pathOf(from: string, to: string): HTMLElement {
  const el = document.querySelector(`.fake-edge-path[data-edge="${from}->${to}"]`);
  if (el === null) throw new Error(`missing path ${from} -> ${to}`);
  return el as HTMLElement;
}

function markerOf(from: string, to: string): unknown {
  return JSON.parse(pathOf(from, to).getAttribute('data-marker') ?? 'null');
}

function dblclick(el: HTMLElement): void {
  el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function tabByName(name: string): HTMLButtonElement {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(el => el.textContent === name);
  if (tab === undefined) throw new Error(`missing tab ${name}`);
  return tab as HTMLButtonElement;
}

describe('ArchView with a fake flow', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = installDom();
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    root.unmount();
    dom.window.close();
  });

  async function show(element: ReactElement): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      root.render(element);
    });
  }

  async function reopen(): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      root.unmount();
    });
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  }

  async function showArchView(
    at: string,
    graphs: Record<string, unknown>,
    onDrill: (dir: string) => void,
    onOpenFile: (path: string) => void,
    fetcher?: typeof fetch,
  ): Promise<Call[]> {
    const { ArchView } = await import('./ArchView.tsx');
    const { waitFor } = await import('@testing-library/dom');
    const calls: Call[] = [];
    const usedFetcher = fetcher ?? archFetcher(calls, graphs);
    await show(
      createElement(QueryClientProvider, { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at, fetcher: usedFetcher, onDrill, onOpenFile })),
    );
    await waitFor(() => {
      expect(document.querySelector('.fake-flow')).not.toBeNull();
    });
    return calls;
  }

  function noopDir(): void {
    return undefined;
  }

  function noopPath(): void {
    return undefined;
  }

  it('draws the root view as one package box with its count and no arrows', async () => {
    await showArchView('', GRAPHS, noopDir, noopPath);
    expect(nodeEls().map(node => node.textContent)).toEqual(['src4 files']);
    expect(nodeById('src').dataset).toMatchObject({ x: '0', y: '0', draggable: 'true' });
    expect(boxClasses('src').contains('nodrag')).toBe(false);
    expect(boxClasses('src').contains('nopan')).toBe(true);
    expect(boxClasses('src').contains('package')).toBe(true);
    expect(boxClasses('src').contains('file')).toBe(false);
    expect(boxCycleFlag(nodeById('src'))).toBe('false');
    expect(edgeEls()).toEqual([]);
    expect(attrOf('.fake-flow', 'data-draggable-nodes')).toBe('true');
    expect(attrOf('.fake-flow', 'data-nodes-connectable')).toBe('false');
    expect(attrOf('.fake-flow', 'data-edges-focusable')).toBe('false');
    expect(attrOf('.fake-flow', 'data-fit-view')).toBe('true');
    expect(attrOf('.fake-flow', 'data-pan-on-drag')).toBe('undefined');
    expect(attrOf('.fake-flow', 'data-zoom-on-scroll')).toBe('undefined');
    expect(attrOf('.fake-flow', 'data-zoom-on-double-click')).toBe('false');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered');
  });

  it('puts the workspace app above its library with package names', async () => {
    const workspaceGraphs: Record<string, unknown> = {
      '': {
        at: '',
        crumbs: [{ name: 'workspace', at: '' }],
        nodes: [
          { id: 'packages/web', kind: 'package', name: '@acme/web', path: 'packages/web', files: 1, row: 0, order: 0, cycle: false },
          { id: 'packages/core', kind: 'package', name: '@acme/core', path: 'packages/core', files: 1, row: 1, order: 0, cycle: false },
        ],
        edges: [{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }],
      },
    };
    await showArchView('', workspaceGraphs, noopDir, noopPath);
    expect(nodeEls().map(node => node.textContent)).toEqual(['@acme/web1 file', '@acme/core1 file']);
    expect(Number(nodeById('packages/web').dataset.y)).toBeLessThan(Number(nodeById('packages/core').dataset.y));
    expect(edgeBetween('packages/web', 'packages/core').getAttribute('data-cycle')).toBe('false');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('workspace');
  });

  it('draws the src view in layers with one labelled arrow', async () => {
    await showArchView('src', GRAPHS, noopDir, noopPath);
    expect(nodeById('src/app').dataset.y).toBe('0');
    expect(nodeById('src/infra').dataset.y).toBe('140');
    expect(nodeById('src/domain').dataset.y).toBe('280');
    expect(nodeById('src/app').textContent).toBe('app2 files');
    expect(nodeById('src/infra').textContent).toBe('infra1 file');
    expect(document.querySelectorAll('.box-count')).toHaveLength(3);
    const labelled = edgeBetween('src/app', 'src/infra');
    expect(labelled.getAttribute('data-cycle')).toBe('false');
    expect(labelled.classList.contains('arrow')).toBe(true);
    expect(labelled.classList.contains('cycle')).toBe(false);
    expect(labelTextOf(labelled)).toBe('2');
    expect(titleTextOf(labelled)).toBe('1 runtime · 1 type-only · 0 extends/implements');
    expect(labelTextOf(edgeBetween('src/app', 'src/domain'))).toBeNull();
    expect(labelTextOf(edgeBetween('src/infra', 'src/domain'))).toBeNull();
    expect(edgeEls().map(edge => `${edge.dataset.from}->${edge.dataset.to}`).sort()).toEqual([
      'src/app->src/domain',
      'src/app->src/infra',
      'src/infra->src/domain',
    ]);
    expect(pathOf('src/app', 'src/infra').getAttribute('data-stroke')).toBe('#64748b');
    expect(pathOf('src/app', 'src/infra').getAttribute('data-stroke-width')).toBe('1.5');
    expect(markerOf('src/app', 'src/infra')).toMatchObject({ type: 'arrowclosed', width: 14, height: 14, color: '#64748b' });
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src');
    for (const edge of edgeEls()) expect(edge.getAttribute('data-cycle')).toBe('false');
    for (const node of nodeEls()) expect(boxCycleFlag(node)).toBe('false');
  });

  it('draws the cycle in red with tooltips', async () => {
    await showArchView('src/app', GRAPHS, noopDir, noopPath);
    expect(nodeById('src/app/a.ts').dataset.x).toBe('0');
    expect(nodeById('src/app/b.ts').dataset.x).toBe('260');
    for (const node of nodeEls()) expect(boxCycleFlag(node)).toBe('true');
    expect(nodeEls().map(node => node.textContent)).toEqual(['a.ts', 'b.ts']);
    expect(document.querySelectorAll('.box-count')).toHaveLength(0);
    expect(boxClasses('src/app/a.ts').contains('file')).toBe(true);
    expect(boxClasses('src/app/a.ts').contains('package')).toBe(false);
    const ab = edgeBetween('src/app/a.ts', 'src/app/b.ts');
    expect(ab.getAttribute('data-cycle')).toBe('true');
    expect(ab.classList.contains('cycle')).toBe(true);
    expect(ab.classList.contains('arrow')).toBe(true);
    expect(pathOf('src/app/a.ts', 'src/app/b.ts').getAttribute('data-stroke')).toBe('#dc2626');
    expect(pathOf('src/app/a.ts', 'src/app/b.ts').getAttribute('data-stroke-width')).toBe('2');
    expect(markerOf('src/app/a.ts', 'src/app/b.ts')).toMatchObject({ width: 14, height: 14, color: '#dc2626' });
    expect(titleTextOf(ab)).toBe('a.ts → b.ts → a.ts');
    expect(labelTextOf(ab)).toBeNull();
    expect(titleTextOf(edgeBetween('src/app/b.ts', 'src/app/a.ts'))).toBe('b.ts → a.ts → b.ts');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src / app');
  });

  it('drills on package double-click and opens files on file double-click', async () => {
    const drilled: string[] = [];
    const opened: string[] = [];
    await showArchView('src', GRAPHS, dir => drilled.push(dir), path => opened.push(path));
    const { act } = await import('react');
    await act(async () => {
      dblclick(nodeById('src/app'));
    });
    expect(drilled).toEqual(['src/app']);
    expect(opened).toEqual([]);
    await showArchView('src/domain', GRAPHS, dir => drilled.push(dir), path => opened.push(path));
    await act(async () => {
      dblclick(nodeById('src/domain/model.ts'));
    });
    expect(opened).toEqual(['src/domain/model.ts']);
  });

  it('climbs via the breadcrumb', async () => {
    const drilled: string[] = [];
    await showArchView('src/app', GRAPHS, dir => drilled.push(dir), noopPath);
    const crumb = Array.from(document.querySelectorAll('nav[aria-label="breadcrumb"] button')).find(
      el => el.textContent === 'layered',
    );
    if (crumb === undefined) throw new Error('missing crumb');
    const { act } = await import('react');
    await act(async () => {
      click(crumb as HTMLElement);
    });
    expect(drilled).toEqual(['']);
  });

  it('rescans and redraws with the new arrow', async () => {
    const graphs: Record<string, unknown> = { ...GRAPHS };
    const calls: Call[] = [];
    const fetcher = archFetcher(calls, graphs);
    const { ArchView } = await import('./ArchView.tsx');
    const { waitFor } = await import('@testing-library/dom');
    await show(
      createElement(
        QueryClientProvider,
        { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at: 'src', fetcher, onDrill: noopDir, onOpenFile: noopPath }),
        createElement(TreeProbe, { token: 'tok', fetcher }),
        createElement(FileProbe, { token: 'tok', fetcher }),
      ),
    );
    await waitFor(() => {
      expect(document.querySelector('.fake-flow')).not.toBeNull();
    });
    const stamp = Number(attrOf('.fake-flow', 'data-mount-stamp'));
    graphs.src = {
      ...(GRAPHS.src as Record<string, unknown>),
      nodes: [
        { id: 'src/main.ts', kind: 'file', name: 'main.ts', path: 'src/main.ts', row: 0, order: 0, cycle: false },
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 1, order: 0, cycle: false },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 2, order: 0, cycle: false },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 3, order: 0, cycle: false },
      ],
      edges: [{ from: 'src/main.ts', to: 'src/app', runtime: 1, type: 0, cycle: false }, ...(GRAPHS.src as { edges: unknown[] }).edges],
    };
    const { act } = await import('react');
    const rescanButton = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Rescan');
    if (rescanButton === undefined) throw new Error('missing Rescan');
    await act(async () => {
      click(rescanButton);
    });
    await waitFor(() => {
      expect(nodeById('src/main.ts').dataset.y).toBe('0');
    });
    expect(Number(attrOf('.fake-flow', 'data-mount-stamp'))).toBeGreaterThan(stamp);
    expect(nodeById('src/app').dataset.y).toBe('140');
    expect(edgeBetween('src/main.ts', 'src/app').getAttribute('data-cycle')).toBe('false');
    expect(calls.map(call => `${call.method} ${call.url}`)).toContain('POST /api/rescan');
    await waitFor(() => {
      expect(calls.filter(call => call.url === '/api/tree')).toHaveLength(2);
    });
    expect(calls.filter(call => call.url === '/api/file?path=src%2Fapp%2Fa.ts')).toHaveLength(1);
  });

  it('shows loading then the 404 message', async () => {
    const { ArchView } = await import('./ArchView.tsx');
    const never = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    await show(
      createElement(QueryClientProvider, { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at: '', fetcher: never, onDrill: () => undefined, onOpenFile: () => undefined })),
    );
    expect(document.querySelector('.arch-canvas')?.textContent).toBe('loading…');
    const calls: Call[] = [];
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await act(async () => {
      root.unmount();
    });
    root = createRoot(document.getElementById('root') as HTMLElement);
    await show(
      createElement(QueryClientProvider, { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at: 'notes', fetcher: archFetcher(calls, GRAPHS), onDrill: () => undefined, onOpenFile: () => undefined })),
    );
    await waitFor(() => {
      expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such directory');
    });
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('');
    expect(document.querySelectorAll('nav[aria-label="breadcrumb"] button')).toHaveLength(0);
    expect(optionOf('crap').disabled).toBe(true);
    expect(optionOf('mutants').disabled).toBe(true);
    const { act: clickAct } = await import('react');
    await clickAct(async () => {
      click(metricsButton());
    });
    expect(drawerRows()).toHaveLength(0);
    expect(document.querySelector('aside[aria-label="metrics"]')?.getAttribute('data-boxes')).toBe('0');
  });

const HEALTH_GRAPHS = {
  src: {
    at: 'src',
    crumbs: [
      { name: 'layered', at: '' },
      { name: 'src', at: 'src' },
    ],
    nodes: [
      { id: 'src/green.ts', kind: 'file', name: 'green.ts', path: 'src/green.ts', row: 0, order: 0, cycle: false, crap: 3, coverage: '1.00', mutants: 0 },
      { id: 'src/amber.ts', kind: 'file', name: 'amber.ts', path: 'src/amber.ts', row: 1, order: 0, cycle: false, crap: 6, coverage: '0.50', mutants: 0 },
      { id: 'src/red.ts', kind: 'file', name: 'red.ts', path: 'src/red.ts', row: 2, order: 0, cycle: false, crap: 42, coverage: '0.00', mutants: 0 },
      { id: 'src/plain.ts', kind: 'file', name: 'plain.ts', path: 'src/plain.ts', row: 3, order: 0, cycle: false, coverage: '1.00', mutants: 3 },
      { id: 'src/clean.ts', kind: 'file', name: 'clean.ts', path: 'src/clean.ts', row: 4, order: 0, cycle: false, coverage: '1.00', mutants: 0 },
      { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 5, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy', crap: 6, coverage: '0.50', mutants: 0 },
      { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 2, row: 6, order: 0, cycle: false, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy', crap: 6, coverage: '0.50', mutants: 0 },
      { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 7, order: 0, cycle: false, ca: 3, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy', crap: 6, coverage: '0.50', mutants: 0 },
    ],
    edges: [],
    crapMax: 4,
    coverage: 'stale',
    mutation: 'on',
  },
};

const LAYERED_VIEW = {
  src: {
    at: 'src',
    crumbs: [
      { name: 'layered', at: '' },
      { name: 'src', at: 'src' },
    ],
    nodes: [
      { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 2, row: 0, order: 0, cycle: false, ca: 2, ce: 2, i: '0.50', a: '0.00', d: '0.50', zone: 'healthy' },
      { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 1, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
      { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 2, order: 0, cycle: false, ca: 3, ce: 0, i: '0.00', a: '1.00', d: '0.00', zone: 'healthy' },
    ],
    edges: [],
    crapMax: 4,
    coverage: 'off',
    mutation: 'off',
  },
};

const ROOT_VIEW = {
  '': {
    at: '',
    crumbs: [{ name: 'healthy', at: '' }],
    nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 5, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–', crap: 42, coverage: '0.54', mutants: 3 }],
    edges: [],
    crapMax: 4,
    coverage: 'on',
    mutation: 'on',
  },
};

const FRESH_VIEW = {
  src: { ...HEALTH_GRAPHS.src, coverage: 'on', mutation: 'stale' },
};

function badgeText(id: string): string | null {
  return nodeById(id).querySelector('.box-badge')?.textContent ?? null;
}

function badgeHealth(id: string): string | null {
  return nodeById(id).querySelector('.box-badge')?.getAttribute('data-health') ?? null;
}

function tdText(tr: Element): string | null {
  return tr.querySelector('td')?.textContent ?? null;
}

function rowCells(tr: Element): string[] {
  return Array.from(tr.querySelectorAll('td')).map(cell => cell.textContent ?? '');
}

function optionOf(value: string): HTMLOptionElement {
  const option = document.querySelector(`select[aria-label="Overlay"] option[value="${value}"]`);
  if (option === null) throw new Error(value);
  return option as HTMLOptionElement;
}

function hotLines(): string[] {
  const heading = Array.from(document.querySelectorAll('aside[aria-label="details"] h3')).find(item => item.textContent === 'Hot functions');
  const items = heading?.parentElement?.querySelectorAll('li');
  return Array.from(items ?? []).map(item => item.textContent ?? '');
}

function graphFetches(calls: Call[]): number {
  return calls.filter(call => call.url.startsWith('/api/graph')).length;
}

function textOf(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

function metricsButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Metrics');
  if (button === undefined) throw new Error('metrics');
  return button as HTMLButtonElement;
}

function drawerRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('aside[aria-label="metrics"] tbody tr'));
}

function headerOf(label: string): HTMLTableCellElement {
  const cell = Array.from(document.querySelectorAll('aside[aria-label="metrics"] th')).find(th => th.textContent === label);
  if (cell === undefined) throw new Error(label);
  return cell as HTMLTableCellElement;
}

function rowNamed(name: string): HTMLElement {
  const row = drawerRows().find(tr => tdText(tr) === name);
  if (row === undefined) throw new Error(name);
  return row;
}

function panelText(): string {
  return document.querySelector('aside[aria-label="details"]')?.textContent ?? '';
}

function overlaySelect(): HTMLSelectElement {
  const select = document.querySelector('select[aria-label="Overlay"]');
  if (select === null) throw new Error('overlay');
  return select as HTMLSelectElement;
}

  it('controls overlays and stale indicators', async () => {
    const { act } = await import('react');
    const { fireEvent, waitFor } = await import('@testing-library/dom');
    const layoutRef = { current: { version: 1 as const, views: {}, settings: { tests: false, external: false, overlay: 'none' as const } } };
    const fetcher = archFetcher([], HEALTH_GRAPHS, layoutRef);
    await showArchView('src', HEALTH_GRAPHS, noopDir, noopPath, fetcher);

    expect(overlaySelect().value).toBe('none');
    expect(document.querySelector('[aria-label="health"]')).toBeNull();
    expect(document.querySelector('span[aria-label="stale"]')).toBeNull();

    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'crap' } });
    });
    await waitFor(() => {
      expect(document.querySelector('span[aria-label="stale"]')).not.toBeNull();
    });
    expect(badgeText('src/green.ts')).toBe('3');
    expect(badgeHealth('src/green.ts')).toBe('green');
    expect(badgeText('src/amber.ts')).toBe('6');
    expect(badgeHealth('src/amber.ts')).toBe('amber');
    expect(badgeText('src/red.ts')).toBe('42');
    expect(badgeHealth('src/red.ts')).toBe('red');
    expect(badgeText('src/plain.ts')).toBe('–');
    expect(badgeHealth('src/plain.ts')).toBeNull();
    expect(badgeText('src/clean.ts')).toBe('–');
    expect(badgeHealth('src/clean.ts')).toBeNull();
    expect(layoutRef.current.settings.overlay).toBe('crap');

    await reopen();
    await showArchView('src', HEALTH_GRAPHS, noopDir, noopPath, fetcher);
    expect(overlaySelect().value).toBe('crap');
    expect(badgeText('src/red.ts')).toBe('42');

    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'coverage' } });
    });
    await waitFor(() => {
      expect(badgeText('src/green.ts')).toBe('1.00');
    });
    expect(badgeHealth('src/green.ts')).toBe('green');
    expect(badgeText('src/amber.ts')).toBe('0.50');
    expect(badgeHealth('src/amber.ts')).toBe('red');
    expect(badgeText('src/red.ts')).toBe('0.00');
    expect(badgeHealth('src/red.ts')).toBe('red');

    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'mutants' } });
    });
    await waitFor(() => {
      expect(badgeText('src/plain.ts')).toBe('3');
    });
    expect(badgeHealth('src/plain.ts')).toBe('red');
    expect(badgeText('src/clean.ts')).toBe('0');
    expect(badgeHealth('src/clean.ts')).toBe('green');
    expect(badgeText('src/green.ts')).toBe('0');
    expect(badgeHealth('src/green.ts')).toBe('green');
    expect(document.querySelector('span[aria-label="stale"]')).toBeNull();
    expect(overlaySelect().value).toBe('mutants');
    expect(layoutRef.current.settings.overlay).toBe('mutants');
    expect(optionOf('none').textContent).toBe('None');
    expect(optionOf('crap').textContent).toBe('CRAP');
    expect(optionOf('coverage').textContent).toBe('Coverage');
    expect(optionOf('mutants').textContent).toBe('Surviving mutants');
    expect(document.querySelector('.overlay-box label')?.textContent).toContain('Overlay ');
  });

  it('A missing report disables its option and names the command to run', async () => {
    const { act } = await import('react');
    const layoutRef = { current: { version: 1 as const, views: {}, settings: { tests: false, external: false, overlay: 'none' as const } } };
    await showArchView('src', LAYERED_VIEW, noopDir, noopPath, archFetcher([], LAYERED_VIEW, layoutRef));
    expect(optionOf('crap').disabled).toBe(true);
    expect(optionOf('crap').title).toBe('no coverage data: run marestail gate');
    expect(optionOf('coverage').disabled).toBe(true);
    expect(optionOf('coverage').title).toBe('no coverage data: run marestail gate');
    expect(optionOf('mutants').disabled).toBe(true);
    expect(optionOf('mutants').title).toBe('no mutation report: run marestail gate --tier full');
    expect(optionOf('none').disabled).toBe(false);
    const { fireEvent } = await import('@testing-library/dom');
    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'crap' } });
    });
    expect(overlaySelect().value).toBe('none');
    expect(document.querySelector('[aria-label="health"]')).toBeNull();
  });

  it('colours a CRAP of 6 green when the reported limit is 8', async () => {
    const graphs = {
      src: {
        at: 'src',
        crumbs: [{ name: 'repo', at: '' }, { name: 'src', at: 'src' }],
        nodes: [
          { id: 'src/edge.ts', kind: 'file', name: 'edge.ts', path: 'src/edge.ts', row: 0, order: 0, cycle: false, crap: 6, coverage: '0.80', mutants: 1 },
        ],
        edges: [],
        crapMax: 8,
        coverage: 'on',
        mutation: 'on',
      },
    };
    const layoutRef = { current: { version: 1 as const, views: {}, settings: { tests: false, external: false, overlay: 'crap' as const } } };
    await showArchView('src', graphs, noopDir, noopPath, archFetcher([], graphs, layoutRef));
    expect(badgeHealth('src/edge.ts')).toBe('green');
    expect(badgeText('src/edge.ts')).toBe('6');
  });

  it('A reload re-reads the reports and choosing an overlay does not', async () => {
    const { act } = await import('react');
    const { fireEvent, waitFor } = await import('@testing-library/dom');
    let phase: 'held' | 'fresh' = 'held';
    const calls: Call[] = [];
    const layoutRef = { current: { version: 1 as const, views: {}, settings: { tests: false, external: false, overlay: 'none' as const } } };
    const fetcher = archFetcher(calls, () => (phase === 'held' ? HEALTH_GRAPHS : FRESH_VIEW), layoutRef);
    await showArchView('src', HEALTH_GRAPHS, noopDir, noopPath, fetcher);
    expect(graphFetches(calls)).toBe(1);
    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'crap' } });
    });
    await waitFor(() => {
      expect(document.querySelector('span[aria-label="stale"]')).not.toBeNull();
    });
    expect(badgeText('src/red.ts')).toBe('42');
    phase = 'fresh';
    await act(async () => {
      fireEvent.change(overlaySelect(), { target: { value: 'coverage' } });
    });
    await waitFor(() => {
      expect(overlaySelect().value).toBe('coverage');
    });
    expect(graphFetches(calls)).toBe(1);
    expect(document.querySelector('span[aria-label="stale"]')).not.toBeNull();
    await reopen();
    await showArchView('src', FRESH_VIEW, noopDir, noopPath, fetcher);
    expect(overlaySelect().value).toBe('coverage');
    expect(document.querySelector('span[aria-label="stale"]')).toBeNull();
    expect(graphFetches(calls)).toBe(2);
  });

  it('The Metrics table shows the real CRAP, coverage and mutant numbers', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await showArchView('', ROOT_VIEW, noopDir, noopPath);
    await act(async () => {
      click(metricsButton());
    });
    await waitFor(() => {
      expect(document.querySelector('aside[aria-label="metrics"]')).not.toBeNull();
    });
    expect(drawerRows().map(tdText)).toEqual(['src']);
    expect(rowCells(rowNamed('src'))).toEqual(['src', '5', '0', '0', '–', '0.00', '–', '–', '42', '0.54', '3']);
  });

  it('The Metrics table sorts by D and selecting a row selects the box', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await showArchView('src', LAYERED_VIEW, noopDir, noopPath);
    await act(async () => {
      click(metricsButton());
    });
    await waitFor(() => {
      expect(document.querySelector('aside[aria-label="metrics"]')).not.toBeNull();
    });
    expect(drawerRows().map(tdText)).toEqual(['infra', 'app', 'domain']);
    expect(rowCells(rowNamed('infra'))).toEqual(['infra', '2', '2', '2', '0.50', '0.00', '0.50', 'healthy', '–', '–', '–']);
    expect(rowCells(rowNamed('app'))).toEqual(['app', '2', '0', '2', '1.00', '0.00', '0.00', 'healthy', '–', '–', '–']);
    expect(rowCells(rowNamed('domain'))).toEqual(['domain', '2', '3', '0', '0.00', '1.00', '0.00', 'healthy', '–', '–', '–']);
    expect(headerOf('D').getAttribute('aria-sort')).toBe('descending');
    await act(async () => {
      click(headerOf('I'));
    });
    expect(drawerRows().map(tdText)).toEqual(['app', 'infra', 'domain']);
    expect(headerOf('I').getAttribute('aria-sort')).toBe('descending');
    await act(async () => {
      click(rowNamed('domain'));
    });
    await waitFor(() => {
      expect(textOf('aside[aria-label="details"] h2')).toBe('domain');
    });
    expect(nodeById('src/domain').querySelector('.box')?.getAttribute('data-selected')).toBe('true');
    expect(panelText()).toContain('I 0.00');
    expect(panelText()).toContain('A 1.00');
    expect(panelText()).toContain('D 0.00');
    expect(panelText()).toContain('Zone healthy');
    await act(async () => {
      click(metricsButton());
    });
    expect(document.querySelector('aside[aria-label="metrics"]')).toBeNull();
  });

  it("A file's panel lists the functions over the limit", async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await showArchView('src', HEALTH_GRAPHS, noopDir, noopPath);
    await act(async () => {
      click(nodeById('src/red.ts'));
    });
    await waitFor(() => {
      expect(textOf('aside[aria-label="details"] h2')).toBe('red.ts');
    });
    expect(panelText()).toContain('CRAP 42');
    expect(panelText()).toContain('Coverage 0.00');
    expect(panelText()).toContain('Mutants 0');
    expect(hotLines()).toEqual(['bad · line 1 · cc 6 · coverage 0.00']);
    expect(document.querySelector('[data-hot]')?.getAttribute('data-hot')).toBe('bad@1');
    await act(async () => {
      click(nodeById('src/green.ts'));
    });
    await waitFor(() => {
      expect(textOf('aside[aria-label="details"] h2')).toBe('green.ts');
    });
    expect(hotLines()).toEqual([]);
    expect(panelText()).toContain('CRAP 3');
    expect(panelText()).toContain('Coverage 1.00');
  });
});

describe('App with the Architecture tab', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = installDom();
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    root.unmount();
    dom.window.close();
  });

  async function remount(url: string): Promise<void> {
    root.unmount();
    dom.window.close();
    dom = installDom(url);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  }

  async function renderApp(calls: Call[], graphs = GRAPHS, events: EventTarget = window): Promise<void> {
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    await act(async () => {
      root.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher: archFetcher(calls, graphs),
          events,
        }),
      );
    });
  }

  function recordingEvents(): { target: EventTarget; added: string[]; removed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const target = {
      addEventListener: (type: string) => added.push(type),
      removeEventListener: (type: string) => removed.push(type),
    } as unknown as EventTarget;
    return { target, added, removed };
  }

  async function waitForText(text: string): Promise<void> {
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(() => {
      expect(document.body.textContent).toContain(text);
    });
  }

  function treeRows(): string[] {
    return Array.from(document.querySelectorAll('aside nav button')).map(el => el.textContent ?? '');
  }

  it('opens on the Files tab with the 001 tree and switches tabs', async () => {
    const calls: Call[] = [];
    await renderApp(calls);
    await waitForText('tsconfig.json');
    expect(Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.textContent)).toEqual(['Files', 'Architecture']);
    expect(tabByName('Files').getAttribute('aria-selected')).toBe('true');
    expect(tabByName('Architecture').getAttribute('aria-selected')).toBe('false');
    expect(treeRows()).toEqual(['layered/', 'notes/', 'src/', 'tsconfig.json']);
    expect(document.querySelector('main')?.textContent).toBe('select a file');
    expect(calls.map(call => call.url)).toEqual(['/api/tree']);
    const { act } = await import('react');
    await act(async () => {
      click(tabByName('Architecture'));
    });
    await waitForText('4 files');
    expect(tabByName('Architecture').getAttribute('aria-selected')).toBe('true');
    expect(tabByName('Files').getAttribute('aria-selected')).toBe('false');
    expect(window.location.hash).toBe('#at=');
    expect(nodeEls().map(node => node.textContent)).toEqual(['src4 files']);
    await act(async () => {
      click(tabByName('Files'));
    });
    await waitForText('select a file');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/');
  });

  it('drills down and climbs out with the breadcrumb', async () => {
    const calls: Call[] = [];
    await renderApp(calls);
    const { act } = await import('react');
    await act(async () => {
      click(tabByName('Architecture'));
    });
    await waitForText('4 files');
    await act(async () => {
      dblclick(nodeById('src'));
    });
    await waitForText('app2 files');
    expect(window.location.hash).toBe('#at=src');
    expect(tabByName('Architecture').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src');
    expect(Number(nodeById('src/app').dataset.y)).toBeLessThan(Number(nodeById('src/infra').dataset.y));
    expect(Number(nodeById('src/infra').dataset.y)).toBeLessThan(Number(nodeById('src/domain').dataset.y));
    const crumb = Array.from(document.querySelectorAll('nav[aria-label="breadcrumb"] button')).find(
      el => el.textContent === 'layered',
    );
    if (crumb === undefined) throw new Error('missing crumb');
    await act(async () => {
      click(crumb as HTMLElement);
    });
    await waitForText('4 files');
    expect(window.location.hash).toBe('#at=');
    expect(nodeEls().map(node => node.textContent)).toEqual(['src4 files']);
  });

  it('climbs out one level per Back button press', async () => {
    const calls: Call[] = [];
    await renderApp(calls);
    const { act } = await import('react');
    await act(async () => {
      click(tabByName('Architecture'));
    });
    await waitForText('4 files');
    await act(async () => {
      dblclick(nodeById('src'));
    });
    await waitForText('app2 files');
    await act(async () => {
      dblclick(nodeById('src/app'));
    });
    await waitForText('a.ts');
    expect(window.location.hash).toBe('#at=src/app');
    await act(async () => {
      window.history.back();
    });
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(() => {
      expect(window.location.hash).toBe('#at=src');
      expect(nodeEls().map(node => node.dataset.node).sort()).toEqual(['src/app', 'src/domain', 'src/infra']);
    });
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#at=');
      expect(nodeEls().map(node => node.textContent)).toEqual(['src4 files']);
    });
  });

  it('opens a deep link into a drilled-down view', async () => {
    await remount('http://127.0.0.1:4700/?token=tok#at=src/app');
    const calls: Call[] = [];
    await renderApp(calls);
    await waitForText('a.ts');
    expect(tabByName('Architecture').getAttribute('aria-selected')).toBe('true');
    expect(window.location.hash).toBe('#at=src/app');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src / app');
    for (const node of nodeEls()) expect(boxCycleFlag(node)).toBe('true');
  });

  it('returns to the selected file when switching back to Files', async () => {
    await remount('http://127.0.0.1:4700/?token=tok#file=src/app/a.ts');
    const calls: Call[] = [];
    await renderApp(calls);
    await waitForText('src/app/a.ts');
    const { act } = await import('react');
    await act(async () => {
      click(tabByName('Architecture'));
    });
    await waitForText('4 files');
    expect(window.location.hash).toBe('#at=');
    await act(async () => {
      click(tabByName('Files'));
    });
    await waitForText('export class Model');
    expect(window.location.hash).toBe('#file=src/app/a.ts');
    expect(tabByName('Files').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('main header')?.textContent).toBe('src/app/a.ts');
  });

  it('attaches the popstate listener on the injected target and removes it on unmount', async () => {
    const events = recordingEvents();
    const calls: Call[] = [];
    await renderApp(calls, GRAPHS, events.target);
    await waitForText('tsconfig.json');
    expect(events.added).toEqual(['popstate']);
    const { act } = await import('react');
    await act(async () => {
      root.unmount();
    });
    expect(events.removed).toEqual(['popstate']);
    await remount('http://127.0.0.1:4700/?token=tok');
  });

  it('follows a replaced location object on the next popstate', async () => {
    const calls: Call[] = [];
    await renderApp(calls);
    await waitForText('tsconfig.json');
    const { act } = await import('react');
    const { App } = await import('./App.tsx');
    const otherLocation = { hash: '#at=src', pathname: '/' } as unknown as Location;
    await act(async () => {
      root.render(
        createElement(App, {
          token: 'tok',
          location: otherLocation,
          historyApi: window.history,
          fetcher: archFetcher(calls, GRAPHS),
          events: window,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(new window.Event('popstate'));
    });
    await waitForText('app2 files');
    expect(tabByName('Architecture').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src');
  });

  it('opens a file in the Files tab on double-click', async () => {
    const calls: Call[] = [];
    await renderApp(calls);
    const { act } = await import('react');
    await act(async () => {
      click(tabByName('Architecture'));
    });
    await waitForText('4 files');
    await act(async () => {
      dblclick(nodeById('src'));
    });
    await waitForText('app2 files');
    await act(async () => {
      dblclick(nodeById('src/domain'));
    });
    await waitForText('model.ts');
    await act(async () => {
      dblclick(nodeById('src/domain/model.ts'));
    });
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('pre div')).map(el => el.textContent)).toEqual(['1 export class Model { id = 0; }']);
    });
    expect(document.querySelector('main header')?.textContent).toBe('src/domain/model.ts');
    expect(tabByName('Files').getAttribute('aria-selected')).toBe('true');
    expect(window.location.hash).toBe('#file=src/domain/model.ts');
    const row = Array.from(document.querySelectorAll('aside nav button')).find(el => el.textContent === 'model.ts');
    expect(row?.getAttribute('aria-current')).toBe('true');
    expect(calls.map(call => call.url)).toContain('/api/file?path=src%2Fdomain%2Fmodel.ts');
  });
});

