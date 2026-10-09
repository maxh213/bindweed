import type { GraphNode, GraphView, ViewEdge } from '../domain/graph.ts';
import { arrange, type LayerNode, type Pin, type PlacedBox } from '../domain/layout.ts';
import { moveDest, sentenceOf, type AddEdit, type CutEdit, type MoveEdit, type NoteEdit, type NoteTarget, type PlanDoc, type PlanEdit, type PlanSummary } from '../domain/plan.ts';
import { parentDir } from './draw.ts';

export type RowInk = { path: string; name: string; ghost: boolean };

export type GhostBoxInk = { id: string; name: string; x: number; y: number };

export type CutMarkInk = { from: string; to: string };

export type NoteInk = { nodes: Map<string, string[]>; edges: Map<string, string[]> };

export type EntryTarget = { kind: 'node'; id: string } | { kind: 'arrow'; from: string; to: string; cut: boolean };

export type MarkSel = { from: string; to: string; cut: boolean };

export type ShownGraph = 'now' | 'planned';

export const FILE_DRAG_MIME = 'text/x-bindweed-file';

export function staleList(edits: PlanEdit[], stale: (string | null)[] | undefined): (string | null)[] {
  return edits.map((_, index) => stale?.[index] ?? null);
}

function moveUndoneBy(path: string, edit: MoveEdit): string {
  return moveDest(edit.file, edit.to) === path ? edit.file : path;
}

function unmovedBy(path: string, edit: PlanEdit, stale: string | null): string {
  if (stale !== null || edit.kind !== 'move-file') return path;
  return moveUndoneBy(path, edit);
}

type UndoStep = { edit: PlanEdit; reason: string | null };

function undoSteps(edits: PlanEdit[], stale: (string | null)[]): UndoStep[] {
  const steps: UndoStep[] = [];
  edits.forEach((edit, index) => {
    steps.push({ edit, reason: stale[index] ?? null });
  });
  steps.reverse();
  return steps;
}

