export type NoteTarget = { node: string } | { edge: [string, string] };

export type MoveEdit = { kind: 'move-file'; file: string; to: string };

export type CutEdit = { kind: 'cut-edge'; from: string; to: string; files: [string, string][] };

export type AddEdit = { kind: 'add-edge'; from: string; to: string };

export type NoteEdit = { kind: 'note'; target: NoteTarget; text: string };

export type CreatePackageEdit = { kind: 'create-package'; path: string };

export type RenamePackageEdit = { kind: 'rename-package'; from: string; to: string };

export type RenameFileEdit = { kind: 'rename-file'; from: string; to: string };

export type MergeEdit = { kind: 'merge-packages'; packages: string[]; into: string };

type SplitPart = { name: string; files: string[] };

export type SplitEdit = { kind: 'split-package'; package: string; parts: SplitPart[] };

export type FateEdit = { kind: 'fate'; file: string; fate: 'delete' } | { kind: 'fate'; file: string; fate: 'fold'; into: string };

export type PlanEdit = MoveEdit | CutEdit | AddEdit | NoteEdit | CreatePackageEdit | RenamePackageEdit | RenameFileEdit | MergeEdit | SplitEdit | FateEdit;

export type PlanDoc = {
  version: 1;
  name: string;
  slug: string;
  createdAt: string;
  baseCommit: string;
  edits: PlanEdit[];
  redo: PlanEdit[];
};

export type PlanSummary = { name: string; slug: string; editCount: number; createdAt: string };

const SLUG_MAX = 40;
export const PLAN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLAN_KEYS = ['version', 'name', 'slug', 'createdAt', 'baseCommit', 'edits', 'redo'];
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function isDash(value: string, index: number): boolean {
  return value[index] === '-';
}

function skipDashes(value: string, from: number, step: number): number {
  let index = from;
  while (isDash(value, index)) index += step;
  return index;
}

function trimDashes(value: string): string {
  const start = skipDashes(value, 0, 1);
  const end = skipDashes(value, value.length - 1, -1) + 1;
  return value.slice(start, end);
}

export function slugOf(name: string): string {
  const dashed = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return trimDashes(dashed).slice(0, SLUG_MAX);
}

export function freeSlug(base: string, taken: (slug: string) => boolean): string {
  let slug = base;
  let next = 2;
  while (taken(slug)) {
    slug = `${base}-${next}`;
    next += 1;
  }
  return slug;
}

export function legalName(name: string): boolean {
  return NAME_PATTERN.test(name) && name !== '.' && name !== '..';
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function childPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

export function renamedFile(from: string, to: string): string {
  return childPath(parentOf(from), to);
}

export function splitPartPath(pkg: string, name: string): string {
  return `${pkg}/${name}`;
}

export function byStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function within(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function pathOk(path: string): boolean {
  return path.split('/').every(legalName);
}

export function moveDest(file: string, to: string): string {
  const name = lastSegment(file);
  return to === '.' ? name : `${to}/${name}`;
}

function recordOf(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw));
}

function noExtraKeys(rec: Record<string, unknown>, keys: string[]): boolean {
  const known = new Set(keys);
  return Object.keys(rec).filter(key => !known.has(key)).length === 0;
}

function slugChecked(name: string): string | undefined {
  return slugOf(name) === '' ? undefined : name;
}

function nameField(rec: Record<string, unknown>): string | undefined {
  return typeof rec.name === 'string' ? rec.name : undefined;
}

export function planNameFrom(raw: unknown): string | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['name'])) return undefined;
  const field = nameField(rec);
  if (field === undefined) return undefined;
  return slugChecked(field.trim());
}

function pairArray(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  return raw;
}

function stringPair(raw: unknown): [string, string] | undefined {
  const pair = pairArray(raw);
  if (pair === undefined) return undefined;
  const [first, second] = pair;
  return typeof first === 'string' && typeof second === 'string' ? [first, second] : undefined;
}

function listOfAtLeast(raw: unknown, min: number): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length < min) return undefined;
  return raw;
}

