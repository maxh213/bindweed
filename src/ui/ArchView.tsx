import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BaseEdge,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Crumb, GraphView, ViewEdge, ViewNode } from '../domain/graph.ts';
import { fetchGraph, postRescan } from './client.ts';
import { graphStateOf, type GraphState } from './view.ts';

type BoxData = { name: string; packageBox: boolean; count: number | undefined; cycle: boolean };

type BoxNode = Node<BoxData, 'box'>;

type ArrowData = { cycle: boolean; cycleText: string | null; label: string | null };

type ArrowEdge = Edge<ArrowData, 'arrow'>;

export type ArchViewProps = {
  token: string;
  at: string;
  fetcher: typeof fetch;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
};

const X_GAP = 260;
const Y_GAP = 140;
const CYCLE_COLOR = '#dc2626';
const PLAIN_COLOR = '#64748b';

function cycleFlag(cycle: boolean): 'true' | 'false' {
  return cycle ? 'true' : 'false';
}

function arrowColor(cycle: boolean): string {
  return cycle ? CYCLE_COLOR : PLAIN_COLOR;
}

function arrowStyle(cycle: boolean): { stroke: string; strokeWidth: number } {
  return { stroke: arrowColor(cycle), strokeWidth: cycle ? 2 : 1.5 };
}

function countText(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

function boxClass(data: BoxData): string {
  const kind = data.packageBox ? 'package' : 'file';
  return data.cycle ? `box ${kind} nodrag nopan cycle` : `box ${kind} nodrag nopan`;
}

function BoxCount({ count, packageBox }: Readonly<{ count: number | undefined; packageBox: boolean }>) {
  if (!packageBox || count === undefined) return null;
  return <span className="box-count">{countText(count)}</span>;
}

function Box({ data }: NodeProps<BoxNode>) {
  return (
    <div className={boxClass(data)} data-cycle={cycleFlag(data.cycle)}>
      <Handle type="target" position={Position.Top} />
      <span className="box-name">{data.name}</span>
      <BoxCount count={data.count} packageBox={data.packageBox} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ArrowTitle({ text }: Readonly<{ text: string | null }>) {
  if (text === null) return null;
  return <title>{text}</title>;
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
  const data = props.data as ArrowData;
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <g className={arrowClassOf(data.cycle)} data-cycle={cycleFlag(data.cycle)} data-from={props.source} data-to={props.target}>
      <ArrowTitle text={data.cycleText} />
      <BaseEdge id={props.id} path={path} style={arrowStyle(data.cycle)} markerEnd={props.markerEnd} />
      <ArrowLabel label={data.label} x={labelX} y={labelY} />
    </g>
  );
}

function arrowClassOf(cycle: boolean): string {
  return cycle ? 'arrow cycle' : 'arrow';
}

function boxDataOf(node: ViewNode): BoxData {
  return {
    name: node.name,
    packageBox: node.kind === 'package',
    count: node.kind === 'package' ? node.files : undefined,
    cycle: node.cycle,
  };
}

function toFlowNode(node: ViewNode): BoxNode {
  return {
    id: node.id,
    type: 'box',
    position: { x: node.order * X_GAP, y: node.row * Y_GAP },
    data: boxDataOf(node),
    draggable: false,
  };
}

function arrowDataOf(edge: ViewEdge): ArrowData {
  const total = edge.runtime + edge.type;
  return {
    cycle: edge.cycle,
    cycleText: edge.cycleText ?? null,
    label: total > 1 ? String(total) : null,
  };
}

function toFlowEdge(edge: ViewEdge): ArrowEdge {
  return {
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'arrow',
    data: arrowDataOf(edge),
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: arrowColor(edge.cycle) },
  };
}

const nodeTypes = { box: Box };
const edgeTypes = { arrow: Arrow };

function GraphCanvas(props: Readonly<{ view: GraphView; onDrill: (dir: string) => void; onOpenFile: (path: string) => void }>) {
  const nodes = props.view.nodes.map(toFlowNode);
  const edges = props.view.edges.map(toFlowEdge);
  const onNodeDoubleClick = (event: unknown, node: BoxNode) => {
    if (node.data.packageBox) props.onDrill(node.id);
    else props.onOpenFile(node.id);
  };
  return (
    <div className="arch-canvas">
      <ReactFlow
        key={`${props.view.at}:${props.view.nodes.length}:${props.view.edges.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        fitView
        onNodeDoubleClick={onNodeDoubleClick}
      />
    </div>
  );
}

function ArchCanvas(props: Readonly<{ state: GraphState; onDrill: (dir: string) => void; onOpenFile: (path: string) => void }>) {
  if (props.state.kind === 'loading') return <div className="arch-canvas">loading…</div>;
  if (props.state.kind === 'message') return <div className="arch-canvas">{props.state.message}</div>;
  return <GraphCanvas view={props.state.view} onDrill={props.onDrill} onOpenFile={props.onOpenFile} />;
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

export function ArchView(props: Readonly<ArchViewProps>) {
  const queryClient = useQueryClient();
  const graphQuery = useQuery({
    queryKey: ['graph', props.token, props.at] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher),
  });
  const state = graphStateOf(graphQuery.data, graphQuery.isPending);
  const rescan = async () => {
    await postRescan(props.token, props.fetcher);
    await queryClient.invalidateQueries({ queryKey: ['graph'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
  };
  return (
    <div className="arch-pane">
      <div className="arch-toolbar">
        <CrumbList crumbs={crumbsOf(state)} onDrill={props.onDrill} />
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <ArchCanvas state={state} onDrill={props.onDrill} onOpenFile={props.onOpenFile} />
    </div>
  );
}
