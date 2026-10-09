import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import {
  addEdgeIndex,
  withEdit,
  withRedo,
  withUndo,
  withoutEdit,
  type NoteTarget,
  type PlanDoc,
  type PlanEdit,
} from '../domain/plan.ts';
import { deletePlan, fetchGraph, fetchPairs, fetchPlan, fetchPlans, postPlan, putPlan } from './client.ts';
import { parentDir } from './draw.ts';
import { ChangeList, DeletePlanDialog, NewPlanDialog, NoteDialog, Notice, PlanSelect, ShownSwitch } from './PlanBar.tsx';
import { FILE_DRAG_MIME, fieldTarget, keyActionOf, planDropTarget } from './plangesture.ts';
import { arrowViewAt, entryTarget, planPicture, type Planning, type PlanInk, type ShownGraph } from './planpicture.ts';
import { planRoster } from './planroster.ts';

type Picture = ReturnType<typeof planPicture>;

type Pin = { x: number; y: number };

type ArrowEnds = { from: string; to: string };

type PlanSessionProps = {
  token: string;
  fetcher: typeof fetch;
  at: string;
  slug: string | null;
  tests: boolean;
  external: boolean;
  pins: Record<string, Pin>;
  shown: ShownGraph;
  ready: boolean;
  nodes: GraphNode[];
  edges: ViewEdge[];
  other: GraphView | undefined;
  planned: GraphView | undefined;
  ids: Set<string>;
  deletable: ArrowEnds | null;
  onShown: (shown: ShownGraph) => void;
  onPlanChange: (plan: string | null) => void;
  onDrill: (dir: string) => void;
  onOpenFile: (path: string) => void;
  onPickNode: (id: string) => void;
  onPickArrow: (from: string, to: string, cut: boolean) => void;
};

type PlanSessionView = {
  toolbar: ReactNode;
  notice: ReactNode;
  changes: ReactNode;
  dialogs: ReactNode;
  planning: Planning | null;
  moveFile: (file: string, dir: string) => boolean;
  openFile: (path: string) => void;
  dropTarget: (kind: GraphNode['kind'] | null, event: unknown) => string | null;
  dropOnCrumb: (event: { preventDefault(): void; dataTransfer: { getData(mime: string): string } }, at: string) => void;
};

type RowResult = { data?: GraphView | { error: string } };

function slugKey(slug: string | null): string {
  return slug ?? '';
}

function editsOf(doc: PlanDoc | null): PlanEdit[] {
  if (doc === null) return [];
  return doc.edits;
}

function readyEdits(ready: boolean, doc: PlanDoc | null): PlanEdit[] {
  if (!ready) return [];
  return editsOf(doc);
}

function packageIds(slug: string | null, ready: boolean, nodes: GraphNode[]): string[] {
  if (slug === null || !ready) return [];
  return nodes.filter(node => node.kind === 'package').map(node => node.id);
}

function rowQuery(token: string, fetcher: typeof fetch, id: string, tests: boolean, external: boolean, plan: string) {
  return {
    queryKey: ['graph', token, id, tests, external, plan] as const,
    queryFn: () => fetchGraph(token, id, fetcher, { tests, external, plan }),
  };
}

function rowQueriesFor(token: string, fetcher: typeof fetch, id: string, tests: boolean, external: boolean, slug: string) {
  return [rowQuery(token, fetcher, id, tests, external, ''), rowQuery(token, fetcher, id, tests, external, slug)];
}

function rowData(results: readonly RowResult[], index: number): GraphView | { error: string } | undefined {
  return results[index]?.data;
}

function zipped(ids: string[], results: readonly RowResult[]) {
  return ids.map((id, index) => ({ id, now: rowData(results, index * 2), planned: rowData(results, index * 2 + 1) }));
}

function loadedPicture(slug: string | null, input: Parameters<typeof planPicture>[0]): Picture | null {
  if (slug === null) return null;
  return planPicture(input);
}

