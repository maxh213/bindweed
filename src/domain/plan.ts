export type NoteTarget = { node: string } | { edge: [string, string] };

export type MoveEdit = { kind: 'move-file'; file: string; to: string };

export type CutEdit = { kind: 'cut-edge'; from: string; to: string; files: [string, string][] };

export type AddEdit = { kind: 'add-edge'; from: string; to: string };

type NoteEdit = { kind: 'note'; target: NoteTarget; text: string };

export type CreatePackageEdit = { kind: 'create-package'; path: string };

export type RenamePackageEdit = { kind: 'rename-package'; from: string; to: string };

export type RenameFileEdit = { kind: 'rename-file'; from: string; to: string };

export type MergeEdit = { kind: 'merge-packages'; packages: string[]; into: string };

type SplitPart = { name: string; files: string[] };

export type SplitEdit = { kind: 'split-package'; package: string; parts: SplitPart[] };

export type FateEdit = { kind: 'fate'; file: string; fate: 'delete' } | { kind: 'fate'; file: string; fate: 'fold'; into: string };

export type PlanEdit = MoveEdit | CutEdit | AddEdit | NoteEdit | CreatePackageEdit | RenamePackageEdit | RenameFileEdit | MergeEdit | SplitEdit | FateEdit;

export type ContractRule = {
  name: string;
  severity: 'error';
  comment: string;
  from: Record<string, never> | { path: string };
  to: { path: string } | { circular: true };
};

export type Contract = { rules: ContractRule[] };

export type Question = { id: string; text: string; why: string };

export type Round = { round: number; questions: Question[]; answers: string[] };

export type PlanTask = { file: string; title: string; body: string };

export type PlanDoc = {
  version: 1;
  name: string;
  slug: string;
  createdAt: string;
  baseCommit: string;
  edits: PlanEdit[];
  redo: PlanEdit[];
  contract?: Contract;
  interview?: Round[];
  tasks?: PlanTask[];
  brief?: string;
};

export type PlanSummary = { name: string; slug: string; editCount: number; createdAt: string };

const SLUG_MAX = 40;
export const PLAN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLAN_KEYS = ['version', 'name', 'slug', 'createdAt', 'baseCommit', 'edits', 'redo', 'contract', 'interview', 'tasks', 'brief'];
const TASK_FILE_PATTERN = /^\d{3}-[a-z0-9][a-z0-9-]*\.md$/;
const RULE_KEYS = ['name', 'severity', 'comment', 'from', 'to'];
export const CONTRACT_RULE_PREFIX = 'bindweed:';
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

export function mergeDest(edit: MergeEdit, path: string): string {
  const home = edit.packages.find(pkg => within(pkg, path));
  if (home === undefined || home === edit.into) return path;
  return `${edit.into}${path.slice(home.length)}`;
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

function pathEnd(rec: Record<string, unknown>): { path: string } | undefined {
  if (typeof rec.path !== 'string' || !noExtraKeys(rec, ['path'])) return undefined;
  return { path: rec.path };
}

function fromEnd(raw: unknown): ContractRule['from'] | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return Object.keys(rec).length === 0 ? {} : pathEnd(rec);
}

function toEnd(raw: unknown): ContractRule['to'] | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return rec.circular === true && noExtraKeys(rec, ['circular']) ? { circular: true } : pathEnd(rec);
}

function ruleWords(rec: Record<string, unknown>): { name: string; comment: string } | undefined {
  const name = stringOf(rec.name);
  const comment = stringOf(rec.comment);
  if (!name?.startsWith(CONTRACT_RULE_PREFIX) || !comment) return undefined;
  return { name, comment };
}

function ruleShapeOk(rec: Record<string, unknown>): boolean {
  return noExtraKeys(rec, RULE_KEYS) && rec.severity === 'error';
}

function ruleFields(rec: Record<string, unknown>): ContractRule | undefined {
  const words = ruleWords(rec);
  const from = fromEnd(rec.from);
  const to = toEnd(rec.to);
  if (words === undefined || from === undefined || to === undefined) return undefined;
  return { name: words.name, severity: 'error', comment: words.comment, from, to };
}

