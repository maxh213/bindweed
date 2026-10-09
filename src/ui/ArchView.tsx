import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Crumb, GraphNode, GraphView, NodeDetail, ViewEdge } from '../domain/graph.ts';
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
import {
  addEdgeIndex,
  withEdit,
  withRedo,
  withUndo,
  withoutEdit,
  type NoteTarget,
  type PlanDoc,
  type PlanEdit,
  type PlanSummary,
} from '../domain/plan.ts';
import { ArchCanvas, CanvasProvider, useCenterOn, type FocusRequest, type PlanInk, type Planning } from './ArchCanvas.tsx';
import {
  deletePlan,
  fetchDetail,
  fetchGraph,
  fetchLayout,
  fetchPairs,
  fetchPlan,
  fetchPlans,
  postPlan,
  postRescan,
  putLayout,
  putPlan,
} from './client.ts';
import { DetailSlot } from './DetailPanel.tsx';
import { chosenId, detailId, detailOn, parentDir } from './draw.ts';
import { MetricsDrawer, OverlayBox } from './HealthControls.tsx';
import { DEFAULT_LIMIT, type MetricBox, type OverlayName, type ReportFacts } from './healthdraw.ts';
import { ChangeList, DeletePlanDialog, NewPlanDialog, NoteDialog, Notice, PlanSelect, ShownSwitch } from './PlanBar.tsx';
import {
  addedMarkers,
  arrowViewAt,
  changeEntries,
  deleteNameOf,
  diskPathOf,
  drilledFiles,
  entryTarget,
  fieldTarget,
  FILE_DRAG_MIME,
  ghostBoxes,
  keyActionOf,
  liveCuts,
  marksInView,
  noteInk,
  planChoice,
  planDocOf,
  planDropTarget,
  planLabels,
  plansOf,
  rowsFor,
  staleList,
  type ChangeEntry,
  type EntryTarget,
  type MarkSel,
  type RowInk,
  type ShownGraph,
} from './planview.ts';
import { graphStateOf, type GraphState } from './view.ts';

