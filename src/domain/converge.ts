import { byStrings, cutEndLater, pathAfter, sentenceOf, within, type AddEdit, type ContractRule, type CreatePackageEdit, type CutEdit, type FateEdit, type PlanDoc, type PlanEdit, type SplitEdit } from './plan.ts';
import type { ImportLine, ScanResult, WorktreeScan } from './scan.ts';

export type ConvergeStatus = 'done' | 'not yet' | 'contradicted' | 'note';

type EditVerdict = { index: number; status: ConvergeStatus; sentence: string; remain?: string[] };

type RuleVerdict = { name: string; comment: string; holds: boolean; breaks?: string[] };

export type Convergence = { header: string; edits: EditVerdict[]; rules: RuleVerdict[] };

type Spot = { file: string; line: number };

type Verdict = { status: ConvergeStatus; spots: Spot[] };

type Place = 'in' | 'out' | 'lost';

type Ctx = {
  edits: PlanEdit[];
  stale: (string | null)[];
  browsed: ScanResult;
  files: Set<string>;
  imports: ImportLine[];
  fated: Set<string>;
};

type EditOf = { [E in PlanEdit as E['kind']]: E };

type EditKind = keyof EditOf;

type Checks = { [K in EditKind]: (ctx: Ctx, edit: EditOf[K], index: number) => Verdict };

type FoldEdit = Extract<FateEdit, { fate: 'fold' }>;

type Matcher = (imp: ImportLine) => boolean;

const NOT_YET: Verdict = { status: 'not yet', spots: [] };

export function plannedPath(edits: PlanEdit[], stale: (string | null)[], index: number, path: string): string {
  return cutEndLater(pathAfter(edits[index], path) ?? path, edits, stale, index);
}

function plannedOf(ctx: Ctx, index: number, path: string): string {
  return plannedPath(ctx.edits, ctx.stale, index, path);
}

function bothPaths(ctx: Ctx, index: number, path: string): string[] {
  return [path, plannedOf(ctx, index, path)];
}

function spotOf(imp: ImportLine): Spot {
  return { file: imp.from, line: imp.line };
}

function bySpot(a: Spot, b: Spot): number {
  return byStrings(a.file, b.file) || a.line - b.line;
}

function spotText(spot: Spot): string {
  return spot.line === 0 ? spot.file : `${spot.file}:${spot.line}`;
}

function bare(file: string): Spot {
  return { file, line: 0 };
}

function spotTexts(spots: Spot[]): string[] {
  return [...new Set(spots.toSorted(bySpot).map(spotText))];
}

function fromSpots(spots: Spot[]): Verdict {
  return { status: spots.length === 0 ? 'done' : 'not yet', spots };
}

function flagged(done: boolean): Verdict {
  return done ? { status: 'done', spots: [] } : NOT_YET;
}

function leftBehind(ctx: Ctx, old: string, planned: string): boolean {
  return planned !== old && ctx.files.has(old);
}

function fateCovers(ctx: Ctx, old: string, planned: string): Place {
  return ctx.fated.has(old) || ctx.fated.has(planned) ? 'in' : 'lost';
}

function placeOf(ctx: Ctx, old: string, planned: string): Place {
  if (ctx.files.has(planned)) return leftBehind(ctx, old, planned) ? 'out' : 'in';
  return ctx.files.has(old) ? 'out' : fateCovers(ctx, old, planned);
}

function coveredStatus(places: Place[]): ConvergeStatus {
  if (places.includes('lost')) return 'contradicted';
  return places.every(place => place === 'in') ? 'done' : 'not yet';
}

function coveredVerdict(ctx: Ctx, index: number, covered: string[]): Verdict {
  const places = covered.map(path => placeOf(ctx, path, plannedOf(ctx, index, path)));
  return { status: coveredStatus(places), spots: [] };
}

function browsedUnder(ctx: Ctx, dirs: string[]): string[] {
  return ctx.browsed.files.map(file => file.path).filter(path => dirs.some(dir => within(dir, path)));
}

function splitFiles(ctx: Ctx, edit: SplitEdit): string[] {
  const listed = new Set(edit.parts.flatMap(part => part.files));
  return ctx.browsed.files.filter(file => listed.has(file.path)).map(file => file.path);
}

function pairMatches(ends: string[][], imp: ImportLine): boolean {
  return ends[0].includes(imp.from) && ends[1].includes(imp.to);
}

