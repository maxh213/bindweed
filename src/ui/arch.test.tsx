import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', async () => {
  const { createElement: ce } = await import('react');

  type FakeNode = {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    draggable?: boolean;
  };
  type FakeEdge = { id: string; source: string; target: string; type: string; data?: Record<string, unknown> };
  type FakeFlowProps = {
    nodes: FakeNode[];
    edges: FakeEdge[];
    nodeTypes: Record<string, (props: never) => ReactElement | null>;
    edgeTypes: Record<string, (props: never) => ReactElement | null>;
    nodesDraggable?: boolean;
    fitView?: boolean;
    panOnDrag?: boolean;
    zoomOnScroll?: boolean;
    zoomOnDoubleClick?: boolean;
    onNodeDoubleClick?: (event: unknown, node: FakeNode) => void;
  };

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
        onDoubleClick: (event: unknown) => props.onNodeDoubleClick?.(event, node),
      },
      ce(Box as (props: { data: Record<string, unknown> }) => ReactElement | null, { data: node.data }),
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
      markerEnd: 'url(#arrow)',
    });
  }

  function ReactFlow(props: FakeFlowProps) {
    const probe = fakeEdgeView(props, { id: 'probe', source: '', target: '', type: 'arrow' });
    return ce(
      'div',
      {
        className: 'fake-flow',
        'data-draggable-nodes': String(props.nodesDraggable),
        'data-fit-view': String(props.fitView),
        'data-pan-on-drag': String(props.panOnDrag),
        'data-zoom-on-scroll': String(props.zoomOnScroll),
        'data-zoom-on-double-click': String(props.zoomOnDoubleClick),
      },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge)), probe),
    );
  }

  return {
    ReactFlow,
    BaseEdge: (props: { id: string; path: string }) => ce('path', { className: 'fake-edge-path', 'data-edge': props.id, d: props.path }),
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
      { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
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

function graphBodyFor(url: string, graphs: Record<string, unknown>): Response {
  const at = new URL(url, 'http://x').searchParams.get('at') ?? '';
  const body = graphs[at];
  return body === undefined ? notOk({ error: 'no such directory' }) : ok(body);
}

function fileBodyFor(url: string): Response {
  const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
  return ok({ path, text: MODEL_TEXT });
}

function archFetcher(calls: Call[], graphs: Record<string, unknown>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    record(calls, url, init);
    if (url === '/api/tree') return ok(TREE);
    if (url.startsWith('/api/graph')) return graphBodyFor(url, graphs);
    if (url.startsWith('/api/file')) return fileBodyFor(url);
    return ok({ files: 4, ms: 3 });
  }) as typeof fetch;
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });
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

  async function showArchView(
    at: string,
    graphs: Record<string, unknown>,
    onDrill: (dir: string) => void,
    onOpenFile: (path: string) => void,
  ): Promise<Call[]> {
    const { ArchView } = await import('./ArchView.tsx');
    const { waitFor } = await import('@testing-library/dom');
    const calls: Call[] = [];
    await show(
      createElement(QueryClientProvider, { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at, fetcher: archFetcher(calls, graphs), onDrill, onOpenFile })),
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
    expect(nodeById('src').dataset).toMatchObject({ x: '0', y: '0', draggable: 'false' });
    expect(boxCycleFlag(nodeById('src'))).toBe('false');
    expect(edgeEls()).toEqual([]);
    expect(attrOf('.fake-flow', 'data-draggable-nodes')).toBe('false');
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
    const labelled = edgeBetween('src/app', 'src/infra');
    expect(labelled.getAttribute('data-cycle')).toBe('false');
    expect(labelTextOf(labelled)).toBe('2');
    expect(titleTextOf(labelled)).toBeNull();
    expect(labelTextOf(edgeBetween('src/app', 'src/domain'))).toBeNull();
    expect(labelTextOf(edgeBetween('src/infra', 'src/domain'))).toBeNull();
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('layered / src');
    for (const edge of edgeEls()) expect(edge.getAttribute('data-cycle')).toBe('false');
  });

  it('draws the cycle in red with tooltips', async () => {
    await showArchView('src/app', GRAPHS, noopDir, noopPath);
    expect(nodeById('src/app/a.ts').dataset.x).toBe('0');
    expect(nodeById('src/app/b.ts').dataset.x).toBe('260');
    for (const node of nodeEls()) expect(boxCycleFlag(node)).toBe('true');
    expect(nodeEls().map(node => node.textContent)).toEqual(['a.ts', 'b.ts']);
    const ab = edgeBetween('src/app/a.ts', 'src/app/b.ts');
    expect(ab.getAttribute('data-cycle')).toBe('true');
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
    const calls = await showArchView('src', graphs, noopDir, noopPath);
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
    const { waitFor } = await import('@testing-library/dom');
    const rescanButton = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Rescan');
    if (rescanButton === undefined) throw new Error('missing Rescan');
    await act(async () => {
      click(rescanButton);
    });
    await waitFor(() => {
      expect(nodeById('src/main.ts').dataset.y).toBe('0');
    });
    expect(nodeById('src/app').dataset.y).toBe('140');
    expect(edgeBetween('src/main.ts', 'src/app').getAttribute('data-cycle')).toBe('false');
    expect(calls.map(call => `${call.method} ${call.url}`)).toContain('POST /api/rescan');
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
    const { waitFor } = await import('@testing-library/dom');
    await show(
      createElement(QueryClientProvider, { client: newQueryClient() },
        createElement(ArchView, { token: 'tok', at: 'notes', fetcher: archFetcher(calls, GRAPHS), onDrill: () => undefined, onOpenFile: () => undefined })),
    );
    await waitFor(() => {
      expect(document.querySelector('.arch-canvas')?.textContent).toBe('no such directory');
    });
    expect(document.querySelector('nav[aria-label="breadcrumb"]')?.textContent).toBe('');
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

  async function renderApp(calls: Call[], graphs = GRAPHS): Promise<void> {
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    await act(async () => {
      root.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher: archFetcher(calls, graphs),
          events: window,
        }),
      );
    });
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
