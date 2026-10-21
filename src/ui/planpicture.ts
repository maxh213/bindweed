import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { arrange, type LayerNode, type Pin, type PlacedBox } from '../domain/layout.ts';
import {
  mergeDest,
  moveDest,
  renamedFile,
  sentenceOf,
  splitPartPath,
  within,
  type FateEdit,
  type NoteTarget,
  type PlanEdit,
  type SplitEdit,
} from '../domain/plan.ts';
import { parentDir } from './draw.ts';

export type ShownGraph = 'now' | 'planned';

export type RowInk = { path: string; name: string; ghost: boolean; deleted: boolean };

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

export type Planning = {
  ink: PlanInk;
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

type EditOf = { [E in PlanEdit as E['kind']]: E };

type EditKind = keyof EditOf;

type PathSteps = { [K in EditKind]: (edit: EditOf[K], path: string) => string | null };

function splitStep(edit: SplitEdit, path: string): string | null {
  const part = edit.parts.find(item => item.files.includes(path));
  if (part === undefined) return path;
  return `${splitPartPath(edit.package, part.name)}${path.slice(edit.package.length)}`;
}

const PATH_STEPS: PathSteps = {
  'move-file': (edit, path) => (path === edit.file ? moveDest(edit.file, edit.to) : path),
  'cut-edge': (edit, path) => path,
  'add-edge': (edit, path) => path,
  note: (edit, path) => path,
  'create-package': (edit, path) => path,
  'rename-package': (edit, path) => (within(edit.from, path) ? `${edit.to}${path.slice(edit.from.length)}` : path),
  'rename-file': (edit, path) => (path === edit.from ? renamedFile(edit.from, edit.to) : path),
  'merge-packages': mergeDest,
  'split-package': splitStep,
  fate: (edit, path) => (edit.fate === 'fold' && path === edit.file ? null : path),
};

function stepOf<K extends EditKind>(kind: K, edit: EditOf[K], path: string): string | null {
  return PATH_STEPS[kind](edit, path);
}

function steppedPath(edit: PlanEdit, reason: string | null, path: string): string | null {
  if (reason !== null) return path;
  return stepOf(edit.kind, edit, path);
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

export type ProposalRow = { path: string; name: string; highlight: boolean };

export type ProposalBox = { id: string; name: string; x: number; y: number; highlight: boolean; rows: ProposalRow[] };

type ProposalStrike = { id: string; highlight: boolean };

export type ProposalLink = { from: string; to: string; highlight: boolean };

export type ProposalInk = {
  boxes: ProposalBox[];
  rows: (ProposalRow & { boxId: string })[];
  strikes: ProposalStrike[];
  cuts: ProposalLink[];
  arrows: ProposalLink[];
};

type OpenProposal = { index: number; edit: PlanEdit };

type ProposalChild = { id: string; planned: GraphView | null; proposed: GraphView | null };

export type ProposalInput = {
  shown: ShownGraph;
  planned: GraphNode[];
  pins: Record<string, Pin>;
  proposal: GraphView | null;
  children: ProposalChild[];
  edits: OpenProposal[];
  hover: number | null;
};

const CELL_X = 260;
const CELL_Y = 140;

function noProposal(): ProposalInk {
  return { boxes: [], rows: [], strikes: [], cuts: [], arrows: [] };
}

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / CELL_X)},${Math.floor(y / CELL_Y)}`;
}

function shiftSpot(x: number, y: number, taken: Set<string>): { x: number; y: number } {
  let next = x;
  while (taken.has(cellKey(next, y))) next += CELL_X;
  taken.add(cellKey(next, y));
  return { x: next, y };
}

function takenCells(spots: PlacedBox[]): Set<string> {
  return new Set(spots.map(spot => cellKey(spot.x, spot.y)));
}

function startSpot(node: GraphNode, pins: Record<string, Pin>): { x: number; y: number } {
  return pins[node.id] ?? { x: node.order * CELL_X, y: node.row * CELL_Y };
}

function createdLater(edit: PlanEdit, id: string): boolean {
  if (edit.kind === 'split-package') return edit.parts.some(part => splitPartPath(edit.package, part.name) === id);
  if (edit.kind === 'move-file') return moveDest(edit.file, edit.to) === id;
  return edit.kind === 'merge-packages' && edit.into === id;
}

function createdBox(edit: PlanEdit, id: string): boolean {
  if (edit.kind === 'create-package') return edit.path === id;
  if (edit.kind === 'rename-package') return edit.to === id;
  return createdLater(edit, id);
}

function fileStrike(edit: PlanEdit): string[] {
  if (edit.kind === 'rename-file') return [edit.from];
  if (edit.kind === 'fate') return [edit.file];
  return [];
}

function strikeIds(edit: PlanEdit): string[] {
  if (edit.kind === 'split-package') return [edit.package];
  if (edit.kind === 'rename-package') return [edit.from];
  if (edit.kind === 'merge-packages') return edit.packages.filter(pkg => pkg !== edit.into);
  return fileStrike(edit);
}

function fileEditPath(edit: PlanEdit): string | undefined {
  if (edit.kind === 'move-file') return edit.file;
  if (edit.kind === 'rename-file') return edit.from;
  if (edit.kind === 'fate') return edit.file;
  return undefined;
}

function splitFiles(edit: PlanEdit): string[] {
  if (edit.kind !== 'split-package') return [];
  return edit.parts.flatMap(part => part.files);
}

function mentioned(edit: PlanEdit): string[] {
  const one = fileEditPath(edit);
  return one === undefined ? splitFiles(edit) : [one];
}

function fileNodes(view: GraphView | null): GraphNode[] {
  if (view === null) return [];
  return view.nodes.filter(node => node.kind === 'file');
}

function addFiles(paths: Set<string>, nodes: GraphNode[]): void {
  for (const node of nodes) paths.add(node.id);
}

function seedPaths(planned: GraphNode[], children: ProposalChild[], edits: OpenProposal[]): string[] {
  const paths = new Set<string>();
  addFiles(paths, planned.filter(node => node.kind === 'file'));
  for (const child of children) addFiles(paths, fileNodes(child.planned));
  for (const item of edits) for (const path of mentioned(item.edit)) paths.add(path);
  return [...paths];
}

function nextOwners(owners: Map<string, number>, item: OpenProposal): Map<string, number> {
  const next = new Map<string, number>();
  for (const [path, index] of owners) {
    const moved = steppedPath(item.edit, null, path);
    if (moved === null) continue;
    next.set(moved, moved === path ? index : item.index);
  }
  return next;
}

function ownersOf(start: string[], edits: OpenProposal[]): Map<string, number> {
  let owners = new Map(start.map(path => [path, -1]));
  for (const item of edits) owners = nextOwners(owners, item);
  return owners;
}

function missingIds(planned: GraphNode[], nodes: GraphNode[]): GraphNode[] {
  const ids = new Set(planned.map(node => node.id));
  return nodes.filter(node => !ids.has(node.id));
}

function freshFiles(planned: GraphView | null, proposed: GraphView | null): GraphNode[] {
  const known = new Set(fileNodes(planned).map(node => node.id));
  return fileNodes(proposed).filter(node => !known.has(node.id));
}

function heldRow(boxId: string, node: GraphNode, owners: Map<string, number>): { boxId: string; path: string; name: string; index: number } | undefined {
  const index = owners.get(node.id);
  if (index === undefined || index < 0) return undefined;
  return { boxId, path: node.id, name: node.name, index };
}

function childRows(child: ProposalChild, owners: Map<string, number>): { boxId: string; path: string; name: string; index: number }[] {
  const rows: { boxId: string; path: string; name: string; index: number }[] = [];
  for (const node of freshFiles(child.planned, child.proposed)) {
    const row = heldRow(child.id, node, owners);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

function rowInk(row: { path: string; name: string; index: number }, hover: number | null): ProposalRow {
  return { path: row.path, name: row.name, highlight: row.index === hover };
}

type HeldRow = { boxId: string; path: string; name: string; index: number };

function boxedRows(rows: HeldRow[], newIds: Set<string>, hover: number | null): Map<string, ProposalRow[]> {
  const map = new Map<string, ProposalRow[]>();
  for (const row of rows) {
    if (!newIds.has(row.boxId)) continue;
    const list = map.get(row.boxId) ?? [];
    list.push(rowInk(row, hover));
    map.set(row.boxId, list);
  }
  return map;
}

function looseRows(rows: HeldRow[], newIds: Set<string>, hover: number | null): ProposalInk['rows'] {
  return rows.filter(row => !newIds.has(row.boxId)).map(row => ({ boxId: row.boxId, ...rowInk(row, hover) }));
}

function placedBox(node: GraphNode, index: number, pins: Record<string, Pin>, taken: Set<string>, hover: number | null, rows: ProposalRow[]): ProposalBox {
  const start = startSpot(node, pins);
  const spot = shiftSpot(start.x, start.y, taken);
  return { id: node.id, name: node.name, x: spot.x, y: spot.y, highlight: index === hover, rows };
}

function boxOwner(edits: OpenProposal[], id: string): number | undefined {
  return edits.find(item => createdBox(item.edit, id))?.index;
}

function spotOf(node: GraphNode): { id: string; row: number; order: number } {
  return { id: node.id, row: node.row, order: node.order };
}

function ownedMissing(planned: GraphNode[], nodes: GraphNode[], edits: OpenProposal[]): GraphNode[] {
  return missingIds(planned, nodes).filter(node => boxOwner(edits, node.id) !== undefined);
}

function placeBoxes(nodes: GraphNode[], planned: GraphNode[], pins: Record<string, Pin>, edits: OpenProposal[], hover: number | null, rows: Map<string, ProposalRow[]>): ProposalBox[] {
  const taken = takenCells(arrange(planned.map(spotOf), pins));
  return nodes.map(node => placedBox(node, boxOwner(edits, node.id) as number, pins, taken, hover, rows.get(node.id) ?? []));
}

function pushStrike(seen: Set<string>, marks: ProposalStrike[], id: string, index: number, hover: number | null): void {
  if (seen.has(id)) return;
  seen.add(id);
  marks.push({ id, highlight: index === hover });
}

function strikeMarks(edits: OpenProposal[], hover: number | null): ProposalStrike[] {
  const seen = new Set<string>();
  const marks: ProposalStrike[] = [];
  for (const item of edits) {
    for (const id of strikeIds(item.edit)) pushStrike(seen, marks, id, item.index, hover);
  }
  return marks;
}

function endMark(edit: PlanEdit, kind: 'cut-edge' | 'add-edge'): { from: string; to: string } | undefined {
  if (edit.kind !== kind) return undefined;
  return { from: edit.from, to: edit.to };
}

function visibleEnds(mark: { from: string; to: string }, ids: Set<string>): boolean {
  return ids.has(mark.from) && ids.has(mark.to);
}

function linkOf(ends: { from: string; to: string }, index: number, hover: number | null): ProposalLink {
  return { ...ends, highlight: index === hover };
}

function linkMarks(edits: OpenProposal[], kind: 'cut-edge' | 'add-edge', ids: Set<string>, hover: number | null): ProposalLink[] {
  const marks: ProposalLink[] = [];
  for (const item of edits) {
    const ends = endMark(item.edit, kind);
    if (ends === undefined || !visibleEnds(ends, ids)) continue;
    marks.push(linkOf(ends, item.index, hover));
  }
  return marks;
}

export function proposalInk(input: ProposalInput): ProposalInk {
  if (input.shown !== 'planned') return noProposal();
  if (input.proposal === null) return noProposal();
  const owners = ownersOf(seedPaths(input.planned, input.children, input.edits), input.edits);
  const held = input.children.flatMap(child => childRows(child, owners));
  const fresh = ownedMissing(input.planned, input.proposal.nodes, input.edits);
  const newIds = new Set(fresh.map(node => node.id));
  const boxes = placeBoxes(fresh, input.planned, input.pins, input.edits, input.hover, boxedRows(held, newIds, input.hover));
  const ids = new Set([...input.planned.map(node => node.id), ...boxes.map(box => box.id)]);
  return {
    boxes,
    rows: looseRows(held, newIds, input.hover),
    strikes: strikeMarks(input.edits, input.hover),
    cuts: linkMarks(input.edits, 'cut-edge', ids, input.hover),
    arrows: linkMarks(input.edits, 'add-edge', ids, input.hover),
  };
}
