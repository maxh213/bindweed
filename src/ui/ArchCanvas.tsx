import {
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { pointsUp, type PlacedBox } from '../domain/layout.ts';
import type { NoteTarget } from '../domain/plan.ts';
import { arrowColor, boxCenter, edgeLabel, edgeTitle, filesLabel, headOf, lineOf, plannedColor } from './draw.ts';
import { badgeLevel, badgeText, type Level, type OverlayName } from './healthdraw.ts';
import { FILE_DRAG_MIME, type CutMarkInk, type GhostBoxInk, type MarkSel, type NoteInk, type RowInk } from './planview.ts';

export type PlanInk = {
  rows: Map<string, RowInk[]>;
  ghosts: GhostBoxInk[];
  cuts: CutMarkInk[];
  added: ViewEdge[];
  notes: NoteInk;
};

export type Planning = {
  ink: PlanInk;
  onDropFile: (file: string, dir: string) => boolean;
  onDrawEdge: (from: string, to: string) => void;
  onCutEdge: (from: string, to: string) => void;
  onAddNote: (target: NoteTarget) => void;
  onOpenPlanned: (path: string) => void;
};

export type FocusRequest = { kind: 'node'; id: string } | { kind: 'arrow'; from: string; to: string };

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
  rows: RowInk[];
  noteTexts: string[];
  planning: Planning | null;
  onHover: (id: string | null) => void;
};

type BoxNode = Node<BoxData, 'box'>;

type GhostData = { name: string; x: number; y: number };

type GhostNode = Node<GhostData, 'ghost'>;

type ArrowData = {
  cycle: boolean;
  up: boolean;
  planned: boolean;
  line: 'solid' | 'dashed';
  head: 'filled' | 'hollow';
  title: string;
  label: string | null;
  color: string;
  dimmed: boolean;
  selected: boolean;
  noteTexts: string[];
  from: string;
  to: string;
  planning: Planning | null;
};

type ArrowEdge = Edge<ArrowData, 'arrow'>;

type CutData = { selected: boolean };

type CutEdge = Edge<CutData, 'cutmark'>;

type MarkerEnd = string | { type: MarkerType; width: number; height: number; color: string };

export type CanvasProps = {
  spots: PlacedBox[];
  hover: string | null;
  chosen: string | null;
  marked: MarkSel | null;
  overlay: OverlayName;
  crapMax: number;
  planning: Planning | null;
  focus: FocusRequest | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onSelectMark: (mark: MarkSel) => void;
  onClear: () => void;
  onOpen: (id: string, kind: GraphNode['kind'] | null) => void;
  onDropNode: (id: string, kind: GraphNode['kind'] | null, x: number, y: number, event: unknown) => void;
};

const CONNECT_RADIUS = 260;
const CUT_STYLE = { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' };

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

type Noted = { key: string; text: string; at: number };

function notedTexts(texts: string[]): Noted[] {
  const seen = new Map<string, number>();
  const marks: Noted[] = [];
  texts.forEach((text, index) => {
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    marks.push({ key: `${count}:${text}`, text, at: index });
  });
  return marks;
}

function NoteMarks({ texts }: Readonly<{ texts: string[] }>) {
  if (texts.length === 0) return null;
  return (
    <>
      {notedTexts(texts).map(mark => (
        <span key={mark.key} className="note-marker" aria-label="note" title={mark.text}>
          ✎
        </span>
      ))}
    </>
  );
}

function BoxRow({ row, onOpen }: Readonly<{ row: RowInk; onOpen: ((path: string) => void) | undefined }>) {
  if (row.ghost) {
    return (
      <div className="box-row" data-ghost="true" data-path={row.path} onDoubleClick={event => event.stopPropagation()}>
        {row.name}
      </div>
    );
  }
  return (
    <div
      className="box-row nodrag"
      data-path={row.path}
      draggable
      onDragStart={event => event.dataTransfer.setData(FILE_DRAG_MIME, row.path)}
      onDoubleClick={event => {
        event.stopPropagation();
        onOpen?.(row.path);
      }}
    >
      {row.name}
    </div>
  );
}

function BoxRows({ rows, onOpen }: Readonly<{ rows: RowInk[]; onOpen: ((path: string) => void) | undefined }>) {
  if (rows.length === 0) return null;
  return (
    <div className="box-rows">
      {rows.map(row => (
        <BoxRow key={row.path} row={row} onOpen={onOpen} />
      ))}
    </div>
  );
}

function BoxMenu({ onNote }: Readonly<{ onNote: () => void }>) {
  const [open, setOpen] = useState(false);
  return (
    <span className="box-menu nopan nodrag">
      <button type="button" onClick={() => setOpen(current => !current)}>
        Menu
      </button>
      {open ? (
        <span role="menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNote();
            }}
          >
            Add note
          </button>
        </span>
      ) : null}
    </span>
  );
}

