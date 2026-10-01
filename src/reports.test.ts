import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHealth } from './reports.ts';

describe('readHealth', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bw-reports-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(file: string, content: string): string {
    const full = join(root, file);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return full;
  }

  function setMtime(full: string, stampSec: number): void {
    utimesSync(full, stampSec, stampSec);
  }

  it('reads reports with fresh and stale mtimes and parses coverage and mutants', () => {
    const srcA = write('src/a.ts', 'export const a = 1;\n');
    const srcB = write('src/b.ts', 'export const b = 2;\n');
    setMtime(srcA, 1000);
    setMtime(srcB, 1200);

    write('marestail.toml', '[ts]\ncrap_max = 6\n');

    const covJson = JSON.stringify({
      './src/a.ts': {
        statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
        s: { 0: 1, 1: 0 },
      },
      [join(root, 'src/b.ts')]: {
        statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
        s: { 0: 1 },
      },
      '/tmp/outside/c.ts': {
        statementMap: { 0: { start: { line: 1 } } },
        s: { 0: 1 },
      },
    });
    const covFile = write('.marestail/ts-coverage/coverage-final.json', covJson);

    const mutJson = JSON.stringify({
      files: {
        'src/a.ts': {
          mutants: [
            { status: 'Survived' },
            { status: 'NoCoverage' },
            { status: 'Killed' },
            { status: 'Timeout' },
          ],
        },
        [join(root, 'src/b.ts')]: {
          mutants: [{ status: 'Survived' }],
        },
        '/tmp/outside/c.ts': {
          mutants: [{ status: 'Survived' }],
        },
      },
    });
    const mutFile = write('reports/mutation/mutation.json', mutJson);

    setMtime(covFile, 1100);
    setMtime(mutFile, 1300);

    const health = readHealth(root, ['src/a.ts', 'src/b.ts']);
    expect(health.crapMax).toBe(6);
    expect(health.coverage).toBe('stale');
    expect(health.mutation).toBe('on');
    expect(health.coverageEntries.get('src/a.ts')?.statements).toHaveLength(2);
    expect(health.coverageEntries.get('src/b.ts')?.statements).toHaveLength(2);
    expect(health.coverageEntries.get('src/b.ts')?.statements[1].hits).toBe(0);
    expect(health.coverageEntries.has('outside/c.ts')).toBe(false);
    expect([...health.coverageEntries.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...health.mutantCounts.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect(health.mutantCounts.get('src/a.ts')).toBe(2);
    expect(health.mutantCounts.get('src/b.ts')).toBe(1);
  });

  it('keeps a dotted relative key and reads a two-digit decimal limit', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('marestail.toml', 'crap_max=12.25\n');
    write('.marestail/ts-coverage/coverage-final.json', JSON.stringify({
      'src/./a.ts': { statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 } },
      './src/a.ts': { statementMap: { 0: { start: { line: 2 } } }, s: { 0: 0 } },
    }));
    const health = readHealth(root, ['src/a.ts']);
    expect(health.crapMax).toBe(12.25);
    expect(health.coverageEntries.has('src/./a.ts')).toBe(true);
    expect(health.coverageEntries.get('src/a.ts')?.statements[0].line).toBe(2);
  });

  it('stays stale when a missing path follows a newer source and the later source is older', () => {
    const older = write('src/a.ts', 'export const a = 1;\n');
    const newer = write('src/b.ts', 'export const b = 2;\n');
    setMtime(older, 1000);
    setMtime(newer, 3000);
    const cov = write('.marestail/ts-coverage/coverage-final.json', JSON.stringify({}));
    const mut = write('reports/mutation/mutation.json', JSON.stringify({ files: {} }));
    setMtime(cov, 2000);
    setMtime(mut, 2000);
    const health = readHealth(root, ['src/b.ts', 'src/a.ts', 'gone.ts']);
    expect(health.coverage).toBe('stale');
    expect(health.mutation).toBe('stale');
    expect(health.crapMax).toBe(4);
  });

  it('handles missing or corrupt reports and missing crap max in config', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('marestail.toml', '[ts]\nfoo = "bar"\n');

    write('.marestail/ts-coverage/coverage-final.json', 'not json');
    write('reports/mutation/mutation.json', JSON.stringify({ bad: true }));

    const health = readHealth(root, ['src/a.ts']);
    expect(health.crapMax).toBe(4);
    expect(health.coverage).toBe('off');
    expect(health.mutation).toBe('off');
  });

  it('handles equal mtimes and missing source paths', () => {
    const srcA = write('src/a.ts', 'export const a = 1;\n');
    setMtime(srcA, 2000);

    const covFile = write('.marestail/ts-coverage/coverage-final.json', JSON.stringify({}));
    const mutFile = write('reports/mutation/mutation.json', JSON.stringify({ files: {} }));
    setMtime(covFile, 2000);
    setMtime(mutFile, 2000);

    const health = readHealth(root, ['src/a.ts', 'nonexistent.ts']);
    expect(health.coverage).toBe('on');
    expect(health.mutation).toBe('on');

    const emptyPathsHealth = readHealth(root, []);
    expect(emptyPathsHealth.coverage).toBe('on');
    expect(emptyPathsHealth.mutation).toBe('on');
  });
});
