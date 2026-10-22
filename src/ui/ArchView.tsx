import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { Crumb, GraphNode, GraphView, NodeDetail } from '../domain/graph.ts';
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
import { ArchCanvas, CanvasProvider, useCenterOn, type CanvasProps, type FocusRequest, type MarkSel } from './ArchCanvas.tsx';
import { fetchConverge, fetchDetail, fetchGraph, fetchLayout, postRescan, putLayout, type ConvergeAnswer, type RunCard } from './client.ts';
import { DetailSlot } from './DetailPanel.tsx';
import { chosenId, detailId, detailOn, parentDir } from './draw.ts';
import { MetricsDrawer, OverlayBox } from './HealthControls.tsx';
import { DEFAULT_LIMIT, type MetricBox, type OverlayName, type ReportFacts } from './healthdraw.ts';
import { usePlanSession } from './plansession.tsx';
import { graphStateOf, type GraphState } from './view.ts';

export type ArchViewProps = {
  token: string;
  at: string;
  plan?: string | null;
  fetcher: typeof fetch;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
  onPlanChange?: (plan: string | null) => void;
  converge?: string | null;
  runs?: { runs: RunCard[] } | { error: string };
  onConverge?: (slug: string | null) => void;
};

type Shown = 'now' | 'planned';

type Verdict = ConvergeAnswer | { error: string } | undefined;

const CONVERGE_POLL_MS = 20000;

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

type CrumbDrop = (event: React.DragEvent, at: string) => void;

function crumbProps(at: string, drop: CrumbDrop | null): { 'data-crumb'?: string; onDragOver?: (event: React.DragEvent) => void; onDrop?: (event: React.DragEvent) => void } {
  if (drop === null) return {};
  return {
    'data-crumb': at,
    onDragOver: event => event.preventDefault(),
    onDrop: event => drop(event, at),
  };
}

function CrumbButton(
  props: Readonly<{ crumb: Crumb; separator: boolean; onDrill: (dir: string) => void; onCrumbDrop: CrumbDrop | null }>,
) {
  const dropProps = crumbProps(props.crumb.at, props.onCrumbDrop);
  return (
    <span>
      {props.separator ? ' / ' : null}
      <button type="button" onClick={() => props.onDrill(props.crumb.at)} {...dropProps}>
        {props.crumb.name}
      </button>
    </span>
  );
}

