import { fireEvent, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sheet = process.getBuiltinModule('node:fs').readFileSync(new URL('./app.css', import.meta.url), 'utf8');

vi.mock('@xyflow/react', async () => {
  const { createElement: ce, useState } = await import('react');

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
  type Point = { x: number; y: number };
  type MousePoint = { target: EventTarget | null; currentTarget: EventTarget | null; clientX: number; clientY: number };

  let flowMounts = 0;
  let dropAt: Point | null = null;
  let panOrigin: Point | null = null;
  const centers: Point[] = [];

  function dropPosition(node: FakeNode): Point {
    if (dropAt === null) return node.position;
    return dropAt;
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

  function onDrop(props: FakeFlowProps, node: FakeNode, event: { altKey: boolean }): void {
    if (!event.altKey) return;
    props.onNodeDragStop?.({}, { ...node, position: dropPosition(node) });
  }

  function beginPan(event: MousePoint, enabled: boolean): Point | null {
    if (!enabled) return null;
    if (event.target !== event.currentTarget) return null;
    return { x: event.clientX, y: event.clientY };
  }

  function panShift(origin: Point | null, x: number, y: number): Point | null {
    if (origin === null) return null;
    return { x: x - origin.x, y: y - origin.y };
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
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const probe = fakeEdgeView(props, { id: 'probe', source: '', target: '', type: 'arrow' });
    return ce(
      'div',
      {
        className: 'fake-flow',
        'data-draggable-nodes': String(props.nodesDraggable),
        'data-pan-on-drag': String(props.panOnDrag),
        'data-mount-stamp': String(stamp),
        style: { transform: `translate(${pan.x}px, ${pan.y}px)` },
        onMouseDown: (event: MousePoint) => {
          panOrigin = beginPan(event, props.panOnDrag !== false);
        },
        onMouseMove: (event: MousePoint) => {
          const next = panShift(panOrigin, event.clientX, event.clientY);
          if (next !== null) setPan(next);
        },
        onMouseUp: () => {
          panOrigin = null;
        },
      },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge)), probe),
    );
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
    kindsArmDrop: (shift: Point | null) => {
      dropAt = shift;
    },
    kindsFlowCenters: centers,
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

type Pin = { x: number; y: number };
type LayoutDoc = { version: 1; views: Record<string, Record<string, Pin>>; settings: { tests: boolean; external: boolean } };
type World = {
  layout: LayoutDoc;
  main: boolean;
  armMain: boolean;
  puts: number;
  gate: Promise<void> | null;
  detailGate: Promise<void> | null;
  details: string[];
  graphs: string[];
};
type GNode = {
  id: string;
  kind: string;
  name: string;
  path: string;
  files?: number;
  row: number;
  order: number;
  cycle: boolean;
  abstract?: true;
  test?: true;
};
type GEdge = { from: string; to: string; runtime: number; type: number; heritage?: number; cycle: boolean; cycleText?: string };
type GView = { at: string; crumbs: { name: string; at: string }[]; nodes: GNode[]; edges: GEdge[] };
type Flags = { at: string; tests: boolean; external: boolean };

const CRUMB = [
  { name: 'layered', at: '' },
  { name: 'src', at: 'src' },
];

const SRC: GView = {
  at: 'src',
  crumbs: CRUMB,
  nodes: [
    { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
    { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 2, row: 1, order: 0, cycle: false },
    { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 2, order: 0, cycle: false, abstract: true },
  ],
  edges: [
    { from: 'src/app', to: 'src/infra', runtime: 2, type: 1, cycle: false },
    { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
    { from: 'src/infra', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false },
  ],
};

const FS: GNode = { id: 'node:fs', kind: 'external', name: 'node:fs', path: 'node:fs', row: 3, order: 0, cycle: false };
const REACT: GNode = { id: 'react', kind: 'external', name: 'react', path: 'react', row: 3, order: 1, cycle: false };
const FS_EDGE: GEdge = { from: 'src/infra', to: 'node:fs', runtime: 1, type: 0, cycle: false };
const REACT_EDGE: GEdge = { from: 'src/infra', to: 'react', runtime: 1, type: 0, cycle: false };

const SRC_EXT: GView = { ...SRC, nodes: [...SRC.nodes, FS, REACT], edges: [...SRC.edges, FS_EDGE, REACT_EDGE] };

const APP: GView = {
  at: 'src/app',
  crumbs: [...CRUMB, { name: 'app', at: 'src/app' }],
  nodes: [
    { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true },
    { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
  ],
};

const APP_TESTS: GView = {
  ...APP,
  nodes: [
    { id: 'src/app/a.test.ts', kind: 'file', name: 'a.test.ts', path: 'src/app/a.test.ts', row: 0, order: 0, cycle: false, test: true },
    { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 1, order: 0, cycle: true },
    { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 1, order: 1, cycle: true },
  ],
  edges: [{ from: 'src/app/a.test.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: false }, ...APP.edges],
};

const DOMAIN: GView = {
  at: 'src/domain',
  crumbs: [...CRUMB, { name: 'domain', at: 'src/domain' }],
  nodes: [
    { id: 'src/domain/model.ts', kind: 'file', name: 'model.ts', path: 'src/domain/model.ts', row: 0, order: 0, cycle: false, abstract: true },
    { id: 'src/domain/shape.ts', kind: 'file', name: 'shape.ts', path: 'src/domain/shape.ts', row: 0, order: 1, cycle: false, abstract: true },
  ],
  edges: [],
};

const INFRA: GView = {
  at: 'src/infra',
  crumbs: [...CRUMB, { name: 'infra', at: 'src/infra' }],
  nodes: [
    { id: 'src/infra/db.ts', kind: 'file', name: 'db.ts', path: 'src/infra/db.ts', row: 0, order: 0, cycle: false },
    { id: 'src/infra/repo.ts', kind: 'file', name: 'repo.ts', path: 'src/infra/repo.ts', row: 0, order: 1, cycle: false },
  ],
  edges: [],
};

const SRC_MAIN: GView = {
  ...SRC,
  nodes: [
    { id: 'src/main.ts', kind: 'file', name: 'main.ts', path: 'src/main.ts', row: 0, order: 0, cycle: false },
    { ...SRC.nodes[0], row: 1 },
    { ...SRC.nodes[1], row: 2 },
    { ...SRC.nodes[2], row: 3 },
  ] as GNode[],
  edges: [{ from: 'src/main.ts', to: 'src/app', runtime: 1, type: 0, cycle: false }, ...SRC.edges],
};

const CYC: GView = {
  at: 'cyc',
  crumbs: [
    { name: 'kinds', at: '' },
    { name: 'cyc', at: 'cyc' },
  ],
  nodes: [
    { id: 'cyc/a.ts', kind: 'file', name: 'a.ts', path: 'cyc/a.ts', row: 0, order: 0, cycle: true, abstract: true },
    { id: 'cyc/b.ts', kind: 'file', name: 'b.ts', path: 'cyc/b.ts', row: 0, order: 1, cycle: true, abstract: true },
  ],
  edges: [
    { from: 'cyc/a.ts', to: 'cyc/b.ts', runtime: 0, type: 1, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
    { from: 'cyc/b.ts', to: 'cyc/a.ts', runtime: 0, type: 1, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
  ],
};

const TYPED: GView = {
  at: 'typed',
  crumbs: [
    { name: 'kinds', at: '' },
    { name: 'typed', at: 'typed' },
  ],
  nodes: [
    { id: 'typed/repo.ts', kind: 'file', name: 'repo.ts', path: 'typed/repo.ts', row: 0, order: 0, cycle: false },
    { id: 'typed/shape.ts', kind: 'file', name: 'shape.ts', path: 'typed/shape.ts', row: 1, order: 0, cycle: false, abstract: true },
  ],
  edges: [{ from: 'typed/repo.ts', to: 'typed/shape.ts', runtime: 0, type: 1, heritage: 1, cycle: false }],
};

const GAP: GView = {
  at: 'gap',
  crumbs: [
    { name: 'kinds', at: '' },
    { name: 'gap', at: 'gap' },
  ],
  nodes: [{ id: 'gap/a.ts', kind: 'file', name: 'a.ts', path: 'gap/a.ts', row: 0, order: 0, cycle: false }],
  edges: [
    { from: 'missing-from', to: 'gap/a.ts', runtime: 1, type: 0, cycle: false },
    { from: 'gap/a.ts', to: 'missing-to', runtime: 1, type: 0, cycle: false },
  ],
};

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
            { name: 'a.test.ts', path: 'src/app/a.test.ts', kind: 'file' },
            { name: 'a.ts', path: 'src/app/a.ts', kind: 'file' },
            { name: 'b.ts', path: 'src/app/b.ts', kind: 'file' },
          ],
        },
        {
          name: 'domain',
          path: 'src/domain',
          kind: 'dir',
          children: [
            { name: 'model.ts', path: 'src/domain/model.ts', kind: 'file' },
            { name: 'shape.ts', path: 'src/domain/shape.ts', kind: 'file' },
          ],
        },
        {
          name: 'infra',
          path: 'src/infra',
          kind: 'dir',
          children: [
            { name: 'db.ts', path: 'src/infra/db.ts', kind: 'file' },
            { name: 'repo.ts', path: 'src/infra/repo.ts', kind: 'file' },
          ],
        },
      ],
    },
    { name: 'tsconfig.json', path: 'tsconfig.json', kind: 'file' },
  ],
};

const FILES: Record<string, string> = {
  'src/domain/shape.ts': 'export interface Shape { draw(): void }\n',
  'src/domain/model.ts': 'export interface Model { id: number }\n',
};

const INFRA_DETAIL = {
  id: 'src/infra',
  name: 'infra',
  path: 'src/infra',
  kind: 'package',
  files: 2,
  imports: [{ id: 'src/domain', name: 'domain', kind: 'package', runtime: 2, type: 0, heritage: 1 }],
  importedBy: [{ id: 'src/app', name: 'app', kind: 'package', runtime: 2, type: 1, heritage: 0 }],
};

const INFRA_EXT_DETAIL = {
  ...INFRA_DETAIL,
  imports: [
    { id: 'src/domain', name: 'domain', kind: 'package', runtime: 2, type: 0, heritage: 1 },
    { id: 'node:fs', name: 'node:fs', kind: 'external', runtime: 1, type: 0, heritage: 0 },
    { id: 'react', name: 'react', kind: 'external', runtime: 1, type: 0, heritage: 0 },
  ],
};

const DOMAIN_DETAIL = {
  id: 'src/domain',
  name: 'domain',
  path: 'src/domain',
  kind: 'package',
  files: 2,
  abstract: true,
  imports: [],
  importedBy: [
    { id: 'src/app', name: 'app', kind: 'package', runtime: 0, type: 1, heritage: 0 },
    { id: 'src/infra', name: 'infra', kind: 'package', runtime: 2, type: 0, heritage: 1 },
  ],
};

const A_DETAIL = {
  id: 'src/app/a.ts',
  name: 'a.ts',
  path: 'src/app/a.ts',
  kind: 'file',
  imports: [
    { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    { id: 'src/domain/model.ts', name: 'model.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
    { id: 'src/infra/db.ts', name: 'db.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    { id: 'src/infra/repo.ts', name: 'repo.ts', kind: 'file', runtime: 0, type: 1, heritage: 0 },
  ],
  importedBy: [{ id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
};

const A_TESTS_DETAIL = {
  ...A_DETAIL,
  importedBy: [
    { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    { id: 'src/app/a.test.ts', name: 'a.test.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
  ],
};

const DB_DETAIL = {
  id: 'src/infra/db.ts',
  name: 'db.ts',
  path: 'src/infra/db.ts',
  kind: 'file',
  imports: [{ id: 'src/domain/model.ts', name: 'model.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
  importedBy: [
    { id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
    { id: 'src/app/b.ts', name: 'b.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 },
  ],
};

const SHAPE_DETAIL = {
  id: 'src/domain/shape.ts',
  name: 'shape.ts',
  path: 'src/domain/shape.ts',
  kind: 'file',
  abstract: true,
  imports: [],
  importedBy: [{ id: 'src/infra/repo.ts', name: 'repo.ts', kind: 'file', runtime: 1, type: 0, heritage: 1 }],
};

const FS_DETAIL = {
  id: 'node:fs',
  name: 'node:fs',
  path: 'node:fs',
  kind: 'external',
  imports: [],
  importedBy: [{ id: 'src/infra', name: 'infra', kind: 'package', runtime: 1, type: 0, heritage: 0 }],
};

const REACT_DETAIL = { ...FS_DETAIL, id: 'react', name: 'react', path: 'react' };

const TEST_DETAIL = {
  id: 'src/app/a.test.ts',
  name: 'a.test.ts',
  path: 'src/app/a.test.ts',
  kind: 'file',
  imports: [{ id: 'src/app/a.ts', name: 'a.ts', kind: 'file', runtime: 1, type: 0, heritage: 0 }],
  importedBy: [],
};

const DETAILS: Record<string, unknown> = {
  'src/infra|src|0|0': INFRA_DETAIL,
  'src/domain|src|0|0': DOMAIN_DETAIL,
  'src/app/a.ts|src/app|0|0': A_DETAIL,
  'src/app/a.ts|src/app|1|0': A_TESTS_DETAIL,
  'src/infra/db.ts|src/infra|0|0': DB_DETAIL,
  'src/domain/shape.ts|src/domain|0|0': SHAPE_DETAIL,
  'src/infra|src|0|1': INFRA_EXT_DETAIL,
  'node:fs|src|0|1': FS_DETAIL,
  'react|src|0|1': REACT_DETAIL,
  'src/app/a.test.ts|src/app|1|0': TEST_DETAIL,
};

function freshWorld(): World {
  return {
    layout: { version: 1, views: {}, settings: { tests: false, external: false } },
    main: false,
    armMain: false,
    puts: 0,
    gate: null,
    detailGate: null,
    details: [],
    graphs: [],
  };
}

let world = freshWorld();

function ok(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function notOk(body: unknown): Response {
  return { ok: false, json: async () => body } as Response;
}

function flagsOf(url: string): Flags {
  const params = new URL(url, 'http://x').searchParams;
  return { at: params.get('at') ?? '', tests: params.get('tests') === '1', external: params.get('external') === '1' };
}

function retarget(node: GNode, files: number): GNode {
  if (node.id !== 'src/app') return node;
  return { ...node, files };
}

function appFiles(view: GView, files: number): GView {
  return { ...view, nodes: view.nodes.map(node => retarget(node, files)) };
}

function srcExternal(tests: boolean): GView {
  if (tests) return appFiles(SRC_EXT, 3);
  return SRC_EXT;
}

function srcPlain(tests: boolean): GView {
  if (tests) return appFiles(SRC, 3);
  return SRC;
}

function srcFlags(flags: Flags): GView {
  if (flags.external) return srcExternal(flags.tests);
  return srcPlain(flags.tests);
}

function srcView(current: World, flags: Flags): GView {
  if (current.main) return SRC_MAIN;
  return srcFlags(flags);
}

function appView(tests: boolean): GView {
  if (tests) return APP_TESTS;
  return APP;
}

function layeredView(current: World, flags: Flags): GView | undefined {
  if (flags.at === 'src') return srcView(current, flags);
  if (flags.at === 'src/app') return appView(flags.tests);
  return undefined;
}

function kindView(at: string): GView | undefined {
  if (at === 'cyc') return CYC;
  if (at === 'typed') return TYPED;
  if (at === 'gap') return GAP;
  return undefined;
}

function nestedView(flags: Flags): GView | undefined {
  if (flags.at === 'src/domain') return DOMAIN;
  if (flags.at === 'src/infra') return INFRA;
  return kindView(flags.at);
}

function viewFor(current: World, flags: Flags): GView | undefined {
  return layeredView(current, flags) ?? nestedView(flags);
}

function graphResponse(current: World, url: string): Response {
  const view = viewFor(current, flagsOf(url));
  if (view === undefined) return notOk({ error: 'no such directory' });
  return ok(view);
}

function detailKey(url: string): string {
  const params = new URL(url, 'http://x').searchParams;
  const tests = params.get('tests') === '1' ? '1' : '0';
  const external = params.get('external') === '1' ? '1' : '0';
  return `${params.get('id')}|${params.get('at')}|${tests}|${external}`;
}

function detailResponse(url: string): Response {
  const body = DETAILS[detailKey(url)];
  if (body === undefined) return notOk({ error: 'no such node' });
  return ok(body);
}

function fileResponse(url: string): Response {
  const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
  const text = FILES[path];
  if (text === undefined) return notOk({ error: 'no such file' });
  return ok({ path, text });
}

function put(current: World, body: BodyInit | null | undefined): Response {
  if (typeof body !== 'string') return notOk({ error: 'bad layout' });
  current.layout = JSON.parse(body) as LayoutDoc;
  current.puts += 1;
  return ok(current.layout);
}

function rescan(current: World): Response {
  if (current.armMain) current.main = true;
  const files = current.main ? 8 : 7;
  return ok({ files, ms: 4 });
}

function getApi(current: World, path: string, url: string): Response | undefined {
  if (path === '/api/layout') return ok(current.layout);
  if (path === '/api/tree') return ok(TREE);
  if (path === '/api/graph') return graphResponse(current, url);
  return undefined;
}

function getRest(path: string, url: string): Response {
  if (path === '/api/detail') return detailResponse(url);
  if (path === '/api/file') return fileResponse(url);
  return notOk({ error: 'not found' });
}

function pathOfUrl(url: string): string {
  return url.split('?')[0] ?? url;
}

function methodOf(init: RequestInit | undefined): string {
  return init?.method ?? 'GET';
}

function isPut(method: string, path: string): boolean {
  return method === 'PUT' && path === '/api/layout';
}

function isRescan(method: string, path: string): boolean {
  return method === 'POST' && path === '/api/rescan';
}

function written(current: World, method: string, path: string, body: BodyInit | null | undefined): Response | undefined {
  if (isPut(method, path)) return put(current, body);
  if (isRescan(method, path)) return rescan(current);
  return undefined;
}

function read(current: World, path: string, url: string): Response {
  return getApi(current, path, url) ?? getRest(path, url);
}

function answer(current: World, url: string, init?: RequestInit): Response {
  const path = pathOfUrl(url);
  return written(current, methodOf(init), path, init?.body) ?? read(current, path, url);
}

function layoutHold(current: World, path: string, method: string): Promise<void> | null {
  if (path !== '/api/layout') return null;
  if (method !== 'GET') return null;
  return current.gate;
}

async function releaseLayout(current: World, path: string, method: string): Promise<void> {
  const pending = layoutHold(current, path, method);
  if (pending !== null) await pending;
}

function heldDetail(current: World, path: string): Promise<void> | null {
  if (current.detailGate === null) return null;
  if (path !== '/api/detail') return null;
  return current.detailGate;
}

async function releaseDetail(current: World, path: string): Promise<void> {
  const pending = heldDetail(current, path);
  if (pending !== null) await pending;
}

function pageFetcher(): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const text = String(url);
    const path = pathOfUrl(text);
    if (path === '/api/detail') world.details.push(text);
    if (path === '/api/graph') world.graphs.push(text);
    await releaseLayout(world, path, methodOf(init));
    await releaseDetail(world, path);
    return answer(world, text, init);
  }) as typeof fetch;
}

function installDom(url: string): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const w = dom.window;
  const style = w.document.createElement('style');
  style.textContent = sheet;
  w.document.head.appendChild(style);
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('box') ? 40 : 0;
    },
  });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('box')) return 0;
      if (this.dataset.id === 'src/domain') return 80;
      return 120;
    },
  });
  Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: w.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { value: w.HTMLButtonElement, configurable: true });
  Object.defineProperty(globalThis, 'HTMLInputElement', { value: w.HTMLInputElement, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: w.Node, configurable: true });
  Object.defineProperty(globalThis, 'DocumentFragment', { value: w.DocumentFragment, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: w.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: w.getComputedStyle.bind(w), configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, writable: true, configurable: true });
  return dom;
}

function nodeEls(): HTMLElement[] {
  return [...document.querySelectorAll('.fake-node')] as HTMLElement[];
}

function nodeById(id: string): HTMLElement {
  const el = nodeEls().find(node => node.dataset.node === id);
  if (el === undefined) throw new Error(`missing node ${id}`);
  return el;
}

function idNamed(name: string): string {
  const node = nodeEls().find(el => el.querySelector('.box-name')?.textContent === name);
  if (node === undefined) throw new Error(name);
  return node.dataset.node ?? '';
}

function boxOf(id: string): HTMLElement {
  const el = nodeById(id).querySelector('.box');
  if (!(el instanceof HTMLElement)) throw new Error(id);
  return el;
}

function namedBox(name: string): HTMLElement {
  return boxOf(idNamed(name));
}

function edgeEls(): HTMLElement[] {
  return [...document.querySelectorAll('g[data-from]')] as HTMLElement[];
}

function edgeBetween(from: string, to: string): HTMLElement {
  const el = edgeEls().find(edge => edge.dataset.from === from && edge.dataset.to === to);
  if (el === undefined) throw new Error(`${from}->${to}`);
  return el;
}

function arrowNamed(from: string, to: string): HTMLElement {
  return edgeBetween(idNamed(from), idNamed(to));
}

function pathOf(from: string, to: string): HTMLElement {
  const el = document.querySelector(`.fake-edge-path[data-edge="${from}->${to}"]`);
  if (el === null) throw new Error(`path ${from}`);
  return el as HTMLElement;
}

function panel(): HTMLElement {
  const el = document.querySelector('aside[aria-label="details"]');
  if (!(el instanceof HTMLElement)) throw new Error('missing panel');
  return el;
}

function sectionOf(title: string): HTMLElement {
  const found = [...panel().querySelectorAll('section')].find(el => el.querySelector('h3')?.textContent === title);
  if (!(found instanceof HTMLElement)) throw new Error(title);
  return found;
}

function entryButton(title: string, name: string): HTMLButtonElement {
  const button = [...sectionOf(title).querySelectorAll('button')].find(el => el.textContent?.startsWith(`${name} `));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${title} ${name}`);
  return button;
}

function fileCount(): string | undefined {
  return [...panel().querySelectorAll('p')].map(el => el.textContent ?? '').find(text => /^\d+ files?$/.test(text));
}

function hasWord(text: string): boolean {
  return [...panel().querySelectorAll('p')].some(el => el.textContent === text);
}

function crumbNamed(name: string): HTMLButtonElement {
  const nav = document.querySelector('nav[aria-label="breadcrumb"]');
  const button = [...(nav?.querySelectorAll('button') ?? [])].find(el => el.textContent === name);
  if (!(button instanceof HTMLButtonElement)) throw new Error(name);
  return button;
}

function labelled(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find(el => el.textContent === text);
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(text);
  return input;
}

function tabNamed(name: string): HTMLButtonElement {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === name);
  if (!(tab instanceof HTMLButtonElement)) throw new Error(name);
  return tab;
}

function centers(): { x: number; y: number }[] {
  const list = (globalThis as { kindsFlowCenters?: { x: number; y: number }[] }).kindsFlowCenters;
  if (list === undefined) throw new Error('centers');
  return list;
}

function arm(shift: { x: number; y: number }): void {
  const drop = (globalThis as { kindsArmDrop?: (value: { x: number; y: number } | null) => void }).kindsArmDrop;
  if (drop === undefined) throw new Error('drop');
  drop(shift);
}

function childText(node: Element, selector: string): string | null {
  const found = node.querySelector(selector);
  if (found === null) return null;
  return found.textContent;
}

function docText(selector: string): string | null {
  const found = document.querySelector(selector);
  if (found === null) return null;
  return found.textContent;
}

function docAttr(selector: string, name: string): string | null {
  const found = document.querySelector(selector);
  if (found === null) return null;
  return found.getAttribute(name);
}

function flowEl(): HTMLElement {
  const flow = document.querySelector('.fake-flow');
  if (!(flow instanceof HTMLElement)) throw new Error('flow');
  return flow;
}

function yOf(name: string): number {
  return Number(namedBox(name).dataset.y);
}

function xOf(name: string): number {
  return Number(namedBox(name).dataset.x);
}

async function press(el: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function pointAt(name: string, over: boolean): Promise<void> {
  const box = namedBox(name);
  await act(async () => {
    if (over) fireEvent.mouseOver(box);
    else fireEvent.mouseOut(box);
  });
}

async function flip(label: string): Promise<void> {
  await press(labelled(label));
}

async function dropBox(name: string): Promise<void> {
  await act(async () => {
    fireEvent.mouseUp(nodeById(idNamed(name)), { altKey: true });
  });
}

async function panCanvas(): Promise<void> {
  const flow = flowEl();
  await act(async () => {
    fireEvent.mouseDown(flow, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(flow, { clientX: 24, clientY: 10 });
    fireEvent.mouseUp(flow);
  });
}

async function seeHeading(text: string): Promise<void> {
  await waitFor(() => {
    expect(panel().querySelector('h2')?.textContent).toBe(text);
  });
}

async function seeNode(name: string): Promise<void> {
  await waitFor(() => {
    expect(idNamed(name)).not.toBe('');
  });
}

const heightTimers: unknown[] = [];
const clearedTimers: unknown[] = [];

function spyHeightTimer(): void {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, delay, ...args) => {
    const id = originalSet(fn, delay, ...args);
    if ((new Error().stack ?? '').includes('watchBoxes')) heightTimers.push(id);
    return id;
  });
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(id => {
    clearedTimers.push(id);
    originalClear(id);
  });
}

describe('Architecture kinds, pins and toggles', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(async () => {
    heightTimers.length = 0;
    clearedTimers.length = 0;
    spyHeightTimer();
    await import('@xyflow/react');
    world = freshWorld();
    centers().length = 0;
    dom = installDom('http://127.0.0.1:4800/?token=tok#at=src');
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function remount(url: string): Promise<void> {
    const wasMounted = document.querySelector('.arch-canvas') !== null;
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    await act(async () => {
      root.unmount();
    });
    if (wasMounted) {
      expect(disconnect).toHaveBeenCalled();
      expect(heightTimers.some(id => clearedTimers.includes(id))).toBe(true);
    }
    disconnect.mockRestore();
    dom.window.close();
    dom = installDom(url);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  }

  async function render(): Promise<void> {
    const { App } = await import('./App.tsx');
    const { takeToken } = await import('./client.ts');
    expect(takeToken(window.location, window.sessionStorage, window.history)).toBe('tok');
    await act(async () => {
      root.render(createElement(App, { token: 'tok', location: window.location, historyApi: window.history, fetcher: pageFetcher() }));
    });
  }

  async function openHash(hash: string): Promise<void> {
    await remount(`http://127.0.0.1:4800/?token=tok${hash}`);
    await render();
    await waitFor(() => {
      expect(document.querySelector('.fake-flow')).not.toBeNull();
    });
  }

  it('The src view shows green, a hollow head, a solid mix and a dashed arrow', async () => {
    await openHash('#at=src');
    expect(tabNamed('Architecture').getAttribute('aria-selected')).toBe('true');
    expect(docText('nav[aria-label="breadcrumb"]')).toBe('layered / src');
    expect(yOf('app')).toBeLessThan(yOf('infra'));
    expect(yOf('infra')).toBeLessThan(yOf('domain'));
    expect(namedBox('domain').dataset.abstract).toBe('true');
    expect(window.getComputedStyle(namedBox('domain')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(window.getComputedStyle(namedBox('domain')).borderTopColor).toBe('rgb(21, 128, 61)');
    expect(window.getComputedStyle(namedBox('domain'), '::before').backgroundColor).toBe('rgb(220, 252, 231)');
    expect(window.getComputedStyle(namedBox('domain'), '::before').borderTopColor).toBe('rgb(21, 128, 61)');
    expect(window.getComputedStyle(namedBox('app')).backgroundColor).not.toBe('rgb(220, 252, 231)');
    expect(window.getComputedStyle(namedBox('infra')).backgroundColor).not.toBe('rgb(220, 252, 231)');
    expect(labelled('Tests').checked).toBe(false);
    expect(labelled('External packages').checked).toBe(false);
    const mix = arrowNamed('app', 'infra');
    expect(mix.dataset.line).toBe('solid');
    expect(mix.dataset.head).toBe('filled');
    expect(childText(mix, '.arrow-label')).toBe('3');
    expect(childText(mix, 'title')).toBe('2 runtime · 1 type-only · 0 extends/implements');
    expect(pathOf(idNamed('app'), idNamed('infra')).dataset.marker).toContain('arrowclosed');
    const dashed = arrowNamed('app', 'domain');
    expect(dashed.dataset.line).toBe('dashed');
    expect(dashed.dataset.head).toBe('filled');
    expect(dashed.querySelector('.arrow-label')).toBeNull();
    expect(childText(dashed, 'title')).toBe('0 runtime · 1 type-only · 0 extends/implements');
    const hollow = arrowNamed('infra', 'domain');
    expect(hollow.dataset.line).toBe('solid');
    expect(hollow.dataset.head).toBe('hollow');
    expect(childText(hollow, '.arrow-label')).toBe('2');
    expect(childText(hollow, 'title')).toBe('2 runtime · 0 type-only · 1 extends/implements');
    expect(pathOf(idNamed('infra'), idNamed('domain')).dataset.dash).toBe('');
    expect(pathOf(idNamed('app'), idNamed('domain')).dataset.dash).toBe('6 4');
    expect(pathOf(idNamed('infra'), idNamed('domain')).dataset.marker).toBe('"url(#hollow-64748b)"');
    expect(docAttr('#hollow-64748b path', 'fill')).toBe('none');
    expect(edgeEls().every(edge => edge.dataset.up === 'false')).toBe(true);
    expect(nodeEls().every(node => node.querySelector('.box')?.getAttribute('data-cycle') === 'false')).toBe(true);
    expect(namedBox('domain').offsetHeight).toBeGreaterThanOrEqual(16);
    expect(namedBox('domain').offsetHeight).toBeLessThanOrEqual(200);
  });

  it('Hovering infra dims everything that does not touch it', async () => {
    await openHash('#at=src');
    const href = window.location.href;
    await pointAt('infra', true);
    expect(namedBox('infra').classList.contains('dim')).toBe(false);
    expect(arrowNamed('app', 'infra').classList.contains('dim')).toBe(false);
    expect(arrowNamed('infra', 'domain').classList.contains('dim')).toBe(false);
    expect(namedBox('app').classList.contains('dim')).toBe(true);
    expect(namedBox('domain').classList.contains('dim')).toBe(true);
    expect(arrowNamed('app', 'domain').classList.contains('dim')).toBe(true);
    expect(window.getComputedStyle(namedBox('app')).opacity).toBe('0.25');
    await pointAt('infra', false);
    expect(nodeEls().every(node => node.querySelector('.box')?.classList.contains('dim') === false)).toBe(true);
    expect(edgeEls().every(edge => edge.classList.contains('dim') === false)).toBe(true);
    expect(window.location.href).toBe(href);
  });

  it('Clicking infra opens the panel, and domain in the panel selects that box', async () => {
    await openHash('#at=src');
    const href = window.location.href;
    let releaseDetailGate: () => void = () => undefined;
    world.detailGate = new Promise(resolve => {
      releaseDetailGate = resolve;
    });
    await press(nodeById(idNamed('infra')));
    await waitFor(() => {
      expect(world.details.some(url => new URL(url, 'http://x').searchParams.get('id') === 'src/infra')).toBe(true);
    });
    expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
    releaseDetailGate();
    await seeHeading('infra');
    expect(window.location.href).toBe(href);
    expect(hasWord('src/infra')).toBe(true);
    expect(hasWord('package')).toBe(true);
    expect(fileCount()).toBe('2 files');
    expect(hasWord('abstract')).toBe(false);
    expect(entryButton('Imports', 'domain').textContent).toBe('domain 2 runtime · 0 type-only · 1 extends/implements');
    expect(entryButton('Imported by', 'app').textContent).toBe('app 2 runtime · 1 type-only · 0 extends/implements');
    world.detailGate = new Promise(resolve => {
      releaseDetailGate = resolve;
    });
    await press(entryButton('Imports', 'domain'));
    await waitFor(() => {
      expect(world.details.some(url => new URL(url, 'http://x').searchParams.get('id') === 'src/domain')).toBe(true);
    });
    expect(panel().querySelector('h2')?.textContent).toBe('infra');
    releaseDetailGate();
    await seeHeading('domain');
    expect(namedBox('domain').dataset.selected).toBe('true');
    expect(nodeEls().filter(node => node.querySelector('.box')?.getAttribute('data-selected') === 'true')).toHaveLength(1);
    const box = namedBox('domain');
    expect(centers().at(-1)).toEqual({ x: Number(box.dataset.x) + box.offsetWidth / 2, y: Number(box.dataset.y) + box.offsetHeight / 2 });
    expect(hasWord('abstract')).toBe(true);
    expect(fileCount()).toBe('2 files');
    expect(sectionOf('Imports').querySelectorAll('button')).toHaveLength(0);
    expect(entryButton('Imported by', 'app').textContent).toBe('app 0 runtime · 1 type-only · 0 extends/implements');
    expect(entryButton('Imported by', 'infra').textContent).toBe('infra 2 runtime · 0 type-only · 1 extends/implements');
    await act(async () => {
      fireEvent.doubleClick(nodeById(idNamed('app')));
    });
    await waitFor(() => {
      expect(window.location.href).toBe('http://127.0.0.1:4800/#at=src/app');
    });
    expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
  });

  it("Clicking db.ts in a.ts's panel drills to the infra view", async () => {
    await openHash('#at=src/app');
    await press(nodeById(idNamed('a.ts')));
    await seeHeading('a.ts');
    await press(entryButton('Imports', 'db.ts'));
    await waitFor(() => {
      expect(window.location.href).toBe('http://127.0.0.1:4800/#at=src/infra');
    });
    await seeHeading('db.ts');
    expect(namedBox('db.ts').dataset.selected).toBe('true');
    expect(hasWord('src/infra/db.ts')).toBe(true);
    expect(hasWord('file')).toBe(true);
    expect(fileCount()).toBeUndefined();
    expect(hasWord('abstract')).toBe(false);
    expect(entryButton('Imported by', 'a.ts').textContent).toBe('a.ts 1 runtime · 0 type-only · 0 extends/implements');
    expect(entryButton('Imported by', 'b.ts').textContent).toBe('b.ts 1 runtime · 0 type-only · 0 extends/implements');
    expect(entryButton('Imports', 'model.ts').textContent).toBe('model.ts 1 runtime · 0 type-only · 0 extends/implements');
    await press(crumbNamed('infra'));
    expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
  });

  it('Double-clicking a file still opens it in the Files tab', async () => {
    await openHash('#at=src/domain');
    await press(nodeById(idNamed('shape.ts')));
    await seeHeading('shape.ts');
    expect(hasWord('src/domain/shape.ts')).toBe(true);
    expect(hasWord('file')).toBe(true);
    expect(hasWord('abstract')).toBe(true);
    expect(fileCount()).toBeUndefined();
    expect([...panel().querySelectorAll('p')].map(el => el.textContent)).toEqual(['src/domain/shape.ts', 'file', 'abstract']);
    expect(sectionOf('Imports').querySelectorAll('button')).toHaveLength(0);
    expect(entryButton('Imported by', 'repo.ts').textContent).toBe('repo.ts 1 runtime · 0 type-only · 1 extends/implements');
    await act(async () => {
      fireEvent.doubleClick(nodeById(idNamed('shape.ts')));
    });
    await waitFor(() => {
      expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true');
    });
    expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
    expect(document.querySelector('main header')?.textContent).toBe('src/domain/shape.ts');
    expect(document.querySelector('[data-line="1"]')?.textContent).toBe('1 export interface Shape { draw(): void }');
    expect(window.location.href).toBe('http://127.0.0.1:4800/#file=src/domain/shape.ts');
    expect(document.querySelector('label')).toBeNull();
  });

  it('Dragging the canvas pans, and dropping a box pins only that box', async () => {
    await openHash('#at=src');
    expect(docAttr('.fake-flow', 'data-pan-on-drag')).not.toBe('false');
    const before = nodeEls().map(node => `${node.dataset.node}:${node.dataset.x},${node.dataset.y}`);
    await panCanvas();
    expect(flowEl().style.transform).toBe('translate(24px, 10px)');
    expect(nodeEls().map(node => `${node.dataset.node}:${node.dataset.x},${node.dataset.y}`)).toEqual(before);
    expect(world.puts).toBe(0);
    expect(world.layout).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    arm({ x: 12, y: -80 });
    await dropBox('domain');
    await waitFor(() => {
      expect(yOf('domain')).toBe(-80);
    });
    expect(xOf('domain')).toBe(12);
    expect(yOf('app') - yOf('domain')).toBeGreaterThanOrEqual(namedBox('domain').offsetHeight);
    const upApp = arrowNamed('app', 'domain');
    expect(upApp.dataset.up).toBe('true');
    expect(upApp.dataset.line).toBe('dashed');
    expect(upApp.dataset.head).toBe('filled');
    expect(childText(upApp, 'title')).toBe('points up: app is drawn below domain');
    const upInfra = arrowNamed('infra', 'domain');
    expect(upInfra.dataset.up).toBe('true');
    expect(upInfra.dataset.line).toBe('solid');
    expect(upInfra.dataset.head).toBe('hollow');
    expect(childText(upInfra, '.arrow-label')).toBe('2');
    expect(childText(upInfra, 'title')).toBe('points up: infra is drawn below domain');
    expect(upInfra.classList.contains('up')).toBe(true);
    expect(window.getComputedStyle(upInfra.querySelector('.arrow-label') as Element).fill).toBe('rgb(220, 38, 38)');
    expect(pathOf(idNamed('infra'), idNamed('domain')).dataset.marker).toBe('"url(#hollow-dc2626)"');
    expect(docAttr('#hollow-dc2626 path', 'stroke')).toBe('#dc2626');
    expect(arrowNamed('app', 'infra').dataset.up).toBe('false');
    await waitFor(() => {
      expect(world.layout).toEqual({
        version: 1,
        views: { src: { 'src/domain': { x: 12, y: -80 } } },
        settings: { tests: false, external: false },
      });
    });
  });

  it('A gap of half a box or less does not point up', async () => {
    world.layout = {
      version: 1,
      views: { src: { 'src/app': { x: 0, y: 0 }, 'src/domain': { x: 0, y: -8 } } },
      settings: { tests: false, external: false },
    };
    await openHash('#at=src');
    expect(arrowNamed('app', 'domain').dataset.up).toBe('false');
    expect(arrowNamed('app', 'domain').querySelector('title')?.textContent).toBe('0 runtime · 1 type-only · 0 extends/implements');
    expect(arrowNamed('infra', 'domain').dataset.up).toBe('true');
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('box') ? 12 : 0;
      },
    });
    const canvas = document.querySelector('.arch-canvas');
    if (canvas === null) throw new Error('canvas');
    await act(async () => {
      canvas.appendChild(document.createElement('span'));
    });
    expect(arrowNamed('app', 'domain').dataset.up).toBe('true');
    world.layout = {
      version: 1,
      views: { src: { 'src/app': { x: 0, y: 0 }, 'src/domain': { x: 0, y: -400 } } },
      settings: { tests: false, external: false },
    };
    await openHash('#at=src');
    expect(arrowNamed('app', 'domain').dataset.up).toBe('true');
    expect(arrowNamed('app', 'domain').querySelector('title')?.textContent).toBe('points up: app is drawn below domain');
  });

  it('A cycle arrow that points up says so and stays a cycle', async () => {
    world.layout = {
      version: 1,
      views: { 'src/app': { 'src/app/a.ts': { x: 0, y: -400 } } },
      settings: { tests: false, external: false },
    };
    await openHash('#at=src/app');
    expect(xOf('a.ts')).toBe(0);
    expect(yOf('a.ts')).toBe(-400);
    expect(xOf('b.ts')).toBe(260);
    expect(yOf('b.ts')).toBe(0);
    const up = arrowNamed('b.ts', 'a.ts');
    expect(up.dataset.cycle).toBe('true');
    expect(up.dataset.up).toBe('true');
    expect(up.dataset.line).toBe('solid');
    expect(up.dataset.head).toBe('filled');
    expect(up.querySelector('.arrow-label')).toBeNull();
    expect(up.querySelector('title')?.textContent).toBe('points up: b.ts is drawn below a.ts');
    expect(pathOf(idNamed('b.ts'), idNamed('a.ts')).dataset.stroke).toBe('#dc2626');
    const flat = arrowNamed('a.ts', 'b.ts');
    expect(flat.dataset.cycle).toBe('true');
    expect(flat.dataset.up).toBe('false');
    expect(flat.dataset.line).toBe('solid');
    expect(flat.dataset.head).toBe('filled');
    expect(flat.querySelector('.arrow-label')).toBeNull();
    expect(flat.querySelector('title')?.textContent).toBe('a.ts → b.ts → a.ts');
    expect(namedBox('a.ts').dataset.cycle).toBe('true');
    expect(namedBox('b.ts').dataset.cycle).toBe('true');
  });

  it('The pin survives a new page load, a rescan and a restart, and a token-less refresh still fails', async () => {
    await openHash('#at=src');
    arm({ x: 0, y: -80 });
    await dropBox('domain');
    await waitFor(() => {
      expect(yOf('domain')).toBe(-80);
    });
    await press([...document.querySelectorAll('button')].find(el => el.textContent === 'Rescan') as HTMLElement);
    await waitFor(() => {
      expect(yOf('domain')).toBe(-80);
    });
    expect(yOf('domain')).toBeLessThan(yOf('app'));
    const saved = JSON.parse(JSON.stringify(world.layout)) as LayoutDoc;
    await openHash('#at=src');
    expect(yOf('domain')).toBe(-80);
    expect(yOf('domain')).toBeLessThan(yOf('app'));
    world = freshWorld();
    world.layout = saved;
    await openHash('#at=src');
    expect(yOf('domain')).toBe(-80);
    expect(yOf('domain')).toBeLessThan(yOf('app'));
  });

  it('An edge whose end is not on the canvas does not point up', async () => {
    await openHash('#at=gap');
    const inbound = edgeBetween('missing-from', 'gap/a.ts');
    const outbound = edgeBetween('gap/a.ts', 'missing-to');
    expect(inbound.dataset.up).toBe('false');
    expect(outbound.dataset.up).toBe('false');
    expect(inbound.querySelector('title')?.textContent).toBe('1 runtime · 0 type-only · 0 extends/implements');
    expect(outbound.querySelector('title')?.textContent).toBe('1 runtime · 0 type-only · 0 extends/implements');
  });

  it('Reset layout does nothing while the layout is still loading', async () => {
    let release: () => void = () => undefined;
    world.gate = new Promise(resolve => {
      release = resolve;
    });
    const reported: unknown[] = [];
    const onProcess = (error: unknown): void => {
      reported.push(error);
    };
    process.on('uncaughtException', onProcess);
    await remount('http://127.0.0.1:4800/?token=tok#at=src');
    const onWindow = (event: Event): void => {
      reported.push(event);
      event.preventDefault();
    };
    window.addEventListener('error', onWindow);
    try {
      await render();
      expect(world.graphs).toEqual([]);
      const reset = [...document.querySelectorAll('button')].find(el => el.textContent === 'Reset layout');
      if (!(reset instanceof HTMLElement)) throw new Error('reset');
      await press(reset);
      expect(reported).toEqual([]);
      expect(document.querySelector('.fake-flow')).toBeNull();
      expect(world.puts).toBe(0);
      expect(world.graphs).toEqual([]);
    } finally {
      process.off('uncaughtException', onProcess);
      window.removeEventListener('error', onWindow);
    }
    release();
    await waitFor(() => {
      expect(document.querySelector('.fake-flow')).not.toBeNull();
    });
  });

  it('Clicking the current src crumb closes the infra panel', async () => {
    await openHash('#at=src');
    await press(nodeById(idNamed('infra')));
    await seeHeading('infra');
    await press(crumbNamed('src'));
    expect(window.location.href).toBe('http://127.0.0.1:4800/#at=src');
    expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
  });

  it('Selecting a listed box still selects it when its element has no id', async () => {
    await openHash('#at=src');
    await press(nodeById(idNamed('infra')));
    await seeHeading('infra');
    const box = namedBox('domain');
    const spot = { x: Number(box.dataset.x), y: Number(box.dataset.y) };
    box.removeAttribute('data-id');
    centers().length = 0;
    await press(entryButton('Imports', 'domain'));
    await seeHeading('domain');
    expect(centers().at(-1)).toEqual(spot);
  });

  it("Reset layout clears this view's pins and leaves settings and every other view", async () => {
    world.layout = {
      version: 1,
      views: { src: { 'src/domain': { x: 0, y: -400 } }, 'src/app': { 'src/app/a.ts': { x: 40, y: 10 } } },
      settings: { tests: true, external: false },
    };
    await openHash('#at=src');
    expect(labelled('Tests').checked).toBe(true);
    expect(yOf('domain')).toBeLessThan(yOf('app'));
    await press([...document.querySelectorAll('button')].find(el => el.textContent === 'Reset layout') as HTMLElement);
    await waitFor(() => {
      expect(yOf('domain')).toBe(280);
    });
    expect(yOf('app')).toBeLessThan(yOf('infra'));
    expect(yOf('infra')).toBeLessThan(yOf('domain'));
    expect(edgeEls().every(edge => edge.dataset.up === 'false')).toBe(true);
    expect(labelled('Tests').checked).toBe(true);
    expect(world.layout.views.src).toBeUndefined();
    expect(world.layout.views['src/app']?.['src/app/a.ts']).toEqual({ x: 40, y: 10 });
    expect(world.layout.settings.tests).toBe(true);
    await openHash('#at=src/app');
    expect(xOf('a.ts')).toBe(40);
    expect(yOf('a.ts')).toBe(10);
    expect(labelled('Tests').checked).toBe(true);
  });

  it('A new box that would land on a pinned box steps right', async () => {
    world.main = true;
    world.layout = {
      version: 1,
      views: { src: { 'src/app': { x: 200, y: 100 }, 'src/domain': { x: 260, y: 0 } } },
      settings: { tests: false, external: false },
    };
    await openHash('#at=src');
    expect(xOf('main.ts')).toBe(520);
    expect(yOf('main.ts')).toBe(0);
    expect(xOf('app')).toBe(200);
    expect(yOf('app')).toBe(100);
    expect(xOf('domain')).toBe(260);
    expect(yOf('domain')).toBe(0);
    expect(xOf('infra')).toBe(0);
    expect(yOf('infra')).toBe(280);
    expect(world.puts).toBe(0);
    expect(Object.keys(world.layout.views)).toEqual(['src']);
    expect(Object.keys(world.layout.views.src ?? {})).toEqual(['src/app', 'src/domain']);
    world.layout = { version: 1, views: { src: { 'src/app': { x: 0, y: -8 } } }, settings: { tests: false, external: false } };
    await openHash('#at=src');
    expect(xOf('main.ts')).toBe(0);
    expect(yOf('main.ts')).toBe(0);
    expect(xOf('app')).toBe(0);
    expect(yOf('app')).toBe(-8);
  });

  it('An external that appears on a pin steps right and the pin is not rewritten', async () => {
    const saved = {
      version: 1 as const,
      views: { src: { 'src/domain': { x: 260, y: 420 } } },
      settings: { tests: false, external: true },
    };
    world.layout = saved;
    await openHash('#at=src');
    expect(labelled('External packages').checked).toBe(true);
    expect(labelled('Tests').checked).toBe(false);
    expect(xOf('app')).toBe(0);
    expect(yOf('app')).toBe(0);
    expect(xOf('infra')).toBe(0);
    expect(yOf('infra')).toBe(140);
    expect(xOf('node:fs')).toBe(0);
    expect(yOf('node:fs')).toBe(420);
    expect(xOf('react')).toBe(520);
    expect(yOf('react')).toBe(420);
    expect(xOf('domain')).toBe(260);
    expect(yOf('domain')).toBe(420);
    expect(world.puts).toBe(0);
    expect(world.layout).toEqual(saved);
  });

  it('A pin for a deleted file is ignored and left in the file', async () => {
    world.layout = {
      version: 1,
      views: { 'src/domain': { 'src/domain/gone.ts': { x: 0, y: 0 } } },
      settings: { tests: false, external: false },
    };
    await openHash('#at=src/domain');
    expect(nodeEls().map(node => node.dataset.node).sort()).toEqual(['src/domain/model.ts', 'src/domain/shape.ts']);
    expect(xOf('model.ts')).toBe(0);
    expect(yOf('model.ts')).toBe(0);
    expect(xOf('shape.ts')).toBe(260);
    expect(yOf('shape.ts')).toBe(0);
    expect(world.layout.views['src/domain']?.['src/domain/gone.ts']).toEqual({ x: 0, y: 0 });
    expect(world.puts).toBe(0);
  });

  it('The Tests checkbox shows a.test.ts and is remembered', async () => {
    await openHash('#at=src/app');
    await flip('Tests');
    await seeNode('a.test.ts');
    expect(yOf('a.test.ts')).toBeLessThan(yOf('a.ts'));
    expect(yOf('a.test.ts')).toBeLessThan(yOf('b.ts'));
    expect(namedBox('a.test.ts').querySelector('.box-tag')?.textContent).toBe('test');
    const arrow = arrowNamed('a.test.ts', 'a.ts');
    expect(arrow.dataset.line).toBe('solid');
    expect(arrow.dataset.head).toBe('filled');
    expect(arrow.querySelector('.arrow-label')).toBeNull();
    expect(arrow.querySelector('title')?.textContent).toBe('1 runtime · 0 type-only · 0 extends/implements');
    expect(world.layout.settings.tests).toBe(true);
    await press(nodeById(idNamed('a.ts')));
    await seeHeading('a.ts');
    expect(entryButton('Imported by', 'a.test.ts').textContent).toBe('a.test.ts 1 runtime · 0 type-only · 0 extends/implements');
    expect(entryButton('Imported by', 'b.ts').textContent).toBe('b.ts 1 runtime · 0 type-only · 0 extends/implements');
    expect(sectionOf('Imported by').querySelectorAll('button')).toHaveLength(2);
    await press(nodeById(idNamed('a.test.ts')));
    await seeHeading('a.test.ts');
    expect(entryButton('Imports', 'a.ts').textContent).toBe('a.ts 1 runtime · 0 type-only · 0 extends/implements');
    expect(sectionOf('Imported by').querySelectorAll('button')).toHaveLength(0);
    await openHash('#at=src/app');
    expect(labelled('Tests').checked).toBe(true);
    expect(idNamed('a.test.ts')).toBe('src/app/a.test.ts');
    await flip('Tests');
    await waitFor(() => {
      expect(document.body.textContent).not.toContain('a.test.ts');
      expect(yOf('a.ts')).toBe(yOf('b.ts'));
    });
  });

  it('The External packages checkbox shows node:fs and react on one row', async () => {
    await openHash('#at=src');
    expect(labelled('Tests').checked).toBe(false);
    expect(labelled('External packages').checked).toBe(false);
    await flip('External packages');
    await seeNode('node:fs');
    await seeNode('react');
    expect(yOf('node:fs')).toBe(yOf('react'));
    expect(yOf('node:fs')).toBeGreaterThan(yOf('domain'));
    expect(xOf('node:fs')).toBeLessThan(xOf('react'));
    expect(window.getComputedStyle(namedBox('node:fs')).borderTopStyle).toBe('dashed');
    expect(window.getComputedStyle(namedBox('react')).borderTopStyle).toBe('dashed');
    const fs = arrowNamed('infra', 'node:fs');
    const react = arrowNamed('infra', 'react');
    expect(fs.dataset.line).toBe('solid');
    expect(fs.dataset.head).toBe('filled');
    expect(fs.querySelector('.arrow-label')).toBeNull();
    expect(fs.querySelector('title')?.textContent).toBe('1 runtime · 0 type-only · 0 extends/implements');
    expect(react.dataset.line).toBe('solid');
    expect(react.dataset.head).toBe('filled');
    expect(react.querySelector('.arrow-label')).toBeNull();
    expect(react.querySelector('title')?.textContent).toBe('1 runtime · 0 type-only · 0 extends/implements');
    expect(yOf('app')).toBeLessThan(yOf('infra'));
    expect(yOf('infra')).toBeLessThan(yOf('domain'));
    expect(window.getComputedStyle(namedBox('domain')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(world.layout.settings).toEqual({ tests: false, external: true });
    await openHash('#at=src');
    expect(labelled('External packages').checked).toBe(true);
    expect(xOf('node:fs')).toBeLessThan(xOf('react'));
    expect(yOf('node:fs')).toBeGreaterThan(yOf('domain'));
    await press(nodeById(idNamed('infra')));
    await seeHeading('infra');
    expect(entryButton('Imports', 'domain').textContent).toBe('domain 2 runtime · 0 type-only · 1 extends/implements');
    expect(entryButton('Imports', 'node:fs').textContent).toBe('node:fs 1 runtime · 0 type-only · 0 extends/implements');
    expect(entryButton('Imports', 'react').textContent).toBe('react 1 runtime · 0 type-only · 0 extends/implements');
    expect(sectionOf('Imports').querySelectorAll('button')).toHaveLength(3);
    await press(nodeById(idNamed('node:fs')));
    await seeHeading('node:fs');
    expect(hasWord('node:fs')).toBe(true);
    expect(hasWord('external')).toBe(true);
    expect(fileCount()).toBeUndefined();
    expect(entryButton('Imported by', 'infra').textContent).toBe('infra 1 runtime · 0 type-only · 0 extends/implements');
    expect(sectionOf('Imports').querySelectorAll('button')).toHaveLength(0);
    await press(nodeById(idNamed('react')));
    await seeHeading('react');
    expect(hasWord('react')).toBe(true);
    expect(hasWord('external')).toBe(true);
    expect(fileCount()).toBeUndefined();
    expect(entryButton('Imported by', 'infra').textContent).toBe('infra 1 runtime · 0 type-only · 0 extends/implements');
    expect(sectionOf('Imports').querySelectorAll('button')).toHaveLength(0);
    const opened = window.location.href;
    await act(async () => {
      fireEvent.doubleClick(nodeById(idNamed('node:fs')));
    });
    expect(window.location.href).toBe(opened);
    expect(tabNamed('Architecture').getAttribute('aria-selected')).toBe('true');
    await flip('External packages');
    await waitFor(() => {
      expect(document.querySelector('aside[aria-label="details"]')).toBeNull();
    });
    expect(document.body.textContent).not.toContain('node:fs');
    expect(document.body.textContent).not.toContain('react');
  });

  it('Both checkboxes on show the external row and the test file', async () => {
    await openHash('#at=src');
    await flip('Tests');
    await waitFor(() => {
      expect(world.layout.settings.tests).toBe(true);
    });
    await flip('External packages');
    await seeNode('node:fs');
    expect(yOf('node:fs')).toBe(yOf('react'));
    expect(yOf('node:fs')).toBeGreaterThan(yOf('domain'));
    expect(xOf('node:fs')).toBeLessThan(xOf('react'));
    expect(yOf('app')).toBeLessThan(yOf('infra'));
    expect(yOf('infra')).toBeLessThan(yOf('domain'));
    expect(world.layout.settings).toEqual({ tests: true, external: true });
    await act(async () => {
      fireEvent.doubleClick(nodeById(idNamed('app')));
    });
    await seeNode('a.test.ts');
    expect(namedBox('a.test.ts').querySelector('.box-tag')?.textContent).toBe('test');
    expect(labelled('Tests').checked).toBe(true);
    expect(labelled('External packages').checked).toBe(true);
  });

  it('A cycle of abstract files is drawn red, and the cycle tooltip stays the cycle text', async () => {
    await openHash('#at=cyc');
    expect(namedBox('a.ts').dataset.abstract).toBe('true');
    expect(namedBox('a.ts').dataset.cycle).toBe('true');
    expect(namedBox('b.ts').dataset.abstract).toBe('true');
    expect(namedBox('b.ts').dataset.cycle).toBe('true');
    expect(window.getComputedStyle(namedBox('a.ts')).backgroundColor).toBe('rgb(254, 226, 226)');
    expect(window.getComputedStyle(namedBox('b.ts')).backgroundColor).toBe('rgb(254, 226, 226)');
    expect(window.getComputedStyle(namedBox('a.ts')).backgroundColor).not.toBe('rgb(220, 252, 231)');
    const ab = arrowNamed('a.ts', 'b.ts');
    const ba = arrowNamed('b.ts', 'a.ts');
    expect(ab.dataset.cycle).toBe('true');
    expect(ab.dataset.up).toBe('false');
    expect(ab.dataset.line).toBe('dashed');
    expect(ab.dataset.head).toBe('filled');
    expect(ab.querySelector('.arrow-label')).toBeNull();
    expect(ab.querySelector('title')?.textContent).toBe('a.ts → b.ts → a.ts');
    expect(ba.dataset.cycle).toBe('true');
    expect(ba.dataset.up).toBe('false');
    expect(ba.dataset.line).toBe('dashed');
    expect(ba.dataset.head).toBe('filled');
    expect(ba.querySelector('.arrow-label')).toBeNull();
    expect(ba.querySelector('title')?.textContent).toBe('b.ts → a.ts → b.ts');
    expect(pathOf(idNamed('a.ts'), idNamed('b.ts')).dataset.stroke).toBe('#dc2626');
    expect(pathOf(idNamed('a.ts'), idNamed('b.ts')).dataset.dash).toBe('6 4');
  });

  it('A type-only heritage arrow is dashed and hollow', async () => {
    await openHash('#at=typed');
    const arrow = arrowNamed('repo.ts', 'shape.ts');
    expect(arrow.dataset.line).toBe('dashed');
    expect(arrow.dataset.head).toBe('hollow');
    expect(arrow.dataset.up).toBe('false');
    expect(arrow.querySelector('title')?.textContent).toBe('0 runtime · 1 type-only · 1 extends/implements');
    expect(window.getComputedStyle(namedBox('shape.ts')).backgroundColor).toBe('rgb(220, 252, 231)');
    expect(window.getComputedStyle(namedBox('repo.ts')).backgroundColor).not.toBe('rgb(220, 252, 231)');
  });

  it('hides a detail that failed to load', async () => {
    const { DetailSlot } = await import('./DetailPanel.tsx');
    await act(async () => {
      root.render(createElement(DetailSlot, { data: undefined, onPick: () => undefined }));
    });
    expect(document.querySelector('aside')).toBeNull();
    await act(async () => {
      root.render(createElement(DetailSlot, { data: { error: 'no such node' }, onPick: () => undefined }));
    });
    expect(document.querySelector('aside')).toBeNull();
  });
});
