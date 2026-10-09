import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import {
  addEdgeIndex,
  byStrings,
  childPath,
  parentOf,
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
import {
  CanvasMenu,
  ChangeList,
  DeletePlanDialog,
  MergeDialog,
  NewPackageDialog,
  NewPlanDialog,
  NoteDialog,
  Notice,
  PlanSelect,
  RenameDialog,
  ShownSwitch,
  SplitDialog,
} from './PlanBar.tsx';
import { FILE_DRAG_MIME, fieldTarget, keyActionOf, planDropTarget } from './plangesture.ts';
import { arrowViewAt, entryTarget, planPicture, type Planning, type PlanInk, type ShownGraph } from './planpicture.ts';
import { planRoster } from './planroster.ts';
import { fileRenameName, mergeTarget, nameProblem, relativeTo, siblingPath, splitParts, splitProblem, takenProblem } from './reshape.ts';

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
  edges: ViewEdge[] | undefined;
  other: GraphView | undefined;
  planned: GraphView | undefined;
  ids: Set<string>;
  selection: string[];
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
  pickFile: (id: string) => boolean;
};

type NameAsk = { mode: 'create' } | { mode: 'rename'; id: string; kind: 'package' | 'file' } | { mode: 'merge' };

type SplitAsk = { pkg: string; files: string[] };

function editsOf(doc: PlanDoc | null): PlanEdit[] {
  if (doc === null) return [];
  return doc.edits;
}

function packageIds(nodes: GraphNode[]): string[] {
  return nodes.filter(node => node.kind === 'package').map(node => node.id);
}

type RowPair = { id: string; now: GraphView | { error: string }; planned: GraphView | { error: string } };

type RowResult = { data?: RowPair };

function rowQueryFor(token: string, fetcher: typeof fetch, id: string, tests: boolean, external: boolean, slug: string) {
  return {
    queryKey: ['graph', 'rows', token, id, tests, external, slug] as const,
    queryFn: async (): Promise<RowPair> => {
      const [now, planned] = await Promise.all([
        fetchGraph(token, id, fetcher, { tests, external }),
        fetchGraph(token, id, fetcher, { tests, external, plan: slug }),
      ]);
      return { id, now, planned };
    },
  };
}

function rowPackages(results: readonly RowResult[]): RowPair[] {
  return results.map(result => result.data).filter((data): data is RowPair => data !== undefined);
}

function rowQueriesFor(token: string, fetcher: typeof fetch, nodes: GraphNode[], tests: boolean, external: boolean, slug: string | null) {
  if (slug === null) return [];
  return packageIds(nodes).map(id => rowQueryFor(token, fetcher, id, tests, external, slug));
}

function visibleEntries(ready: boolean, picture: Picture): Picture['entries'] {
  if (!ready) return [];
  return picture.entries;
}

function reasonsOf(entries: Picture['entries']): (string | null)[] {
  return entries.map(entry => entry.stale);
}

function movedTo(dir: string): string {
  return dir === '' ? '.' : dir;
}