function visibleInk(ready: boolean, picture: Picture | null): PlanInk | null {
  if (!ready || picture === null) return null;
  return picture.ink;
}

function visibleEntries(ready: boolean, picture: Picture | null): Picture['entries'] {
  if (!ready || picture === null) return [];
  return picture.entries;
}

function reasonsOf(ready: boolean, picture: Picture | null): (string | null)[] {
  return visibleEntries(ready, picture).map(entry => entry.stale);
}

function identityPath(path: string): string {
  return path;
}

function diskOf(picture: Picture | null): (path: string) => string {
  if (picture === null) return identityPath;
  return picture.diskPath;
}

function planActive(slug: string | null, ink: PlanInk | null): boolean {
  return slug !== null && ink !== null;
}

function pathFor(active: boolean, disk: (path: string) => string, path: string): string {
  if (!active) return identityPath(path);
  return disk(path);
}

function movedTo(dir: string): string {
  return dir === '' ? '.' : dir;
}

function planningOf(slug: string | null, ink: PlanInk | null, handlers: Omit<Planning, 'ink'>): Planning | null {
  if (slug === null || ink === null) return null;
  return { ink, ...handlers };
}

function canUndoOf(doc: PlanDoc | null): boolean {
  return doc !== null && doc.edits.length > 0;
}

function canRedoOf(doc: PlanDoc | null): boolean {
  return doc !== null && doc.redo.length > 0;
}