function ruleFrom(raw: unknown): ContractRule | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !ruleShapeOk(rec)) return undefined;
  return ruleFields(rec);
}

export function parseContract(raw: unknown): Contract | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['rules'])) return undefined;
  const rules = everyRead(listOfAtLeast(rec.rules, 0), ruleFrom);
  return rules === undefined ? undefined : { rules };
}

export function contractNamesFrom(raw: unknown): string[] | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['names'])) return undefined;
  return stringsFrom(rec.names);
}

function questionFields(rec: Record<string, unknown>): Question | undefined {
  const [id, text, why] = [stringOf(rec.id), stringOf(rec.text), stringOf(rec.why)];
  if (id === undefined || text === undefined || why === undefined) return undefined;
  return { id, text, why };
}

function questionFrom(raw: unknown): Question | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['id', 'text', 'why'])) return undefined;
  return questionFields(rec);
}

function roundNumber(raw: unknown): number | undefined {
  return Number.isInteger(raw) && Number(raw) >= 1 ? Number(raw) : undefined;
}

function roundFields(rec: Record<string, unknown>): Round | undefined {
  const round = roundNumber(rec.round);
  const questions = everyRead(listOfAtLeast(rec.questions, 0), questionFrom);
  const answers = stringsFrom(rec.answers);
  if (round === undefined || questions === undefined || answers === undefined) return undefined;
  return { round, questions, answers };
}

function roundFrom(raw: unknown): Round | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['round', 'questions', 'answers'])) return undefined;
  return roundFields(rec);
}

function taskFile(raw: unknown): string | undefined {
  return typeof raw === 'string' && TASK_FILE_PATTERN.test(raw) ? raw : undefined;
}

function taskFields(rec: Record<string, unknown>): PlanTask | undefined {
  const [file, title, body] = [taskFile(rec.file), stringOf(rec.title), stringOf(rec.body)];
  if (file === undefined || title === undefined || body === undefined) return undefined;
  return { file, title, body };
}

function taskFrom(raw: unknown): PlanTask | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['file', 'title', 'body'])) return undefined;
  return taskFields(rec);
}

type DocExtras = Pick<PlanDoc, 'contract' | 'interview' | 'tasks' | 'brief'>;

const EXTRA_READERS: [keyof DocExtras, (raw: unknown) => DocExtras[keyof DocExtras] | undefined][] = [
  ['contract', parseContract],
  ['interview', raw => everyRead(listOfAtLeast(raw, 0), roundFrom)],
  ['tasks', raw => everyRead(listOfAtLeast(raw, 0), taskFrom)],
  ['brief', stringOf],
];

function docExtras(rec: Record<string, unknown>): DocExtras | undefined {
  const extras: Record<string, unknown> = {};
  for (const [key, read] of EXTRA_READERS) {
    if (rec[key] === undefined) continue;
    extras[key] = read(rec[key]);
    if (extras[key] === undefined) return undefined;
  }
  return extras;
}

export function parsePlan(raw: unknown): PlanDoc | undefined {
  const rec = docCore(raw);
  if (rec === undefined) return undefined;
  const lists = docLists(rec);
  const extra = docExtras(rec);
  if (lists === undefined || extra === undefined) return undefined;
  return { ...docFrom(rec, lists.edits, lists.redo), ...extra };
}

