import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { arrange, type LayerNode, type Pin, type PlacedBox } from '../domain/layout.ts';
import { moveDest, pathAfter, renamedFile, sentenceOf, splitPartPath, type FateEdit, type NoteTarget, type PlanEdit } from '../domain/plan.ts';
import { parentDir } from './draw.ts';
import type { ProposalInk } from './proposalpicture.ts';

export type ShownGraph = 'now' | 'planned';

export type RowInk = { path: string; name: string; ghost: boolean; deleted: boolean; converge?: 'done' | 'contradicted' };

export type GhostBoxInk = { id: string; name: string; x: number; y: number };

export type CutMarkInk = { from: string; to: string };

type NoteInk = { nodes: Map<string, string[]>; edges: Map<string, string[]> };

type PlanInk = {
  rows: Map<string, RowInk[]>;
  ghosts: GhostBoxInk[];
  cuts: CutMarkInk[];
  added: ViewEdge[];
  notes: NoteInk;
};

type ConvergeInk = { rows: Map<string, 'done' | 'contradicted'>; boxes: Set<string>; cuts: CutMarkInk[]; arrows: CutMarkInk[] };

export type Planning = {
  ink: PlanInk;
  converge: ConvergeInk | null;
  proposal: ProposalInk;
  mergeReady: boolean;
  onDropFile: (file: string, dir: string) => boolean;
  onDrawEdge: (from: string, to: string) => void;
  onCutEdge: (from: string, to: string) => void;
  onAddNote: (target: NoteTarget) => void;
  onOpenPlanned: (path: string) => void;
  onRename: (id: string, kind: 'package' | 'file') => void;
  onSplit: (id: string) => void;
  onMerge: () => void;
  onDelete: (file: string) => void;
  onFold: (file: string) => void;
  onPickFile: (path: string) => boolean;
};

type PlanWarning = NonNullable<GraphView['warnings']>[number][number];

type WarningLine = { text: string; importers: string[] };

type ChangeEntry = { edit: PlanEdit; sentence: string; stale: string | null; warnings: WarningLine[] };

type EntryTarget = { kind: 'node'; id: string } | { kind: 'box'; id: string } | { kind: 'arrow'; from: string; to: string; cut: boolean };

type PlanView = GraphView | { error: string } | undefined;

type DrilledFile = { id: string; name: string; deleted: boolean };

type PackageRows = { id: string; now: PlanView; planned: PlanView };

type PlanPicture = {
  ink: PlanInk;
  entries: ChangeEntry[];
  diskPath: (path: string) => string;
};

type PictureInput = {
  shown: ShownGraph;
  nodes: GraphNode[];
  other: PlanView;
  pins: Record<string, Pin>;
  edits: PlanEdit[];
  stale: (string | null)[] | undefined;
  edges: ViewEdge[] | undefined;
  ids: Set<string>;
  packages: PackageRows[];
  warnings: PlanWarning[][] | undefined;
};

function staleList(edits: PlanEdit[], stale: (string | null)[] | undefined): (string | null)[] {
  return edits.map((_, index) => stale?.[index] ?? null);
}

function moveUndoneBy(path: string, edit: PlanEdit): string {
  if (edit.kind !== 'move-file') return path;
  return moveDest(edit.file, edit.to) === path ? edit.file : path;
}

function unmovedBy(path: string, edit: PlanEdit, stale: string | null): string {
  if (stale !== null) return path;
  return moveUndoneBy(path, edit);
}

type UndoStep = { edit: PlanEdit; reason: string | null };

function undoSteps(edits: PlanEdit[], stale: (string | null)[]): UndoStep[] {
  return edits.map((edit, index) => ({ edit, reason: stale[index] ?? null })).reverse();
}

function diskPathOf(path: string, edits: PlanEdit[], stale: (string | null)[]): string {
  let current = path;
  for (const step of undoSteps(edits, stale)) current = unmovedBy(current, step.edit, step.reason);
  return current;
}

function steppedPath(edit: PlanEdit, reason: string | null, path: string): string | null {
  if (reason !== null) return path;
  return pathAfter(edit, path);
}

function removedByFold(path: string, edits: PlanEdit[], stale: (string | null)[]): boolean {
  let current: string | null = path;
  for (const [index, edit] of edits.entries()) {
    if (current === null) return true;
    current = steppedPath(edit, stale[index] ?? null, current);
  }
  return current === null;
}

