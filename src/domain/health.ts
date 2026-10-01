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
  if (stats.kind === 'no-entry') return stats;
  return { kind: 'entry', coverage: stats.coverage, crap: stats.crap, hot: stats.hot, mutants: stats.mutants };
}

type Scored = { inReport: false } | { inReport: true; coverage: string; crap: number | null };

function scoredFields(scored: Scored): HealthFields {
  if (!scored.inReport) return { crap: DASH };
  if (scored.crap === null) return { coverage: scored.coverage };
  return { crap: scored.crap, coverage: scored.coverage };
}

function withMutants(health: Health, mutants: number, fields: HealthFields): HealthFields {
  if (health.mutation === 'off') return fields;
  return { ...fields, mutants };
}

function reportedFields(health: Health, scored: Scored, mutants: number): HealthFields {
  const base = health.coverage === 'off' ? {} : scoredFields(scored);
  return withMutants(health, mutants, base);
}

function fileScore(stats: ScoredFile): Scored {
  if (stats.kind === 'no-entry') return { inReport: false };
  return { inReport: true, coverage: stats.coverage, crap: stats.crap };
}

export function fileFields(health: Health, file: FileLike): HealthFields {
  const stats = scoreFile(health, file);
  return reportedFields(health, fileScore(stats), stats.mutants);
}

type PackageAcc = { covered: number; statements: number; hasEntry: boolean; crap: number | null; mutants: number };

function freshAcc(): PackageAcc {
  return { covered: 0, statements: 0, hasEntry: false, crap: null, mutants: 0 };
}

function addCrap(acc: PackageAcc, crap: number | null): void {
  if (crap === null) return;
  acc.crap = acc.crap === null ? crap : Math.max(acc.crap, crap);
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
  return { hasEntry: acc.hasEntry, coverage: coverageRatio(acc.covered, acc.statements), crap: acc.crap, mutants: acc.mutants };
}

function packageScore(stats: PackageStats): Scored {
  if (!stats.hasEntry) return { inReport: false };
  return { inReport: true, coverage: stats.coverage, crap: stats.crap };
}

export function packageFields(health: Health, files: FileLike[]): HealthFields {
  const stats = packageStats(health, files);
  return reportedFields(health, packageScore(stats), stats.mutants);
}
