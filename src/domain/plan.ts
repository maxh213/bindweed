export type NoteTarget = { node: string } | { edge: [string, string] };

export type MoveEdit = { kind: 'move-file'; file: string; to: string };

export type CutEdit = { kind: 'cut-edge'; from: string; to: string; files: [string, string][] };

export type AddEdit = { kind: 'add-edge'; from: string; to: string };

export type NoteEdit = { kind: 'note'; target: NoteTarget; text: string };

export type PlanEdit = MoveEdit | CutEdit | AddEdit | NoteEdit;

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
  const dashed = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

export function moveDest(file: string, to: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return to === '.' ? name : `${to}/${name}`;
}

function recordOf(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw));
}

function exactKeys(rec: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(rec);
  return own.length === keys.length && keys.every(key => key in rec);
}

function slugChecked(name: string): string | undefined {
  return slugOf(name) === '' ? undefined : name;
}

function nameField(rec: Record<string, unknown>): string | undefined {
  return typeof rec.name === 'string' ? rec.name : undefined;
}

export function planNameFrom(raw: unknown): string | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !exactKeys(rec, ['name'])) return undefined;
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

function nonEmptyList(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw;
}

function pairsFrom(raw: unknown): [string, string][] | undefined {
  const list = nonEmptyList(raw);
  if (list === undefined) return undefined;
  const files: [string, string][] = [];
  for (const pair of list) {
    const parsed = stringPair(pair);
    if (parsed === undefined) return undefined;
    files.push(parsed);
  }
  return files;
}

function endpointsOf(rec: Record<string, unknown>): { from: string; to: string } | undefined {
  if (typeof rec.from !== 'string' || typeof rec.to !== 'string') return undefined;
  return { from: rec.from, to: rec.to };
}

function moveEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!exactKeys(rec, ['kind', 'file', 'to'])) return undefined;
  if (typeof rec.file !== 'string' || typeof rec.to !== 'string') return undefined;
  return { kind: 'move-file', file: rec.file, to: rec.to };
}

function cutEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!exactKeys(rec, ['kind', 'from', 'to', 'files'])) return undefined;
  const ends = endpointsOf(rec);
  const files = pairsFrom(rec.files);
  if (ends === undefined || files === undefined) return undefined;
  return { kind: 'cut-edge', from: ends.from, to: ends.to, files };
}

function addEditFrom(rec: Record<string, unknown>): PlanEdit | undefined {
  if (!exactKeys(rec, ['kind', 'from', 'to'])) return undefined;
  const ends = endpointsOf(rec);
  if (ends === undefined || ends.from === ends.to) return undefined;
  return { kind: 'add-edge', from: ends.from, to: ends.to };
}

function nodeTarget(rec: Record<string, unknown>): NoteTarget | undefined {
  if (typeof rec.node !== 'string' || !exactKeys(rec, ['node'])) return undefined;
  return { node: rec.node };
}

function edgeTarget(rec: Record<string, unknown>): NoteTarget | undefined {
  const pair = stringPair(rec.edge);
  if (pair === undefined || !exactKeys(rec, ['edge'])) return undefined;
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
  if (!exactKeys(rec, ['kind', 'target', 'text'])) return undefined;
  const target = noteTargetFrom(rec.target);
  const text = textField(rec);
  if (target === undefined || text === undefined) return undefined;
  return { kind: 'note', target, text };
}

const EDIT_READERS: Record<string, (rec: Record<string, unknown>) => PlanEdit | undefined> = {
  'move-file': moveEditFrom,
  'cut-edge': cutEditFrom,
  'add-edge': addEditFrom,
  note: noteEditFrom,
};

export function parsePlanEdit(raw: unknown): PlanEdit | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || typeof rec.kind !== 'string') return undefined;
  return EDIT_READERS[rec.kind]?.(rec);
}

function editsFrom(raw: unknown): PlanEdit[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const edits: PlanEdit[] = [];
  for (const item of raw) {
    const edit = parsePlanEdit(item);
    if (edit === undefined) return undefined;
    edits.push(edit);
  }
  return edits;
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
  return exactKeys(rec, PLAN_KEYS) && rec.version === 1 && nameOk(rec.name) && typeof rec.slug === 'string';
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

export function sentenceOf(edit: PlanEdit): string {
  if (edit.kind === 'move-file') return `Move ${edit.file} to ${edit.to}`;
  if (edit.kind === 'cut-edge') return cutSentence(edit.from, edit.to, edit.files.length);
  if (edit.kind === 'add-edge') return `${edit.from} should use ${edit.to}`;
  return noteSentence(edit.target, edit.text);
}
