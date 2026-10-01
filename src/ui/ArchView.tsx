import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import { chosenId, parentDir } from './draw.ts';
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

function spotsOf(state: GraphState, pins: Record<string, Pin>): PlacedBox[] {
  if (state.kind !== 'ok') return [];
  return arrange(state.view.nodes.map(layerOf), pins);
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
      onHover={props.onHover}
      onSelect={props.onSelect}
      onOpen={props.onOpen}
      onPin={props.onPin}
    />
  );
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
  const state = graphStateOf(graphQuery.data, graphQuery.isPending);
  const ids = idsOf(state);
  const chosen = chosenId(picked, armed, ids);
  const detailQuery = useQuery({
    queryKey: ['detail', props.token, props.at, detailKey(chosen), settings.tests, settings.external] as const,
    queryFn: () => fetchDetail(props.token, detailKey(chosen), props.at, props.fetcher, settings),
    enabled: detailEnabled(chosen),
  });
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
        <FlagBox label="Tests" checked={settings.tests} onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ tests: checked }), store)} />
        <FlagBox
          label="External packages"
          checked={settings.external}
          onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ external: checked }), store)}
        />
        <button type="button" onClick={() => commitLayout(layoutQuery.data, doc => withoutView(doc, props.at), store)}>
          Reset layout
        </button>
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <div className="arch-body">
        <CanvasArea
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
    <CanvasProvider>
      <ArchPane {...props} />
    </CanvasProvider>
  );
}