function rowDrop(event: DragEvent<HTMLElement>, id: string, planning: Planning): void {
  event.preventDefault();
  const file = event.dataTransfer.getData(FILE_DRAG_MIME);
  if (file !== '') planning.onDropFile(file, id);
}

function boxDropProps(data: BoxData, id: string): { onDragOver?: (event: DragEvent<HTMLElement>) => void; onDrop?: (event: DragEvent<HTMLElement>) => void } {
  const planning = data.planning;
  if (planning === null || data.kind !== 'package') return {};
  return {
    onDragOver: event => event.preventDefault(),
    onDrop: event => rowDrop(event, id, planning),
  };
}

function boxMenu(data: BoxData, id: string): ReactNode {
  const planning = data.planning;
  if (planning === null || !data.selected) return null;
  return <BoxMenu onNote={() => planning.onAddNote({ node: id })} />;
}

function drawLabel(planning: Planning | null): string | undefined {
  return planning === null ? undefined : 'Draw dependency';
}

function rowOpener(planning: Planning | null): ((path: string) => void) | undefined {
  return planning?.onOpenPlanned;
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
      {...boxDropProps(data, id)}
    >
      <Handle type="target" position={Position.Top} />
      <span className="box-name">{data.name}</span>
      <BoxCount text={data.count} />
      <TestTag show={data.test} />
      <HealthBadge text={data.badge} level={data.level} />
      <NoteMarks texts={data.noteTexts} />
      <BoxRows rows={data.rows} onOpen={rowOpener(data.planning)} />
      {boxMenu(data, id)}
      <Handle type="source" position={Position.Bottom} aria-label={drawLabel(data.planning)} isConnectable={data.planning !== null} />
    </div>
  );
}

function GhostBox({ id, data }: NodeProps<GhostNode>) {
  return (
    <div className="box ghost" data-id={id} data-x={data.x} data-y={data.y} data-ghost="true">
      <span className="box-name">{data.name}</span>
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

function ArrowNoteMarks({ texts, x, y }: Readonly<{ texts: string[]; x: number; y: number }>) {
  if (texts.length === 0) return null;
  return (
    <>
      {notedTexts(texts).map(mark => (
        <g key={mark.key} className="note-marker" aria-label="note" {...{ title: mark.text }} transform={`translate(${x + 14 * (mark.at + 1)} ${y})`}>
          <title>{mark.text}</title>
          <circle r={4} className="note-dot" />
        </g>
      ))}
    </>
  );
}

function ArrowMenu({ x, y, onCut, onNote }: Readonly<{ x: number; y: number; onCut: () => void; onNote: () => void }>) {
  const [open, setOpen] = useState(false);
  return (
    <EdgeLabelRenderer>
      <div className="arrow-menu nodrag" style={{ transform: `translate(-50%, -100%) translate(${x}px, ${y}px)` }}>
        <button type="button" onClick={() => setOpen(current => !current)}>
          Menu
        </button>
        {open ? (
          <span role="menu">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCut();
              }}
            >
              Cut
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNote();
              }}
            >
              Add note
            </button>
          </span>
        ) : null}
      </div>
    </EdgeLabelRenderer>
  );
}

function arrowMenu(data: ArrowData, x: number, y: number): ReactNode {
  const planning = data.planning;
  if (planning === null || !data.selected) return null;
  return <ArrowMenu x={x} y={y} onCut={() => planning.onCutEdge(data.from, data.to)} onNote={() => planning.onAddNote({ edge: [data.from, data.to] })} />;
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
      data-planned={data.planned ? 'true' : undefined}
      data-selected={boolAttr(data.selected)}
    >
      <title>{data.title}</title>
      <BaseEdge id={props.id} path={path} style={arrowStyle(data)} markerEnd={props.markerEnd} />
      <ArrowLabel label={data.label} x={labelX} y={labelY} />
      <ArrowNoteMarks texts={data.noteTexts} x={labelX} y={labelY} />
      {arrowMenu(data, labelX, labelY)}
    </g>
  );
}