function cutVerdict(ctx: Ctx, edit: CutEdit, index: number): Verdict {
  const pairs = edit.files.map(pair => pair.map(path => bothPaths(ctx, index, path)));
  return fromSpots(ctx.imports.filter(imp => pairs.some(ends => pairMatches(ends, imp))).map(spotOf));
}

function inAny(nodes: string[], path: string): boolean {
  return nodes.some(node => within(node, path));
}

function addJoins(imp: ImportLine, from: string[], to: string[]): boolean {
  return imp.resolved && inAny(from, imp.from) && inAny(to, imp.to);
}

function addVerdict(ctx: Ctx, edit: AddEdit, index: number): Verdict {
  const from = bothPaths(ctx, index, edit.from);
  const to = bothPaths(ctx, index, edit.to);
  return flagged(ctx.imports.some(imp => addJoins(imp, from, to)));
}

function createVerdict(ctx: Ctx, edit: CreatePackageEdit, index: number): Verdict {
  const dir = plannedOf(ctx, index, edit.path);
  return flagged([...ctx.files].some(path => path.startsWith(`${dir}/`)));
}

function firstScanned(ctx: Ctx, paths: string[]): string | undefined {
  for (const path of paths) {
    if (ctx.files.has(path)) return path;
  }
  return undefined;
}

function present(ctx: Ctx, paths: string[]): boolean {
  return firstScanned(ctx, paths) !== undefined;
}

function deleteVerdict(ctx: Ctx, file: string, index: number): Verdict {
  const paths = bothPaths(ctx, index, file);
  if (present(ctx, paths)) return NOT_YET;
  return fromSpots(ctx.imports.filter(imp => paths.includes(imp.to)).map(spotOf));
}

function formerImporters(ctx: Ctx, edit: FoldEdit): string[] {
  const edges = ctx.browsed.edges.filter(edge => edge.to === edit.file && edge.from !== edit.into);
  return [...new Set(edges.map(edge => edge.from))];
}

function keptImports(ctx: Ctx, found: string, folded: string[], into: string[]): Spot[] {
  const own = ctx.imports.filter(imp => imp.from === found);
  if (own.some(imp => into.includes(imp.to))) return [];
  const kept = own.filter(imp => folded.includes(imp.to)).map(spotOf);
  return kept.length === 0 ? [bare(found)] : kept;
}

function missingImporter(ctx: Ctx, planned: string, importer: string): Spot[] {
  return fateCovers(ctx, importer, planned) === 'in' ? [] : [bare(planned)];
}

function importerSpots(ctx: Ctx, index: number, importer: string, folded: string[], into: string[]): Spot[] {
  const planned = plannedOf(ctx, index, importer);
  const found = firstScanned(ctx, [planned, importer]);
  if (found === undefined) return missingImporter(ctx, planned, importer);
  return keptImports(ctx, found, folded, into);
}

function foldVerdict(ctx: Ctx, edit: FoldEdit, index: number): Verdict {
  const folded = bothPaths(ctx, index, edit.file);
  if (present(ctx, folded)) return NOT_YET;
  const into = bothPaths(ctx, index, edit.into);
  return fromSpots(formerImporters(ctx, edit).flatMap(importer => importerSpots(ctx, index, importer, folded, into)));
}

function fateVerdict(ctx: Ctx, edit: FateEdit, index: number): Verdict {
  return edit.fate === 'fold' ? foldVerdict(ctx, edit, index) : deleteVerdict(ctx, edit.file, index);
}

const CHECKS: Checks = {
  'move-file': (ctx, edit, index) => coveredVerdict(ctx, index, [edit.file]),
  'rename-file': (ctx, edit, index) => coveredVerdict(ctx, index, [edit.from]),
  'rename-package': (ctx, edit, index) => coveredVerdict(ctx, index, browsedUnder(ctx, [edit.from])),
  'merge-packages': (ctx, edit, index) => coveredVerdict(ctx, index, browsedUnder(ctx, edit.packages)),
  'split-package': (ctx, edit, index) => coveredVerdict(ctx, index, splitFiles(ctx, edit)),
  'cut-edge': cutVerdict,
  'add-edge': addVerdict,
  'create-package': createVerdict,
  fate: fateVerdict,
  note: () => ({ status: 'note', spots: [] }),
};

