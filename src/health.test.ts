import { describe, expect, it } from 'vitest';
import {
  emptyHealth,
  fileFields,
  fileStats,
  martinFields,
  martinIndex,
  packageFields,
  type CoverageEntry,
  type FileLike,
  type FileStats,
  type Health,
} from './domain/health.ts';
import type { ScanResult, ScannedFile } from './domain/scan.ts';

function sampleEntry(lines: { line: number; hits: number }[]): CoverageEntry {
  return { statements: lines };
}

type SampleFlags = { coverage?: 'on' | 'stale' | 'off'; mutation?: 'on' | 'stale' | 'off'; crapMax?: number };

const DEFAULT_FLAGS: Required<SampleFlags> = {
  crapMax: 4,
  coverage: 'on',
  mutation: 'on',
};

function sampleHealth(entries: Record<string, CoverageEntry>, mutants: Record<string, number>, flags?: SampleFlags): Health {
  return {
    ...DEFAULT_FLAGS,
    ...flags,
    coverageEntries: new Map(Object.entries(entries)),
    mutantCounts: new Map(Object.entries(mutants)),
  };
}

function asEntry(stats: FileStats) {
  if (stats.kind !== 'entry') throw new Error('expected entry');
  return stats;
}

describe('health domain calculations', () => {
  it('builds empty health with default and custom crap limits', () => {
    expect(emptyHealth()).toEqual({
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
      coverageEntries: new Map(),
      mutantCounts: new Map(),
    });
    expect(emptyHealth(6).crapMax).toBe(6);
  });

  it('computes file stats and fields for files with no coverage entry', () => {
    const health = sampleHealth({}, { 'src/plain.ts': 3 });
    const file: FileLike = { path: 'src/plain.ts', functions: [] };
    const stats = fileStats(health, file);
    expect(stats).toEqual({ kind: 'no-entry', hot: [], mutants: 3 });
    expect(fileFields(health, file)).toEqual({ crap: '–', mutants: 3 });

    const offHealth = sampleHealth({}, { 'src/plain.ts': 3 }, { coverage: 'off', mutation: 'off' });
    expect(fileFields(offHealth, file)).toEqual({});

    const unrecorded: FileLike = { path: 'src/unrecorded.ts' };
    expect(fileStats(health, unrecorded).mutants).toBe(0);
  });

  it('computes file stats and hot functions for covered and uncovered code', () => {
    const entry = sampleEntry([
      { line: 2, hits: 1 },
      { line: 3, hits: 0 },
      { line: 4, hits: 1 },
      { line: 5, hits: 0 },
    ]);
    const file: FileLike = {
      path: 'src/amber.ts',
      functions: [
        { name: 'mid', line: 1, endLine: 6, cc: 4 },
        { name: 'spare', line: 7, endLine: 8, cc: 1 },
      ],
    };
    const health = sampleHealth({ 'src/amber.ts': entry }, {});
    const stats = fileStats(health, file);
    expect(stats.kind).toBe('entry');
    expect(asEntry(stats).coverage).toBe('0.50');
    expect(asEntry(stats).crap).toBe(6);
    expect(stats.hot).toEqual([{ name: 'mid', line: 1, cc: 4, coverage: '0.50', crap: 6 }]);
    expect(fileFields(health, file)).toEqual({ crap: 6, coverage: '0.50', mutants: 0 });

    const noFnFile: FileLike = { path: 'src/amber.ts', functions: [] };
    expect(asEntry(fileStats(health, noFnFile)).crap).toBeNull();
    expect(fileFields(health, noFnFile)).toEqual({ coverage: '0.50', mutants: 0 });

    const undefinedFnsFile: FileLike = { path: 'src/amber.ts' };
    expect(asEntry(fileStats(health, undefinedFnsFile)).crap).toBeNull();

    const emptyEntry = sampleEntry([]);
    const emptyHealthFixture = sampleHealth({ 'src/amber.ts': emptyEntry }, {});
    expect(asEntry(fileStats(emptyHealthFixture, file)).coverage).toBe('1.00');
  });

  it('computes package fields summing statements, maxing CRAP and summing mutants', () => {
    const entryA = sampleEntry([
      { line: 2, hits: 1 },
      { line: 3, hits: 1 },
    ]);
    const entryB = sampleEntry([
      { line: 2, hits: 0 },
      { line: 3, hits: 0 },
    ]);
    const files: FileLike[] = [
      { path: 'src/a.ts', functions: [{ name: 'fa', line: 1, endLine: 4, cc: 2 }] },
      { path: 'src/b.ts', functions: [{ name: 'fb', line: 1, endLine: 4, cc: 6 }] },
      { path: 'src/c.ts' },
    ];
    const health = sampleHealth(
      { 'src/a.ts': entryA, 'src/b.ts': entryB },
      { 'src/a.ts': 1, 'src/b.ts': 2, 'src/c.ts': 1 },
    );
    expect(packageFields(health, files)).toEqual({
      crap: 42,
      coverage: '0.50',
      mutants: 4,
    });

    const offHealth = sampleHealth({}, {}, { coverage: 'off', mutation: 'off' });
    expect(packageFields(offHealth, files)).toEqual({});

    const emptyEntriesHealth = sampleHealth({}, { 'src/c.ts': 1 });
    expect(packageFields(emptyEntriesHealth, [{ path: 'src/c.ts' }])).toEqual({
      crap: '–',
      mutants: 1,
    });

    const noFnHealth = sampleHealth({ 'src/a.ts': entryA }, {});
    expect(packageFields(noFnHealth, [{ path: 'src/a.ts', functions: [] }])).toEqual({
      coverage: '1.00',
      mutants: 0,
    });
  });

  it('calculates Martin numbers and zones for packages and files', () => {
    const files: ScannedFile[] = [
      { path: 'src/app/a.ts', test: false },
      { path: 'src/app/b.ts', test: false },
      { path: 'src/domain/model.ts', test: false, abstract: true },
      { path: 'src/domain/shape.ts', test: false, abstract: true },
      { path: 'src/infra/db.ts', test: false },
      { path: 'src/infra/repo.ts', test: false },
      { path: 'src/app/a.test.ts', test: true },
    ];
    const scan: ScanResult = {
      files,
      edges: [
        { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' },
        { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' },
        { from: 'src/app/a.ts', to: 'src/infra/repo.ts', kind: 'type' },
        { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' },
        { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' },
        { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' },
        { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' },
        { from: 'src/infra/repo.ts', to: 'src/domain/shape.ts', kind: 'runtime', heritage: 1 },
      ],
      externals: [],
      workspaces: [],
    };
    const index = martinIndex(scan);

    expect(martinFields(index, 'src/domain', 'package')).toEqual({
      ca: 3,
      ce: 0,
      i: '0.00',
      a: '1.00',
      d: '0.00',
      zone: 'healthy',
    });
    expect(martinFields(index, 'src/app', 'package')).toEqual({
      ca: 0,
      ce: 2,
      i: '1.00',
      a: '0.00',
      d: '0.00',
      zone: 'healthy',
    });
    expect(martinFields(index, 'src/infra', 'package')).toEqual({
      ca: 2,
      ce: 2,
      i: '0.50',
      a: '0.00',
      d: '0.50',
      zone: 'healthy',
    });
    expect(martinFields(index, 'src', 'package')).toEqual({
      ca: 0,
      ce: 0,
      i: '–',
      a: '0.33',
      d: '–',
    });
    expect(martinFields(index, 'src/app/a.ts', 'file')).toEqual({
      ca: 1,
      ce: 4,
      i: '0.80',
      a: '0.00',
      d: '0.20',
    });
  });

  it('determines pain and useless zones', () => {
    const scan: ScanResult = {
      files: [
        { path: 'pain/a.ts', test: false },
        { path: 'use/u.ts', test: false, abstract: true },
        { path: 'target/t.ts', test: false },
      ],
      edges: [
        { from: 'target/t.ts', to: 'pain/a.ts', kind: 'runtime' },
        { from: 'use/u.ts', to: 'target/t.ts', kind: 'runtime' },
      ],
      externals: [],
      workspaces: [],
    };
    const index = martinIndex(scan);

    expect(martinFields(index, 'pain', 'package').zone).toBe('pain');
    expect(martinFields(index, 'use', 'package').zone).toBe('useless');
    expect(martinFields(index, 'empty', 'package')).toEqual({
      ca: 0,
      ce: 0,
      i: '–',
      a: '0.00',
      d: '–',
    });

    const indexWithMissing = {
      files: [{ path: 'orphan.ts', test: false }],
      imports: new Map<string, ReadonlySet<string>>(),
    };
    expect(martinFields(indexWithMissing, 'orphan.ts', 'file')).toEqual({
      ca: 0,
      ce: 0,
      i: '–',
      a: '0.00',
      d: '–',
    });
  });
});