export type ArchViewProps = {
  token: string;
  at: string;
  plan?: string | null;
  fetcher: typeof fetch;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
  onPlanChange?: (plan: string | null) => void;
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

function crumbDrop(event: React.DragEvent, at: string, onDropFile: (file: string, dir: string) => boolean): void {
  event.preventDefault();
  const file = event.dataTransfer.getData(FILE_DRAG_MIME);
  if (file !== '') onDropFile(file, at);
}

function CrumbButton(
  props: Readonly<{ crumb: Crumb; separator: boolean; onDrill: (dir: string) => void; onDropFile: ((file: string, dir: string) => boolean) | null }>,
) {
  const dropProps =
    props.onDropFile === null
      ? {}
      : {
          'data-crumb': props.crumb.at,
          onDragOver: (event: React.DragEvent) => event.preventDefault(),
          onDrop: (event: React.DragEvent) => crumbDrop(event, props.crumb.at, props.onDropFile as (file: string, dir: string) => boolean),
        };
  return (
    <span>
      {props.separator ? ' / ' : null}
      <button type="button" onClick={() => props.onDrill(props.crumb.at)} {...dropProps}>
        {props.crumb.name}
      </button>
    </span>
  );
}

function CrumbList(
  props: Readonly<{ crumbs: Crumb[]; onDrill: (dir: string) => void; onDropFile: ((file: string, dir: string) => boolean) | null }>,
) {
  return (
    <nav aria-label="breadcrumb">
      {props.crumbs.map((crumb, index) => (
        <CrumbButton key={crumb.at} crumb={crumb} separator={index > 0} onDrill={props.onDrill} onDropFile={props.onDropFile} />
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

type CanvasAreaProps = {
  state: GraphState;
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

function CanvasArea(props: Readonly<CanvasAreaProps>) {
  if (props.state.kind === 'loading') return <div className="arch-canvas">loading…</div>;
  if (props.state.kind === 'message') return <div className="arch-canvas">{props.state.message}</div>;
  return (
    <ArchCanvas
      view={props.state.view}
      spots={props.spots}
      hover={props.hover}
      chosen={props.chosen}
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

type RowResult = { data: GraphView | { error: string } | undefined };

function rowQueriesFor(token: string, fetcher: typeof fetch, id: string, settings: LayoutSettings, slug: string) {
  return [
    {
      queryKey: ['graph', token, id, settings.tests, settings.external, ''] as const,
      queryFn: () => fetchGraph(token, id, fetcher, settings),
    },
    {
      queryKey: ['graph', token, id, settings.tests, settings.external, slug] as const,
      queryFn: () => fetchGraph(token, id, fetcher, { ...settings, plan: slug }),
    },
  ];
}

function rowPair(results: readonly RowResult[], index: number, shown: ShownGraph): RowInk[] {
  const now = drilledFiles(results[index * 2]?.data);
  const planned = drilledFiles(results[index * 2 + 1]?.data);
  return shown === 'planned' ? rowsFor(planned, now) : rowsFor(now, planned);
}

function rowsMap(packages: string[], results: readonly RowResult[], shown: ShownGraph): Map<string, RowInk[]> {
  const map = new Map<string, RowInk[]>();
  packages.forEach((id, index) => {
    map.set(id, rowPair(results, index, shown));
  });
  return map;
}

function addedInk(shown: ShownGraph, edits: PlanEdit[], stale: (string | null)[], view: GraphView, ids: Set<string>): ViewEdge[] {
  if (shown !== 'now') return [];
  return marksInView(addedMarkers(edits, stale, view.edges), ids);
}

type InkInput = {
  slug: string | null;
  shown: ShownGraph;
  state: GraphState;
  other: GraphState;
  rows: Map<string, RowInk[]>;
  pins: Record<string, Pin>;
  edits: PlanEdit[];
  stale: (string | null)[];
};

function otherViewOf(other: GraphState): GraphView | undefined {
  return other.kind === 'ok' ? other.view : undefined;
}

function buildInk(input: InkInput): PlanInk | null {
  if (input.slug === null || input.state.kind !== 'ok') return null;
  const ids = idsOf(input.state);
  return {
    rows: input.rows,
    ghosts: ghostBoxes(input.state.view.nodes, otherViewOf(input.other), input.pins),
    cuts: marksInView(liveCuts(input.edits, input.stale), ids),
    added: addedInk(input.shown, input.edits, input.stale, input.state.view, ids),
    notes: noteInk(input.edits, input.stale),
  };
}

function slugKey(slug: string | null): string {
  return slug ?? '';
}

function editsOf(doc: PlanDoc | null): PlanEdit[] {
  return doc?.edits ?? [];
}

function staleFieldOf(state: GraphState): (string | null)[] | undefined {
  return state.kind === 'ok' ? state.view.stale : undefined;
}

function showingPlanned(shown: ShownGraph, slug: string | null): boolean {
  return shown === 'planned' && slug !== null;
}

function detailPlanKey(planned: boolean, slug: string | null): string {
  return planned ? slugKey(slug) : '';
}

function plannedEnabled(layout: LayoutDoc | undefined, slug: string | null): boolean {
  return layout !== undefined && slug !== null;
}

function rowPackagesOf(slug: string | null, state: GraphState): string[] {
  if (slug === null || state.kind !== 'ok') return [];
  return state.view.nodes.filter(node => node.kind === 'package').map(node => node.id);
}

function edgesOfState(state: GraphState): ViewEdge[] {
  return state.kind === 'ok' ? state.view.edges : [];
}

function planChangerOf(handler: ((plan: string | null) => void) | undefined): (plan: string | null) => void {
  return handler ?? (() => undefined);
}

function overlayOf(settings: LayoutSettings): OverlayName {
  return settings.overlay ?? 'none';
}

function canUndoOf(doc: PlanDoc | null): boolean {
  return doc !== null && doc.edits.length > 0;
}

function canRedoOf(doc: PlanDoc | null): boolean {
  return doc !== null && doc.redo.length > 0;
}

function planTargetOf(slug: string | null, kind: GraphNode['kind'] | null, event: unknown): string | null {
  if (slug === null || kind !== 'file') return null;
  return planDropTarget(event);
}

function crumbDrops(slug: string | null, tryMove: (file: string, dir: string) => boolean): ((file: string, dir: string) => boolean) | null {
  return slug === null ? null : tryMove;
}

function buildPlanning(slug: string | null, ink: PlanInk | null, handlers: Omit<Planning, 'ink'>): Planning | null {
  if (slug === null || ink === null) return null;
  return { ink, ...handlers };
}

function PlanToolbar(
  props: Readonly<{
    slug: string | null;
    plans: PlanSummary[];
    shown: ShownGraph;
    onChoosePlan: (slug: string | null) => void;
    onNewPlan: () => void;
    onDeletePlan: () => void;
    onShown: (shown: ShownGraph) => void;
  }>,
) {
  return (
    <>
      <PlanSelect value={planChoice(props.slug, props.plans)} plans={props.plans} labels={planLabels(props.plans)} onChoose={props.onChoosePlan} />
      <button type="button" onClick={props.onNewPlan}>
        New plan…
      </button>
      <button type="button" disabled={props.slug === null} onClick={props.onDeletePlan}>
        Delete plan
      </button>
      {props.slug === null ? null : <ShownSwitch shown={props.shown} onChoose={props.onShown} />}
    </>
  );
}

function PlanNotice(props: Readonly<{ slug: string | null; text: string | null }>) {
  if (props.slug === null) return null;
  return <Notice text={props.text} />;
}

function PlanChanges(
  props: Readonly<{
    slug: string | null;
    doc: PlanDoc | null;
    entries: ChangeEntry[];
    onUndo: () => void;
    onRedo: () => void;
    onPick: (entry: ChangeEntry) => void;
    onRemove: (index: number) => void;
  }>,
) {
  if (props.slug === null) return null;
  return (
    <ChangeList
      entries={props.entries}
      canUndo={canUndoOf(props.doc)}
      canRedo={canRedoOf(props.doc)}
      onUndo={props.onUndo}
      onRedo={props.onRedo}
      onPick={props.onPick}
      onRemove={props.onRemove}
    />
  );
}

function DeleteSlot(props: Readonly<{ target: string; name: string; onDelete: (slug: string) => void; onCancel: () => void }>) {
  return <DeletePlanDialog name={props.name} onDelete={() => props.onDelete(props.target)} onCancel={props.onCancel} />;
}

function NoteSlot(props: Readonly<{ target: NoteTarget; onAdd: (target: NoteTarget, text: string) => void; onCancel: () => void }>) {
  return <NoteDialog error={null} onAdd={text => props.onAdd(props.target, text)} onCancel={props.onCancel} />;
}

function PlanDialogs(
  props: Readonly<{
    newPlanOpen: boolean;
    newPlanError: string | null;
    deleteTarget: string | null;
    deleteName: string;
    noteTarget: NoteTarget | null;
    onCreatePlan: (name: string) => void;
    onCancelNew: () => void;
    onDeletePlan: (slug: string) => void;
    onCancelDelete: () => void;
    onAddNote: (target: NoteTarget, text: string) => void;
    onCancelNote: () => void;
  }>,
) {
  return (
    <>
      {props.newPlanOpen ? <NewPlanDialog error={props.newPlanError} onCreate={props.onCreatePlan} onCancel={props.onCancelNew} /> : null}
      {props.deleteTarget === null ? null : <DeleteSlot target={props.deleteTarget} name={props.deleteName} onDelete={props.onDeletePlan} onCancel={props.onCancelDelete} />}
      {props.noteTarget === null ? null : <NoteSlot target={props.noteTarget} onAdd={props.onAddNote} onCancel={props.onCancelNote} />}
    </>
  );
}

function ArchPane(props: Readonly<ArchViewProps & { slug: string | null }>) {
  const queryClient = useQueryClient();
  const layoutQuery = useQuery({
    queryKey: ['layout', props.token] as const,
    queryFn: () => fetchLayout(props.token, props.fetcher),
  });
  const settings = settingsOf(layoutQuery.data);
  const slug = props.slug;
  const plansQuery = useQuery({
    queryKey: ['plans', props.token] as const,
    queryFn: () => fetchPlans(props.token, props.fetcher),
  });
  const planQuery = useQuery({
    queryKey: ['plan', props.token, slugKey(slug)] as const,
    queryFn: () => fetchPlan(props.token, slugKey(slug), props.fetcher),
    enabled: slug !== null,
  });
  const nowQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external, ''] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, settings),
    enabled: layoutQuery.data !== undefined,
  });
  const plannedQuery = useQuery({
    queryKey: ['graph', props.token, props.at, settings.tests, settings.external, slugKey(slug)] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, { ...settings, plan: slugKey(slug) }),
    enabled: plannedEnabled(layoutQuery.data, slug),
  });
  const [shown, setShown] = useState<ShownGraph>('planned');
  const [picked, setPicked] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [marked, setMarked] = useState<MarkSel | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanError, setNewPlanError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nowState = graphStateOf(nowQuery.data, nowQuery.isPending);
  const plannedState = graphStateOf(plannedQuery.data, plannedQuery.isPending);
  const plannedShown = showingPlanned(shown, slug);
  const state = plannedShown ? plannedState : nowState;
  const otherState = plannedShown ? nowState : plannedState;
  const ids = useMemo(() => idsOf(state), [state]);
  const chosen = chosenId(picked, armed, ids);
  const detailPlan = detailPlanKey(plannedShown, slug);
  const detailQuery = useQuery({
    queryKey: ['detail', props.token, props.at, detailId(chosen), settings.tests, settings.external, detailPlan] as const,
    queryFn: () => fetchDetail(props.token, detailId(chosen), props.at, props.fetcher, { ...settings, plan: detailPlan }),
    enabled: detailOn(chosen),
  });
  const body = detailBody(chosen, detailQuery.data, keptDetail);
  useEffect(() => {
    keptDetail = body;
  }, [body]);
  const plans = plansOf(plansQuery.data);
  const doc = planDocOf(planQuery.data);
  const edits = state.kind === 'ok' ? editsOf(doc) : [];
  const staleArr = staleList(edits, staleFieldOf(plannedState));
  const pins = pinsOf(layoutQuery.data, props.at);
  const spots = useMemo(() => spotsOf(state, pins), [state, pins]);
  const center = useCenterOn(spots);
  const rowPackages = rowPackagesOf(slug, state);
  const rowResults = useQueries({ queries: rowPackages.flatMap(id => rowQueriesFor(props.token, props.fetcher, id, settings, slugKey(slug))) });
  const rows = rowsMap(rowPackages, rowResults, shown);
  const ink = buildInk({ slug, shown, state, other: otherState, rows, pins, edits, stale: staleArr });
  const plannedEdges = edgesOfState(plannedState);

  const changePlan = planChangerOf(props.onPlanChange);

  const store = (next: LayoutDoc): void => {
    queryClient.setQueryData(['layout', props.token], next);
    void putLayout(props.token, next, props.fetcher);
  };
  const savePlan = (next: PlanDoc): void => {
    void putPlan(props.token, next, props.fetcher).then(async saved => {
      if ('error' in saved) {
        setNotice(saved.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.setQueryData(['plan', props.token, slugKey(slug)], saved);
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    });
  };
  const withDoc = (action: (current: PlanDoc) => void): void => {
    if (doc === null) return;
    action(doc);
  };
  const editPlan = (edit: PlanEdit): void => {
    withDoc(current => {
      savePlan(withEdit(current, edit));
      setNotice(null);
    });
  };
  const undoEdit = (): void => {
    withDoc(current => {
      if (current.edits.length === 0) return;
      savePlan(withUndo(current));
      setNotice(null);
    });
  };
  const redoEdit = (): void => {
    withDoc(current => {
      if (current.redo.length === 0) return;
      savePlan(withRedo(current));
      setNotice(null);
    });
  };
  const removeEdit = (index: number): void => {
    withDoc(current => {
      savePlan(withoutEdit(current, index));
      setNotice(null);
    });
  };
  const tryMove = (file: string, dir: string): boolean => {
    if (parentDir(file) === dir) return false;
    editPlan({ kind: 'move-file', file, to: dir === '' ? '.' : dir });
    return true;
  };
  const cutRealArrow = async (from: string, to: string): Promise<void> => {
    if (!plannedEdges.some(edge => edge.from === from && edge.to === to)) {
      setNotice(`no such arrow ${from} → ${to}`);
      return;
    }
    const pairs = await fetchPairs(props.token, from, to, props.at, { ...settings, plan: slugKey(slug) }, props.fetcher);
    if ('error' in pairs) {
      setNotice(pairs.error);
      return;
    }
    if (pairs.pairs.length === 0) {
      setNotice(`no such arrow ${from} → ${to}`);
      return;
    }
    editPlan({ kind: 'cut-edge', from, to, files: pairs.pairs });
  };
  const cutArrow = async (from: string, to: string): Promise<void> => {
    if (slug === null) return;
    const added = addEdgeIndex(edits, staleArr, from, to);
    if (added !== -1) {
      removeEdit(added);
      return;
    }
    await cutRealArrow(from, to);
  };
  const drawEdge = (from: string, to: string): void => {
    if (from === to) {
      setNotice('a box cannot depend on itself');
      return;
    }
    if (plannedEdges.some(edge => edge.from === from && edge.to === to)) {
      setNotice(`${from} already imports ${to}`);
      return;
    }
    editPlan({ kind: 'add-edge', from, to });
  };
  const addNote = (target: NoteTarget, text: string): void => {
    editPlan({ kind: 'note', target, text });
    setNoteTarget(null);
  };
  const openPlanned = (path: string): void => {
    props.onOpenFile(diskPathOf(path, edits, staleArr));
  };
  const pickNodeTarget = (id: string): void => {
    setFocus({ kind: 'node', id });
    setMarked(null);
    if (ids.has(id)) {
      setPicked(id);
      return;
    }
    setArmed(id);
    props.onDrill(parentDir(id));
  };
  const pickArrowTarget = (from: string, to: string, cut: boolean): void => {
    setMarked({ from, to, cut });
    setPicked(null);
    setArmed(null);
    setFocus({ kind: 'arrow', from, to });
    const viewAt = arrowViewAt(from, to);
    if (viewAt === props.at) return;
    props.onDrill(viewAt);
  };
  const pickTarget = (target: EntryTarget): void => {
    if (target.kind === 'node') pickNodeTarget(target.id);
    else pickArrowTarget(target.from, target.to, target.cut);
  };
  const pickEntry = (entry: ChangeEntry): void => {
    if (entry.stale !== null) {
      setNotice(entry.stale);
      return;
    }
    pickTarget(entryTarget(entry.edit));
  };
  const deleteMarked = (): void => {
    if (marked === null || marked.cut) return;
    void cutArrow(marked.from, marked.to);
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
  };
  const dropNode = (id: string, kind: GraphNode['kind'] | null, x: number, y: number, event: unknown): void => {
    const target = planTargetOf(slug, kind, event);
    if (target !== null && tryMove(id, target)) return;
    commitLayout(layoutQuery.data, doc0 => withPin(doc0, props.at, id, { x, y }), store);
  };
  const createPlan = async (name: string): Promise<void> => {
    const created = await postPlan(props.token, name, props.fetcher);
    if ('error' in created) {
      setNewPlanError(created.error);
      return;
    }
    setNewPlanOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['plans'] });
    changePlan(created.slug);
  };
  const removeCurrentPlan = async (target: string): Promise<void> => {
    const removed = await deletePlan(props.token, target, props.fetcher);
    if ('error' in removed) {
      setNotice(removed.error);
      return;
    }
    changePlan(null);
    await queryClient.invalidateQueries({ queryKey: ['plans'] });
  };
  const rescan = async (): Promise<void> => {
    await postRescan(props.token, props.fetcher);
    await queryClient.invalidateQueries({ queryKey: ['graph'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
  };

  useEffect(() => {
    const actions: Record<string, () => void> = { undo: undoEdit, redo: redoEdit, delete: deleteMarked };
    const onKey = (event: KeyboardEvent) => {
      const action = keyActionOf(event.key, event.ctrlKey || event.metaKey, event.shiftKey, fieldTarget(event.target));
      if (action !== null) actions[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const overlay = overlayOf(settings);
  const flags = reportFlags(state);
  const planning = buildPlanning(slug, ink, {
    onDropFile: tryMove,
    onDrawEdge: drawEdge,
    onCutEdge: cutArrow,
    onAddNote: setNoteTarget,
    onOpenPlanned: openPlanned,
  });
  const openBox = (id: string, kind: GraphNode['kind'] | null): void => {
    if (kind === 'package') {
      props.onDrill(id);
      return;
    }
    if (kind !== 'file') return;
    if (planning === null) props.onOpenFile(id);
    else openPlanned(id);
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
          onDropFile={crumbDrops(slug, tryMove)}
        />
        <PlanToolbar
          slug={slug}
          plans={plans}
          shown={shown}
          onChoosePlan={changePlan}
          onNewPlan={() => {
            setNewPlanError(null);
            setNewPlanOpen(true);
          }}
          onDeletePlan={() => setDeleteTarget(slug)}
          onShown={setShown}
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
        <button type="button" onClick={() => commitLayout(layoutQuery.data, doc0 => withoutView(doc0, props.at), store)}>
          Reset layout
        </button>
        <button type="button" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <PlanNotice slug={slug} text={notice} />
      <MetricsDrawer open={metricsOpen} boxes={packageBoxes(state)} onPick={pickMetric} />
      <div className="arch-body">
        <CanvasArea
          state={state}
          spots={spots}
          hover={hover}
          chosen={chosen}
          marked={marked}
          overlay={overlay}
          crapMax={crapMaxOf(state)}
          planning={planning}
          focus={focus}
          onHover={setHover}
          onSelect={id => {
            setPicked(id);
            setMarked(null);
          }}
          onSelectMark={mark => {
            setMarked(mark);
            setPicked(null);
            setArmed(null);
          }}
          onClear={clearSelection}
          onOpen={openBox}
          onDropNode={dropNode}
        />
        <PlanChanges
          slug={slug}
          doc={doc}
          entries={changeEntries(edits, staleArr)}
          onUndo={undoEdit}
          onRedo={redoEdit}
          onPick={pickEntry}
          onRemove={removeEdit}
        />
        <DetailSlot data={body} onPick={pickMetric} />
      </div>
      <PlanDialogs
        newPlanOpen={newPlanOpen}
        newPlanError={newPlanError}
        deleteTarget={deleteTarget}
        deleteName={deleteNameOf(plans, deleteTarget, doc)}
        noteTarget={noteTarget}
        onCreatePlan={name => void createPlan(name)}
        onCancelNew={() => setNewPlanOpen(false)}
        onDeletePlan={target => void removeCurrentPlan(target)}
        onCancelDelete={() => setDeleteTarget(null)}
        onAddNote={addNote}
        onCancelNote={() => setNoteTarget(null)}
      />
    </div>
  );
}

export function ArchView(props: Readonly<ArchViewProps>) {
  const slug = props.plan ?? null;
  return (
    <CanvasProvider>
      <ArchPane key={slug ?? ''} {...props} slug={slug} />
    </CanvasProvider>
  );
}
