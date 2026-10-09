import { describe, expect, it } from 'vitest';
import type { PlanEdit } from './domain/plan.ts';
import { applyPlan, staleReasons } from './domain/planned.ts';
import type { ScanResult } from './domain/scan.ts';

const LAYERED: ScanResult = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/app/a.test.ts', test: true },
    { path: 'src/app/save.ts', test: false },
    { path: 'src/domain/model.ts', test: false, abstract: true },
    { path: 'src/domain/shape.ts', test: false, abstract: true },
    { path: 'src/infra/db.ts', test: false },
    { path: 'src/infra/repo.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/infra/repo.ts', kind: 'type' },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' },
    { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/app/a.test.ts', to: 'src/app/a.ts', kind: 'runtime' },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' },
    { from: 'src/infra/repo.ts', to: 'src/domain/shape.ts', kind: 'runtime', heritage: 1 },
  ],
  externals: [
    { from: 'src/infra/repo.ts', name: 'node:fs', kind: 'runtime' },
    { from: 'src/infra/repo.ts', name: 'react', kind: 'runtime' },
  ],
  workspaces: [],
};

const MOVE_SAVE: PlanEdit = { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' };
const CUT_APP_DOMAIN: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const ADD_INFRA_APP: PlanEdit = { kind: 'add-edge', from: 'src/infra', to: 'src/app' };
const NOTE_DOMAIN: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' };

function pathsOf(scan: ScanResult): string[] {
  return scan.files.map(file => file.path);
}

describe('applyPlan', () => {
  it('applies the three pinned edits in order', () => {
    const planned = applyPlan(LAYERED, [MOVE_SAVE, CUT_APP_DOMAIN, ADD_INFRA_APP]);
    expect(pathsOf(planned)).toContain('src/infra/save.ts');
    expect(pathsOf(planned)).not.toContain('src/app/save.ts');
    expect(planned.edges.some(edge => edge.from === 'src/app/a.ts' && edge.to === 'src/domain/model.ts')).toBe(false);
    expect(planned.edges.some(edge => edge.from === 'src/app/a.ts' && edge.to === 'src/infra/db.ts')).toBe(true);
    expect(planned.planned).toEqual([{ from: 'src/infra', to: 'src/app' }]);
  });

  it('keeps a moved file’s imports, importers and externals', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }]);
    const edges = planned.edges.filter(edge => edge.from === 'src/infra/b.ts' || edge.to === 'src/infra/b.ts');
    expect(edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual([
      'src/app/a.ts->src/infra/b.ts',
      'src/infra/b.ts->src/app/a.ts',
      'src/infra/b.ts->src/infra/db.ts',
    ]);
    const movedRepo = applyPlan(LAYERED, [{ kind: 'move-file', file: 'src/infra/repo.ts', to: 'src/app' }]);
    expect(movedRepo.externals.map(ext => ext.from)).toEqual(['src/app/repo.ts', 'src/app/repo.ts']);
  });

  it('moves a file to the root as the bare name', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'move-file', file: 'src/app/save.ts', to: '.' }]);
    expect(pathsOf(planned)).toContain('save.ts');
  });

  it('moves onto the file’s own directory change nothing', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'move-file', file: 'src/app/save.ts', to: 'src/app' }]);
    expect(pathsOf(planned)).toEqual(pathsOf(LAYERED));
    expect(planned.edges).toEqual(LAYERED.edges);
  });

  it('cuts only the listed pairs', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/a.ts', 'src/infra/db.ts']] }]);
    expect(planned.edges.some(edge => edge.from === 'src/app/a.ts' && edge.to === 'src/infra/db.ts')).toBe(false);
    expect(planned.edges.some(edge => edge.from === 'src/app/a.ts' && edge.to === 'src/infra/repo.ts')).toBe(true);
    expect(planned.edges.some(edge => edge.from === 'src/app/b.ts' && edge.to === 'src/infra/db.ts')).toBe(true);
  });

  it('skips stale edits and keeps later edits working', () => {
    const planned = applyPlan(LAYERED, [
      { kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' },
      MOVE_SAVE,
    ]);
    expect(pathsOf(planned)).toContain('src/infra/save.ts');
    expect(pathsOf(planned)).toEqual(pathsOf(LAYERED).map(path => (path === 'src/app/save.ts' ? 'src/infra/save.ts' : path)));
  });

  it('leaves the input scan untouched', () => {
    applyPlan(LAYERED, [MOVE_SAVE, CUT_APP_DOMAIN, ADD_INFRA_APP]);
    expect(pathsOf(LAYERED)).toContain('src/app/save.ts');
    expect(LAYERED.planned).toBeUndefined();
  });
});

