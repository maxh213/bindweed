import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { z } from 'zod';
import type { CoverageEntry, CoverageStatement, Health, ReportFlag } from './domain/health.ts';

const locationSchema = z.object({ start: z.object({ line: z.number() }) });

const coverageFileSchema = z.object({
  statementMap: z.record(z.string(), locationSchema),
  s: z.record(z.string(), z.number()),
});

const coverageSchema = z.record(z.string(), coverageFileSchema);

const mutationSchema = z.object({
  files: z.record(z.string(), z.object({ mutants: z.array(z.object({ status: z.string() })) })),
});

type CoverageFile = z.infer<typeof coverageFileSchema>;

type MutationReport = z.infer<typeof mutationSchema>;

const SURVIVING = new Set(['Survived', 'NoCoverage']);

const COVERAGE_FILE = ['.marestail', 'ts-coverage', 'coverage-final.json'];

const MUTATION_FILE = ['reports', 'mutation', 'mutation.json'];

const CRAP_MAX_KEY = /crap_max\s*=\s*(\d+(?:\.\d+)?)/;

const DEFAULT_CRAP_MAX = 4;

function slashed(path: string): string {
  return normalize(path).split(sep).join('/');
}

function relativeKey(root: string, key: string): string | undefined {
  if (!isAbsolute(key)) return key.replace(/^\.\//, '');
  const full = slashed(key);
  const base = `${slashed(root)}/`;
  if (!full.startsWith(base)) return undefined;
  return full.slice(base.length);
}

function statementsOf(file: CoverageFile): CoverageStatement[] {
  return Object.keys(file.statementMap).map(id => ({ line: file.statementMap[id].start.line, hits: file.s[id] ?? 0 }));
}

function indexReport<T, V>(root: string, rows: Record<string, T> | undefined, valueOf: (row: T) => V): Map<string, V> {
  const indexed = new Map<string, V>();
  if (rows === undefined) return indexed;
  for (const [key, row] of Object.entries(rows)) {
    const path = relativeKey(root, key);
    if (path !== undefined) indexed.set(path, valueOf(row));
  }
  return indexed;
}

function coverageEntries(root: string, data: Record<string, CoverageFile> | undefined): Map<string, CoverageEntry> {
  return indexReport(root, data, file => ({ statements: statementsOf(file) }));
}

function survivorsOf(file: { mutants: { status: string }[] }): number {
  return file.mutants.filter(mutant => SURVIVING.has(mutant.status)).length;
}

function mutantCounts(root: string, data: MutationReport | undefined): Map<string, number> {
  return indexReport(root, data?.files, survivorsOf);
}

function mtimeOf(full: string): number | undefined {
  try {
    return statSync(full).mtimeMs;
  } catch {
    return undefined;
  }
}

function later(current: number | undefined, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  return Math.max(current, candidate);
}

function newestMtime(root: string, paths: string[]): number | undefined {
  let newest: number | undefined;
  for (const path of paths) newest = later(newest, mtimeOf(join(root, path)));
  return newest;
}

function reportFlag(full: string, newest: number | undefined): ReportFlag {
  if (newest !== undefined && statSync(full).mtimeMs < newest) return 'stale';
  return 'on';
}

function parseReport<T>(full: string, schema: z.ZodType<T>): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(full, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readReport<T>(full: string, newest: number | undefined, schema: z.ZodType<T>): { flag: ReportFlag; data: T | undefined } {
  const data = parseReport(full, schema);
  if (data === undefined) return { flag: 'off', data: undefined };
  return { flag: reportFlag(full, newest), data };
}

function readText(full: string): string | undefined {
  try {
    return readFileSync(full, 'utf8');
  } catch {
    return undefined;
  }
}

function crapMaxIn(text: string): number {
  const match = CRAP_MAX_KEY.exec(text);
  if (match === null) return DEFAULT_CRAP_MAX;
  return Number(match[1]);
}

function readCrapMax(root: string): number {
  const text = readText(join(root, 'marestail.toml'));
  if (text === undefined) return DEFAULT_CRAP_MAX;
  return crapMaxIn(text);
}

export function readHealth(root: string, paths: string[]): Health {
  const newest = newestMtime(root, paths);
  const coverage = readReport(join(root, ...COVERAGE_FILE), newest, coverageSchema);
  const mutation = readReport(join(root, ...MUTATION_FILE), newest, mutationSchema);
  return {
    crapMax: readCrapMax(root),
    coverage: coverage.flag,
    mutation: mutation.flag,
    coverageEntries: coverageEntries(root, coverage.data),
    mutantCounts: mutantCounts(root, mutation.data),
  };
}
