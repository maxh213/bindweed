import type { RawFunction, ScanEdge, ScanResult, ScannedFile } from './scan.ts';

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

export type FileStats =
  | { kind: 'entry'; entry: CoverageEntry; coverage: string; crap: number | null; hot: HotFunction[]; mutants: number }
  | { kind: 'no-entry'; hot: HotFunction[]; mutants: number };

type PackageStats = { hasEntry: boolean; coverage: string; crap: number | null; mutants: number };

type Zone = 'pain' | 'useless' | 'healthy';

export type MartinFields = { ca: number; ce: number; i: string; a: string; d: string; zone?: Zone };

export type MartinIndex = { files: ScannedFile[]; imports: ReadonlyMap<string, ReadonlySet<string>> };

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

export function fileStats(health: Health, file: FileLike): FileStats {
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

function fileScore(stats: FileStats): Scored {
  if (stats.kind === 'no-entry') return { inReport: false };
  return { inReport: true, coverage: stats.coverage, crap: stats.crap };
}

export function fileFields(health: Health, file: FileLike): HealthFields {
  const stats = fileStats(health, file);
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
  const stats = fileStats(health, file);
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

function internalPaths(scan: ScanResult): Set<string> {
  return new Set(scan.files.filter(file => !file.test).map(file => file.path));
}

function internalEdges(scan: ScanResult, internal: ReadonlySet<string>): ScanEdge[] {
  return scan.edges.filter(edge => internal.has(edge.from) && internal.has(edge.to));
}

function importMap(paths: string[], edges: ScanEdge[]): Map<string, Set<string>> {
  const map = new Map(paths.map(path => [path, new Set<string>()]));
  for (const edge of edges) map.get(edge.from)?.add(edge.to);
  return map;
}

export function martinIndex(scan: ScanResult): MartinIndex {
  const internal = internalPaths(scan);
  const files = scan.files.filter(file => !file.test);
  return { files, imports: importMap(files.map(file => file.path), internalEdges(scan, internal)) };
}

function memberOf(id: string, kind: 'package' | 'file', path: string): boolean {
  if (kind === 'file') return path === id;
  return path === id || path.startsWith(`${id}/`);
}

function memberFiles(index: MartinIndex, id: string, kind: 'package' | 'file'): ScannedFile[] {
  return index.files.filter(file => memberOf(id, kind, file.path));
}

function importsOf(index: MartinIndex, path: string): ReadonlySet<string> {
  return index.imports.get(path) ?? new Set<string>();
}

function intersects(imports: ReadonlySet<string>, members: ReadonlySet<string>): boolean {
  for (const target of imports) {
    if (members.has(target)) return true;
  }
  return false;
}

function outside(imports: ReadonlySet<string>, members: ReadonlySet<string>): boolean {
  for (const target of imports) {
    if (!members.has(target)) return true;
  }
  return false;
}

function countAfferent(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const file of index.files) {
    if (members.has(file.path)) continue;
    if (intersects(importsOf(index, file.path), members)) count += 1;
  }
  return count;
}

function countTargets(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const path of members) {
    for (const target of importsOf(index, path)) {
      if (!members.has(target)) count += 1;
    }
  }
  return count;
}

function countImportingFiles(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const path of members) {
    if (outside(importsOf(index, path), members)) count += 1;
  }
  return count;
}

function countEfferent(index: MartinIndex, members: ReadonlySet<string>, kind: 'file' | 'package'): number {
  if (kind === 'file') return countTargets(index, members);
  return countImportingFiles(index, members);
}

function abstractRatio(files: ScannedFile[]): number {
  if (files.length === 0) return 0;
  return files.filter(file => file.abstract === true).length / files.length;
}

type Ratios =
  | { ca: number; ce: number; a: number; i: null }
  | { ca: number; ce: number; a: number; i: number; d: number };

function ratiosOf(index: MartinIndex, id: string, kind: 'package' | 'file'): Ratios {
  const members = memberFiles(index, id, kind);
  const paths = new Set(members.map(file => file.path));
  const ca = countAfferent(index, paths);
  const ce = countEfferent(index, paths, kind);
  const a = abstractRatio(members);
  if (ca + ce === 0) return { ca, ce, a, i: null };
  const i = ce / (ca + ce);
  return { ca, ce, a, i, d: Math.abs(a + i - 1) };
}

function zoneOf(a: number, i: number, d: number): Zone {
  if (d <= 0.5) return 'healthy';
  if (a + i < 1) return 'pain';
  return 'useless';
}

export function martinFields(index: MartinIndex, id: string, kind: 'package' | 'file'): MartinFields {
  const ratios = ratiosOf(index, id, kind);
  if (ratios.i === null) return { ca: ratios.ca, ce: ratios.ce, i: DASH, a: ratios.a.toFixed(2), d: DASH };
  const fields = { ca: ratios.ca, ce: ratios.ce, i: ratios.i.toFixed(2), a: ratios.a.toFixed(2), d: ratios.d.toFixed(2) };
  if (kind === 'file') return fields;
  return { ...fields, zone: zoneOf(ratios.a, ratios.i, ratios.d) };
}