function PlanToolbar(
  props: Readonly<{
    slug: string | null;
    plans: ReturnType<typeof planRoster>['plans'];
    labels: Map<string, string>;
    choice: string;
    shown: ShownGraph;
    onChoosePlan: (slug: string | null) => void;
    onNewPlan: () => void;
    onDeletePlan: () => void;
    onShown: (shown: ShownGraph) => void;
  }>,
) {
  return (
    <>
      <PlanSelect value={props.choice} plans={props.plans} labels={props.labels} onChoose={props.onChoosePlan} />
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
    entries: Picture['entries'];
    onUndo: () => void;
    onRedo: () => void;
    onPick: (entry: Picture['entries'][number]) => void;
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

function dropTargetOf(slug: string | null, kind: GraphNode['kind'] | null, event: unknown): string | null {
  if (slug === null || kind !== 'file') return null;
  return planDropTarget(event);
}

function sameDir(file: string, dir: string): boolean {
  return parentDir(file) === dir;
}

export function usePlanSession(props: Readonly<PlanSessionProps>): PlanSessionView {
  const queryClient = useQueryClient();
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
  const [notice, setNotice] = useState<string | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanError, setNewPlanError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const roster = planRoster(plansQuery.data, planQuery.data, slug, deleteTarget);
  const doc = roster.doc;
  const edits = readyEdits(props.ready, doc);
  const packages = packageIds(slug, props.ready, props.nodes);
  const rowResults = useQueries({
    queries: packages.flatMap(id => rowQueriesFor(props.token, props.fetcher, id, props.tests, props.external, slugKey(slug))),
  });
  const picture = loadedPicture(slug, {
    shown: props.shown,
    nodes: props.nodes,
    other: props.other,
    pins: props.pins,
    edits,
    stale: props.planned?.stale,
    edges: props.edges,
    ids: props.ids,
    packages: zipped(packages, rowResults),
  });
  const ink = visibleInk(props.ready, picture);
  const active = planActive(slug, ink);
  const disk = diskOf(picture);
  const entries = visibleEntries(props.ready, picture);
  const stale = reasonsOf(props.ready, picture);
  const plannedEdges = props.planned?.edges ?? [];

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
  const moveFile = (file: string, dir: string): boolean => {
    if (sameDir(file, dir)) return false;
    editPlan({ kind: 'move-file', file, to: movedTo(dir) });
    return true;
  };
  const cutRealArrow = async (from: string, to: string): Promise<void> => {
    if (!plannedEdges.some(edge => edge.from === from && edge.to === to)) {
      setNotice(`no such arrow ${from} → ${to}`);
      return;
    }
    const pairs = await fetchPairs(props.token, from, to, props.at, { tests: props.tests, external: props.external, plan: slugKey(slug) }, props.fetcher);
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
    const added = addEdgeIndex(edits, stale, from, to);
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
  const openFile = (path: string): void => {
    props.onOpenFile(pathFor(active, disk, path));
  };
  const pickArrow = (from: string, to: string, cut: boolean): void => {
    props.onPickArrow(from, to, cut);
    const viewAt = arrowViewAt(from, to);
    if (viewAt === props.at) return;
    props.onDrill(viewAt);
  };
  const applyTarget = (target: ReturnType<typeof entryTarget>): void => {
    if (target.kind === 'node') props.onPickNode(target.id);
    else pickArrow(target.from, target.to, target.cut);
  };
  const pickEntry = (entry: Picture['entries'][number]): void => {
    if (entry.stale !== null) {
      setNotice(entry.stale);
      return;
    }
    applyTarget(entryTarget(entry.edit));
  };
  const deleteMarked = (): void => {
    if (props.deletable === null) return;
    void cutArrow(props.deletable.from, props.deletable.to);
  };
  const createPlan = async (name: string): Promise<void> => {
    const created = await postPlan(props.token, name, props.fetcher);
    if ('error' in created) {
      setNewPlanError(created.error);
      return;
    }
    setNewPlanOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['plans'] });
    props.onPlanChange(created.slug);
  };
  const removeCurrentPlan = async (target: string): Promise<void> => {
    const removed = await deletePlan(props.token, target, props.fetcher);
    if ('error' in removed) {
      setNotice(removed.error);
      return;
    }
    props.onPlanChange(null);
    await queryClient.invalidateQueries({ queryKey: ['plans'] });
  };
  const dropTarget = (kind: GraphNode['kind'] | null, event: unknown): string | null => dropTargetOf(slug, kind, event);
  const dropOnCrumb = (event: { preventDefault(): void; dataTransfer: { getData(mime: string): string } }, at: string): void => {
    event.preventDefault();
    const file = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (file !== '') moveFile(file, at);
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

  const planning = planningOf(slug, ink, {
    onDropFile: moveFile,
    onDrawEdge: drawEdge,
    onCutEdge: cutArrow,
    onAddNote: setNoteTarget,
    onOpenPlanned: openFile,
  });

  return {
    toolbar: (
      <PlanToolbar
        slug={slug}
        plans={roster.plans}
        labels={roster.labels}
        choice={roster.choice}
        shown={props.shown}
        onChoosePlan={props.onPlanChange}
        onNewPlan={() => {
          setNewPlanError(null);
          setNewPlanOpen(true);
        }}
        onDeletePlan={() => setDeleteTarget(slug)}
        onShown={props.onShown}
      />
    ),
    notice: <PlanNotice slug={slug} text={notice} />,
    changes: (
      <PlanChanges
        slug={slug}
        doc={doc}
        entries={entries}
        onUndo={undoEdit}
        onRedo={redoEdit}
        onPick={pickEntry}
        onRemove={removeEdit}
      />
    ),
    dialogs: (
      <PlanDialogs
        newPlanOpen={newPlanOpen}
        newPlanError={newPlanError}
        deleteTarget={deleteTarget}
        deleteName={roster.deleteName}
        noteTarget={noteTarget}
        onCreatePlan={name => void createPlan(name)}
        onCancelNew={() => setNewPlanOpen(false)}
        onDeletePlan={target => void removeCurrentPlan(target)}
        onCancelDelete={() => setDeleteTarget(null)}
        onAddNote={addNote}
        onCancelNote={() => setNoteTarget(null)}
      />
    ),
    planning,
    moveFile,
    openFile,
    dropTarget,
    dropOnCrumb,
  };
}
