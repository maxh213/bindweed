import { describe, expect, it } from 'vitest';
import { martinFields, martinIndex } from './domain/coupling.ts';
import type { ScanResult, ScannedFile } from './domain/scan.ts';

describe('Martin coupling', () => {
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

  it('does not count a self-import or a path that only shares a file prefix', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/a.ts', test: false },
        { path: 'src/a.ts/nested.ts', test: false, abstract: true },
        { path: 'src/b.ts', test: false },
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/a.ts', kind: 'runtime' },
        { from: 'src/a.ts', to: 'src/b.ts', kind: 'runtime' },
      ],
      externals: [],
      workspaces: [],
    };
    const index = martinIndex(scan);
    expect(martinFields(index, 'src/a.ts', 'file')).toEqual({ ca: 0, ce: 1, i: '1.00', a: '0.00', d: '0.00' });
  });

  it('ignores an import whose source is not an internal file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/a.ts', test: false },
        { path: 'src/a.test.ts', test: true },
      ],
      edges: [{ from: 'src/a.test.ts', to: 'src/a.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    expect(martinFields(martinIndex(scan), 'src/a.ts', 'file').ca).toBe(0);
  });
});