function planningOf(slug: string | null, ink: PlanInk, handlers: Omit<Planning, 'ink'>): Planning | null {
  if (slug === null) return null;
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
    onNewPackage: () => void;
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
      {props.slug === null ? null : <CanvasMenu onNewPackage={props.onNewPackage} />}
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

function NameSlot(props: Readonly<{ ask: NameAsk; error: string | null; onSubmit: (name: string) => void; onCancel: () => void }>) {
  if (props.ask.mode === 'create') return <NewPackageDialog error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
  if (props.ask.mode === 'merge') return <MergeDialog error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
  return <RenameDialog error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
}

function ReshapeDialogs(
  props: Readonly<{
    nameAsk: NameAsk | null;
    splitAsk: SplitAsk | null;
    error: string | null;
    onName: (ask: NameAsk, name: string) => void;
    onSplit: (ask: SplitAsk, names: string[], assigned: Record<string, string>) => void;
    onCancel: () => void;
  }>,
) {
  const nameAsk = props.nameAsk;
  const splitAsk = props.splitAsk;
  return (
    <>
      {nameAsk === null ? null : <NameSlot ask={nameAsk} error={props.error} onSubmit={name => props.onName(nameAsk, name)} onCancel={props.onCancel} />}
      {splitAsk === null ? null : (
        <SplitDialog
          files={splitAsk.files.map(path => ({ path, label: relativeTo(splitAsk.pkg, path) }))}
          error={props.error}
          onSplit={(names, assigned) => props.onSplit(splitAsk, names, assigned)}
          onCancel={props.onCancel}
        />
      )}
    </>
  );
}

function nodeIdsOf(view: GraphView | undefined): Set<string> {
  return new Set((view?.nodes ?? []).map(node => node.id));
}

function kindOf(nodes: GraphNode[], id: string): GraphNode['kind'] | undefined {
  return nodes.find(node => node.id === id)?.kind;
}

function selectedPackages(nodes: GraphNode[], selection: string[]): GraphNode[] {
  return nodes.filter(node => node.kind === 'package' && selection.includes(node.id)).sort((a, b) => a.id.localeCompare(b.id));
}

function idsIn(nodes: GraphNode[]): string[] {
  return nodes.map(node => node.id);
}

async function filesUnder(token: string, dir: string, slug: string, fetcher: typeof fetch): Promise<string[]> {
  const view = await fetchGraph(token, dir, fetcher, { tests: true, external: false, plan: slug });
  if ('error' in view) return [];
  const nested = await Promise.all(view.nodes.filter(node => node.kind === 'package').map(node => filesUnder(token, node.id, slug, fetcher)));
  return [...view.nodes.filter(node => node.kind === 'file').map(node => node.id), ...nested.flat()].sort(byStrings);
}

async function boxShown(token: string, id: string, query: { tests: boolean; external: boolean; plan: string | null }, fetcher: typeof fetch): Promise<boolean> {
  const view = await fetchGraph(token, parentOf(id), fetcher, query);
  return !('error' in view) && view.nodes.some(node => node.id === id);
}

function plannedHas(planned: GraphView | undefined, from: string, to: string): boolean {
  return planned !== undefined && planned.edges.some(edge => edge.from === from && edge.to === to);
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
    queryKey: ['plan', props.token, slug] as const,
    queryFn: () => fetchPlan(props.token, String(slug), props.fetcher),
    enabled: slug !== null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanError, setNewPlanError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [nameAsk, setNameAsk] = useState<NameAsk | null>(null);
  const [splitAsk, setSplitAsk] = useState<SplitAsk | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [foldFrom, setFoldFrom] = useState<string | null>(null);
  const roster = planRoster(plansQuery.data, planQuery.data, slug, deleteTarget);
  const doc = roster.doc;
  const edits = editsOf(doc);
  const rowResults = useQueries({
    queries: rowQueriesFor(props.token, props.fetcher, props.nodes, props.tests, props.external, slug),
  });
  const picture = planPicture({
    shown: props.shown,
    nodes: props.nodes,
    other: props.other,
    pins: props.pins,
    edits,
    stale: props.planned?.stale,
    edges: props.edges,
    ids: props.ids,
    packages: rowPackages(rowResults),
    warnings: props.planned?.warnings,
  });
  const disk = picture.diskPath;
  const entries = visibleEntries(props.ready, picture);
  const stale = reasonsOf(entries);

  const savePlan = (next: PlanDoc): void => {
    void putPlan(props.token, next, props.fetcher).then(async saved => {
      if ('error' in saved) {
        setNotice(saved.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.setQueryData(['plan', props.token, slug], saved);
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
    if (!plannedHas(props.planned, from, to)) {
      setNotice(`no such arrow ${from} → ${to}`);
      return;
    }
    const pairs = await fetchPairs(props.token, from, to, props.at, { tests: props.tests, external: props.external, plan: slug }, props.fetcher);
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
    if (plannedHas(props.planned, from, to)) {
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
    props.onOpenFile(disk(path));
  };
  const pickArrow = (from: string, to: string, cut: boolean): void => {
    props.onPickArrow(from, to, cut);
    const viewAt = arrowViewAt(from, to);
    if (viewAt === props.at) return;
    props.onDrill(viewAt);
  };
  const pickBox = async (id: string): Promise<void> => {
    if (props.ids.has(id) || (await boxShown(props.token, id, { tests: props.tests, external: props.external, plan: slug }, props.fetcher))) {
      props.onPickNode(id);
      return;
    }
    setNotice(`no such box ${id}`);
  };
  const applyTarget = (target: ReturnType<typeof entryTarget>): void => {
    if (target.kind === 'node') props.onPickNode(target.id);
    else if (target.kind === 'box') void pickBox(target.id);
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
    props.onPlanChange(created.slug);
  };
  const removeCurrentPlan = async (target: string): Promise<void> => {
    const removed = await deletePlan(props.token, target, props.fetcher);
    if ('error' in removed) {
      setNotice(removed.error);
      return;
    }
    props.onPlanChange(null);
  };
  const closeAsk = (): void => {
    setNameAsk(null);
    setSplitAsk(null);
    setAskError(null);
  };
  const ask = (next: NameAsk): void => {
    closeAsk();
    setNameAsk(next);
  };
  const storeOr = (problem: string | null, edit: PlanEdit): void => {
    if (problem !== null) {
      setAskError(problem);
      return;
    }
    editPlan(edit);
    closeAsk();
  };
  const taken = (): Set<string> => nodeIdsOf(props.planned);
  const freshNameProblem = (name: string, path: string): string | null => nameProblem(name) ?? takenProblem(path, taken());
  const createPackage = (name: string): void => {
    const path = childPath(props.at, name);
    storeOr(freshNameProblem(name, path), { kind: 'create-package', path });
  };
  const storeRename = (id: string, name: string, edit: PlanEdit): void => {
    const dest = siblingPath(id, name);
    if (dest === id) closeAsk();
    else storeOr(freshNameProblem(name, dest), edit);
  };
  const renamePackage = (id: string, name: string): void => {
    storeRename(id, name, { kind: 'rename-package', from: id, to: siblingPath(id, name) });
  };
  const renameFile = (id: string, typed: string): void => {
    const name = fileRenameName(id, typed);
    storeRename(id, name, { kind: 'rename-file', from: id, to: name });
  };
  const mergeSelected = (name: string): void => {
    const chosen = selectedPackages(props.nodes, props.selection);
    const into = mergeTarget(name, props.at, chosen);
    const packages = idsIn(chosen);
    const clash = packages.includes(into) ? null : takenProblem(into, taken());
    storeOr(nameProblem(name) ?? clash, { kind: 'merge-packages', packages, into });
  };
  const submitName = (current: NameAsk, name: string): void => {
    if (current.mode === 'create') createPackage(name);
    else if (current.mode === 'merge') mergeSelected(name);
    else if (current.kind === 'package') renamePackage(current.id, name);
    else renameFile(current.id, name);
  };
  const submitSplit = (current: SplitAsk, names: string[], assigned: Record<string, string>): void => {
    const form = { pkg: current.pkg, names, files: current.files, assigned, taken: taken() };
    storeOr(splitProblem(form), { kind: 'split-package', package: current.pkg, parts: splitParts(form) });
  };
  const openSplit = async (pkg: string): Promise<void> => {
    const files = await filesUnder(props.token, pkg, String(slug), props.fetcher);
    closeAsk();
    setSplitAsk({ pkg, files });
  };
  const armFold = (file: string): void => {
    setFoldFrom(file);
    setNotice(`click a file to fold ${file} into`);
  };
  const foldInto = (path: string): boolean => {
    if (foldFrom === null) return false;
    if (foldFrom === path) {
      setNotice('a file cannot fold into itself');
      return true;
    }
    editPlan({ kind: 'fate', file: foldFrom, fate: 'fold', into: path });
    setFoldFrom(null);
    return true;
  };
  const pickFile = (id: string): boolean => kindOf(props.nodes, id) === 'file' && foldInto(id);
  const dropTarget = (kind: GraphNode['kind'] | null, event: unknown): string | null => dropTargetOf(slug, kind, event);
  const dropOnCrumb = (event: { preventDefault(): void; dataTransfer: { getData(mime: string): string } }, at: string): void => {
    event.preventDefault();
    const file = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (file !== '') moveFile(file, at);
  };

  const onUndo = useEffectEvent(undoEdit);
  const onRedo = useEffectEvent(redoEdit);
  const onDelete = useEffectEvent(deleteMarked);
  useEffect(() => {
    const run = (action: ReturnType<typeof keyActionOf>): void => {
      if (action === 'undo') onUndo();
      else if (action === 'redo') onRedo();
      else if (action === 'delete') onDelete();
    };
    const onKey = (event: KeyboardEvent) => {
      run(keyActionOf(event.key, event.ctrlKey || event.metaKey, event.shiftKey, fieldTarget(event.target)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const planning = planningOf(slug, picture.ink, {
    mergeReady: selectedPackages(props.nodes, props.selection).length >= 2,
    onDropFile: moveFile,
    onDrawEdge: drawEdge,
    onCutEdge: cutArrow,
    onAddNote: setNoteTarget,
    onOpenPlanned: openFile,
    onRename: (id, kind) => ask({ mode: 'rename', id, kind }),
    onSplit: pkg => void openSplit(pkg),
    onMerge: () => ask({ mode: 'merge' }),
    onDelete: file => editPlan({ kind: 'fate', file, fate: 'delete' }),
    onFold: armFold,
    onPickFile: foldInto,
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
        onNewPackage={() => ask({ mode: 'create' })}
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
      <>
        <ReshapeDialogs nameAsk={nameAsk} splitAsk={splitAsk} error={askError} onName={submitName} onSplit={submitSplit} onCancel={closeAsk} />
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
      </>
    ),
    planning,
    moveFile,
    openFile,
    dropTarget,
    dropOnCrumb,
    pickFile,
  };
}
