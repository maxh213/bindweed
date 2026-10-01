const DASH = '–';

const COVERAGE_HINT = 'no coverage data: run marestail gate';

const MUTATION_HINT = 'no mutation report: run marestail gate --tier full';

export type Level = 'green' | 'amber' | 'red';

export type OverlayName = 'none' | 'crap' | 'coverage' | 'mutants';

type Zone = 'pain' | 'useless' | 'healthy';

export type HealthFacts = {
  crap?: number | '–';
  coverage?: string;
  mutants?: number;
  ca?: number;
  ce?: number;
  i?: string;
  a?: string;
  d?: string;
  zone?: Zone;
};

export type ReportFacts = { coverage: string; mutation: string };

export type HotFacts = { name: string; line: number; cc: number; coverage: string; crap: number };

export type MetricBox = { id: string; name: string; kind: string; files?: number } & HealthFacts;

export type SortKey = 'name' | 'files' | 'ca' | 'ce' | 'i' | 'a' | 'd' | 'zone' | 'crap' | 'coverage' | 'mutants';

type Direction = 'ascending' | 'descending';

export type SortState = { key: SortKey; direction: Direction };

type CellValue = number | string | null;

export type MetricsRow = { id: string; name: string; cells: Record<SortKey, string>; values: Record<SortKey, CellValue> };

export type MetricLine = { label: string; value: string };

export const DEFAULT_LIMIT = 4;

export const OVERLAY_OPTIONS: { value: OverlayName; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'crap', label: 'CRAP' },
  { value: 'coverage', label: 'Coverage' },
  { value: 'mutants', label: 'Surviving mutants' },
];

type CrapValue = number | '–' | undefined;

type Measured = HealthFacts & { name: string; files?: number };

function dash(value: string | undefined): string {
  return value ?? DASH;
}

function countText(value: number | undefined): string {
  if (value === undefined) return DASH;
  return String(value);
}

