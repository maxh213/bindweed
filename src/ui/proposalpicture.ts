import type { GraphNode, GraphView } from '../domain/graph.ts';
import { arrange, type Pin, type PlacedBox } from '../domain/layout.ts';
import { moveDest, pathAfter, splitPartPath, type PlanEdit } from '../domain/plan.ts';

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

export type ProposalChild = { id: string; planned: GraphView | null; proposed: GraphView | null };

export type ProposalInput = {
  shown: 'now' | 'planned';
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
    const moved = pathAfter(item.edit, path);
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