function everyRead<T>(items: unknown[] | undefined, read: (item: unknown) => T | undefined): T[] | undefined {
  if (items === undefined) return undefined;
  const values: T[] = [];
  for (const item of items) {
    const value = read(item);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function pairsFrom(raw: unknown): [string, string][] | undefined {
  return everyRead(listOfAtLeast(raw, 1), stringPair);
}

function endpointsOf(rec: Record<string, unknown>): { from: string; to: string } | undefined {
  if (typeof rec.from !== 'string' || typeof rec.to !== 'string') return undefined;
  return { from: rec.from, to: rec.to };
}

function moveEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!noExtraKeys(rec, ['kind', 'file', 'to'])) return undefined;
  if (typeof rec.file !== 'string' || typeof rec.to !== 'string') return undefined;
  return { kind: 'move-file', file: rec.file, to: rec.to };
}

function cutEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!noExtraKeys(rec, ['kind', 'from', 'to', 'files'])) return undefined;
  const ends = endpointsOf(rec);
  const files = pairsFrom(rec.files);
  if (ends === undefined || files === undefined) return undefined;
  return { kind: 'cut-edge', from: ends.from, to: ends.to, files };
}

function addEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!noExtraKeys(rec, ['kind', 'from', 'to'])) return undefined;
  const ends = endpointsOf(rec);
  if (ends === undefined || ends.from === ends.to) return undefined;
  return { kind: 'add-edge', from: ends.from, to: ends.to };
}

function nodeTarget(rec: Record<string, unknown>): NoteTarget | undefined {
  if (typeof rec.node !== 'string' || !noExtraKeys(rec, ['node'])) return undefined;
  return { node: rec.node };
}

function edgeTarget(rec: Record<string, unknown>): NoteTarget | undefined {
  const pair = stringPair(rec.edge);
  if (pair === undefined || !noExtraKeys(rec, ['edge'])) return undefined;
  return { edge: pair };
}

function noteTargetFrom(raw: unknown): NoteTarget | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return nodeTarget(rec) ?? edgeTarget(rec);
}

function textField(rec: Record<string, unknown>): string | undefined {
  return typeof rec.text === 'string' && rec.text !== '' ? rec.text : undefined;
}

function noteEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!noExtraKeys(rec, ['kind', 'target', 'text'])) return undefined;
  const target = noteTargetFrom(rec.target);
  const text = textField(rec);
  if (target === undefined || text === undefined) return undefined;
  return { kind: 'note', target, text };
}

function stringOf(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

function createEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const path = stringOf(rec.path);
  if (!noExtraKeys(rec, ['kind', 'path']) || path === undefined) return undefined;
  return pathOk(path) ? { kind: 'create-package', path } : undefined;
}

function renamePairOk(from: string, to: string): boolean {
  return from !== to && parentOf(from) === parentOf(to) && legalName(lastSegment(from)) && legalName(lastSegment(to));
}

function renameEnds(rec: Record<string, unknown>): { from: string; to: string } | undefined {
  if (!noExtraKeys(rec, ['kind', 'from', 'to'])) return undefined;
  return endpointsOf(rec);
}

function renamePackageFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const ends = renameEnds(rec);
  if (ends === undefined || !renamePairOk(ends.from, ends.to)) return undefined;
  return { kind: 'rename-package', from: ends.from, to: ends.to };
}

function renameFileFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const ends = renameEnds(rec);
  if (ends === undefined || !legalName(ends.to)) return undefined;
  return { kind: 'rename-file', from: ends.from, to: ends.to };
}

function stringsFrom(raw: unknown): string[] | undefined {
  return everyRead(listOfAtLeast(raw, 0), stringOf);
}

function nestsAny(packages: string[], pkg: string, index: number): boolean {
  return packages.some((other, at) => at !== index && within(other, pkg));
}

function packagesOk(packages: string[] | undefined): packages is string[] {
  if (packages === undefined || packages.length < 2) return false;
  return !packages.some((pkg, index) => nestsAny(packages, pkg, index));
}

function mergeInto(rec: Record<string, unknown>): string | undefined {
  const into = stringOf(rec.into);
  return into !== undefined && pathOk(into) ? into : undefined;
}

function mergeEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const packages = stringsFrom(rec.packages);
  const into = mergeInto(rec);
  if (!noExtraKeys(rec, ['kind', 'packages', 'into']) || !packagesOk(packages) || into === undefined) return undefined;
  return { kind: 'merge-packages', packages, into };
}

function partFields(rec: Record<string, unknown>): SplitPart | undefined {
  const name = nameField(rec);
  const files = stringsFrom(rec.files);
  if (name === undefined || files === undefined || !legalName(name)) return undefined;
  return { name, files };
}

function partFrom(raw: unknown): SplitPart | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['name', 'files'])) return undefined;
  return partFields(rec);
}

function partsFrom(raw: unknown): SplitPart[] | undefined {
  return everyRead(listOfAtLeast(raw, 2), partFrom);
}

function distinct(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function partsOk(parts: SplitPart[] | undefined): parts is SplitPart[] {
  if (parts === undefined) return false;
  return distinct(parts.map(part => part.name)) && distinct(parts.flatMap(part => part.files));
}

function splitEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const pkg = stringOf(rec.package);
  const parts = partsFrom(rec.parts);
  if (!noExtraKeys(rec, ['kind', 'package', 'parts']) || pkg === undefined) return undefined;
  return partsOk(parts) ? { kind: 'split-package', package: pkg, parts } : undefined;
}

function deleteFateFrom(rec: Record<string, unknown>, file: string): PlanEdit | undefined {
  if (!noExtraKeys(rec, ['kind', 'file', 'fate'])) return undefined;
  return { kind: 'fate', file, fate: 'delete' };
}

function foldFateFrom(rec: Record<string, unknown>, file: string): PlanEdit | undefined {
  const into = stringOf(rec.into);
  if (into === undefined || into === file) return undefined;
  return { kind: 'fate', file, fate: 'fold', into };
}

const FATE_READERS: Record<string, (rec: Record<string, unknown>, file: string) => PlanEdit | undefined> = {
  delete: deleteFateFrom,
  fold: foldFateFrom,
};

function fateEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  const file = stringOf(rec.file);
  if (!noExtraKeys(rec, ['kind', 'file', 'fate', 'into']) || file === undefined) return undefined;
  return FATE_READERS[String(rec.fate)]?.(rec, file);
}

const EDIT_READERS: Record<string, (rec: Record<string, unknown>) => PlanEdit | undefined> = {
  'move-file': moveEditFrom,
  'cut-edge': cutEditFrom,
  'add-edge': addEditFrom,
  note: noteEditFrom,
  'create-package': createEditFrom,
  'rename-package': renamePackageFrom,
  'rename-file': renameFileFrom,
  'merge-packages': mergeEditFrom,
  'split-package': splitEditFrom,
  fate: fateEditFrom,
};

export function parsePlanEdit(raw: unknown): PlanEdit | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || typeof rec.kind !== 'string') return undefined;
  return EDIT_READERS[rec.kind]?.(rec);
}

function editsFrom(raw: unknown): PlanEdit[] | undefined {
  return everyRead(listOfAtLeast(raw, 0), parsePlanEdit);
}

function nameOk(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function createdAtOk(value: unknown): boolean {
  return typeof value === 'string' && CREATED_AT.test(value);
}

function commitOk(value: unknown): boolean {
  return typeof value === 'string' && COMMIT.test(value);
}

function docShapeOk(rec: Record<string, unknown>): boolean {
  return noExtraKeys(rec, PLAN_KEYS) && rec.version === 1 && nameOk(rec.name) && typeof rec.slug === 'string';
}

function docStampsOk(rec: Record<string, unknown>): boolean {
  return createdAtOk(rec.createdAt) && commitOk(rec.baseCommit);
}

function docCore(raw: unknown): Record<string, unknown> | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return docShapeOk(rec) && docStampsOk(rec) ? rec : undefined;
}

function docLists(rec: Record<string, unknown>): { edits: PlanEdit[]; redo: PlanEdit[] } | undefined {
  const edits = editsFrom(rec.edits);
  const redo = editsFrom(rec.redo);
  if (edits === undefined || redo === undefined) return undefined;
  return { edits, redo };
}

