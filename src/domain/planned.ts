import {
  byStrings,
  cutEndLater,
  mergeDest,
  moveDest,
  parentOf,
  renamedFile,
  splitPartPath,
  within,
  type AddEdit,
  type ContractRule,
  type CreatePackageEdit,
  type CutEdit,
  type FateEdit,
  type MergeEdit,
  type MoveEdit,
  type NoteTarget,
  type PlanEdit,
  type RenameFileEdit,
  type RenamePackageEdit,
  type SplitEdit,
} from './plan.ts';
import type { PlanWarning, ScanResult } from './scan.ts';

type CutRef = { from: string; to: string };

type Marks = { declared: Map<string, number>; deleted: Map<string, number> };

type WalkState = { scan: ScanResult; cuts: CutRef[]; marks: Marks };

type Look = { scan: ScanResult; files: Set<string>; marks: Marks };

type WalkOut = { states: WalkState[]; stale: (string | null)[] };

type Relocate = (path: string) => string;

export type CycleTexts = (scan: ScanResult) => string[];

export type PlanReport = { scan: ScanResult; stale: (string | null)[]; warnings: PlanWarning[][] };

function fileSet(scan: ScanResult): Set<string> {
  return new Set(scan.files.map(file => file.path));
}

function dirKnown(look: Look, dir: string): boolean {
  return look.marks.declared.has(dir) || look.scan.files.some(file => file.path.startsWith(`${dir}/`));
}

function boxKnown(look: Look, path: string): boolean {
  return look.files.has(path) || dirKnown(look, path);
}

function boxStale(look: Look, from: string, to: string): string | null {
  if (!boxKnown(look, from)) return `no such box ${from}`;
  return boxKnown(look, to) ? null : `no such box ${to}`;
}

function moveTargetStale(look: Look, to: string, dest: string): string | null {
  if (to !== '.' && !dirKnown(look, to)) return `no such directory ${to}`;
  return look.files.has(dest) ? `${dest} already exists` : null;
}