type FoldGone = (path: string) => boolean;

function foldGone(shown: ShownGraph, edits: PlanEdit[], stale: (string | null)[]): FoldGone {
  if (shown !== 'planned') return () => false;
  return path => removedByFold(path, edits, stale);
}

function noteEntryTarget(target: NoteTarget): EntryTarget {
  if ('node' in target) return { kind: 'node', id: target.node };
  return { kind: 'arrow', from: target.edge[0], to: target.edge[1], cut: false };
}

function fateTarget(edit: FateEdit): string {
  return edit.fate === 'fold' ? edit.into : edit.file;
}

type PackageEdit = Exclude<PlanEdit, { kind: 'move-file' | 'cut-edge' | 'add-edge' | 'note' }>;

function reshapeTarget(edit: Exclude<PackageEdit, { kind: 'create-package' | 'rename-package' }>): string {
  if (edit.kind === 'rename-file') return renamedFile(edit.from, edit.to);
  if (edit.kind === 'merge-packages') return edit.into;
  if (edit.kind === 'split-package') return splitPartPath(edit.package, edit.parts[0].name);
  return fateTarget(edit);
}

function boxTargetOf(edit: PackageEdit): EntryTarget {
  if (edit.kind === 'create-package') return { kind: 'box', id: edit.path };
  if (edit.kind === 'rename-package') return { kind: 'box', id: edit.to };
  return { kind: 'box', id: reshapeTarget(edit) };
}

function laterTarget(edit: Exclude<PlanEdit, { kind: 'move-file' | 'cut-edge' | 'add-edge' }>): EntryTarget {
  if (edit.kind === 'note') return noteEntryTarget(edit.target);
  return boxTargetOf(edit);
}

export function entryTarget(edit: PlanEdit): EntryTarget {
  if (edit.kind === 'move-file') return { kind: 'node', id: moveDest(edit.file, edit.to) };
  if (edit.kind === 'cut-edge') return { kind: 'arrow', from: edit.from, to: edit.to, cut: true };
  if (edit.kind === 'add-edge') return { kind: 'arrow', from: edit.from, to: edit.to, cut: false };
  return laterTarget(edit);
}

export function arrowViewAt(from: string, to: string): string {
  const parent = parentDir(from);
  return parent === parentDir(to) ? parent : '';
}

function drilledFiles(view: PlanView): DrilledFile[] {
  if (view === undefined || 'error' in view) return [];
  return view.nodes.filter(node => node.kind === 'file').map(node => ({ id: node.id, name: node.name, deleted: node.fate === 'delete' }));
}

function byRowName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function rowOf(file: DrilledFile, ghost: boolean): RowInk {
  return { path: file.id, name: file.name, ghost, deleted: !ghost && file.deleted };
}

function rowsFor(shown: DrilledFile[], other: DrilledFile[], gone: FoldGone): RowInk[] {
  const shownIds = new Set(shown.map(file => file.id));
  const reals = shown.map(file => rowOf(file, false)).sort(byRowName);
  const ghosts = other.filter(file => !shownIds.has(file.id) && !gone(file.id)).map(file => rowOf(file, true)).sort(byRowName);
  return [...reals, ...ghosts];
}

function packageRows(pack: PackageRows, shown: ShownGraph, gone: FoldGone): RowInk[] {
  const now = drilledFiles(pack.now);
  const planned = drilledFiles(pack.planned);
  return shown === 'planned' ? rowsFor(planned, now, gone) : rowsFor(now, planned, gone);
}

function rowsMap(packages: PackageRows[], shown: ShownGraph, gone: FoldGone): Map<string, RowInk[]> {
  const map = new Map<string, RowInk[]>();
  for (const pack of packages) map.set(pack.id, packageRows(pack, shown, gone));
  return map;
}

function fileGhost(node: GraphNode, spot: PlacedBox, skip: boolean): GhostBoxInk | null {
  if (skip || node.kind !== 'file') return null;
  return { id: node.id, name: node.name, x: spot.x, y: spot.y };
}

function ghostBoxes(shown: GraphNode[], other: PlanView, pins: Record<string, Pin>, gone: FoldGone): GhostBoxInk[] {
  if (other === undefined || 'error' in other) return [];
  const others = other.nodes;
  const shownIds = new Set(shown.map(node => node.id));
  const layers: LayerNode[] = others.map(node => ({ id: node.id, row: node.row, order: node.order }));
  const spots = arrange(layers, pins);
  const ghosts: GhostBoxInk[] = [];
  others.forEach((node, index) => {
    const spot = spots[index];
    if (spot === undefined) return;
    const ghost = fileGhost(node, spot, shownIds.has(node.id) || gone(node.id));
    if (ghost !== null) ghosts.push(ghost);
  });
  return ghosts;
}

