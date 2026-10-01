import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BaseEdge,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Crumb, GraphNode, GraphView, NodeDetail, ViewEdge } from '../domain/graph.ts';
import {
  arrange,
  pointsUp,
  type LayerNode,
  type LayoutDoc,
  type Pin,
  type PlacedBox,
  withPin,
  withoutView,
  withSettings,
} from '../domain/layout.ts';
import { fetchDetail, fetchGraph, fetchLayout, postRescan, putLayout, type GraphQuery } from './client.ts';
import { DetailSlot } from './DetailPanel.tsx';
import {
  arrowColor,
  boxCenter,
  chosenId,
  edgeLabel,
  edgeTitle,
  filesLabel,
  headOf,
  lineOf,
  parentDir,
} from './draw.ts';
import { graphStateOf, type GraphState } from './view.ts';

type BoxKind = 'package' | 'file' | 'external';

type BoxData = {
  name: string;
  kind: BoxKind;
  count: string | null;
  cycle: boolean;
  abstract: boolean;
  test: boolean;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  onHover: (id: string | null) => void;
};

type BoxNode = Node<BoxData, 'box'>;

type ArrowData = {
  cycle: boolean;
  up: boolean;
  line: 'solid' | 'dashed';
  head: 'filled' | 'hollow';
  title: string;
  label: string | null;
  color: string;
  dimmed: boolean;
};

type ArrowEdge = Edge<ArrowData, 'arrow'>;

type MarkerEnd = string | { type: MarkerType; width: number; height: number; color: string };

export type ArchViewProps = {
  token: string;
  at: string;
  fetcher: typeof fetch;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
};

const EMPTY_PINS: Record<string, Pin> = {};

function boolAttr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function readBoxHeight(): number {
  const box = document.querySelector('.arch-canvas .box');
  if (!(box instanceof HTMLElement)) return 0;
  return box.offsetHeight;
}

function watchBoxes(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setTimeout(onStoreChange, 0);
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}

function useBoxHeight(): number {
  return useSyncExternalStore(watchBoxes, readBoxHeight, readBoxHeight);
}

function pushFlag(parts: string[], flag: boolean, name: string): void {
  if (flag) parts.push(name);
}

function boxClass(data: BoxData): string {
  const parts = ['box', data.kind, 'nopan'];
  pushFlag(parts, data.cycle, 'cycle');
  pushFlag(parts, data.abstract, 'abstract');
  pushFlag(parts, data.dimmed, 'dim');
  return parts.join(' ');
}

function BoxCount({ text }: Readonly<{ text: string | null }>) {
  if (text === null) return null;
  return <span className="box-count">{text}</span>;
}

function TestTag({ show }: Readonly<{ show: boolean }>) {
  if (!show) return null;
  return <span className="box-tag">test</span>;
}