function CutMark(props: EdgeProps<CutEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <g
      className="cutmark"
      aria-label="cut"
      data-cut="true"
      data-from={props.source}
      data-to={props.target}
      data-selected={boolAttr(props.data?.selected ?? false)}
    >
      <BaseEdge id={props.id} path={path} style={CUT_STYLE} />
      <text x={labelX} y={labelY} className="cut-label">
        ✂
      </text>
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

const nodeTypes = { box: Box, ghost: GhostBox };
const edgeTypes = { arrow: Arrow, cutmark: CutMark };

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
  planning: Planning | null;
  onHover: (id: string | null) => void;
};

function boxRows(planning: Planning | null, id: string): RowInk[] {
  return planning?.ink.rows.get(id) ?? [];
}

function boxNoteTexts(planning: Planning | null, id: string): string[] {
  return planning?.ink.notes.nodes.get(id) ?? [];
}

function boxData(node: GraphNode, spot: PlacedBox, style: BoxStyle): BoxData {
  return {
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
    rows: boxRows(style.planning, node.id),
    noteTexts: boxNoteTexts(style.planning, node.id),
    planning: style.planning,
    onHover: style.onHover,
  };
}

function toBox(node: GraphNode, spot: PlacedBox, style: BoxStyle): BoxNode {
  return {
    id: node.id,
    type: 'box',
    position: { x: spot.x, y: spot.y },
    data: boxData(node, spot, style),
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

function toGhost(ghost: GhostBoxInk): GhostNode {
  return {
    id: ghost.id,
    type: 'ghost',
    position: { x: ghost.x, y: ghost.y },
    data: { name: ghost.name, x: ghost.x, y: ghost.y },
    draggable: false,
  };
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

function noteKeyOf(from: string, to: string): string {
  return `${from}\n${to}`;
}

function arrowNotes(ctx: ArrowCtx, from: string, to: string): string[] {
  return ctx.planning?.ink.notes.edges.get(noteKeyOf(from, to)) ?? [];
}

function markSelected(marked: MarkSel | null, from: string, to: string): boolean {
  return marked !== null && !marked.cut && marked.from === from && marked.to === to;
}

function arrowColorOf(edge: ViewEdge, red: boolean): string {
  return edge.planned === true ? plannedColor(red) : arrowColor(red);
}

type ArrowCtx = {
  spots: Map<string, PlacedBox>;
  names: Map<string, string>;
  hover: string | null;
  height: number;
  marked: MarkSel | null;
  planning: Planning | null;
};

function arrowData(edge: ViewEdge, up: boolean, ctx: ArrowCtx): ArrowData {
  const heritage = heritageOf(edge);
  const selected = markSelected(ctx.marked, edge.from, edge.to);
  return {
    cycle: edge.cycle,
    up,
    planned: edge.planned === true,
    line: lineOf(edge.runtime),
    head: headOf(heritage),
    title: edgeTitle(up, lookupName(ctx.names, edge.from), lookupName(ctx.names, edge.to), edge.cycleText, edge.runtime, edge.type, heritage),
    label: edgeLabel(edge.runtime, edge.type),
    color: arrowColorOf(edge, edge.cycle || up),
    dimmed: arrowDimmed(edge.from, edge.to, ctx.hover),
    selected,
    noteTexts: arrowNotes(ctx, edge.from, edge.to),
    from: edge.from,
    to: edge.to,
    planning: ctx.planning,
  };
}

function toArrow(edge: ViewEdge, ctx: ArrowCtx, forcedUp?: boolean): ArrowEdge {
  const up = forcedUp ?? pointsUpward(ctx.spots.get(edge.from), ctx.spots.get(edge.to), ctx.height);
  const data = arrowData(edge, up, ctx);
  return {
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'arrow',
    data,
    markerEnd: markerFor(data.head, data.color),
  };
}

function toAddedArrow(edge: ViewEdge, ctx: ArrowCtx): ArrowEdge {
  return { ...toArrow(edge, ctx, false), id: `added:${edge.from}->${edge.to}` };
}

function cutSelected(marked: MarkSel | null, from: string, to: string): boolean {
  return marked !== null && marked.cut && marked.from === from && marked.to === to;
}

function toCutMark(cut: CutMarkInk, marked: MarkSel | null): CutEdge {
  return {
    id: `cut:${cut.from}->${cut.to}`,
    source: cut.from,
    target: cut.to,
    type: 'cutmark',
    data: { selected: cutSelected(marked, cut.from, cut.to) },
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

function nodeKind(node: BoxNode | GhostNode): GraphNode['kind'] | null {
  return node.type === 'ghost' ? null : node.data.kind;
}

function measureBox(id: string): { width: number; height: number } {
  const box = boxElement(id);
  if (box === undefined) return { width: 0, height: 0 };
  return { width: box.offsetWidth, height: box.offsetHeight };
}

function centreOf(id: string, spots: PlacedBox[]): { x: number; y: number } | null {
  const spot = spots.find(item => item.id === id);
  if (spot === undefined) return null;
  const size = measureBox(id);
  return boxCenter(spot.x, spot.y, size.width, size.height);
}

function focusPoint(focus: FocusRequest, spots: PlacedBox[]): { x: number; y: number } | null {
  if (focus.kind === 'node') return centreOf(focus.id, spots);
  const from = centreOf(focus.from, spots);
  const to = centreOf(focus.to, spots);
  if (from === null || to === null) return null;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
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

function useFocusCentre(focus: FocusRequest | null, spots: PlacedBox[], nodesKey: string): void {
  const flow = useReactFlow();
  const spotsRef = useRef(spots);
  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);
  useEffect(() => {
    if (focus === null) return;
    const point = focusPoint(focus, spotsRef.current);
    if (point !== null) void flow.setCenter(point.x, point.y);
  }, [focus, nodesKey, flow]);
}

type InkEdges = { added: ViewEdge[]; cuts: CutMarkInk[] };

function inkEdges(planning: Planning | null): InkEdges {
  if (planning === null) return { added: [], cuts: [] };
  return { added: planning.ink.added, cuts: planning.ink.cuts };
}

export function ArchCanvas(props: Readonly<CanvasProps & { view: GraphView }>) {
  const height = useBoxHeight();
  const planning = props.planning;
  const nodesKey = props.view.nodes.map(node => node.id).join('\n');
  const nodes = useMemo(
    () =>
      zipBoxes(props.view.nodes, props.spots, {
        hover: props.hover,
        chosen: props.chosen,
        overlay: props.overlay,
        crapMax: props.crapMax,
        planning,
        onHover: props.onHover,
      }),
    [props.view.nodes, props.spots, props.hover, props.chosen, props.overlay, props.crapMax, planning, props.onHover],
  );
  const boxes = useMemo(() => [...nodes, ...(planning?.ink.ghosts ?? []).map(toGhost)], [nodes, planning]);
  const edges = useMemo(() => {
    const ctx: ArrowCtx = {
      spots: spotMap(props.spots),
      names: namesOf(props.view.nodes),
      hover: props.hover,
      height,
      marked: props.marked,
      planning,
    };
    const ink = inkEdges(planning);
    return [
      ...props.view.edges.map(edge => toArrow(edge, ctx)),
      ...ink.added.map(edge => toAddedArrow(edge, ctx)),
      ...ink.cuts.map(cut => toCutMark(cut, props.marked)),
    ];
  }, [props.view.edges, props.view.nodes, props.spots, props.hover, height, props.marked, planning]);
  useFocusCentre(props.focus, props.spots, nodesKey);
  return (
    <div className="arch-canvas">
      <MarkerSvg />
      <ReactFlow
        key={`${props.view.at}:${props.view.nodes.length}:${props.view.edges.length}`}
        nodes={boxes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        nodesConnectable={planning !== null}
        edgesFocusable={false}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={CONNECT_RADIUS}
        zoomOnDoubleClick={false}
        fitView
        onNodeClick={(_event, node) => props.onSelect(node.id)}
        onNodeDoubleClick={(_event, node) => props.onOpen(node.id, nodeKind(node))}
        onNodeDragStop={(event, node) => props.onDropNode(node.id, nodeKind(node), node.position.x, node.position.y, event)}
        onEdgeClick={(_event, edge) => props.onSelectMark({ from: edge.source, to: edge.target, cut: edge.type === 'cutmark' })}
        onPaneClick={() => props.onClear()}
        onConnect={(connection: Connection) => planning?.onDrawEdge(connection.source, connection.target)}
      />
    </div>
  );
}