export function pendingRound(interview: Round[]): Round | undefined {
  const last = interview.at(-1);
  return last !== undefined && last.answers.length === 0 && last.questions.length > 0 ? last : undefined;
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

function packageRename(path: string, edit: RenamePackageEdit): string {
  return within(edit.from, path) ? `${edit.to}${path.slice(edit.from.length)}` : path;
}

function fileRename(path: string, edit: RenameFileEdit): string {
  return path === edit.from ? renamedFile(edit.from, edit.to) : path;
}

function renamedTo(path: string, edit: PlanEdit): string | undefined {
  if (edit.kind === 'rename-package') return packageRename(path, edit);
  if (edit.kind === 'rename-file') return fileRename(path, edit);
  return undefined;
}

function splitFileDest(edit: SplitEdit, path: string): string | undefined {
  const part = edit.parts.find(item => item.files.includes(path));
  if (part === undefined) return undefined;
  return `${splitPartPath(edit.package, part.name)}${path.slice(edit.package.length)}`;
}

function repackedTo(path: string, edit: PlanEdit): string | undefined {
  if (edit.kind === 'merge-packages') return mergeDest(edit, path);
  if (edit.kind === 'split-package') return splitFileDest(edit, path) ?? path;
  return undefined;
}

function folded(path: string, edit: PlanEdit): string {
  if (edit.kind !== 'fate' || edit.fate !== 'fold') return path;
  return path === edit.file ? edit.into : path;
}

function movedBy(path: string, edit: PlanEdit): string {
  const named = renamedTo(path, edit);
  if (named !== undefined) return named;
  return repackedTo(path, edit) ?? folded(path, edit);
}

type Mover = (path: string, edit: PlanEdit) => string;

function carriedBy(path: string, edit: PlanEdit): string {
  if (edit.kind !== 'move-file' || path !== edit.file) return movedBy(path, edit);
  return moveDest(edit.file, edit.to);
}

function stepLater(path: string, edit: PlanEdit, reason: string | null | undefined, move: Mover): string {
  if (reason !== null) return path;
  return move(path, edit);
}

function applyLater(path: string, edits: PlanEdit[], stale: (string | null)[], from: number, move: Mover): string {
  return edits.slice(from + 1).reduce((current, edit, offset) => stepLater(current, edit, stale[from + 1 + offset], move), path);
}

export function cutEndLater(path: string, edits: PlanEdit[], stale: (string | null)[], from: number): string {
  return applyLater(path, edits, stale, from, carriedBy);
}

function firstSegment(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

function childUnder(path: string, at: string): string {
  const prefix = `${at}/`;
  if (!path.startsWith(prefix)) return path;
  const rel = path.slice(prefix.length);
  const slash = rel.indexOf('/');
  return slash === -1 ? path : `${at}/${rel.slice(0, slash)}`;
}

function groupedStart(path: string, at: string): string {
  if (at === '') return firstSegment(path);
  return childUnder(path, at);
}

function boxInView(path: string, at: string, ids: ReadonlySet<string>): string | null {
  let id = groupedStart(path, at);
  while (!ids.has(id)) {
    const next = childUnder(path, id);
    if (next === id) return null;
    id = next;
  }
  return id;
}

function drawnPair(edit: AddEdit, edits: PlanEdit[], stale: (string | null)[], index: number, at: string, ids: ReadonlySet<string>): [string, string] | null {
  const from = boxInView(applyLater(edit.from, edits, stale, index, movedBy), at, ids);
  const to = boxInView(applyLater(edit.to, edits, stale, index, movedBy), at, ids);
  if (from === null || to === null) return null;
  return [from, to];
}

function liveAdd(edit: PlanEdit, stale: (string | null)[], index: number): edit is AddEdit {
  return stale[index] === null && edit.kind === 'add-edge';
}

function sameArrow(drawn: [string, string] | null, from: string, to: string): boolean {
  return drawn !== null && drawn[0] === from && drawn[1] === to;
}

type DrawnAsk = {
  edits: PlanEdit[];
  stale: (string | null)[];
  from: string;
  to: string;
  at: string;
  ids: ReadonlySet<string>;
};

function drawsArrow(edit: PlanEdit, index: number, ask: DrawnAsk): boolean {
  if (!liveAdd(edit, ask.stale, index)) return false;
  return sameArrow(drawnPair(edit, ask.edits, ask.stale, index, ask.at, ask.ids), ask.from, ask.to);
}

export function addEdgeIndex(edits: PlanEdit[], stale: (string | null)[], from: string, to: string, at: string, ids: ReadonlySet<string>): number {
  const ask: DrawnAsk = { edits, stale, from, to, at, ids };
  return edits.findIndex((edit, index) => drawsArrow(edit, index, ask));
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