function docFrom(rec: Record<string, unknown>, edits: PlanEdit[], redo: PlanEdit[]): PlanDoc {
  return {
    version: 1,
    name: String(rec.name),
    slug: String(rec.slug),
    createdAt: String(rec.createdAt),
    baseCommit: String(rec.baseCommit),
    edits,
    redo,
  };
}

export function parsePlan(raw: unknown): PlanDoc | undefined {
  const rec = docCore(raw);
  if (rec === undefined) return undefined;
  const lists = docLists(rec);
  if (lists === undefined) return undefined;
  return docFrom(rec, lists.edits, lists.redo);
}

export function summarisePlan(doc: PlanDoc): PlanSummary {
  return { name: doc.name, slug: doc.slug, editCount: doc.edits.length, createdAt: doc.createdAt };
}

export function withEdit(doc: PlanDoc, edit: PlanEdit): PlanDoc {
  return { ...doc, edits: [...doc.edits, edit], redo: [] };
}

export function withUndo(doc: PlanDoc): PlanDoc {
  const last = doc.edits.at(-1);
  if (last === undefined) return doc;
  return { ...doc, edits: doc.edits.slice(0, -1), redo: [...doc.redo, last] };
}

export function withRedo(doc: PlanDoc): PlanDoc {
  const last = doc.redo.at(-1);
  if (last === undefined) return doc;
  return { ...doc, edits: [...doc.edits, last], redo: doc.redo.slice(0, -1) };
}

export function withoutEdit(doc: PlanDoc, index: number): PlanDoc {
  return { ...doc, edits: doc.edits.filter((_, i) => i !== index) };
}

export function addEdgeIndex(edits: PlanEdit[], stale: (string | null)[], from: string, to: string): number {
  return edits.findIndex((edit, index) => stale[index] === null && edit.kind === 'add-edge' && edit.from === from && edit.to === to);
}

function cutSentence(from: string, to: string, count: number): string {
  return `${from} must not import ${to} (${count} ${count === 1 ? 'import' : 'imports'})`;
}

function noteSentence(target: NoteTarget, text: string): string {
  if ('node' in target) return `Note on ${target.node}: "${text}"`;
  return `Note on ${target.edge[0]} → ${target.edge[1]}: "${text}"`;
}

function listed(items: string[]): string {
  return [items.slice(0, -1).join(', '), ...items.slice(-1)].join(' and ');
}

function filesCount(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

function partPhrase(pkg: string, part: SplitPart): string {
  return `${splitPartPath(pkg, part.name)} (${filesCount(part.files.length)})`;
}

function splitSentence(edit: SplitEdit): string {
  return `Split ${edit.package} into ${listed(edit.parts.map(part => partPhrase(edit.package, part)))}`;
}

function fateSentence(edit: FateEdit): string {
  if (edit.fate === 'delete') return `Delete ${edit.file}`;
  return `Fold ${edit.file} into ${edit.into}`;
}

type PackageEdit = CreatePackageEdit | RenamePackageEdit | RenameFileEdit | MergeEdit | SplitEdit | FateEdit;

function reshapeSentence(edit: MergeEdit | SplitEdit | FateEdit): string {
  if (edit.kind === 'merge-packages') return `Merge ${listed(edit.packages)} into ${edit.into}`;
  if (edit.kind === 'split-package') return splitSentence(edit);
  return fateSentence(edit);
}

function packageSentence(edit: PackageEdit): string {
  if (edit.kind === 'create-package') return `Create package ${edit.path}`;
  if (edit.kind === 'rename-package' || edit.kind === 'rename-file') return `Rename ${edit.from} to ${edit.to}`;
  return reshapeSentence(edit);
}

function laterSentence(edit: NoteEdit | PackageEdit): string {
  if (edit.kind === 'note') return noteSentence(edit.target, edit.text);
  return packageSentence(edit);
}

export function sentenceOf(edit: PlanEdit): string {
  if (edit.kind === 'move-file') return `Move ${edit.file} to ${edit.to}`;
  if (edit.kind === 'cut-edge') return cutSentence(edit.from, edit.to, edit.files.length);
  if (edit.kind === 'add-edge') return `${edit.from} should use ${edit.to}`;
  return laterSentence(edit);
}