function moveStale(look: Look, edit: MoveEdit): string | null {
  if (!look.files.has(edit.file)) return `no such file ${edit.file}`;
  const dest = moveDest(edit.file, edit.to);
  if (dest === edit.file) return null;
  return moveTargetStale(look, edit.to, dest);
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

function cutStale(look: Look, edit: CutEdit): string | null {
  return boxStale(look, edit.from, edit.to) ?? cutFilesStale(look.files, edit.files) ?? cutPairsStale(look.scan, edit.files);
}

function fileEdgeJoins(scan: ScanResult, from: string, to: string): boolean {
  return scan.edges.some(edge => within(from, edge.from) && within(to, edge.to));
}

function plannedJoins(scan: ScanResult, from: string, to: string): boolean {
  const planned = scan.planned;
  if (planned === undefined) return false;
  return planned.some(edge => edge.from === from && edge.to === to);
}

function edgeJoins(scan: ScanResult, from: string, to: string): boolean {
  return fileEdgeJoins(scan, from, to) || plannedJoins(scan, from, to);
}

function addStale(look: Look, edit: AddEdit): string | null {
  const box = boxStale(look, edit.from, edit.to);
  if (box !== null) return box;
  return edgeJoins(look.scan, edit.from, edit.to) ? `${edit.from} already imports ${edit.to}` : null;
}

function arrowGone(scan: ScanResult, cuts: CutRef[], from: string, to: string): string | null {
  if (edgeJoins(scan, from, to)) return null;
  return cuts.some(cut => cut.from === from && cut.to === to) ? null : `no such arrow ${from} → ${to}`;
}

function noteEdgeStale(look: Look, cuts: CutRef[], edge: [string, string]): string | null {
  return boxStale(look, edge[0], edge[1]) ?? arrowGone(look.scan, cuts, edge[0], edge[1]);
}

function noteStale(look: Look, cuts: CutRef[], target: NoteTarget): string | null {
  if ('edge' in target) return noteEdgeStale(look, cuts, target.edge);
  return boxKnown(look, target.node) ? null : `no such box ${target.node}`;
}

function takenStale(look: Look, path: string): string | null {
  return boxKnown(look, path) ? `${path} already exists` : null;
}

function createStale(look: Look, edit: CreatePackageEdit): string | null {
  const parent = parentOf(edit.path);
  if (parent !== '' && !dirKnown(look, parent)) return `no such directory ${parent}`;
  return takenStale(look, edit.path);
}

function renamePackageStale(look: Look, edit: RenamePackageEdit): string | null {
  if (!dirKnown(look, edit.from)) return `no such directory ${edit.from}`;
  return takenStale(look, edit.to);
}

function renameFileStale(look: Look, edit: RenameFileEdit): string | null {
  if (!look.files.has(edit.from)) return `no such file ${edit.from}`;
  return takenStale(look, renamedFile(edit.from, edit.to));
}

function listedUnder(edit: MergeEdit, path: string): boolean {
  return edit.packages.some(pkg => within(pkg, path));
}

function strayUnder(look: Look, edit: MergeEdit): boolean {
  return look.scan.files.some(file => within(edit.into, file.path) && !listedUnder(edit, file.path));
}

function intoOccupied(look: Look, edit: MergeEdit): boolean {
  return look.files.has(edit.into) || strayUnder(look, edit);
}

function intoStale(look: Look, edit: MergeEdit): string | null {
  if (edit.packages.includes(edit.into)) return null;
  return intoOccupied(look, edit) ? `${edit.into} already exists` : null;
}

function firstRepeat(paths: string[]): string | undefined {
  const seen = new Set<string>();
  return paths.find(path => seen.size === seen.add(path).size);
}

function landingStale(look: Look, edit: MergeEdit): string | null {
  const repeat = firstRepeat(look.scan.files.map(file => mergeDest(edit, file.path)));
  return repeat === undefined ? null : `${repeat} already exists`;
}

function mergeStale(look: Look, edit: MergeEdit): string | null {
  const missing = edit.packages.find(pkg => !dirKnown(look, pkg));
  if (missing !== undefined) return `no such directory ${missing}`;
  return intoStale(look, edit) ?? landingStale(look, edit);
}

function strayPart(look: Look, edit: SplitEdit): string | undefined {
  return edit.parts.flatMap(part => part.files).find(file => !look.files.has(file) || !file.startsWith(`${edit.package}/`));
}

function partClash(look: Look, edit: SplitEdit): string | null {
  const clash = edit.parts.map(part => splitPartPath(edit.package, part.name)).find(path => boxKnown(look, path));
  return clash === undefined ? null : `${clash} already exists`;
}

function splitStale(look: Look, edit: SplitEdit): string | null {
  if (!dirKnown(look, edit.package)) return `no such directory ${edit.package}`;
  const stray = strayPart(look, edit);
  return stray === undefined ? partClash(look, edit) : `no such file ${stray}`;
}

function fateTargetStale(look: Look, edit: FateEdit): string | null {
  if (edit.fate === 'fold') return look.files.has(edit.into) ? null : `no such file ${edit.into}`;
  return look.marks.deleted.has(edit.file) ? `${edit.file} is already deleted` : null;
}

function fateStale(look: Look, edit: FateEdit): string | null {
  if (!look.files.has(edit.file)) return `no such file ${edit.file}`;
  return fateTargetStale(look, edit);
}

type EditOf = { [E in PlanEdit as E['kind']]: E };

type EditKind = keyof EditOf;

type StaleRules = { [K in EditKind]: (look: Look, edit: EditOf[K], cuts: CutRef[]) => string | null };

const STALE_RULES: StaleRules = {
  'move-file': moveStale,
  'cut-edge': cutStale,
  'add-edge': addStale,
  note: (look, edit, cuts) => noteStale(look, cuts, edit.target),
  'create-package': createStale,
  'rename-package': renamePackageStale,
  'rename-file': renameFileStale,
  'merge-packages': mergeStale,
  'split-package': splitStale,
  fate: fateStale,
};

function rekeyed(map: Map<string, number>, move: Relocate): Map<string, number> {
  return new Map([...map].map(([path, origin]) => [move(path), origin]));
}

function relocatedFiles(scan: ScanResult, move: Relocate): ScanResult {
  return {
    ...scan,
    files: scan.files.map(file => ({ ...file, path: move(file.path) })),
    edges: scan.edges.map(edge => ({ ...edge, from: move(edge.from), to: move(edge.to) })),
    externals: scan.externals.map(ext => ({ ...ext, from: move(ext.from) })),
  };
}

function relocatedPlanned(scan: ScanResult, move: Relocate): ScanResult {
  if (scan.planned === undefined) return scan;
  return { ...scan, planned: scan.planned.map(edge => ({ from: move(edge.from), to: move(edge.to) })) };
}

function withScan(state: WalkState, scan: ScanResult, move: Relocate): WalkState {
  return { ...state, scan, marks: { declared: rekeyed(state.marks.declared, move), deleted: rekeyed(state.marks.deleted, move) } };
}

function relocated(state: WalkState, move: Relocate): WalkState {
  return withScan(state, relocatedPlanned(relocatedFiles(state.scan, move), move), move);
}

function applyMove(state: WalkState, edit: MoveEdit): WalkState {
  const move = exactly(edit.file, moveDest(edit.file, edit.to));
  return withScan(state, relocatedFiles(state.scan, move), move);
}

function exactly(from: string, to: string): Relocate {
  return path => (path === from ? to : path);
}

function underneath(from: string, to: string): Relocate {
  return path => (within(from, path) ? `${to}${path.slice(from.length)}` : path);
}

function withDeclared(state: WalkState, declared: Map<string, number>): WalkState {
  return { ...state, marks: { ...state.marks, declared } };
}

function dropped(edit: MergeEdit, path: string): boolean {
  return path !== edit.into && edit.packages.includes(path);
}

function applyMerge(state: WalkState, edit: MergeEdit): WalkState {
  const kept = new Map([...state.marks.declared].filter(([path]) => !dropped(edit, path)));
  return relocated(withDeclared(state, kept), path => mergeDest(edit, path));
}

function splitMove(edit: SplitEdit): Relocate {
  const dest = new Map<string, string>();
  for (const part of edit.parts) {
    for (const file of part.files) dest.set(file, `${splitPartPath(edit.package, part.name)}${file.slice(edit.package.length)}`);
  }
  return path => dest.get(path) ?? path;
}

function applySplit(state: WalkState, edit: SplitEdit, index: number): WalkState {
  const declared = new Map(state.marks.declared);
  for (const part of edit.parts) declared.set(splitPartPath(edit.package, part.name), index);
  return relocated(withDeclared(state, declared), splitMove(edit));
}

function applyCreate(state: WalkState, edit: CreatePackageEdit, index: number): WalkState {
  return withDeclared(state, new Map([...state.marks.declared, [edit.path, index]]));
}

function withoutFile(state: WalkState, file: string): WalkState {
  const deleted = new Map(state.marks.deleted);
  deleted.delete(file);
  return { ...state, scan: { ...state.scan, files: state.scan.files.filter(item => item.path !== file) }, marks: { ...state.marks, deleted } };
}

function keptPair(edge: { from: string; to: string }): boolean {
  return edge.from !== edge.to;
}

function withoutSelfEdges(state: WalkState): WalkState {
  const edges = state.scan.edges.filter(keptPair);
  const planned = state.scan.planned;
  const scan = planned === undefined ? { ...state.scan, edges } : { ...state.scan, edges, planned: planned.filter(keptPair) };
  return { ...state, scan };
}

function applyFold(state: WalkState, file: string, into: string): WalkState {
  return withoutSelfEdges(relocated(withoutFile(state, file), exactly(file, into)));
}

function markDeleted(state: WalkState, file: string, index: number): WalkState {
  return { ...state, marks: { ...state.marks, deleted: new Map([...state.marks.deleted, [file, index]]) } };
}

function applyFate(state: WalkState, edit: FateEdit, index: number): WalkState {
  return edit.fate === 'fold' ? applyFold(state, edit.file, edit.into) : markDeleted(state, edit.file, index);
}

function pairListed(pairs: [string, string][], from: string, to: string): boolean {
  return pairs.some(pair => pair[0] === from && pair[1] === to);
}

function applyCut(state: WalkState, edit: CutEdit): WalkState {
  const scan = { ...state.scan, edges: state.scan.edges.filter(edge => !pairListed(edit.files, edge.from, edge.to)) };
  return { ...state, scan, cuts: [...state.cuts, { from: edit.from, to: edit.to }] };
}

function applyAdd(state: WalkState, edit: AddEdit): WalkState {
  return { ...state, scan: { ...state.scan, planned: [...(state.scan.planned ?? []), { from: edit.from, to: edit.to }] } };
}

type ApplyRules = { [K in EditKind]: (state: WalkState, edit: EditOf[K], index: number) => WalkState };

const APPLY_RULES: ApplyRules = {
  'move-file': applyMove,
  'cut-edge': applyCut,
  'add-edge': applyAdd,
  note: state => state,
  'create-package': applyCreate,
  'rename-package': (state, edit) => relocated(state, underneath(edit.from, edit.to)),
  'rename-file': (state, edit) => relocated(state, exactly(edit.from, renamedFile(edit.from, edit.to))),
  'merge-packages': applyMerge,
  'split-package': applySplit,
  fate: applyFate,
};

function staleOf<K extends EditKind>(kind: K, look: Look, cuts: CutRef[], edit: EditOf[K]): string | null {
  return STALE_RULES[kind](look, edit, cuts);
}

function appliedOf<K extends EditKind>(kind: K, state: WalkState, edit: EditOf[K], index: number): WalkState {
  return APPLY_RULES[kind](state, edit, index);
}

function lookOf(state: WalkState): Look {
  return { scan: state.scan, files: fileSet(state.scan), marks: state.marks };
}

function stepped(state: WalkState, edit: PlanEdit, index: number, stale: (string | null)[]): WalkState {
  const reason = staleOf(edit.kind, lookOf(state), state.cuts, edit);
  stale.push(reason);
  return reason === null ? appliedOf(edit.kind, state, edit, index) : state;
}

function walkPlan(scan: ScanResult, edits: PlanEdit[]): WalkOut {
  const stale: (string | null)[] = [];
  const states: WalkState[] = [{ scan, cuts: [], marks: { declared: new Map(), deleted: new Map() } }];
  edits.forEach((edit, index) => states.push(stepped(states[index], edit, index, stale)));
  return { states, stale };
}

function directDirs(scan: ScanResult): Set<string> {
  return new Set(scan.files.map(file => parentOf(file.path)));
}

function holdsUnder(scan: ScanResult, declared: string[], dir: string): boolean {
  const prefix = `${dir}/`;
  return scan.files.some(file => file.path.startsWith(prefix)) || declared.some(path => path.startsWith(prefix));
}

function hiddenDirs(original: ScanResult, scan: ScanResult, declared: string[]): string[] {
  const after = directDirs(scan);
  return [...directDirs(original)].filter(dir => !after.has(dir) && holdsUnder(scan, declared, dir));
}

function withList(scan: ScanResult, key: 'declared' | 'deleted' | 'hidden', list: string[]): ScanResult {
  return list.length === 0 ? scan : { ...scan, [key]: list.toSorted(byStrings) };
}

function finished(original: ScanResult, state: WalkState): ScanResult {
  const declared = [...state.marks.declared.keys()];
  const marked = withList(withList(state.scan, 'declared', declared), 'deleted', [...state.marks.deleted.keys()]);
  return withList(marked, 'hidden', hiddenDirs(original, state.scan, declared));
}

function lastOf<T>(items: T[]): T {
  const [last] = items.slice(-1);
  return last;
}

export function applyPlan(scan: ScanResult, edits: PlanEdit[]): ScanResult {
  return finished(scan, lastOf(walkPlan(scan, edits).states));
}

export function staleReasons(scan: ScanResult, edits: PlanEdit[]): (string | null)[] {
  return walkPlan(scan, edits).stale;
}

type Placed = { at: number; warning: PlanWarning };

function holdsFiles(scan: ScanResult, dir: string): boolean {
  return scan.files.some(file => within(dir, file.path));
}

function byMarkedPath(a: [string, number], b: [string, number]): number {
  return byStrings(a[0], b[0]);
}

function emptyWarnings(state: WalkState): Placed[] {
  const empty = [...state.marks.declared].filter(([path]) => !holdsFiles(state.scan, path));
  return empty.toSorted(byMarkedPath).map(([path, at]) => ({ at, warning: { kind: 'empty-package', path } }));
}

function importersOf(scan: ScanResult, file: string): string[] {
  return [...new Set(scan.edges.filter(edge => edge.to === file).map(edge => edge.from))].sort(byStrings);
}

function deletedWarnings(state: WalkState): Placed[] {
  const placed: Placed[] = [];
  for (const [file, at] of state.marks.deleted) {
    const importers = importersOf(state.scan, file);
    if (importers.length > 0) placed.push({ at, warning: { kind: 'deleted-imports', file, importers } });
  }
  return placed;
}

function cachedTexts(cycles: CycleTexts): (scan: ScanResult) => Set<string> {
  const cache = new Map<ScanResult, Set<string>>();
  return scan => {
    const known = cache.get(scan) ?? new Set(cycles(scan));
    cache.set(scan, known);
    return known;
  };
}

function firstStage(stages: ScanResult[], textsOf: (scan: ScanResult) => Set<string>, text: string): number {
  return stages.findIndex(stage => textsOf(stage).has(text));
}

function cycleWarnings(scan: ScanResult, states: WalkState[], cycles: CycleTexts): Placed[] {
  const textsOf = cachedTexts(cycles);
  const stages = states.map(state => finished(scan, state));
  const before = textsOf(stages[0]);
  const fresh = [...textsOf(lastOf(stages))].filter(text => !before.has(text)).sort(byStrings);
  return fresh.map(cycle => ({ at: firstStage(stages, textsOf, cycle) - 1, warning: { kind: 'added-cycle', cycle } }));
}

function grouped(count: number, placed: Placed[]): PlanWarning[][] {
  const out: PlanWarning[][] = Array.from({ length: count }, () => []);
  for (const item of placed) out[item.at].push(item.warning);
  return out;
}

export function planReport(scan: ScanResult, edits: PlanEdit[], cycles: CycleTexts): PlanReport {
  const walk = walkPlan(scan, edits);
  const last = lastOf(walk.states);
  const placed = [...emptyWarnings(last), ...deletedWarnings(last), ...cycleWarnings(scan, walk.states, cycles)];
  return { scan: finished(scan, last), stale: walk.stale, warnings: grouped(edits.length, placed) };
}

type CutAsk = { edits: PlanEdit[]; stale: (string | null)[]; files: Set<string> };

const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

function escaped(path: string): string {
  return path.replace(REGEX_SPECIAL, '\\$&');
}

function spelled(path: string): string {
  return path.replace(/[/.]/g, '-');
}

function endPattern(end: string, files: Set<string>): string {
  return files.has(end) ? `^${escaped(end)}$` : `^${escaped(end)}/`;
}

function cutRule(from: string, to: string, files: Set<string>): ContractRule {
  return {
    name: `bindweed:no-${spelled(from)}-to-${spelled(to)}`,
    severity: 'error',
    comment: `${from} must not import ${to}`,
    from: { path: endPattern(from, files) },
    to: { path: endPattern(to, files) },
  };
}

function liveCut(edit: PlanEdit, reason: string | null | undefined): edit is CutEdit {
  return reason === null && edit.kind === 'cut-edge';
}

function nested(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

function cutRulesAt(edit: PlanEdit, index: number, ask: CutAsk): ContractRule[] {
  if (!liveCut(edit, ask.stale[index])) return [];
  const from = cutEndLater(edit.from, ask.edits, ask.stale, index);
  const to = cutEndLater(edit.to, ask.edits, ask.stale, index);
  return nested(from, to) ? [] : [cutRule(from, to, ask.files)];
}

function distinctRules(rules: ContractRule[]): ContractRule[] {
  const seen = new Set<string>();
  return rules.filter(rule => seen.size < seen.add(JSON.stringify(rule)).size);
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function packagesOf(scan: ScanResult): Set<string> {
  const code = scan.files.filter(file => !file.test).flatMap(file => ancestorsOf(file.path));
  return new Set([...(scan.declared ?? []), ...code]);
}

function siblingPair(from: string, to: string): [string, string] | null {
  const left = from.split('/');
  const right = to.split('/');
  const split = left.findIndex((part, index) => part !== right[index]);
  if (split === -1 || split >= right.length) return null;
  return [left.slice(0, split + 1).join('/'), right.slice(0, split + 1).join('/')];
}

function pairKey(user: string, used: string): string {
  return JSON.stringify([user, used]);
}

function packagePair(pair: [string, string] | null, packages: Set<string>): pair is [string, string] {
  return pair !== null && packages.has(pair[0]) && packages.has(pair[1]);
}

function usesOf(scan: ScanResult, packages: Set<string>): [string, string][] {
  const pairs = [...scan.edges, ...(scan.planned ?? [])].map(edge => siblingPair(edge.from, edge.to));
  const found = new Map(pairs.filter(pair => packagePair(pair, packages)).map(pair => [pairKey(pair[0], pair[1]), pair]));
  return [...found.values()].filter(([user, used]) => !found.has(pairKey(used, user)));
}

function directionRule(user: string, used: string): ContractRule {
  return {
    name: `bindweed:${spelled(used)}-does-not-use-${spelled(user)}`,
    severity: 'error',
    comment: `${used} does not use ${user}`,
    from: { path: `^${escaped(used)}/` },
    to: { path: `^${escaped(user)}/` },
  };
}

function byRuleName(a: ContractRule, b: ContractRule): number {
  return byStrings(a.name, b.name);
}

function directionRules(scan: ScanResult): ContractRule[] {
  return usesOf(scan, packagesOf(scan))
    .map(([user, used]) => directionRule(user, used))
    .sort(byRuleName);
}

function noCircular(): ContractRule {
  return { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };
}

export function contractRules(scan: ScanResult, edits: PlanEdit[], cycles: boolean): ContractRule[] {
  const walk = walkPlan(scan, edits);
  const planned = finished(scan, lastOf(walk.states));
  const ask: CutAsk = { edits, stale: walk.stale, files: fileSet(planned) };
  const rules = [...distinctRules(edits.flatMap((edit, index) => cutRulesAt(edit, index, ask))), ...directionRules(planned)];
  return cycles ? [...rules, noCircular()] : rules;
}
