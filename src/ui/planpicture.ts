import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { arrange, type LayerNode, type Pin, type PlacedBox } from '../domain/layout.ts';
import { moveDest, sentenceOf, type NoteTarget, type PlanEdit } from '../domain/plan.ts';
import { parentDir } from './draw.ts';

export type ShownGraph = 'now' | 'planned';

export type RowInk = { path: string; name: string; ghost: boolean };

export type GhostBoxInk = { id: string; name: string; x: number; y: number };

export type CutMarkInk = { from: string; to: string };

type NoteInk = { nodes: Map<string, string[]>; edges: Map<string, string[]> };

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

type ChangeEntry = { edit: PlanEdit; sentence: string; stale: string | null };

type EntryTarget = { kind: 'node'; id: string } | { kind: 'arrow'; from: string; to: string; cut: boolean };

type PlanView = GraphView | { error: string } | undefined;

type DrilledFile = { id: string; name: string };

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

function noteEntryTarget(target: NoteTarget): EntryTarget {
  if ('node' in target) return { kind: 'node', id: target.node };
  return { kind: 'arrow', from: target.edge[0], to: target.edge[1], cut: false };
}

export function entryTarget(edit: PlanEdit): EntryTarget {
  if (edit.kind === 'move-file') return { kind: 'node', id: moveDest(edit.file, edit.to) };
  if (edit.kind === 'cut-edge') return { kind: 'arrow', from: edit.from, to: edit.to, cut: true };
  if (edit.kind === 'add-edge') return { kind: 'arrow', from: edit.from, to: edit.to, cut: false };
  return noteEntryTarget(edit.target);
}

export function arrowViewAt(from: string, to: string): string {
  const parent = parentDir(from);
  return parent === parentDir(to) ? parent : '';
}

function drilledFiles(view: PlanView): DrilledFile[] {
  if (view === undefined || 'error' in view) return [];
  return view.nodes.filter(node => node.kind === 'file').map(node => ({ id: node.id, name: node.name }));
}

function byRowName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function rowOf(file: DrilledFile, ghost: boolean): RowInk {
  return { path: file.id, name: file.name, ghost };
}

function rowsFor(shown: DrilledFile[], other: DrilledFile[]): RowInk[] {
  const shownIds = new Set(shown.map(file => file.id));
  const reals = shown.map(file => rowOf(file, false)).sort(byRowName);
  const ghosts = other.filter(file => !shownIds.has(file.id)).map(file => rowOf(file, true)).sort(byRowName);
  return [...reals, ...ghosts];
}

function packageRows(pack: PackageRows, shown: ShownGraph): RowInk[] {
  const now = drilledFiles(pack.now);
  const planned = drilledFiles(pack.planned);
  return shown === 'planned' ? rowsFor(planned, now) : rowsFor(now, planned);
}

function rowsMap(packages: PackageRows[], shown: ShownGraph): Map<string, RowInk[]> {
  const map = new Map<string, RowInk[]>();
  for (const pack of packages) map.set(pack.id, packageRows(pack, shown));
  return map;
}

function fileGhost(node: GraphNode, spot: PlacedBox, shown: boolean): GhostBoxInk | null {
  if (shown || node.kind !== 'file') return null;
  return { id: node.id, name: node.name, x: spot.x, y: spot.y };
}

function ghostBoxes(shown: GraphNode[], other: PlanView, pins: Record<string, Pin>): GhostBoxInk[] {
  if (other === undefined || 'error' in other) return [];
  const others = other.nodes;
  const shownIds = new Set(shown.map(node => node.id));
  const layers: LayerNode[] = others.map(node => ({ id: node.id, row: node.row, order: node.order }));
  const spots = arrange(layers, pins);
  const ghosts: GhostBoxInk[] = [];
  others.forEach((node, index) => {
    const spot = spots[index];
    if (spot === undefined) return;
    const ghost = fileGhost(node, spot, shownIds.has(node.id));
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

function changeEntries(edits: PlanEdit[], stale: (string | null)[]): ChangeEntry[] {
  return edits.map((edit, index) => ({ edit, sentence: sentenceOf(edit), stale: stale[index] ?? null }));
}

function inkOf(input: PictureInput, stale: (string | null)[]): PlanInk {
  return {
    rows: rowsMap(input.packages, input.shown),
    ghosts: ghostBoxes(input.nodes, input.other, input.pins),
    cuts: marksInView(liveOf(input.edits, stale, 'cut-edge'), input.ids),
    added: addedOf(input.shown, input.edits, stale, input.edges, input.ids),
    notes: noteInk(input.edits, stale),
  };
}

export function planPicture(input: PictureInput): PlanPicture {
  const stale = staleList(input.edits, input.stale);
  return {
    ink: inkOf(input, stale),
    entries: changeEntries(input.edits, stale),
    diskPath: path => diskPathOf(path, input.edits, stale),
  };
}
