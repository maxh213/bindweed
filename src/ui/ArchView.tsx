import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Crumb, GraphNode, NodeDetail } from '../domain/graph.ts';
import {
  arrange,
  emptySettings,
  type LayerNode,
  type LayoutDoc,
  type LayoutSettings,
  type Pin,
  type PlacedBox,
  withPin,
  withoutView,
  withSettings,
} from '../domain/layout.ts';
import { ArchCanvas, CanvasProvider, useCenterOn } from './ArchCanvas.tsx';
import { fetchDetail, fetchGraph, fetchLayout, postRescan, putLayout } from './client.ts';
import { DetailSlot } from './DetailPanel.tsx';
import { chosenId, detailId, detailOn, parentDir } from './draw.ts';
import { MetricsDrawer, OverlayBox } from './HealthControls.tsx';
import { DEFAULT_LIMIT, type MetricBox, type OverlayName, type ReportFacts } from './healthdraw.ts';
import { graphStateOf, type GraphState } from './view.ts';

export type ArchViewProps = {
  token: string;
  at: string;
  fetcher: typeof fetch;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
};

const EMPTY_PINS: Record<string, Pin> = {};

function layerOf(node: GraphNode): LayerNode {
  return { id: node.id, row: node.row, order: node.order };
}

function noSpots(): PlacedBox[] {
  return JSON.parse('[]');
}

function readSpots(spots: PlacedBox[]): PlacedBox[] {
  const copy: PlacedBox[] = [];
  for (const spot of spots) copy.push({ id: spot.id, x: spot.x, y: spot.y });
  return copy;
}

function spotsOf(state: GraphState, pins: Record<string, Pin>): PlacedBox[] {
  if (state.kind !== 'ok') return readSpots(noSpots());
  return readSpots(arrange(state.view.nodes.map(layerOf), pins));
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

type DetailData = NodeDetail | { error: string } | undefined;

let keptDetail: DetailData = undefined;

function detailBody(chosen: string | null, data: DetailData, previous: DetailData): DetailData {
  if (chosen === null) return undefined;
  if (data !== undefined) return data;
  return previous;
}

function settingsOf(doc: LayoutDoc | undefined): LayoutSettings {
  if (doc === undefined) return emptySettings();
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

function commitLayout(doc: LayoutDoc | undefined, next: (doc: LayoutDoc) => LayoutDoc, store: (doc: LayoutDoc) => void): void {
  if (doc === undefined) return;
  store(next(doc));
}

function settingsDoc(change: Partial<LayoutSettings>): (doc: LayoutDoc) => LayoutDoc {
  return doc => withSettings(doc, { ...doc.settings, ...change });
}

function openNode(kind: GraphNode['kind'], id: string, onDrill: (dir: string) => void, onOpenFile: (path: string) => void): void {
  if (kind === 'package') onDrill(id);
  else if (kind === 'file') onOpenFile(id);
}

type CanvasAreaProps = {
  state: GraphState;
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

function CanvasArea(props: Readonly<CanvasAreaProps>) {
  if (props.state.kind === 'loading') return <div className="arch-canvas">loading…</div>;
  if (props.state.kind === 'message') return <div className="arch-canvas">{props.state.message}</div>;
  return (
    <ArchCanvas
      view={props.state.view}
      spots={props.spots}
      hover={props.hover}
      chosen={props.chosen}
      overlay={props.overlay}
      crapMax={props.crapMax}
      onHover={props.onHover}
      onSelect={props.onSelect}
      onOpen={props.onOpen}
      onPin={props.onPin}
    />
  );
}

function reportFlags(state: GraphState): ReportFacts {
  if (state.kind !== 'ok') return { coverage: 'off', mutation: 'off' };
  return { coverage: state.view.coverage, mutation: state.view.mutation };
}

function crapMaxOf(state: GraphState): number {
  if (state.kind !== 'ok') return DEFAULT_LIMIT;
  return state.view.crapMax;
}

function packageBoxes(state: GraphState): MetricBox[] {
  if (state.kind !== 'ok') return [];
  return state.view.nodes;
}

function ArchPane(props: Readonly<ArchViewProps>) {
  const queryClient = useQueryClient();
  const layoutQuery = useQuery({
    queryKey: ['layout', props.token] as const,
    queryFn: () => fetchLayout(props.token, props.fetcher),
  });
  const settings = settingsOf(layoutQuery.data);
  const graphQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, settings),
    enabled: layoutQuery.data !== undefined,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const state = graphStateOf(graphQuery.data, graphQuery.isPending);
  const ids = idsOf(state);
  const chosen = chosenId(picked, armed, ids);
  const detailQuery = useQuery({
    queryKey: ['detail', props.token, props.at, detailId(chosen), settings.tests, settings.external] as const,
    queryFn: () => fetchDetail(props.token, detailId(chosen), props.at, props.fetcher, settings),
    enabled: detailOn(chosen),
  });
  const body = detailBody(chosen, detailQuery.data, keptDetail);
  useEffect(() => {
    keptDetail = body;
  }, [body]);
  const pins = pinsOf(layoutQuery.data, props.at);
  const spots = useMemo(() => spotsOf(state, pins), [state, pins]);
  const center = useCenterOn(spots);
  const store = (next: LayoutDoc): void => {
    queryClient.setQueryData(['layout', props.token], next);
    void putLayout(props.token, next, props.fetcher);
  };
  const clearSelection = (): void => {
    setPicked(null);
    setArmed(null);
  };
  const pickEntry = (id: string): void => {
    if (ids.has(id)) {
      setPicked(id);
      center(id);
      return;
    }
    setArmed(id);
    props.onDrill(parentDir(id));
  };
  const rescan = async (): Promise<void> => {
    await postRescan(props.token, props.fetcher);
    await queryClient.invalidateQueries({ queryKey: ['graph'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
  };
  const overlay = settings.overlay ?? 'none';
  const flags = reportFlags(state);
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
        <OverlayBox
          overlay={overlay}
          flags={flags}
          onChoose={next => commitLayout(layoutQuery.data, settingsDoc({ overlay: next }), store)}
        />
        <FlagBox label="Tests" checked={settings.tests} onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ tests: checked }), store)} />
        <FlagBox
          label="External packages"
          checked={settings.external}
          onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ external: checked }), store)}
        />
        <button type="button" onClick={() => setMetricsOpen(open => !open)}>
          Metrics
        </button>
        <button type="button" onClick={() => commitLayout(layoutQuery.data, doc => withoutView(doc, props.at), store)}>
          Reset layout
        </button>
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <MetricsDrawer open={metricsOpen} boxes={packageBoxes(state)} onPick={pickEntry} />
      <div className="arch-body">
        <CanvasArea
          state={state}
          spots={spots}
          hover={hover}
          chosen={chosen}
          overlay={overlay}
          crapMax={crapMaxOf(state)}
          onHover={setHover}
          onSelect={id => {
            setPicked(id);
          }}
          onOpen={(id, kind) => {
            openNode(kind, id, props.onDrill, props.onOpenFile);
          }}
          onPin={(id, x, y) => commitLayout(layoutQuery.data, doc => withPin(doc, props.at, id, { x, y }), store)}
        />
        <DetailSlot data={body} onPick={pickEntry} />
      </div>
    </div>
  );
}

export function ArchView(props: Readonly<ArchViewProps>) {
  return (
    <CanvasProvider>
      <ArchPane {...props} />
    </CanvasProvider>
  );
}