function pushText(map: Map<string, string[]>, key: string, text: string): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [text]);
    return;
  }
  list.push(text);
}

function noteKey(from: string, to: string): string {
  return `${from}\n${to}`;
}

function collectNote(ink: NoteInk, edit: PlanEdit): void {
  if (edit.kind !== 'note') return;
  if ('node' in edit.target) pushText(ink.nodes, edit.target.node, edit.text);
  else pushText(ink.edges, noteKey(edit.target.edge[0], edit.target.edge[1]), edit.text);
}

function noteInk(edits: PlanEdit[], stale: (string | null)[]): NoteInk {
  const ink: NoteInk = { nodes: new Map(), edges: new Map() };
  edits.forEach((edit, index) => {
    if (stale[index] !== null) return;
    collectNote(ink, edit);
  });
  return ink;
}

function liveOf(edits: PlanEdit[], stale: (string | null)[], kind: 'cut-edge' | 'add-edge'): CutMarkInk[] {
  return edits
    .filter((edit, index): edit is CutMarkInk & PlanEdit => stale[index] === null && edit.kind === kind)
    .map(edit => ({ from: edit.from, to: edit.to }));
}

function marksInView<T extends { from: string; to: string }>(marks: T[], ids: Set<string>): T[] {
  return marks.filter(mark => ids.has(mark.from) && ids.has(mark.to));
}

function markerEdge(add: CutMarkInk): ViewEdge {
  return { from: add.from, to: add.to, runtime: 0, type: 0, cycle: false, planned: true };
}

function addedMarkers(edits: PlanEdit[], stale: (string | null)[], edges: ViewEdge[] | undefined): ViewEdge[] {
  const live = liveOf(edits, stale, 'add-edge');
  if (edges === undefined) return live.map(markerEdge);
  return live.filter(add => !edges.some(edge => edge.from === add.from && edge.to === add.to)).map(markerEdge);
}

function addedOf(shown: ShownGraph, edits: PlanEdit[], stale: (string | null)[], edges: ViewEdge[] | undefined, ids: Set<string>): ViewEdge[] {
  if (shown !== 'now') return [];
  return marksInView(addedMarkers(edits, stale, edges), ids);
}

function importLine(count: number, file: string): string {
  if (count === 1) return `1 file still imports ${file}, which this plan deletes`;
  return `${count} files still import ${file}, which this plan deletes`;
}

function warningLine(warning: PlanWarning): WarningLine {
  if (warning.kind === 'empty-package') return { text: `${warning.path} is empty`, importers: [] };
  if (warning.kind === 'added-cycle') return { text: `this plan adds a cycle: ${warning.cycle}`, importers: [] };
  return { text: importLine(warning.importers.length, warning.file), importers: warning.importers };
}

function warningLines(warnings: PlanWarning[][] | undefined, index: number): WarningLine[] {
  return (warnings?.[index] ?? []).map(warningLine);
}

function changeEntries(edits: PlanEdit[], stale: (string | null)[], warnings: PlanWarning[][] | undefined): ChangeEntry[] {
  return edits.map((edit, index) => ({ edit, sentence: sentenceOf(edit), stale: stale[index] ?? null, warnings: warningLines(warnings, index) }));
}

function inkOf(input: PictureInput, stale: (string | null)[], gone: FoldGone): PlanInk {
  return {
    rows: rowsMap(input.packages, input.shown, gone),
    ghosts: ghostBoxes(input.nodes, input.other, input.pins, gone),
    cuts: marksInView(liveOf(input.edits, stale, 'cut-edge'), input.ids),
    added: addedOf(input.shown, input.edits, stale, input.edges, input.ids),
    notes: noteInk(input.edits, stale),
  };
}

export function planPicture(input: PictureInput): PlanPicture {
  const stale = staleList(input.edits, input.stale);
  const gone = foldGone(input.shown, input.edits, stale);
  return {
    ink: inkOf(input, stale, gone),
    entries: changeEntries(input.edits, stale, input.warnings),
    diskPath: path => diskPathOf(path, input.edits, stale),
  };
}
