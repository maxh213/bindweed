import type { RawFunction } from './scan.ts';

export type ReportFlag = 'on' | 'stale' | 'off';

const DASH = '–';

export type CoverageStatement = { line: number; hits: number };

export type CoverageEntry = { statements: CoverageStatement[] };

export type Health = {
  crapMax: number;
  coverage: ReportFlag;
  mutation: ReportFlag;
  coverageEntries: ReadonlyMap<string, CoverageEntry>;
  mutantCounts: ReadonlyMap<string, number>;
};

export type HealthFields = { crap?: number | '–'; coverage?: string; mutants?: number };

export type HotFunction = { name: string; line: number; cc: number; coverage: string; crap: number };

export type FileLike = { path: string; functions?: RawFunction[] };

type ScoredFile =
  | { kind: 'entry'; entry: CoverageEntry; coverage: string; crap: number | null; hot: HotFunction[]; mutants: number }
  | { kind: 'no-entry'; hot: HotFunction[]; mutants: number };

export type FileStats =
  | { kind: 'entry'; coverage: string; crap: number | null; hot: HotFunction[]; mutants: number }
  | { kind: 'no-entry'; hot: HotFunction[]; mutants: number };

type PackageStats = { hasEntry: boolean; coverage: string; crap: number | null; mutants: number };

export function emptyHealth(crapMax = 4): Health {
  return { crapMax, coverage: 'off', mutation: 'off', coverageEntries: new Map(), mutantCounts: new Map() };
}

function hitCount(statements: CoverageStatement[]): number {
  return statements.filter(statement => statement.hits > 0).length;
}

function coverageRatio(covered: number, total: number): string {
  if (total === 0) return '1.00';
  return (covered / total).toFixed(2);
}

function crapOf(cc: number, coverage: number): number {
  return Number((cc * cc * (1 - coverage) ** 3 + cc).toFixed(2));
}

function statementsInside(entry: CoverageEntry, fn: RawFunction): CoverageStatement[] {
  return entry.statements.filter(statement => statement.line >= fn.line && statement.line <= fn.endLine);
}

function functionCoverage(entry: CoverageEntry, fn: RawFunction): number {
  const inside = statementsInside(entry, fn);
  if (inside.length === 0) return 1;
  return hitCount(inside) / inside.length;
}

function hotOf(entry: CoverageEntry, fn: RawFunction, limit: number): HotFunction | undefined {
  const coverage = functionCoverage(entry, fn);
  const crap = crapOf(fn.cc, coverage);
  if (crap <= limit) return undefined;
  return { name: fn.name, line: fn.line, cc: fn.cc, coverage: coverage.toFixed(2), crap };
}

function hotList(entry: CoverageEntry, functions: RawFunction[], limit: number): HotFunction[] {
  const hot: HotFunction[] = [];
  for (const fn of functions) {
    const item = hotOf(entry, fn, limit);
    if (item !== undefined) hot.push(item);
  }
  return hot;
}

function fileCrap(entry: CoverageEntry, functions: RawFunction[]): number | null {
  const craps = functions.map(fn => crapOf(fn.cc, functionCoverage(entry, fn)));
  if (craps.length === 0) return null;
  return Math.max(...craps);
}

function scoreFile(health: Health, file: FileLike): ScoredFile {
  const mutants = health.mutantCounts.get(file.path) ?? 0;
  const entry = health.coverageEntries.get(file.path);
  if (entry === undefined) return { kind: 'no-entry', hot: [], mutants };
  const functions = file.functions ?? [];
  return {
    kind: 'entry',
    entry,
    coverage: coverageRatio(hitCount(entry.statements), entry.statements.length),
    crap: fileCrap(entry, functions),
    hot: hotList(entry, functions, health.crapMax),
    mutants,
  };
}

export function fileStats(health: Health, file: FileLike): FileStats {
  const stats = scoreFile(health, file);
  if (stats.kind !== 'entry') return stats;
  return { kind: stats.kind, coverage: stats.coverage, crap: stats.crap, hot: stats.hot, mutants: stats.mutants };
}

function presentFields(stats: { coverage: string; crap: number | null }): HealthFields {
  if (stats.crap === null) return { coverage: stats.coverage };
  return { crap: stats.crap, coverage: stats.coverage };
}

function shownFields(health: Health, stats: ScoredFile): HealthFields {
  if (health.coverage === 'off') return {};
  if (stats.kind === 'no-entry') return { crap: DASH };
  return presentFields(stats);
}

function withMutants(health: Health, mutants: number, fields: HealthFields): HealthFields {
  if (health.mutation === 'off') return fields;
  return { ...fields, mutants };
}

export function fileFields(health: Health, file: FileLike): HealthFields {
  const stats = scoreFile(health, file);
  return withMutants(health, stats.mutants, shownFields(health, stats));
}

type PackageAcc = { covered: number; statements: number; hasEntry: boolean; craps: number[]; mutants: number };

function freshAcc(): PackageAcc {
  return { covered: 0, statements: 0, hasEntry: false, craps: [], mutants: 0 };
}

function addCrap(acc: PackageAcc, crap: number | null): void {
  if (crap === null) return;
  acc.craps.push(crap);
}

function worstCrap(craps: number[]): number | null {
  if (craps.length === 0) return null;
  return Math.max(...craps);
}

function addStats(acc: PackageAcc, health: Health, file: FileLike): void {
  const stats = scoreFile(health, file);
  acc.mutants += stats.mutants;
  if (stats.kind === 'no-entry') return;
  acc.hasEntry = true;
  acc.covered += hitCount(stats.entry.statements);
  acc.statements += stats.entry.statements.length;
  addCrap(acc, stats.crap);
}

function packageStats(health: Health, files: FileLike[]): PackageStats {
  const acc = freshAcc();
  for (const file of files) addStats(acc, health, file);
  return { hasEntry: acc.hasEntry, coverage: coverageRatio(acc.covered, acc.statements), crap: worstCrap(acc.craps), mutants: acc.mutants };
}

function packageShown(health: Health, stats: PackageStats): HealthFields {
  if (health.coverage === 'off') return {};
  if (!stats.hasEntry) return { crap: DASH };
  return presentFields(stats);
}

export function packageFields(health: Health, files: FileLike[]): HealthFields {
  const stats = packageStats(health, files);
  return withMutants(health, stats.mutants, packageShown(health, stats));
}
