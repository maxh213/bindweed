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
import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { pointsUp, type PlacedBox } from '../domain/layout.ts';
import { arrowColor, boxCenter, edgeLabel, edgeTitle, filesLabel, headOf, lineOf, plannedColor } from './draw.ts';
import { badgeLevel, badgeText, type Level, type OverlayName } from './healthdraw.ts';
import { FILE_DRAG_MIME } from './plangesture.ts';
import type { CutMarkInk, GhostBoxInk, Planning, RowInk } from './planpicture.ts';
import type { ProposalBox, ProposalLink, ProposalRow } from './proposalpicture.ts';

export type MarkSel = { from: string; to: string; cut: boolean };

export type FocusRequest = { id: string } | { from: string; to: string };

type BoxData = {
  name: string;
  kind: GraphNode['kind'];
  count: string | null;
  cycle: boolean;
  abstract: boolean;
  test: boolean;
  deleted: boolean;
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

type GhostData = { name: string; x: number; y: number; kind: null };

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
  converged: boolean;
};

type ArrowEdge = Edge<ArrowData, 'arrow'>;

type CutData = { selected: boolean; done: boolean };

type CutEdge = Edge<CutData, 'cutmark'>;

type ProposalData = { name: string; x: number; y: number; kind: null; highlight: boolean; rows: ProposalRow[] };

type ProposalNode = Node<ProposalData, 'proposal'>;

type ProposalMarkData = { highlight: boolean };

type ProposalCutEdge = Edge<ProposalMarkData, 'proposalcut'>;

type ProposalArrowEdge = Edge<ProposalMarkData, 'proposalarrow'>;

type MarkerEnd = string | { type: MarkerType; width: number; height: number; color: string };

export type CanvasProps = {
  spots: PlacedBox[];
  hover: string | null;
  chosen: string | null;
  also: string[];
  marked: MarkSel | null;
  overlay: OverlayName;
  crapMax: number;
  planning: Planning | null;
  focus: FocusRequest | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string, shift: boolean) => void;
  onSelectMark: (mark: MarkSel) => void;
  onClear: () => void;
  onOpen: (id: string, kind: GraphNode['kind'] | null) => void;
  onDropNode: (id: string, kind: GraphNode['kind'] | null, x: number, y: number, event: unknown) => void;
};

const CONNECT_RADIUS = 260;
const GREEN = '#16a34a';
const RED = '#dc2626';
const ROW_COLORS: Record<NonNullable<RowInk['converge']>, string> = { done: GREEN, contradicted: RED };

function editable(planning: Planning | null): boolean {
  return planning !== null && planning.converge === null;
}

function drawIfEditable(planning: Planning | null, connection: Connection): void {
  if (planning === null || planning.converge !== null) return;
  planning.onDrawEdge(connection.source, connection.target);
}

function doneAttr(done: boolean): 'done' | undefined {
  return done ? 'done' : undefined;
}

function rowStyle(row: RowInk): { color: string } | undefined {
  return row.converge === undefined ? undefined : { color: ROW_COLORS[row.converge] };
}

function boolAttr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function onAttr(value: boolean): 'true' | undefined {
  return value ? 'true' : undefined;
}

function strikeFor(planning: Planning | null, id: string): { strike: boolean; highlight: boolean } {
  if (planning === null) return { strike: false, highlight: false };
  const found = planning.proposal.strikes.find(item => item.id === id);
  if (found === undefined) return { strike: false, highlight: false };
  return { strike: true, highlight: found.highlight };
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
  return texts.map((text, index) => ({ key: String(index), text, at: index }));
}