function checkOf<K extends EditKind>(kind: K, ctx: Ctx, edit: EditOf[K], index: number): Verdict {
  return CHECKS[kind](ctx, edit, index);
}

function editVerdict(ctx: Ctx, edit: PlanEdit, index: number): EditVerdict {
  const verdict = checkOf(edit.kind, ctx, edit, index);
  const remain = spotTexts(verdict.spots);
  const base = { index, status: verdict.status, sentence: sentenceOf(edit) };
  return remain.length === 0 ? base : { ...base, remain };
}

function fatedFiles(edits: PlanEdit[]): Set<string> {
  return new Set(edits.flatMap(edit => (edit.kind === 'fate' ? [edit.file] : [])));
}

type Links = Map<string, string[]>;

function linked(imports: ImportLine[], from: (imp: ImportLine) => string, to: (imp: ImportLine) => string): Links {
  const links: Links = new Map();
  for (const imp of imports) {
    const list = links.get(from(imp)) ?? [];
    list.push(to(imp));
    links.set(from(imp), list);
  }
  return links;
}

function finish(node: string, out: Links, seen: Set<string>, order: string[]): void {
  if (seen.has(node)) return;
  seen.add(node);
  for (const next of out.get(node) ?? []) finish(next, out, seen, order);
  order.push(node);
}

function claim(node: string, into: Links, owner: Map<string, string>, root: string): void {
  if (owner.has(node)) return;
  owner.set(node, root);
  for (const prev of into.get(node) ?? []) claim(prev, into, owner, root);
}

function cycleOwners(imports: ImportLine[]): Map<string, string> {
  const out = linked(imports, imp => imp.from, imp => imp.to);
  const into = linked(imports, imp => imp.to, imp => imp.from);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const node of out.keys()) finish(node, out, seen, order);
  const owner = new Map<string, string>();
  for (const node of order.toReversed()) claim(node, into, owner, node);
  return owner;
}

function cycleTest(imports: ImportLine[]): Matcher {
  const owner = cycleOwners(imports.filter(imp => imp.resolved));
  return imp => imp.resolved && owner.get(imp.from) === owner.get(imp.to);
}

function pathMatcher(pattern: string | undefined, end: (imp: ImportLine) => string): Matcher {
  if (pattern === undefined) return () => true;
  const regex = new RegExp(pattern);
  return imp => regex.test(end(imp));
}

function ruleMatcher(rule: ContractRule, cyclic: Matcher): Matcher {
  const from = pathMatcher('path' in rule.from ? rule.from.path : undefined, imp => imp.from);
  const to = 'circular' in rule.to ? cyclic : pathMatcher(rule.to.path, imp => imp.to);
  return imp => from(imp) && to(imp);
}

function ruleVerdict(rule: ContractRule, imports: ImportLine[], cyclic: Matcher): RuleVerdict {
  const breaks = spotTexts(imports.filter(ruleMatcher(rule, cyclic)).map(spotOf));
  const base = { name: rule.name, comment: rule.comment };
  return breaks.length === 0 ? { ...base, holds: true } : { ...base, holds: false, breaks };
}

function countOf<T>(items: T[], keep: (item: T) => boolean): number {
  return items.filter(keep).length;
}

function headerOf(edits: EditVerdict[], rules: RuleVerdict[]): string {
  const checked = countOf(edits, edit => edit.status !== 'note');
  const done = countOf(edits, edit => edit.status === 'done');
  const holding = countOf(rules, rule => rule.holds);
  return `${done} of ${checked} edits done · ${holding} of ${rules.length} rules hold`;
}

export function convergeVerdict(doc: Pick<PlanDoc, 'edits' | 'contract'>, browsed: { scan: ScanResult; stale: (string | null)[] }, worktree: WorktreeScan): Convergence {
  const ctx: Ctx = {
    edits: doc.edits,
    stale: browsed.stale,
    browsed: browsed.scan,
    files: new Set(worktree.scan.files.map(file => file.path)),
    imports: worktree.imports,
    fated: fatedFiles(doc.edits),
  };
  const edits = doc.edits.map((edit, index) => editVerdict(ctx, edit, index));
  const cyclic = cycleTest(worktree.imports);
  const rules = (doc.contract?.rules ?? []).map(rule => ruleVerdict(rule, worktree.imports, cyclic));
  return { header: headerOf(edits, rules), edits, rules };
}