describe('staleReasons', () => {
  it('is all null for the four pinned edits', () => {
    expect(staleReasons(LAYERED, [MOVE_SAVE, CUT_APP_DOMAIN, ADD_INFRA_APP, NOTE_DOMAIN])).toEqual([null, null, null, null]);
  });

  it('marks a move whose file is gone', () => {
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' }])).toEqual([
      'no such file src/app/missing.ts',
    ]);
  });

  it('marks a move to a directory with no scanned file, even one the tree lists', () => {
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/save.ts', to: 'notes' }])).toEqual(['no such directory notes']);
  });

  it('marks a move whose destination exists', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a/x.ts', test: false },
        { path: 'b/x.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    expect(staleReasons(scan, [{ kind: 'move-file', file: 'a/x.ts', to: 'b' }])).toEqual(['b/x.ts already exists']);
  });

  it('treats a hidden test file as present', () => {
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/infra' }])).toEqual([null]);
  });

  it('does not stale a move onto the file’s own directory', () => {
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/save.ts', to: 'src/app' }])).toEqual([null]);
  });

  it('marks a cut whose boxes are gone, from before to', () => {
    expect(staleReasons(LAYERED, [{ kind: 'cut-edge', from: 'src/gone', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] }])).toEqual(
      ['no such box src/gone'],
    );
    expect(staleReasons(LAYERED, [{ kind: 'cut-edge', from: 'src/app', to: 'src/gone', files: [['src/app/a.ts', 'src/domain/model.ts']] }])).toEqual(
      ['no such box src/gone'],
    );
  });

  it('marks a cut whose listed path is gone, importer first', () => {
    const edit: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/gone.ts', 'src/domain/model.ts']] };
    expect(staleReasons(LAYERED, [edit])).toEqual(['no such file src/app/gone.ts']);
    const other: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/gone.ts']] };
    expect(staleReasons(LAYERED, [other])).toEqual(['no such file src/domain/gone.ts']);
  });

  it('marks a cut whose pair is no longer an edge, after another cut removed it', () => {
    expect(staleReasons(LAYERED, [CUT_APP_DOMAIN, CUT_APP_DOMAIN])).toEqual([null, 'src/app/a.ts no longer imports src/domain/model.ts']);
  });

  it('marks an add whose box is gone or whose edge already exists, file or planned', () => {
    expect(staleReasons(LAYERED, [{ kind: 'add-edge', from: 'src/app', to: 'src/infra' }])).toEqual(['src/app already imports src/infra']);
    expect(staleReasons(LAYERED, [ADD_INFRA_APP, ADD_INFRA_APP])).toEqual([null, 'src/infra already imports src/app']);
    expect(staleReasons(LAYERED, [{ kind: 'add-edge', from: 'src/gone', to: 'src/app' }])).toEqual(['no such box src/gone']);
    expect(staleReasons(LAYERED, [{ kind: 'add-edge', from: 'src/app', to: 'src/gone' }])).toEqual(['no such box src/gone']);
  });

  it('marks a note on a missing node', () => {
    expect(staleReasons(LAYERED, [{ kind: 'note', target: { node: 'src/gone' }, text: 'x' }])).toEqual(['no such box src/gone']);
  });

  it('keeps a note on a moved file’s new path, and stales it without the move', () => {
    const note: PlanEdit = { kind: 'note', target: { node: 'src/infra/save.ts' }, text: 'keep the writer here' };
    expect(staleReasons(LAYERED, [MOVE_SAVE, note])).toEqual([null, null]);
    expect(staleReasons(LAYERED, [note])).toEqual(['no such box src/infra/save.ts']);
  });

  it('marks a note on an arrow that is neither planned nor cut', () => {
    const note: PlanEdit = { kind: 'note', target: { edge: ['src/infra', 'src/app'] }, text: 'x' };
    expect(staleReasons(LAYERED, [note])).toEqual(['no such arrow src/infra → src/app']);
    expect(staleReasons(LAYERED, [ADD_INFRA_APP, note])).toEqual([null, null]);
    expect(staleReasons(LAYERED, [CUT_APP_DOMAIN, { kind: 'note', target: { edge: ['src/app', 'src/domain'] }, text: 'x' }])).toEqual([null, null]);
    expect(
      staleReasons(LAYERED, [{ kind: 'note', target: { edge: ['src/app', 'src/infra'] }, text: 'x' }]),
    ).toEqual([null]);
  });

  it('marks a note on an arrow whose box is gone before the arrow check', () => {
    const note: PlanEdit = { kind: 'note', target: { edge: ['src/gone', 'src/app'] }, text: 'x' };
    expect(staleReasons(LAYERED, [note])).toEqual(['no such box src/gone']);
  });

  it('sees paths as earlier non-stale edits left them', () => {
    const staleMove: PlanEdit = { kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' };
    const noteOnSkipped: PlanEdit = { kind: 'note', target: { node: 'src/infra/missing.ts' }, text: 'x' };
    expect(staleReasons(LAYERED, [staleMove, noteOnSkipped])).toEqual([
      'no such file src/app/missing.ts',
      'no such box src/infra/missing.ts',
    ]);
  });

  it('marks a cut against the moved file’s old path as a missing file', () => {
    const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/b.ts', 'src/infra/db.ts']] };
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }, cut])).toEqual([null, 'no such file src/app/b.ts']);
    const movedCut: PlanEdit = { kind: 'cut-edge', from: 'src/infra', to: 'src/infra', files: [['src/infra/b.ts', 'src/infra/db.ts']] };
    expect(staleReasons(LAYERED, [{ kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }, movedCut])).toEqual([null, null]);
  });
});
