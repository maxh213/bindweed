import { plannedPath, type ConvergeStatus } from '../domain/converge.ts';
import { lastSegment, splitPartPath, within, type PlanEdit } from '../domain/plan.ts';
import { parentDir } from './draw.ts';

type RowInk = { path: string; name: string; ghost: boolean; deleted: boolean; converge?: 'done' | 'contradicted' };

type CutMarkInk = { from: string; to: string };

export type ConvergeMarks = {
  rows: Map<string, 'done' | 'contradicted'>;
  boxes: Set<string>;
  cuts: CutMarkInk[];
  arrows: CutMarkInk[];
};

type MarkAsk = { edits: PlanEdit[]; statuses: Map<number, ConvergeStatus>; ids: Set<string> };

type Marking = { ask: MarkAsk; index: number; status: ConvergeStatus; marks: ConvergeMarks };

type InkParts = { rows: Map<string, RowInk[]>; cuts: CutMarkInk[] };

function arrowKey(from: string, to: string): string {
  return `${from}\n${to}`;
}

function carried(step: Marking, path: string): string {
  return plannedPath(step.ask.edits, step.ask.edits.map(() => null), step.index, path);
}

function markRow(step: Marking, path: string): void {
  if (step.status === 'done' || step.status === 'contradicted') step.marks.rows.set(carried(step, path), step.status);
}

function markBoxes(step: Marking, paths: string[]): void {
  if (step.status !== 'done') return;
  for (const path of paths) step.marks.boxes.add(carried(step, path));
}

function markCut(step: Marking, from: string, to: string): void {
  if (step.status !== 'done' || !step.ask.ids.has(from) || !step.ask.ids.has(to)) return;
  step.marks.cuts.push({ from, to });
}

function boxOf(ids: Set<string>, path: string): string | undefined {
  return [...ids].find(id => within(id, path));
}

function markArrow(step: Marking, from: string, to: string): void {
  const ends = [boxOf(step.ask.ids, carried(step, from)), boxOf(step.ask.ids, carried(step, to))];
  if (step.status !== 'done' || ends[0] === undefined || ends[1] === undefined) return;
  step.marks.arrows.push({ from: ends[0], to: ends[1] });
}

type Markers = { [K in PlanEdit['kind']]: (step: Marking, edit: Extract<PlanEdit, { kind: K }>) => void };

const MARKERS: Markers = {
  'move-file': (step, edit) => markRow(step, edit.file),
  'rename-file': (step, edit) => markRow(step, edit.from),
  'rename-package': (step, edit) => markBoxes(step, [edit.from]),
  'merge-packages': (step, edit) => markBoxes(step, [edit.into]),
  'split-package': (step, edit) => markBoxes(step, edit.parts.map(part => splitPartPath(edit.package, part.name))),
  'create-package': (step, edit) => markBoxes(step, [edit.path]),
  'cut-edge': (step, edit) => markCut(step, edit.from, edit.to),
  'add-edge': (step, edit) => markArrow(step, edit.from, edit.to),
  fate: () => undefined,
  note: () => undefined,
};

function markerOf<K extends PlanEdit['kind']>(kind: K, step: Marking, edit: Extract<PlanEdit, { kind: K }>): void {
  MARKERS[kind](step, edit);
}

function markEdit(ask: MarkAsk, marks: ConvergeMarks, edit: PlanEdit, index: number): void {
  const status = ask.statuses.get(index);
  if (status === undefined) return;
  markerOf(edit.kind, { ask, index, status, marks }, edit);
}

export function convergeMarks(ask: MarkAsk): ConvergeMarks {
  const marks: ConvergeMarks = { rows: new Map(), boxes: new Set(), cuts: [], arrows: [] };
  ask.edits.forEach((edit, index) => markEdit(ask, marks, edit, index));
  return marks;
}

function markedRow(row: RowInk, marks: ConvergeMarks): RowInk {
  const status = marks.rows.get(row.path);
  return status === 'done' ? { ...row, converge: 'done' } : row;
}

function lostRow(path: string): RowInk {
  return { path, name: lastSegment(path), ghost: true, deleted: false, converge: 'contradicted' };
}

function boxRows(id: string, rows: RowInk[], marks: ConvergeMarks): RowInk[] {
  const lost = [...marks.rows].filter(([path, status]) => status === 'contradicted' && parentDir(path) === id).map(([path]) => path);
  const kept = rows.filter(row => !lost.includes(row.path)).map(row => markedRow(row, marks));
  return [...kept, ...lost.map(lostRow)];
}

function cutsWith(cuts: CutMarkInk[], done: CutMarkInk[]): CutMarkInk[] {
  const known = new Set(cuts.map(cut => arrowKey(cut.from, cut.to)));
  return [...cuts, ...done.filter(cut => !known.has(arrowKey(cut.from, cut.to)))];
}

export function withConverge<T extends InkParts>(ink: T, marks: ConvergeMarks): T {
  const rows = new Map([...ink.rows].map(([id, list]) => [id, boxRows(id, list, marks)]));
  return { ...ink, rows, cuts: cutsWith(ink.cuts, marks.cuts) };
}