export function diskPathOf(path: string, edits: PlanEdit[], stale: (string | null)[]): string {
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

export function planLabels(plans: PlanSummary[]): Map<string, string> {
  const seen = new Set<string>();
  const labels = new Map<string, string>();
  for (const plan of plans) {
    labels.set(plan.slug, seen.has(plan.name) ? `${plan.name} (${plan.slug})` : plan.name);
    seen.add(plan.name);
  }
  return labels;
}

export function planChoice(slug: string | null, plans: PlanSummary[]): string {
  if (slug === null) return '';
  return plans.some(plan => plan.slug === slug) ? slug : '';
}

type DrilledFile = { id: string; name: string };

type ViewData = GraphView | { error: string } | undefined;

export function drilledFiles(view: ViewData): DrilledFile[] {
  if (view === undefined || 'error' in view) return [];
  return view.nodes.filter(node => node.kind === 'file').map(node => ({ id: node.id, name: node.name }));
}

function byRowName(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1;
  return a.name > b.name ? 1 : 0;
}

function rowOf(file: DrilledFile, ghost: boolean): RowInk {
  return { path: file.id, name: file.name, ghost };
}

export function rowsFor(shown: DrilledFile[], other: DrilledFile[]): RowInk[] {
  const shownIds = new Set(shown.map(file => file.id));
  const reals = shown.map(file => rowOf(file, false)).sort(byRowName);
  const ghosts = other.filter(file => !shownIds.has(file.id)).map(file => rowOf(file, true)).sort(byRowName);
  return [...reals, ...ghosts];
}

function viewNodesOf(view: ViewData): GraphNode[] {
  if (view === undefined || 'error' in view) return [];
  return view.nodes;
}

function fileGhost(node: GraphNode, spot: PlacedBox, shown: boolean): GhostBoxInk | null {
  if (shown || node.kind !== 'file') return null;
  return { id: node.id, name: node.name, x: spot.x, y: spot.y };
}

export function ghostBoxes(shown: GraphNode[], other: ViewData, pins: Record<string, Pin>): GhostBoxInk[] {
  const others = viewNodesOf(other);
  const shownIds = new Set(shown.map(node => node.id));
  const layers: LayerNode[] = others.map(node => ({ id: node.id, row: node.row, order: node.order }));
  const spots = arrange(layers, pins);
  const ghosts: GhostBoxInk[] = [];
  others.forEach((node, index) => {
    const ghost = fileGhost(node, spots[index] as PlacedBox, shownIds.has(node.id));
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

function collectNote(ink: NoteInk, edit: NoteEdit): void {
  if ('node' in edit.target) pushText(ink.nodes, edit.target.node, edit.text);
  else pushText(ink.edges, noteKey(edit.target.edge[0], edit.target.edge[1]), edit.text);
}

export function noteInk(edits: PlanEdit[], stale: (string | null)[]): NoteInk {
  const ink: NoteInk = { nodes: new Map(), edges: new Map() };
  edits.forEach((edit, index) => {
    if (stale[index] !== null || edit.kind !== 'note') return;
    collectNote(ink, edit);
  });
  return ink;
}

function isLink(edit: PlanEdit, kind: 'cut-edge' | 'add-edge'): edit is CutEdit | AddEdit {
  return edit.kind === kind;
}

function liveOf(edits: PlanEdit[], stale: (string | null)[], kind: 'cut-edge' | 'add-edge'): CutMarkInk[] {
  const marks: CutMarkInk[] = [];
  edits.forEach((edit, index) => {
    if (stale[index] !== null || !isLink(edit, kind)) return;
    marks.push({ from: edit.from, to: edit.to });
  });
  return marks;
}

export function liveCuts(edits: PlanEdit[], stale: (string | null)[]): CutMarkInk[] {
  return liveOf(edits, stale, 'cut-edge');
}

function liveAdds(edits: PlanEdit[], stale: (string | null)[]): CutMarkInk[] {
  return liveOf(edits, stale, 'add-edge');
}

function markerEdge(add: CutMarkInk): ViewEdge {
  return { from: add.from, to: add.to, runtime: 0, type: 0, cycle: false, planned: true };
}

export function addedMarkers(edits: PlanEdit[], stale: (string | null)[], edges: ViewEdge[]): ViewEdge[] {
  return liveAdds(edits, stale)
    .filter(add => !edges.some(edge => edge.from === add.from && edge.to === add.to))
    .map(markerEdge);
}

export function marksInView<T extends { from: string; to: string }>(marks: T[], ids: Set<string>): T[] {
  return marks.filter(mark => ids.has(mark.from) && ids.has(mark.to));
}

export function fieldTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function eventPoint(event: unknown): { x: number; y: number } | null {
  if (!(event instanceof MouseEvent)) return null;
  return { x: event.clientX, y: event.clientY };
}

function crumbAtPoint(elements: Element[]): string | null {
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const at = el.dataset.crumb;
    if (at !== undefined) return at;
  }
  return null;
}

function packageIdOf(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (!el.classList.contains('package')) return null;
  return el.dataset.id ?? null;
}

function packageAtPoint(elements: Element[]): string | null {
  for (const el of elements) {
    const id = packageIdOf(el);
    if (id !== null) return id;
  }
  return null;
}

export function planDropTarget(event: unknown): string | null {
  const point = eventPoint(event);
  if (point === null) return null;
  const elements = document.elementsFromPoint(point.x, point.y);
  return crumbAtPoint(elements) ?? packageAtPoint(elements);
}

function undoKey(key: string, ctrl: boolean): boolean {
  return ctrl && (key === 'z' || key === 'Z');
}

export type KeyAction = 'undo' | 'redo' | 'delete';

function undoRedoOf(key: string, ctrl: boolean, shift: boolean): KeyAction | null {
  if (!undoKey(key, ctrl)) return null;
  return shift ? 'redo' : 'undo';
}

export function keyActionOf(key: string, ctrl: boolean, shift: boolean, inField: boolean): KeyAction | null {
  if (inField) return null;
  if (key === 'Delete') return 'delete';
  return undoRedoOf(key, ctrl, shift);
}

export type ChangeEntry = { edit: PlanEdit; sentence: string; stale: string | null };

export function changeEntries(edits: PlanEdit[], stale: (string | null)[]): ChangeEntry[] {
  return edits.map((edit, index) => ({ edit, sentence: sentenceOf(edit), stale: stale[index] ?? null }));
}

export function plansOf(data: { plans: PlanSummary[] } | { error: string } | undefined): PlanSummary[] {
  if (data === undefined || 'error' in data) return [];
  return data.plans;
}

export function planDocOf(data: PlanDoc | { error: string } | undefined): PlanDoc | null {
  if (data === undefined || 'error' in data) return null;
  return data;
}

export function deleteNameOf(plans: PlanSummary[], slug: string | null, doc: PlanDoc | null): string {
  const listed = plans.find(plan => plan.slug === slug);
  if (listed !== undefined) return listed.name;
  return doc?.name ?? '';
}
