import { moveDest, type AddEdit, type CutEdit, type MoveEdit, type NoteEdit, type NoteTarget, type PlanEdit } from './plan.ts';
import type { ScanResult, ScannedFile } from './scan.ts';

type CutRef = { from: string; to: string };

type WalkOut = { scan: ScanResult; stale: (string | null)[] };

function fileSet(scan: ScanResult): Set<string> {
  return new Set(scan.files.map(file => file.path));
}

function dirKnown(scan: ScanResult, dir: string): boolean {
  return scan.files.some(file => file.path.startsWith(`${dir}/`));
}

function boxKnown(scan: ScanResult, path: string, files: Set<string>): boolean {
  return files.has(path) || dirKnown(scan, path);
}

function boxStale(scan: ScanResult, files: Set<string>, from: string, to: string): string | null {
  if (!boxKnown(scan, from, files)) return `no such box ${from}`;
  return boxKnown(scan, to, files) ? null : `no such box ${to}`;
}

function moveTargetStale(scan: ScanResult, files: Set<string>, to: string, dest: string): string | null {
  if (to !== '.' && !dirKnown(scan, to)) return `no such directory ${to}`;
  return files.has(dest) ? `${dest} already exists` : null;
}

function moveStale(scan: ScanResult, files: Set<string>, edit: MoveEdit): string | null {
  if (!files.has(edit.file)) return `no such file ${edit.file}`;
  const dest = moveDest(edit.file, edit.to);
  if (dest === edit.file) return null;
  return moveTargetStale(scan, files, edit.to, dest);
}

function cutFilesStale(files: Set<string>, pairs: [string, string][]): string | null {
  for (const [importer, imported] of pairs) {
    if (!files.has(importer)) return `no such file ${importer}`;
    if (!files.has(imported)) return `no such file ${imported}`;
  }
  return null;
}

function pairJoined(scan: ScanResult, importer: string, imported: string): boolean {
  return scan.edges.some(edge => edge.from === importer && edge.to === imported);
}

function cutPairsStale(scan: ScanResult, pairs: [string, string][]): string | null {
  for (const [importer, imported] of pairs) {
    if (!pairJoined(scan, importer, imported)) return `${importer} no longer imports ${imported}`;
  }
  return null;
}

function cutStale(scan: ScanResult, files: Set<string>, edit: CutEdit): string | null {
  return boxStale(scan, files, edit.from, edit.to) ?? cutFilesStale(files, edit.files) ?? cutPairsStale(scan, edit.files);
}

function covers(node: string, path: string): boolean {
  return path === node || path.startsWith(`${node}/`);
}

function fileEdgeJoins(scan: ScanResult, from: string, to: string): boolean {
  return scan.edges.some(edge => covers(from, edge.from) && covers(to, edge.to));
}

function plannedJoins(scan: ScanResult, from: string, to: string): boolean {
  const planned = scan.planned;
  if (planned === undefined) return false;
  return planned.some(edge => edge.from === from && edge.to === to);
}

function edgeJoins(scan: ScanResult, from: string, to: string): boolean {
  return fileEdgeJoins(scan, from, to) || plannedJoins(scan, from, to);
}

function addStale(scan: ScanResult, files: Set<string>, edit: AddEdit): string | null {
  const box = boxStale(scan, files, edit.from, edit.to);
  if (box !== null) return box;
  return edgeJoins(scan, edit.from, edit.to) ? `${edit.from} already imports ${edit.to}` : null;
}

function arrowGone(scan: ScanResult, cuts: CutRef[], from: string, to: string): string | null {
  if (edgeJoins(scan, from, to)) return null;
  return cuts.some(cut => cut.from === from && cut.to === to) ? null : `no such arrow ${from} → ${to}`;
}

function noteEdgeStale(scan: ScanResult, files: Set<string>, cuts: CutRef[], edge: [string, string]): string | null {
  return boxStale(scan, files, edge[0], edge[1]) ?? arrowGone(scan, cuts, edge[0], edge[1]);
}

function noteTargetStale(scan: ScanResult, files: Set<string>, cuts: CutRef[], target: NoteTarget): string | null {
  if ('edge' in target) return noteEdgeStale(scan, files, cuts, target.edge);
  return boxKnown(scan, target.node, files) ? null : `no such box ${target.node}`;
}

function noteStale(scan: ScanResult, files: Set<string>, cuts: CutRef[], edit: NoteEdit): string | null {
  return noteTargetStale(scan, files, cuts, edit.target);
}

function staleReason(scan: ScanResult, files: Set<string>, cuts: CutRef[], edit: PlanEdit): string | null {
  if (edit.kind === 'move-file') return moveStale(scan, files, edit);
  if (edit.kind === 'cut-edge') return cutStale(scan, files, edit);
  if (edit.kind === 'add-edge') return addStale(scan, files, edit);
  return noteStale(scan, files, cuts, edit);
}

function remapped(value: string, file: string, dest: string): string {
  return value === file ? dest : value;
}

function movedEdge<T extends { from: string; to: string }>(edge: T, file: string, dest: string): T {
  return { ...edge, from: remapped(edge.from, file, dest), to: remapped(edge.to, file, dest) };
}

function movedFile(file: ScannedFile, path: string, dest: string): ScannedFile {
  return file.path === path ? { ...file, path: dest } : file;
}

function movedExternal<T extends { from: string }>(ext: T, file: string, dest: string): T {
  return { ...ext, from: remapped(ext.from, file, dest) };
}

function applyMove(scan: ScanResult, edit: MoveEdit): ScanResult {
  const dest = moveDest(edit.file, edit.to);
  return {
    ...scan,
    files: scan.files.map(file => movedFile(file, edit.file, dest)),
    edges: scan.edges.map(edge => movedEdge(edge, edit.file, dest)),
    externals: scan.externals.map(ext => movedExternal(ext, edit.file, dest)),
  };
}

function pairListed(pairs: [string, string][], from: string, to: string): boolean {
  return pairs.some(pair => pair[0] === from && pair[1] === to);
}

function applyCut(scan: ScanResult, edit: CutEdit): ScanResult {
  return { ...scan, edges: scan.edges.filter(edge => !pairListed(edit.files, edge.from, edge.to)) };
}

function applyAdd(scan: ScanResult, edit: AddEdit): ScanResult {
  return { ...scan, planned: [...(scan.planned ?? []), { from: edit.from, to: edit.to }] };
}

type WalkState = { scan: ScanResult; cuts: CutRef[] };

function appliedEdit(state: WalkState, edit: PlanEdit): WalkState {
  if (edit.kind === 'move-file') return { ...state, scan: applyMove(state.scan, edit) };
  if (edit.kind === 'cut-edge') return { scan: applyCut(state.scan, edit), cuts: [...state.cuts, { from: edit.from, to: edit.to }] };
  if (edit.kind === 'add-edge') return { ...state, scan: applyAdd(state.scan, edit) };
  return state;
}

function walkPlan(scan: ScanResult, edits: PlanEdit[]): WalkOut {
  const stale: (string | null)[] = [];
  let state: WalkState = { scan, cuts: [] };
  for (const edit of edits) {
    const reason = staleReason(state.scan, fileSet(state.scan), state.cuts, edit);
    stale.push(reason);
    if (reason !== null) continue;
    state = appliedEdit(state, edit);
  }
  return { scan: state.scan, stale };
}

export function applyPlan(scan: ScanResult, edits: PlanEdit[]): ScanResult {
  return walkPlan(scan, edits).scan;
}

export function staleReasons(scan: ScanResult, edits: PlanEdit[]): (string | null)[] {
  return walkPlan(scan, edits).stale;
}
