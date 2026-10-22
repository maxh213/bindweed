import { describe, expect, it } from 'vitest';
import { convergeVerdict } from './domain/converge.ts';
import type { PlanEdit } from './domain/plan.ts';
import type { ImportLine, ScanResult } from './domain/scan.ts';

function scanOf(paths: string[], edges: [string, string][] = []): ScanResult {
  return { files: paths.map(path => ({ path, test: false })), edges: edges.map(([from, to]) => ({ from, to, kind: 'runtime' })), externals: [], workspaces: [] };
}

function line(from: string, to: string, at: number, resolved = true): ImportLine {
  return { from, to, line: at, resolved };
}

describe('convergeVerdict', () => {
  it('sorts the remaining imports by file, then by line, and lists each line once', () => {
    const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app/a.ts', to: 'src/infra/db.ts', files: [['src/app/a.ts', 'src/infra/db.ts']] };
    const browsed = scanOf(['src/app/a.ts', 'src/infra/db.ts'], [['src/app/a.ts', 'src/infra/db.ts']]);
    const worktree = { scan: browsed, imports: [line('src/app/a.ts', 'src/infra/db.ts', 9), line('src/app/a.ts', 'src/infra/db.ts', 3), line('src/app/a.ts', 'src/infra/db.ts', 3, false)] };
    const verdict = convergeVerdict({ edits: [cut] }, { scan: browsed, stale: [null] }, worktree);
    expect(verdict.edits[0].remain).toEqual(['src/app/a.ts:3', 'src/app/a.ts:9']);
    expect(verdict.header).toBe('0 of 1 edits done · 0 of 0 rules hold');
  });

  it('counts a self import as circular and a dangling import as no cycle', () => {
    const browsed = scanOf(['src/a.ts', 'src/b.ts']);
    const worktree = { scan: browsed, imports: [line('src/a.ts', 'src/a.ts', 1), line('src/a.ts', 'src/b.ts', 2), line('src/b.ts', 'src/a.ts', 1, false)] };
    const rule = { name: 'bindweed:no-circular', severity: 'error' as const, comment: 'No circular dependencies', from: {}, to: { circular: true as const } };
    const verdict = convergeVerdict({ edits: [], contract: { rules: [rule] } }, { scan: browsed, stale: [] }, worktree);
    expect(verdict.rules).toEqual([{ name: rule.name, comment: rule.comment, holds: false, breaks: ['src/a.ts:1'] }]);
  });
});
