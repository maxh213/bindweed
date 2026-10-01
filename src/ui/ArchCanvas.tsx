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
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { pointsUp, type PlacedBox } from '../domain/layout.ts';
import { arrowColor, boxCenter, edgeLabel, edgeTitle, filesLabel, headOf, lineOf } from './draw.ts';
import { badgeLevel, badgeText, type Level, type OverlayName } from './healthdraw.ts';

type BoxData = {
  name: string;
  kind: GraphNode['kind'];
  count: string | null;
  cycle: boolean;
  abstract: boolean;
  test: boolean;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  badge: string | null;
  level: Level | null;
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

type CanvasProps = {
  spots: PlacedBox[];
  hover: string | null;
  chosen: string | null;
  overlay: OverlayName;
  crapMax: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string, kind: GraphNode['kind']) => void;
  onPin: (id: string, x: number, y: number) => void;
};

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

function HealthBadge({ text, level }: Readonly<{ text: string | null; level: Level | null }>) {
  if (text === null) return null;
  return (
    <span aria-label="health" className="box-badge" data-health={level ?? undefined}>
      {text}
    </span>
  );
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
      <HealthBadge text={data.badge} level={data.level} />
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

function hollowMarkerId(color: string): string {
  return `hollow-${color.slice(1)}`;
}

function HollowMarker({ color }: Readonly<{ color: string }>) {
  return (
    <marker id={hollowMarkerId(color)} viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto">
      <path d="M 0 0 L 14 7 L 0 14 Z" fill="none" stroke={color} />
    </marker>
  );
}

function MarkerSvg() {
  return (
    <svg className="marker-defs">
      <HollowMarker color={arrowColor(false)} />
      <HollowMarker color={arrowColor(true)} />
    </svg>
  );
}

const nodeTypes = { box: Box };
const edgeTypes = { arrow: Arrow };

function isAbstract(node: GraphNode): boolean {
  return (node as { abstract?: true }).abstract === true;
}

function isTestNode(node: GraphNode): boolean {
  return (node as { test?: true }).test === true;
}

function countOf(node: GraphNode): string | null {
  if (node.kind !== 'package') return null;
  return filesLabel(node.files);
}

type BoxStyle = {
  hover: string | null;
  chosen: string | null;
  overlay: OverlayName;
  crapMax: number;
  onHover: (id: string | null) => void;
};

function toBox(node: GraphNode, spot: PlacedBox, style: BoxStyle): BoxNode {
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
      selected: node.id === style.chosen,
      dimmed: style.hover !== null && style.hover !== node.id,
      badge: badgeText(style.overlay, node),
      level: badgeLevel(style.overlay, node, style.crapMax),
      onHover: style.onHover,
    },
    draggable: true,
  };
}

function sizedBox(node: BoxNode): BoxNode {
  const size = measureBox(node.id);
  if (size.width === 0) return node;
  if (size.height === 0) return node;
  return { ...node, measured: { width: size.width, height: size.height } };
}

function zipBoxes(nodes: GraphNode[], spots: PlacedBox[], style: BoxStyle): BoxNode[] {
  return nodes.map((node, index) => sizedBox(toBox(node, spots[index], style)));
}

function pointsUpward(from: PlacedBox | undefined, to: PlacedBox | undefined, height: number): boolean {
  if (from === undefined || to === undefined) return false;
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
  if (head === 'hollow') return `url(#${hollowMarkerId(color)})`;
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
  const data = arrowData(edge, pointsUpward(spots.get(edge.from), spots.get(edge.to), height), hover, names);
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

function boxElement(id: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.box')].find(box => box.dataset.id === id);
}

function measureBox(id: string): { width: number; height: number } {
  const box = boxElement(id);
  if (box === undefined) return { width: 0, height: 0 };
  return { width: box.offsetWidth, height: box.offsetHeight };
}

export function CanvasProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

export function useCenterOn(spots: PlacedBox[]): (id: string) => void {
  const flow = useReactFlow();
  return id => {
    for (const spot of spots) {
      if (spot.id !== id) continue;
      const size = measureBox(id);
      const point = boxCenter(spot.x, spot.y, size.width, size.height);
      void flow.setCenter(point.x, point.y);
      return;
    }
  };
}

export function ArchCanvas(props: Readonly<CanvasProps & { view: GraphView }>) {
  const height = useBoxHeight();
  const nodes = useMemo(
    () =>
      zipBoxes(props.view.nodes, props.spots, {
        hover: props.hover,
        chosen: props.chosen,
        overlay: props.overlay,
        crapMax: props.crapMax,
        onHover: props.onHover,
      }),
    [props.view.nodes, props.spots, props.hover, props.chosen, props.overlay, props.crapMax, props.onHover],
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