function crapText(value: CrapValue): string {
  if (typeof value !== 'number') return DASH;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function crapLevel(value: CrapValue, limit: number): Level | null {
  if (typeof value !== 'number') return null;
  if (value <= limit) return 'green';
  if (value <= limit * 2) return 'amber';
  return 'red';
}

function coverageLevel(value: string | undefined): Level | null {
  if (value === undefined) return null;
  const ratio = Number(value);
  if (ratio >= 1) return 'green';
  if (ratio >= 0.8) return 'amber';
  return 'red';
}

function mutantsLevel(value: number | undefined): Level | null {
  if (value === undefined) return null;
  if (value === 0) return 'green';
  if (value <= 2) return 'amber';
  return 'red';
}

const BADGE_TEXT: Record<Exclude<OverlayName, 'none'>, (facts: HealthFacts) => string> = {
  crap: facts => crapText(facts.crap),
  coverage: facts => dash(facts.coverage),
  mutants: facts => countText(facts.mutants),
};

const BADGE_LEVEL: Record<Exclude<OverlayName, 'none'>, (facts: HealthFacts, limit: number) => Level | null> = {
  crap: (facts, limit) => crapLevel(facts.crap, limit),
  coverage: facts => coverageLevel(facts.coverage),
  mutants: facts => mutantsLevel(facts.mutants),
};

export function badgeText(overlay: OverlayName, facts: HealthFacts): string | null {
  if (overlay === 'none') return null;
  return BADGE_TEXT[overlay](facts);
}

export function badgeLevel(overlay: OverlayName, facts: HealthFacts, limit: number): Level | null {
  if (overlay === 'none') return null;
  return BADGE_LEVEL[overlay](facts, limit);
}

function reportFor(overlay: OverlayName, flags: ReportFacts): string | null {
  if (overlay === 'none') return null;
  if (overlay === 'mutants') return flags.mutation;
  return flags.coverage;
}

export function staleShown(overlay: OverlayName, flags: ReportFacts): boolean {
  return reportFor(overlay, flags) === 'stale';
}

function coverageOverlay(overlay: OverlayName): boolean {
  return overlay === 'crap' || overlay === 'coverage';
}

function mutationHint(flags: ReportFacts): string | null {
  return flags.mutation === 'off' ? MUTATION_HINT : null;
}

function coverageHint(flags: ReportFacts): string | null {
  return flags.coverage === 'off' ? COVERAGE_HINT : null;
}

export function optionHint(overlay: OverlayName, flags: ReportFacts): string | null {
  if (overlay === 'mutants') return mutationHint(flags);
  if (coverageOverlay(overlay)) return coverageHint(flags);
  return null;
}

function overlayFrom(text: string): OverlayName {
  const found = OVERLAY_OPTIONS.find(option => option.value === text);
  if (found === undefined) return 'none';
  return found.value;
}

export function overlayChoice(value: string, current: OverlayName, flags: ReportFacts): OverlayName {
  const picked = overlayFrom(value);
  if (optionHint(picked, flags) === null) return picked;
  return current;
}

export function detailLines(facts: HealthFacts): MetricLine[] {
  const lines: MetricLine[] = [];
  const measured: Measured = { ...facts, name: '' };
  for (const column of COLUMN_LIST) {
    if (!column.detail) continue;
    lines.push({ label: column.label, value: column.text(measured) });
  }
  return lines;
}

export function hotRow(fn: HotFacts): string {
  return `${fn.name} · line ${fn.line} · cc ${fn.cc} · coverage ${fn.coverage}`;
}

function crapValue(value: CrapValue): CellValue {
  if (typeof value !== 'number') return null;
  return value;
}

function ratioValue(value: string | undefined): CellValue {
  if (value === undefined || value === DASH) return null;
  return Number(value);
}

type Column = {
  key: SortKey;
  label: string;
  detail: boolean;
  text: (box: Measured) => string;
  value: (box: MetricBox) => CellValue;
};

const EVERY_COLUMN: unique symbol = Symbol('every');

const COLUMN_LIST: Column[] = [
  { key: 'name', label: 'Name', detail: false, text: box => box.name, value: box => box.name },
  { key: 'files', label: 'Files', detail: false, text: box => countText(box.files), value: box => box.files ?? null },
  { key: 'ca', label: 'Ca', detail: true, text: box => countText(box.ca), value: box => box.ca ?? null },
  { key: 'ce', label: 'Ce', detail: true, text: box => countText(box.ce), value: box => box.ce ?? null },
  { key: 'i', label: 'I', detail: true, text: box => dash(box.i), value: box => ratioValue(box.i) },
  { key: 'a', label: 'A', detail: true, text: box => dash(box.a), value: box => ratioValue(box.a) },
  { key: 'd', label: 'D', detail: true, text: box => dash(box.d), value: box => ratioValue(box.d) },
  { key: 'zone', label: 'Zone', detail: true, text: box => dash(box.zone), value: box => box.zone ?? null },
  { key: 'crap', label: 'CRAP', detail: true, text: box => crapText(box.crap), value: box => crapValue(box.crap) },
  { key: 'coverage', label: 'Coverage', detail: true, text: box => dash(box.coverage), value: box => ratioValue(box.coverage) },
  { key: 'mutants', label: 'Mutants', detail: true, text: box => countText(box.mutants), value: box => box.mutants ?? null },
];

export const COLUMNS: SortKey[] = COLUMN_LIST.map(column => column.key);

function columnsOf(keys: typeof EVERY_COLUMN | readonly SortKey[]): readonly Column[] {
  if (keys === EVERY_COLUMN) return COLUMN_LIST;
  return COLUMN_LIST.filter(column => keys.includes(column.key));
}

function isFull<T>(record: Partial<Record<SortKey, T>>): record is Record<SortKey, T> {
  return COLUMNS.every(key => record[key] !== undefined);
}

function recordFrom<T>(keys: typeof EVERY_COLUMN, pick: (column: Column) => T): Record<SortKey, T>;
function recordFrom<T>(keys: readonly SortKey[], pick: (column: Column) => T): Record<SortKey, T> | undefined;
function recordFrom<T>(keys: typeof EVERY_COLUMN | readonly SortKey[], pick: (column: Column) => T): Record<SortKey, T> | undefined {
  const record: Partial<Record<SortKey, T>> = {};
  for (const column of columnsOf(keys)) record[column.key] = pick(column);
  if (isFull(record)) return record;
  return undefined;
}

export const COLUMN_LABELS: Record<SortKey, string> = recordFrom(EVERY_COLUMN, column => column.label);

type Pair = { text: string; value: CellValue };

function pairOf(box: MetricBox, keys: readonly SortKey[]): Record<SortKey, Pair> | undefined {
  return recordFrom(keys, column => ({ text: column.text(box), value: column.value(box) }));
}

function project<T>(pair: Record<SortKey, Pair>, pick: (item: Pair) => T): Record<SortKey, T> {
  return recordFrom(EVERY_COLUMN, column => pick(pair[column.key]));
}

function rowFrom(box: MetricBox, keys: readonly SortKey[]): MetricsRow | undefined {
  const pair = pairOf(box, keys);
  if (pair === undefined) return undefined;
  return { id: box.id, name: box.name, cells: project(pair, item => item.text), values: project(pair, item => item.value) };
}

function packageRows(boxes: MetricBox[], keys: readonly SortKey[]): MetricsRow[] | undefined {
  const rows: MetricsRow[] = [];
  for (const box of boxes) {
    if (box.kind !== 'package') continue;
    const row = rowFrom(box, keys);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return rows;
}

export function metricRows(boxes: MetricBox[]): MetricsRow[];
export function metricRows(boxes: MetricBox[], keys: readonly SortKey[]): MetricsRow[] | undefined;
export function metricRows(boxes: MetricBox[], keys?: readonly SortKey[]): MetricsRow[] | undefined {
  if (keys === undefined) return packageRows(boxes, COLUMNS);
  return packageRows(boxes, keys);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function nullRank(value: CellValue): number {
  return value === null ? 1 : 0;
}

function comparePresent(a: number | string, b: number | string): number {
  if (typeof a === 'string' || typeof b === 'string') return compareText(String(a), String(b));
  return a - b;
}

function compareValues(a: CellValue, b: CellValue, direction: Direction): number {
  const rank = nullRank(a) - nullRank(b);
  if (rank !== 0) return rank;
  if (a === null || b === null) return 0;
  return aimed(comparePresent(a, b), direction);
}

function aimed(order: number, direction: Direction): number {
  if (direction === 'descending') return -order;
  return order;
}

function compareRows(a: MetricsRow, b: MetricsRow, sort: SortState): number {
  return compareValues(a.values[sort.key], b.values[sort.key], sort.direction) || compareText(a.name, b.name);
}

export function sortRows(rows: MetricsRow[], sort: SortState): MetricsRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort));
}

export function nextSort(current: SortState, clicked: SortKey): SortState {
  if (current.key !== clicked) return { key: clicked, direction: 'descending' };
  if (current.direction === 'descending') return { key: clicked, direction: 'ascending' };
  return { key: clicked, direction: 'descending' };
}

export function ariaSort(current: SortState, column: SortKey): 'ascending' | 'descending' | 'none' {
  if (current.key !== column) return 'none';
  return current.direction;
}

export const DEFAULT_SORT: SortState = { key: 'd', direction: 'descending' };