function NoteMarks({ texts }: Readonly<{ texts: string[] }>) {
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

function fateOf(deleted: boolean): 'delete' | undefined {
  return deleted ? 'delete' : undefined;
}

function ProposalRowMark({ row }: Readonly<{ row: ProposalRow }>) {
  return (
    <div className="box-row" data-proposal="true" data-path={row.path} data-highlight={onAttr(row.highlight)}>
      {row.name}
    </div>
  );
}

function proposalRowsOf(planning: Planning | null, id: string): ProposalRow[] {
  if (planning === null) return [];
  return planning.proposal.rows.filter(row => row.boxId === id);
}

function BoxRow({ row, planning }: Readonly<{ row: RowInk; planning: Planning }>) {
  const strike = strikeFor(planning, row.path);
  if (row.ghost) {
    return (
      <div className="box-row" data-ghost="true" data-path={row.path} data-converge={row.converge} style={rowStyle(row)} onDoubleClick={event => event.stopPropagation()}>
        {row.name}
      </div>
    );
  }
  return (
    <div
      className="box-row nodrag"
      data-path={row.path}
      data-fate={fateOf(row.deleted)}
      data-proposal={onAttr(strike.strike)}
      data-strike={onAttr(strike.strike)}
      data-highlight={onAttr(strike.highlight)}
      data-converge={row.converge}
      style={rowStyle(row)}
      draggable={editable(planning)}
      onDragStart={event => event.dataTransfer.setData(FILE_DRAG_MIME, row.path)}
      onDoubleClick={event => {
        event.stopPropagation();
        planning.onOpenPlanned(row.path);
      }}
    >
      <button
        type="button"
        className="box-row-name"
        onClick={event => {
          if (planning.onPickFile(row.path)) event.stopPropagation();
        }}
      >
        {row.name}
      </button>
    </div>
  );
}

function BoxRows({ rows, planning }: Readonly<{ rows: RowInk[]; planning: Planning }>) {
  if (rows.length === 0) return null;
  return (
    <div className="box-rows">
      {rows.map(row => (
        <BoxRow key={row.path} row={row} planning={planning} />
      ))}
    </div>
  );
}

function ProposalRows({ rows }: Readonly<{ rows: ProposalRow[] }>) {
  if (rows.length === 0) return null;
  return (
    <div className="box-rows">
      {rows.map(row => (
        <ProposalRowMark key={row.path} row={row} />
      ))}
    </div>
  );
}

type MenuItem = { label: string; run: () => void };

function packageItems(planning: Planning, id: string): MenuItem[] {
  const items = [
    { label: 'Rename', run: () => planning.onRename(id, 'package') },
    { label: 'Split', run: () => planning.onSplit(id) },
  ];
  if (!planning.mergeReady) return items;
  return [...items, { label: 'Merge', run: planning.onMerge }];
}

function fileItems(planning: Planning, id: string): MenuItem[] {
  return [
    { label: 'Rename', run: () => planning.onRename(id, 'file') },
    { label: 'Delete', run: () => planning.onDelete(id) },
    { label: 'Fold into…', run: () => planning.onFold(id) },
  ];
}

function kindItems(kind: GraphNode['kind'], planning: Planning, id: string): MenuItem[] {
  if (kind === 'package') return packageItems(planning, id);
  return kind === 'file' ? fileItems(planning, id) : [];
}

function menuItems(kind: GraphNode['kind'], planning: Planning, id: string): MenuItem[] {
  return [{ label: 'Add note', run: () => planning.onAddNote({ node: id }) }, ...kindItems(kind, planning, id)];
}

function BoxMenu({ items }: Readonly<{ items: MenuItem[] }>) {
  const [open, setOpen] = useState(false);
  return (
    <span className="box-menu nopan nodrag">
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(current => !current);
        }}
      >
        Menu
      </button>
      {open ? (
        <span role="menu">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={event => {
                event.stopPropagation();
                setOpen(false);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
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
  if (planning === null || planning.converge !== null || data.kind !== 'package') return {};
  return {
    onDragOver: event => event.preventDefault(),
    onDrop: event => rowDrop(event, id, planning),
  };
}

function boxMenu(data: BoxData, id: string): ReactNode {
  const planning = data.planning;
  if (planning === null || planning.converge !== null || !data.selected) return null;
  return <BoxMenu items={menuItems(data.kind, planning, id)} />;
}

function drawLabel(planning: Planning | null): string | undefined {
  return editable(planning) ? 'Draw dependency' : undefined;
}

function boxConverge(planning: Planning | null, id: string): { 'data-converge'?: 'done'; style?: { borderTopColor: string } } {
  if (planning?.converge?.boxes.has(id) !== true) return {};
  return { 'data-converge': 'done', style: { borderTopColor: GREEN } };
}

function Box({ id, data }: NodeProps<BoxNode>) {
  const strike = strikeFor(data.planning, id);
  return (
    <div
      className={boxClass(data)}
      data-id={id}
      data-x={data.x}
      data-y={data.y}
      data-cycle={boolAttr(data.cycle)}
      data-abstract={boolAttr(data.abstract)}
      data-selected={boolAttr(data.selected)}
      data-fate={fateOf(data.deleted)}
      onMouseEnter={() => data.onHover(id)}
      onMouseLeave={() => data.onHover(null)}
      {...boxConverge(data.planning, id)}
      {...boxDropProps(data, id)}
    >
      <Handle type="target" position={Position.Top} />
      <span className="box-name" data-proposal={onAttr(strike.strike)} data-strike={onAttr(strike.strike)} data-highlight={onAttr(strike.highlight)}>
        {data.name}
      </span>
      <BoxCount text={data.count} />
      <TestTag show={data.test} />
      <HealthBadge text={data.badge} level={data.level} />
      <NoteMarks texts={data.noteTexts} />
      {data.planning === null ? null : <BoxRows rows={data.rows} planning={data.planning} />}
      <ProposalRows rows={proposalRowsOf(data.planning, id)} />
      {boxMenu(data, id)}
      <Handle type="source" position={Position.Bottom} aria-label={drawLabel(data.planning)} isConnectable={editable(data.planning)} />
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

function ProposalBoxNode({ id, data }: NodeProps<ProposalNode>) {
  return (
    <div className="box proposal" data-proposal="true" data-id={id} data-x={data.x} data-y={data.y} data-highlight={onAttr(data.highlight)}>
      <span className="box-name">{data.name}</span>
      <ProposalRows rows={data.rows} />
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
  if (planning === null || planning.converge !== null || !data.selected) return null;
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
      data-converge={doneAttr(data.converged)}
    >
      <title>{data.title}</title>
      <BaseEdge id={props.id} path={path} style={arrowStyle(data)} markerEnd={props.markerEnd} />
      <ArrowLabel label={data.label} x={labelX} y={labelY} />
      <ArrowNoteMarks texts={data.noteTexts} x={labelX} y={labelY} />
      {arrowMenu(data, labelX, labelY)}
    </g>
  );
}

function cutData(data: CutData | undefined): CutData {
  return data ?? { selected: false, done: false };
}

function cutLabelStyle(done: boolean): { fill: string } | undefined {
  return done ? { fill: GREEN } : undefined;
}

function CutMark(props: EdgeProps<CutEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const data = cutData(props.data);
  return (
    <g
      className="cutmark"
      aria-label="cut"
      data-cut="true"
      data-from={props.source}
      data-to={props.target}
      data-selected={boolAttr(data.selected)}
      data-converge={doneAttr(data.done)}
    >
      <BaseEdge id={props.id} path={path} style={{ stroke: data.done ? GREEN : '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }} />
      <text x={labelX} y={labelY} className="cut-label" style={cutLabelStyle(data.done)}>
        ✂
      </text>
    </g>
  );
}

function cutHighlight(data: ProposalMarkData | undefined): boolean {
  if (data === undefined) return false;
  return data.highlight;
}

function ProposalCut(props: EdgeProps<ProposalCutEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <g className="proposal-cut" data-proposal="true" data-from={props.source} data-to={props.target} data-highlight={onAttr(cutHighlight(props.data))}>
      <BaseEdge id={props.id} path={path} style={{ stroke: '#7c3aed', strokeWidth: 1, strokeDasharray: '4 4' }} />
      <text x={labelX} y={labelY} className="proposal-cut-label" fill="#7c3aed">
        ✂
      </text>
    </g>
  );
}

function ProposalArrow(props: EdgeProps<ProposalArrowEdge>) {
  const data = props.data;
  if (data === undefined) return null;
  const [path] = getBezierPath(props);
  return (
    <g data-proposal="true" data-from={props.source} data-to={props.target} data-highlight={onAttr(data.highlight)}>
      <BaseEdge id={props.id} path={path} style={{ stroke: '#7c3aed', strokeWidth: 1.5, strokeDasharray: '6 4' }} markerEnd={props.markerEnd} />
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

const nodeTypes = { box: Box, ghost: GhostBox, proposal: ProposalBoxNode };
const edgeTypes = { arrow: Arrow, cutmark: CutMark, proposalcut: ProposalCut, proposalarrow: ProposalArrow };

function isAbstract(node: GraphNode): boolean {
  return (node as { abstract?: true }).abstract === true;
}

function isTestNode(node: GraphNode): boolean {
  return (node as { test?: true }).test === true;
}

function isDeleted(node: GraphNode): boolean {
  return node.fate === 'delete';
}

function countOf(node: GraphNode): string | null {
  if (node.kind !== 'package') return null;
  return filesLabel(node.files);
}

type BoxStyle = {
  hover: string | null;
  chosen: string | null;
  also: string[];
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
    deleted: isDeleted(node),
    x: spot.x,
    y: spot.y,
    selected: node.id === style.chosen || style.also.includes(node.id),
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
    data: { name: ghost.name, x: ghost.x, y: ghost.y, kind: null },
    draggable: false,
  };
}

function toProposalNode(box: ProposalBox): ProposalNode {
  return {
    id: box.id,
    type: 'proposal',
    position: { x: box.x, y: box.y },
    data: { name: box.name, x: box.x, y: box.y, kind: null, highlight: box.highlight, rows: box.rows },
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

function converged(marks: CutMarkInk[] | undefined, from: string, to: string): boolean {
  return marks?.some(mark => mark.from === from && mark.to === to) === true;
}

function arrowDone(planning: Planning | null, edge: ViewEdge): boolean {
  return converged(planning?.converge?.arrows, edge.from, edge.to);
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
  const done = arrowDone(ctx.planning, edge);
  return {
    cycle: edge.cycle,
    up,
    planned: edge.planned === true,
    line: lineOf(edge.runtime),
    head: headOf(heritage),
    title: edgeTitle(up, lookupName(ctx.names, edge.from), lookupName(ctx.names, edge.to), edge.cycleText, edge.runtime, edge.type, heritage),
    label: edgeLabel(edge.runtime, edge.type),
    color: done ? GREEN : arrowColorOf(edge, edge.cycle || up),
    dimmed: arrowDimmed(edge.from, edge.to, ctx.hover),
    selected,
    noteTexts: arrowNotes(ctx, edge.from, edge.to),
    from: edge.from,
    to: edge.to,
    planning: ctx.planning,
    converged: done,
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

function toCutMark(cut: CutMarkInk, marked: MarkSel | null, planning: Planning | null): CutEdge {
  return {
    id: `cut:${cut.from}->${cut.to}`,
    source: cut.from,
    target: cut.to,
    type: 'cutmark',
    data: { selected: cutSelected(marked, cut.from, cut.to), done: converged(planning?.converge?.cuts, cut.from, cut.to) },
  };
}

function toProposalCut(link: ProposalLink): ProposalCutEdge {
  return {
    id: `proposal-cut:${link.from}->${link.to}`,
    source: link.from,
    target: link.to,
    type: 'proposalcut',
    data: { highlight: link.highlight },
  };
}

function toProposalArrow(link: ProposalLink): ProposalArrowEdge {
  return {
    id: `proposal-arrow:${link.from}->${link.to}`,
    source: link.from,
    target: link.to,
    type: 'proposalarrow',
    data: { highlight: link.highlight },
    markerEnd: markerFor('filled', '#7c3aed'),
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

function nodeKind(node: BoxNode | GhostNode | ProposalNode): GraphNode['kind'] | null {
  return node.data.kind;
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
  if ('id' in focus) return centreOf(focus.id, spots);
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
  const spotsNow = useEffectEvent(() => spots);
  useEffect(() => {
    if (focus === null) return;
    const point = focusPoint(focus, spotsNow());
    if (point !== null) void flow.setCenter(point.x, point.y);
  }, [focus, nodesKey, flow]);
}

type InkEdges = { added: ViewEdge[]; cuts: CutMarkInk[] };

function inkEdges(planning: Planning | null): InkEdges {
  if (planning === null) return { added: [], cuts: [] };
  return { added: planning.ink.added, cuts: planning.ink.cuts };
}

function proposalNodes(planning: Planning | null): ProposalNode[] {
  if (planning === null) return [];
  return planning.proposal.boxes.map(toProposalNode);
}

function proposalCuts(planning: Planning | null): ProposalCutEdge[] {
  if (planning === null) return [];
  return planning.proposal.cuts.map(toProposalCut);
}

function proposalArrows(planning: Planning | null): ProposalArrowEdge[] {
  if (planning === null) return [];
  return planning.proposal.arrows.map(toProposalArrow);
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
        also: props.also,
        overlay: props.overlay,
        crapMax: props.crapMax,
        planning,
        onHover: props.onHover,
      }),
    [props.view.nodes, props.spots, props.hover, props.chosen, props.also, props.overlay, props.crapMax, planning, props.onHover],
  );
  const boxes = useMemo(() => [...nodes, ...(planning?.ink.ghosts ?? []).map(toGhost), ...proposalNodes(planning)], [nodes, planning]);
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
      ...ink.cuts.map(cut => toCutMark(cut, props.marked, planning)),
      ...proposalCuts(planning),
      ...proposalArrows(planning),
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
        nodesConnectable={editable(planning)}
        edgesFocusable={false}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={CONNECT_RADIUS}
        zoomOnDoubleClick={false}
        fitView
        onNodeClick={(event, node) => props.onSelect(node.id, event.shiftKey)}
        onNodeDoubleClick={(_event, node) => props.onOpen(node.id, nodeKind(node))}
        onNodeDragStop={(event, node) => props.onDropNode(node.id, nodeKind(node), node.position.x, node.position.y, event)}
        onEdgeClick={(_event, edge) => props.onSelectMark({ from: edge.source, to: edge.target, cut: edge.type === 'cutmark' })}
        onPaneClick={() => props.onClear()}
        onConnect={(connection: Connection) => drawIfEditable(planning, connection)}
      />
    </div>
  );
}