function Box({ id, data }: NodeProps<BoxNode>) {
  return (
    <div
      className={boxClass(data)}
      data-id={id}
      data-x={data.x}
      data-y={data.y}
      data-cycle={boolAttr(data.cycle)}
      data-abstract={boolAttr(data.abstract)}
      data-selected={boolAttr(data.selected)}
      onMouseEnter={() => data.onHover(id)}
      onMouseLeave={() => data.onHover(null)}
    >
      <Handle type="target" position={Position.Top} />
      <span className="box-name">{data.name}</span>
      <BoxCount text={data.count} />
      <TestTag show={data.test} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function arrowClass(data: ArrowData): string {
  const parts = ['arrow'];
  pushFlag(parts, data.cycle, 'cycle');
  pushFlag(parts, data.up, 'up');
  pushFlag(parts, data.dimmed, 'dim');
  return parts.join(' ');
}

function arrowStyle(data: ArrowData): { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  const strokeWidth = data.cycle ? 2 : 1.5;
  if (data.line === 'solid') return { stroke: data.color, strokeWidth };
  return { stroke: data.color, strokeWidth, strokeDasharray: '6 4' };
}

function ArrowLabel({ label, x, y }: Readonly<{ label: string | null; x: number; y: number }>) {
  if (label === null) return null;
  return (
    <text x={x} y={y} className="arrow-label" textAnchor="middle">
      {label}
    </text>
  );
}

function Arrow(props: EdgeProps<ArrowEdge>) {
  const data = props.data;
  if (data === undefined) return null;
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <g
      className={arrowClass(data)}
      data-cycle={boolAttr(data.cycle)}
      data-up={boolAttr(data.up)}
      data-line={data.line}
      data-head={data.head}
      data-from={props.source}
      data-to={props.target}
    >
      <title>{data.title}</title>
      <BaseEdge id={props.id} path={path} style={arrowStyle(data)} markerEnd={props.markerEnd} />
      <ArrowLabel label={data.label} x={labelX} y={labelY} />
    </g>
  );
}

function HollowMarker({ color }: Readonly<{ color: string }>) {
  return (
    <marker id={`hollow-${color.slice(1)}`} viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto">
      <path d="M 0 0 L 14 7 L 0 14 Z" fill="none" stroke={color} />
    </marker>
  );
}

function MarkerSvg() {
  return (
    <svg className="marker-defs">
      <HollowMarker color="#64748b" />
      <HollowMarker color="#dc2626" />
    </svg>
  );
}

const nodeTypes = { box: Box };
const edgeTypes = { arrow: Arrow };

function isAbstract(node: GraphNode): boolean {
  return node.kind !== 'external' && node.abstract === true;
}

function isTestNode(node: GraphNode): boolean {
  return node.kind === 'file' && node.test === true;
}

function countOf(node: GraphNode): string | null {
  if (node.kind !== 'package') return null;
  return filesLabel(node.files);
}

function toBox(node: GraphNode, spot: PlacedBox, hover: string | null, chosen: string | null, onHover: (id: string | null) => void): BoxNode {
  return {
    id: node.id,
    type: 'box',
    position: { x: spot.x, y: spot.y },
    data: {
      name: node.name,
      kind: node.kind,
      count: countOf(node),
      cycle: node.cycle,
      abstract: isAbstract(node),
      test: isTestNode(node),
      x: spot.x,
      y: spot.y,
      selected: node.id === chosen,
      dimmed: hover !== null && hover !== node.id,
      onHover,
    },
    draggable: true,
  };
}

function zipBoxes(nodes: GraphNode[], spots: PlacedBox[], hover: string | null, chosen: string | null, onHover: (id: string | null) => void): BoxNode[] {
  return nodes.map((node, index) => toBox(node, spots[index], hover, chosen, onHover));
}

function layerOf(node: GraphNode): LayerNode {
  return { id: node.id, row: node.row, order: node.order };
}

function spotsOf(state: GraphState, pins: Record<string, Pin>): PlacedBox[] {
  if (state.kind !== 'ok') return [];
  return arrange(state.view.nodes.map(layerOf), pins);
}

function movedUp(from: PlacedBox | undefined, to: PlacedBox | undefined, height: number): boolean {
  if (from === undefined) return false;
  if (to === undefined) return false;
  return pointsUp(from.y, to.y, height);
}

function lookupName(names: Map<string, string>, id: string): string {
  return names.get(id) ?? id;
}

function heritageOf(edge: ViewEdge): number {
  return edge.heritage ?? 0;
}

function arrowDimmed(from: string, to: string, hover: string | null): boolean {
  if (hover === null) return false;
  return from !== hover && to !== hover;
}

function markerFor(head: 'filled' | 'hollow', color: string): MarkerEnd {
  if (head === 'hollow') return `url(#hollow-${color.slice(1)})`;
  return { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
}

function arrowData(edge: ViewEdge, up: boolean, hover: string | null, names: Map<string, string>): ArrowData {
  const heritage = heritageOf(edge);
  const fromName = lookupName(names, edge.from);
  const toName = lookupName(names, edge.to);
  return {
    cycle: edge.cycle,
    up,
    line: lineOf(edge.runtime),
    head: headOf(heritage),
    title: edgeTitle(up, fromName, toName, edge.cycleText, edge.runtime, edge.type, heritage),
    label: edgeLabel(edge.runtime, edge.type),
    color: arrowColor(edge.cycle || up),
    dimmed: arrowDimmed(edge.from, edge.to, hover),
  };
}

function toArrow(edge: ViewEdge, spots: Map<string, PlacedBox>, names: Map<string, string>, hover: string | null, height: number): ArrowEdge {
  const data = arrowData(edge, movedUp(spots.get(edge.from), spots.get(edge.to), height), hover, names);
  return {
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'arrow',
    data,
    markerEnd: markerFor(data.head, data.color),
  };
}

function namesOf(nodes: GraphNode[]): Map<string, string> {
  return new Map(nodes.map(node => [node.id, node.name]));
}

function spotMap(spots: PlacedBox[]): Map<string, PlacedBox> {
  return new Map(spots.map(spot => [spot.id, spot]));
}

function FlowCanvas(props: Readonly<{
  view: GraphView;
  spots: PlacedBox[];
  hover: string | null;
  chosen: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string, kind: BoxKind) => void;
  onPin: (id: string, x: number, y: number) => void;
}>) {
  const height = useBoxHeight();
  const nodes = useMemo(
    () => zipBoxes(props.view.nodes, props.spots, props.hover, props.chosen, props.onHover),
    [props.view.nodes, props.spots, props.hover, props.chosen, props.onHover],
  );
  const edges = useMemo(
    () => props.view.edges.map(edge => toArrow(edge, spotMap(props.spots), namesOf(props.view.nodes), props.hover, height)),
    [props.view.edges, props.view.nodes, props.spots, props.hover, height],
  );
  return (
    <div className="arch-canvas">
      <MarkerSvg />
      <ReactFlow
        key={`${props.view.at}:${props.view.nodes.length}:${props.view.edges.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        fitView
        onNodeClick={(_event, node) => props.onSelect(node.id)}
        onNodeDoubleClick={(_event, node) => props.onOpen(node.id, node.data.kind)}
        onNodeDragStop={(_event, node) => props.onPin(node.id, node.position.x, node.position.y)}
      />
    </div>
  );
}

function ArchCanvas(props: Readonly<{
  state: GraphState;
  spots: PlacedBox[];
  hover: string | null;
  chosen: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string, kind: BoxKind) => void;
  onPin: (id: string, x: number, y: number) => void;
}>) {
  if (props.state.kind === 'loading') return <div className="arch-canvas">loading…</div>;
  if (props.state.kind === 'message') return <div className="arch-canvas">{props.state.message}</div>;
  return (
    <FlowCanvas
      view={props.state.view}
      spots={props.spots}
      hover={props.hover}
      chosen={props.chosen}
      onHover={props.onHover}
      onSelect={props.onSelect}
      onOpen={props.onOpen}
      onPin={props.onPin}
    />
  );
}

function CrumbButton(props: Readonly<{ crumb: Crumb; separator: boolean; onDrill: (dir: string) => void }>) {
  return (
    <span>
      {props.separator ? ' / ' : null}
      <button type="button" onClick={() => props.onDrill(props.crumb.at)}>
        {props.crumb.name}
      </button>
    </span>
  );
}

function CrumbList(props: Readonly<{ crumbs: Crumb[]; onDrill: (dir: string) => void }>) {
  return (
    <nav aria-label="breadcrumb">
      {props.crumbs.map((crumb, index) => (
        <CrumbButton key={crumb.at} crumb={crumb} separator={index > 0} onDrill={props.onDrill} />
      ))}
    </nav>
  );
}

function crumbsOf(state: GraphState): Crumb[] {
  return state.kind === 'ok' ? state.view.crumbs : [];
}

function FlagBox(props: Readonly<{ label: string; checked: boolean; onCheck: (checked: boolean) => void }>) {
  return (
    <label>
      <input type="checkbox" checked={props.checked} onChange={event => props.onCheck(event.currentTarget.checked)} />
      {props.label}
    </label>
  );
}

function MaybePanel(props: Readonly<{ chosen: string | null; data: NodeDetail | { error: string } | undefined; onPick: (id: string) => void }>) {
  if (props.chosen === null) return null;
  return <DetailSlot data={props.data} onPick={props.onPick} />;
}

function settingsOf(doc: LayoutDoc | undefined): { tests: boolean; external: boolean } {
  if (doc === undefined) return { tests: false, external: false };
  return doc.settings;
}

function pinsOf(doc: LayoutDoc | undefined, at: string): Record<string, Pin> {
  if (doc === undefined) return EMPTY_PINS;
  return doc.views[at] ?? EMPTY_PINS;
}

function idsOf(state: GraphState): Set<string> {
  if (state.kind !== 'ok') return new Set();
  return new Set(state.view.nodes.map(node => node.id));
}

function detailKey(chosen: string | null): string {
  return chosen ?? '';
}

function detailEnabled(chosen: string | null): boolean {
  return chosen !== null;
}

function commitLayout(doc: LayoutDoc | undefined, next: (doc: LayoutDoc) => LayoutDoc, store: (doc: LayoutDoc) => void): void {
  if (doc === undefined) return;
  store(next(doc));
}

function testsDoc(checked: boolean): (doc: LayoutDoc) => LayoutDoc {
  return doc => withSettings(doc, { tests: checked, external: doc.settings.external });
}

function externalDoc(checked: boolean): (doc: LayoutDoc) => LayoutDoc {
  return doc => withSettings(doc, { tests: doc.settings.tests, external: checked });
}

function queryOf(settings: { tests: boolean; external: boolean }): GraphQuery {
  return { tests: settings.tests, external: settings.external };
}

function elementSize(found: Element | null): { width: number; height: number } {
  if (!(found instanceof HTMLElement)) return { width: 0, height: 0 };
  return { width: found.offsetWidth, height: found.offsetHeight };
}

function measure(id: string): { width: number; height: number } {
  const found = [...document.querySelectorAll('.box')].find(el => el.getAttribute('data-id') === id);
  return elementSize(found ?? null);
}

function openNode(kind: BoxKind, id: string, onDrill: (dir: string) => void, onOpenFile: (path: string) => void): void {
  if (kind === 'package') onDrill(id);
  else if (kind === 'file') onOpenFile(id);
}

function ArchPane(props: Readonly<ArchViewProps>) {
  const queryClient = useQueryClient();
  const flow = useReactFlow();
  const layoutQuery = useQuery({
    queryKey: ['layout', props.token] as const,
    queryFn: () => fetchLayout(props.token, props.fetcher),
  });
  const settings = settingsOf(layoutQuery.data);
  const graphQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, queryOf(settings)),
    enabled: layoutQuery.data !== undefined,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const state = graphStateOf(graphQuery.data, graphQuery.isPending);
  const ids = idsOf(state);
  const chosen = chosenId(picked, armed, ids);
  const detailQuery = useQuery({
    queryKey: ['detail', props.token, props.at, detailKey(chosen), settings.tests, settings.external] as const,
    queryFn: () => fetchDetail(props.token, detailKey(chosen), props.at, props.fetcher, queryOf(settings)),
    enabled: detailEnabled(chosen),
  });
  const pins = pinsOf(layoutQuery.data, props.at);
  const spots = useMemo(() => spotsOf(state, pins), [state, pins]);
  const store = (next: LayoutDoc): void => {
    queryClient.setQueryData(['layout', props.token], next);
    void putLayout(props.token, next, props.fetcher);
  };
  const clearSelection = (): void => {
    setPicked(null);
    setArmed(null);
  };
  const center = (id: string): void => {
    for (const spot of spots) {
      if (spot.id !== id) continue;
      const size = measure(id);
      const point = boxCenter(spot.x, spot.y, size.width, size.height);
      void flow.setCenter(point.x, point.y);
      return;
    }
  };
  const pickEntry = (id: string): void => {
    if (ids.has(id)) {
      setPicked(id);
      setArmed(null);
      center(id);
      return;
    }
    setPicked(null);
    setArmed(id);
    props.onDrill(parentDir(id));
  };
  const rescan = async (): Promise<void> => {
    await postRescan(props.token, props.fetcher);
    await queryClient.invalidateQueries({ queryKey: ['graph'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
  };
  return (
    <div className="arch-pane">
      <div className="arch-toolbar">
        <CrumbList
          crumbs={crumbsOf(state)}
          onDrill={dir => {
            clearSelection();
            props.onDrill(dir);
          }}
        />
        <FlagBox label="Tests" checked={settings.tests} onCheck={checked => commitLayout(layoutQuery.data, testsDoc(checked), store)} />
        <FlagBox
          label="External packages"
          checked={settings.external}
          onCheck={checked => commitLayout(layoutQuery.data, externalDoc(checked), store)}
        />
        <button type="button" onClick={() => commitLayout(layoutQuery.data, doc => withoutView(doc, props.at), store)}>
          Reset layout
        </button>
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <div className="arch-body">
        <ArchCanvas
          state={state}
          spots={spots}
          hover={hover}
          chosen={chosen}
          onHover={setHover}
          onSelect={id => {
            setPicked(id);
            setArmed(null);
          }}
          onOpen={(id, kind) => {
            clearSelection();
            openNode(kind, id, props.onDrill, props.onOpenFile);
          }}
          onPin={(id, x, y) => commitLayout(layoutQuery.data, doc => withPin(doc, props.at, id, { x, y }), store)}
        />
        <MaybePanel chosen={chosen} data={detailQuery.data} onPick={pickEntry} />
      </div>
    </div>
  );
}

export function ArchView(props: Readonly<ArchViewProps>) {
  return (
    <ReactFlowProvider>
      <ArchPane {...props} />
    </ReactFlowProvider>
  );
}