function CrumbList(props: Readonly<{ crumbs: Crumb[]; onDrill: (dir: string) => void; onCrumbDrop: CrumbDrop | null }>) {
  return (
    <nav aria-label="breadcrumb">
      {props.crumbs.map((crumb, index) => (
        <CrumbButton key={crumb.at} crumb={crumb} separator={index > 0} onDrill={props.onDrill} onCrumbDrop={props.onCrumbDrop} />
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

type CanvasAreaProps = CanvasProps & { state: GraphState };

function CanvasArea(props: Readonly<CanvasAreaProps>) {
  if (props.state.kind === 'loading') return <div className="arch-canvas">loading…</div>;
  if (props.state.kind === 'message') return <div className="arch-canvas">{props.state.message}</div>;
  return (
    <ArchCanvas
      view={props.state.view}
      spots={props.spots}
      hover={props.hover}
      chosen={props.chosen}
      also={props.also}
      marked={props.marked}
      overlay={props.overlay}
      crapMax={props.crapMax}
      planning={props.planning}
      focus={props.focus}
      onHover={props.onHover}
      onSelect={props.onSelect}
      onSelectMark={props.onSelectMark}
      onClear={props.onClear}
      onOpen={props.onOpen}
      onDropNode={props.onDropNode}
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

function viewOf(state: GraphState): GraphView | undefined {
  return state.view;
}

function noNodes(): GraphNode[] {
  return JSON.parse('[]');
}

function nodesOf(state: GraphState): GraphNode[] {
  if (state.kind !== 'ok') return noNodes();
  return state.view.nodes;
}

function readyOf(state: GraphState): boolean {
  return state.kind === 'ok';
}

function planChangerOf(handler: ((plan: string | null) => void) | undefined): (plan: string | null) => void {
  return handler ?? (() => undefined);
}

function convergeChangerOf(handler: ((slug: string | null) => void) | undefined): (slug: string | null) => void {
  return handler ?? (() => undefined);
}

function overlayOf(settings: LayoutSettings): OverlayName {
  return settings.overlay ?? 'none';
}

function showingPlanned(shown: Shown, slug: string | null): boolean {
  return shown === 'planned' && slug !== null;
}

function detailPlanOf(shown: Shown, slug: string | null): string | null {
  return shown === 'planned' ? slug : null;
}

function crumbDrops(slug: string | null, drop: CrumbDrop): CrumbDrop | null {
  return slug === null ? null : drop;
}

function plannedOn(layout: LayoutDoc | undefined, slug: string | null): boolean {
  return layout !== undefined && slug !== null;
}

function addedId(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

function selectionOf(chosen: string | null, also: string[], ids: Set<string>): string[] {
  const kept = also.filter(id => id !== chosen && ids.has(id));
  return chosen === null ? kept : [chosen, ...kept];
}

function deletableOf(marked: MarkSel | null): { from: string; to: string } | null {
  if (marked === null || marked.cut) return null;
  return { from: marked.from, to: marked.to };
}

function pageVisible(): boolean {
  return document.visibilityState === 'visible';
}

function fetchesInFlight(client: QueryClient): boolean {
  return client.isFetching() > 0;
}

type Watch = { live: boolean; busy: boolean | null; timer?: ReturnType<typeof setTimeout>; stop: () => void };

function scheduleRefresh(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  watch.timer = setTimeout(() => {
    watch.busy = null;
    void refresh().then(() => syncWatch(client, watch, refresh));
  }, CONVERGE_POLL_MS);
}

function armWhenIdle(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (!watch.live) return;
  if (fetchesInFlight(client)) return;
  clearTimeout(watch.timer);
  scheduleRefresh(client, watch, refresh);
}

const SETTLE_TURNS = 100;

function afterImmediateTurns(left: number, done: () => void): void {
  if (left > 0) {
    setImmediate(() => afterImmediateTurns(left - 1, done));
    return;
  }
  done();
}

function scheduleAfterSettle(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (typeof setImmediate !== 'function') {
    armWhenIdle(client, watch, refresh);
    return;
  }
  afterImmediateTurns(SETTLE_TURNS, () => armWhenIdle(client, watch, refresh));
}

function stillFetching(watch: Watch, busy: boolean): boolean {
  return busy && watch.busy === true;
}

function syncWatch(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (!watch.live) return;
  const busy = fetchesInFlight(client);
  if (stillFetching(watch, busy)) return;
  watch.busy = busy;
  clearTimeout(watch.timer);
  if (busy) return;
  scheduleAfterSettle(client, watch, refresh);
}

function pidAliveOf(verdict: Verdict): boolean {
  return verdict !== undefined && 'pidAlive' in verdict && verdict.pidAlive;
}

function watching(converge: string | null, verdict: Verdict): boolean {
  return converge !== null && pidAliveOf(verdict);
}

function editingSlug(converge: string | null, slug: string | null): string | null {
  return converge === null ? slug : null;
}

function useVisible(hidden: { current: boolean }): boolean {
  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => {
    const update = (): void => {
      const now = pageVisible();
      if (!now) hidden.current = true;
      setVisible(now);
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [hidden]);
  return visible;
}

function beginWatch(client: QueryClient, watch: Watch, hidden: { current: boolean }, refresh: () => Promise<void>): void {
  const wasHidden = hidden.current;
  hidden.current = false;
  if (wasHidden) void refresh().then(() => syncWatch(client, watch, refresh));
  else syncWatch(client, watch, refresh);
}

function startWatch(client: QueryClient, hidden: { current: boolean }, refresh: () => Promise<void>): Watch {
  const watch = { live: true, busy: null } as Watch;
  watch.stop = client.getQueryCache().subscribe(() => syncWatch(client, watch, refresh));
  beginWatch(client, watch, hidden, refresh);
  return watch;
}

function useConvergeWatch(active: boolean, refresh: () => Promise<void>): void {
  const client = useQueryClient();
  const hidden = useRef(false);
  const visible = useVisible(hidden);
  const refreshNow = useEffectEvent(refresh);
  useEffect(() => {
    if (!visible) return undefined;
    if (!active) {
      hidden.current = false;
      return undefined;
    }
    const watch = startWatch(client, hidden, () => refreshNow());
    return () => {
      watch.live = false;
      watch.stop();
      clearTimeout(watch.timer);
    };
  }, [active, visible, client]);
}

function convergeable(runs: ArchViewProps['runs'], slug: string): boolean {
  if (runs === undefined || 'error' in runs) return false;
  return runs.runs.some(card => card.slug === slug && card.worktreeExists && card.planExists);
}

function convergeLabel(converge: string | null, slug: string | null, runs: ArchViewProps['runs']): string | null {
  if (converge !== null) return 'Leave';
  return slug !== null && convergeable(runs, slug) ? 'Converge' : null;
}

function ArchPane(props: Readonly<ArchViewProps & { slug: string | null; converging: string | null }>) {
  const queryClient = useQueryClient();
  const layoutQuery = useQuery({
    queryKey: ['layout', props.token] as const,
    queryFn: () => fetchLayout(props.token, props.fetcher),
  });
  const settings = settingsOf(layoutQuery.data);
  const slug = props.slug;
  const converge = props.converging;
  const nowQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external, '', converge] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, { ...settings, converge }),
    enabled: layoutQuery.data !== undefined,
  });
  const plannedQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external, slug, converge] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, { ...settings, plan: slug, converge }),
    enabled: plannedOn(layoutQuery.data, slug),
  });
  const plannedTestsQuery = useQuery({
    queryKey: ['graph', props.token, props.at, true, false, slug, converge] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, { tests: true, external: false, plan: slug, converge }),
    enabled: plannedOn(layoutQuery.data, slug),
  });
  const verdictQuery = useQuery({
    queryKey: ['converge', props.token, converge] as const,
    queryFn: () => fetchConverge(props.token, String(converge), props.fetcher),
    enabled: converge !== null,
  });
  const [shown, setShown] = useState<Shown>('planned');
  const [picked, setPicked] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [marked, setMarked] = useState<MarkSel | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nowState = graphStateOf(nowQuery.data, nowQuery.isPending);
  const plannedState = graphStateOf(plannedQuery.data, plannedQuery.isPending);
  const plannedTestsState = graphStateOf(plannedTestsQuery.data, plannedTestsQuery.isPending);
  const plannedShown = showingPlanned(shown, slug);
  const state = plannedShown ? plannedState : nowState;
  const otherState = plannedShown ? nowState : plannedState;
  const spots = useMemo(() => spotsOf(state, pinsOf(layoutQuery.data, props.at)), [state, layoutQuery.data, props.at]);
  const pins = pinsOf(layoutQuery.data, props.at);
  const ids = idsOf(state);
  const chosen = chosenId(picked, armed, ids);
  const selection = selectionOf(chosen, also, ids);
  const detailPlan = detailPlanOf(shown, slug);
  const detailQuery = useQuery({
    queryKey: ['detail', props.token, props.at, detailId(chosen), settings.tests, settings.external, detailPlan, converge] as const,
    queryFn: () => fetchDetail(props.token, detailId(chosen), props.at, props.fetcher, { ...settings, plan: detailPlan, converge }),
    enabled: detailOn(chosen),
  });
  const refresh = async (): Promise<void> => {
    await Promise.all(['converge', 'graph', 'detail'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  useConvergeWatch(watching(converge, verdictQuery.data), refresh);
  const body = detailBody(chosen, detailQuery.data, keptDetail);
  useEffect(() => {
    keptDetail = body;
  }, [body]);
  const center = useCenterOn(spots);
  const pickNode = (id: string): void => {
    setFocus({ id });
    setMarked(null);
    if (ids.has(id)) {
      setPicked(id);
      return;
    }
    setArmed(id);
    props.onDrill(parentDir(id));
  };
  const selectArrow = (from: string, to: string, cut: boolean): void => {
    setMarked({ from, to, cut });
    setPicked(null);
    setArmed(null);
    setFocus({ from, to });
  };
  const session = usePlanSession({
    token: props.token,
    fetcher: props.fetcher,
    at: props.at,
    slug,
    converge,
    verdict: verdictQuery.data,
    convergeLabel: convergeLabel(converge, slug, props.runs),
    tests: settings.tests,
    external: settings.external,
    pins,
    shown,
    ready: readyOf(state),
    nodes: nodesOf(state),
    edges: viewOf(state)?.edges,
    other: viewOf(otherState),
    planned: viewOf(plannedState),
    named: viewOf(plannedTestsState),
    ids,
    selection,
    deletable: deletableOf(marked),
    onShown: setShown,
    onPlanChange: planChangerOf(props.onPlanChange),
    onConverge: convergeChangerOf(props.onConverge),
    onDrill: props.onDrill,
    onOpenFile: props.onOpenFile,
    onPickNode: pickNode,
    onPickArrow: selectArrow,
  });

  const store = (next: LayoutDoc): void => {
    queryClient.setQueryData(['layout', props.token], next);
    void putLayout(props.token, next, props.fetcher);
  };
  const pickMetric = (id: string): void => {
    if (ids.has(id)) {
      setPicked(id);
      setMarked(null);
      center(id);
      return;
    }
    setArmed(id);
    props.onDrill(parentDir(id));
  };
  const clearSelection = (): void => {
    setPicked(null);
    setArmed(null);
    setMarked(null);
    setAlso([]);
  };
  const selectBox = (id: string, shift: boolean): void => {
    if (session.pickFile(id)) return;
    setMarked(null);
    if (shift && slug !== null) {
      setAlso(current => addedId(current, id));
      return;
    }
    setPicked(id);
    setAlso([]);
  };
  const dropNode = (id: string, kind: GraphNode['kind'] | null, x: number, y: number, event: unknown): void => {
    const target = session.dropTarget(kind, event);
    if (target !== null && session.moveFile(id, target)) return;
    commitLayout(layoutQuery.data, doc0 => withPin(doc0, props.at, id, { x, y }), store);
  };
  const rescan = async (): Promise<void> => {
    await postRescan(props.token, props.fetcher, converge);
    if (converge !== null) {
      await refresh();
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['graph'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
  };
  const overlay = overlayOf(settings);
  const flags = reportFlags(state);
  const openBox = (id: string, kind: GraphNode['kind'] | null): void => {
    if (kind === 'package') {
      props.onDrill(id);
      return;
    }
    if (kind !== 'file') return;
    session.openFile(id);
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
          onCrumbDrop={crumbDrops(editingSlug(converge, slug), session.dropOnCrumb)}
        />
        {session.toolbar}
        <OverlayBox overlay={overlay} flags={flags} onChoose={next => commitLayout(layoutQuery.data, settingsDoc({ overlay: next }), store)} />
        <FlagBox label="Tests" checked={settings.tests} onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ tests: checked }), store)} />
        <FlagBox
          label="External packages"
          checked={settings.external}
          onCheck={checked => commitLayout(layoutQuery.data, settingsDoc({ external: checked }), store)}
        />
        <button type="button" onClick={() => setMetricsOpen(open => !open)}>
          Metrics
        </button>
        <button type="button" onClick={() => commitLayout(layoutQuery.data, doc0 => withoutView(doc0, props.at), store)}>
          Reset layout
        </button>
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      {session.notice}
      <MetricsDrawer open={metricsOpen} boxes={packageBoxes(state)} onPick={pickMetric} />
      <div className="arch-body">
        <CanvasArea
          state={state}
          spots={spots}
          hover={hover}
          chosen={chosen}
          also={selection}
          marked={marked}
          overlay={overlay}
          crapMax={crapMaxOf(state)}
          planning={session.planning}
          focus={focus}
          onHover={setHover}
          onSelect={selectBox}
          onSelectMark={mark => {
            setMarked(mark);
            setPicked(null);
            setArmed(null);
          }}
          onClear={clearSelection}
          onOpen={openBox}
          onDropNode={dropNode}
        />
        {session.changes}
        <DetailSlot data={body} onPick={pickMetric} />
      </div>
      {session.dialogs}
    </div>
  );
}

export function ArchView(props: Readonly<ArchViewProps>) {
  const slug = props.plan ?? null;
  const converging = props.converge ?? null;
  return (
    <CanvasProvider>
      <ArchPane key={`${slug}\n${converging}`} {...props} slug={slug} converging={converging} />
    </CanvasProvider>
  );
}
