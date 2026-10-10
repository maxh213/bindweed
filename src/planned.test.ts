import { describe, expect, it } from 'vitest';
import { cycleTexts, graphView } from './domain/graph.ts';
import type { PlanEdit } from './domain/plan.ts';
import { applyPlan, planReport, staleReasons } from './domain/planned.ts';
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

  it('leaves planned edges on the paths they were drawn with when a file moves', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'add-edge', from: 'src/domain/model.ts', to: 'src/infra/repo.ts' }, { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' }]);
    expect(pathsOf(planned)).toContain('src/app/model.ts');
    expect(planned.planned).toEqual([{ from: 'src/domain/model.ts', to: 'src/infra/repo.ts' }]);
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

  it('joins a planned edge only when both ends match', () => {
    const joinTo: ScanResult = { ...LAYERED, planned: [{ from: 'src/infra', to: 'src/app' }] };
    expect(staleReasons(joinTo, [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }])).toEqual([null]);
    const joinFrom: ScanResult = { ...LAYERED, planned: [{ from: 'src/domain', to: 'src/infra' }] };
    expect(staleReasons(joinFrom, [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }])).toEqual([null]);
    const empty: ScanResult = { ...LAYERED, planned: [] };
    expect(staleReasons(empty, [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }])).toEqual([null]);
  });

  it('counts a cut as covering a note only when both ends match', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a/x.ts', test: false },
        { path: 'a/y.ts', test: false },
        { path: 'b/z.ts', test: false },
        { path: 'c/w.ts', test: false },
      ],
      edges: [{ from: 'a/x.ts', to: 'b/z.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const cut: PlanEdit = { kind: 'cut-edge', from: 'a', to: 'b', files: [['a/x.ts', 'b/z.ts']] };
    const sameFrom: PlanEdit = { kind: 'note', target: { edge: ['a', 'c'] }, text: 'x' };
    const sameTo: PlanEdit = { kind: 'note', target: { edge: ['c', 'b'] }, text: 'x' };
    const both: PlanEdit = { kind: 'note', target: { edge: ['a', 'b'] }, text: 'x' };
    expect(staleReasons(scan, [cut, sameFrom])).toEqual([null, 'no such arrow a → c']);
    expect(staleReasons(scan, [cut, sameTo])).toEqual([null, 'no such arrow c → b']);
    expect(staleReasons(scan, [cut, both])).toEqual([null, null]);
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

const CREATE_PORTS: PlanEdit = { kind: 'create-package', path: 'src/ports' };
const SPLIT_APP: PlanEdit = {
  kind: 'split-package',
  package: 'src/app',
  parts: [
    { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts'] },
    { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
  ],
};

function edgesOf(scan: ScanResult): string[] {
  return scan.edges.map(edge => `${edge.from}>${edge.to}`);
}

function noCycles(): string[] {
  return [];
}

describe('package edits and file fates in the walk', () => {
  it('declares created packages, as parents too, and lets a move target them', () => {
    const planned = applyPlan(LAYERED, [CREATE_PORTS, { kind: 'create-package', path: 'src/ports/deep' }, { kind: 'create-package', path: 'top' }, { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/ports' }]);
    expect(planned.declared).toEqual(['src/ports', 'src/ports/deep', 'top']);
    expect(pathsOf(planned)).toContain('src/ports/shape.ts');
    expect(applyPlan(LAYERED, [])).not.toHaveProperty('declared');
  });

  it('gives the pinned reasons for creates and renames', () => {
    expect(
      staleReasons(LAYERED, [
        { kind: 'create-package', path: 'lib/ports' },
        { kind: 'create-package', path: 'src/infra' },
        { kind: 'create-package', path: 'src/app/a.ts' },
        { kind: 'rename-package', from: 'src/io', to: 'src/net' },
        { kind: 'rename-package', from: 'src/infra', to: 'src/domain' },
        { kind: 'rename-file', from: 'src/app/gone.ts', to: 'x.ts' },
        { kind: 'rename-file', from: 'src/app/save.ts', to: 'b.ts' },
      ]),
    ).toEqual([
      'no such directory lib',
      'src/infra already exists',
      'src/app/a.ts already exists',
      'no such directory src/io',
      'src/domain already exists',
      'no such file src/app/gone.ts',
      'src/app/b.ts already exists',
    ]);
  });

  it('renames a package without moving a sibling that shares its prefix', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/infra2/x.ts', test: false }] };
    const planned = applyPlan(scan, [{ kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }]);
    expect(pathsOf(planned)).toContain('src/infra2/x.ts');
    expect(pathsOf(planned)).not.toContain('src/adapters2/x.ts');
    expect(pathsOf(planned).filter(path => path.startsWith('src/adapters/'))).toEqual(['src/adapters/db.ts', 'src/adapters/repo.ts']);
  });

  it('keeps a nested path when a package is renamed', () => {
    const scan: ScanResult = {
      ...LAYERED,
      files: [...LAYERED.files, { path: 'src/infra/deep/x.ts', test: false }],
      edges: [...LAYERED.edges, { from: 'src/app/a.ts', to: 'src/infra/deep/x.ts', kind: 'runtime' }],
    };
    const planned = applyPlan(scan, [
      { kind: 'create-package', path: 'src/infra/deep/empty' },
      { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' },
    ]);
    expect(pathsOf(planned)).toContain('src/adapters/deep/x.ts');
    expect(pathsOf(planned)).not.toContain('src/adapters/x.ts');
    expect(planned.declared).toEqual(['src/adapters/deep/empty']);
    expect(edgesOf(planned)).toContain('src/app/a.ts>src/adapters/deep/x.ts');
  });

  it('renames a package with its edges, externals, planned edges, declared paths and deleted marks', () => {
    const planned = applyPlan(LAYERED, [
      ADD_INFRA_APP,
      { kind: 'create-package', path: 'src/infra/empty' },
      { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' },
      { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' },
    ]);
    expect(pathsOf(planned).filter(path => path.startsWith('src/adapters/'))).toEqual(['src/adapters/db.ts', 'src/adapters/repo.ts']);
    expect(edgesOf(planned)).toContain('src/app/a.ts>src/adapters/db.ts');
    expect(planned.externals.map(ext => ext.from)).toEqual(['src/adapters/repo.ts', 'src/adapters/repo.ts']);
    expect(planned.planned).toEqual([{ from: 'src/adapters', to: 'src/app' }]);
    expect(planned.declared).toEqual(['src/adapters/empty']);
    expect(planned.deleted).toEqual(['src/adapters/db.ts']);
  });

  it('renames a file in its directory and keeps its edges', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }]);
    expect(pathsOf(planned)).toContain('src/app/c.ts');
    expect(edgesOf(planned)).toContain('src/app/a.ts>src/app/c.ts');
  });

  it('moves a deleted mark onto the file a later rename lands on', () => {
    const report = planReport(LAYERED, [{ kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }, { kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }], cycleTexts);
    expect(report.scan.deleted).toEqual(['src/app/c.ts']);
    expect(report.warnings[0]).toEqual([{ kind: 'deleted-imports', file: 'src/app/c.ts', importers: ['src/app/a.ts'] }]);
    expect(graphView(report.scan, 'src/app', 'repo')?.nodes.find(node => node.id === 'src/app/c.ts')).toMatchObject({ fate: 'delete' });
  });

  it('gives the pinned reasons for merges', () => {
    expect(
      staleReasons(LAYERED, [
        { kind: 'merge-packages', packages: ['src/app', 'src/gone'], into: 'src/x' },
        { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/domain' },
        { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/domain/model.ts' },
        { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/app/a.ts' },
      ]),
    ).toEqual(['no such directory src/gone', 'src/domain already exists', 'src/domain/model.ts already exists', 'src/app/a.ts already exists']);
    const twins: ScanResult = { ...LAYERED, files: [{ path: 'x/a.ts', test: false }, { path: 'y/a.ts', test: false }], edges: [], externals: [] };
    expect(staleReasons(twins, [{ kind: 'merge-packages', packages: ['x', 'y'], into: 'z' }])).toEqual(['z/a.ts already exists']);
    expect(staleReasons(twins, [{ kind: 'merge-packages', packages: ['x', 'y'], into: 'x' }])).toEqual(['x/a.ts already exists']);
  });

  it('merges files under their own sub-paths, into one of the packages too, and drops the others from the declared set', () => {
    const into = applyPlan(LAYERED, [{ kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/core' }]);
    expect(pathsOf(into)).toEqual(['src/core/a.ts', 'src/core/b.ts', 'src/core/a.test.ts', 'src/core/save.ts', 'src/domain/model.ts', 'src/domain/shape.ts', 'src/core/db.ts', 'src/core/repo.ts']);
    const kept = applyPlan(LAYERED, [SPLIT_APP, { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app/read' }]);
    expect(pathsOf(kept).filter(path => path.startsWith('src/app/'))).toEqual(['src/app/read/a.ts', 'src/app/read/b.ts', 'src/app/read/a.test.ts', 'src/app/read/save.ts']);
    expect(kept.declared).toEqual(['src/app/read']);
    const back = applyPlan(LAYERED, [SPLIT_APP, { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app' }]);
    expect(pathsOf(back)).toEqual(pathsOf(LAYERED));
    expect(back).not.toHaveProperty('declared');
    expect(back).not.toHaveProperty('hidden');
  });

  it('keeps a nested path when a merge moves a file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/infra/deep/a.ts', test: false },
        { path: 'src/net/b.ts', test: false },
      ],
      edges: [{ from: 'src/net/b.ts', to: 'src/infra/deep/a.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const planned = applyPlan(scan, [{ kind: 'merge-packages', packages: ['src/infra', 'src/net'], into: 'src/core' }]);
    expect(pathsOf(planned)).toEqual(['src/core/deep/a.ts', 'src/core/b.ts']);
    expect(edgesOf(planned)).toEqual(['src/core/b.ts>src/core/deep/a.ts']);
  });

  it('leaves a prefix sibling unmoved and refuses a merge into that sibling', () => {
    const beside: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/infra2/x.ts', test: false }] };
    const merged = applyPlan(beside, [{ kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' }]);
    expect(pathsOf(merged)).toContain('src/infra2/x.ts');
    expect(pathsOf(merged)).toContain('src/core/db.ts');
    expect(pathsOf(merged)).not.toContain('src/core2/x.ts');
    expect(pathsOf(merged)).not.toContain('src/infra/db.ts');
    expect(staleReasons(beside, [{ kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/infra2' }])).toEqual(['src/infra2 already exists']);
    const core2: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/core2/x.ts', test: false }] };
    const intoCore = applyPlan(core2, [{ kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' }]);
    expect(staleReasons(core2, [{ kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' }])).toEqual([null]);
    expect(pathsOf(intoCore)).toContain('src/core2/x.ts');
    expect(pathsOf(intoCore)).not.toContain('src/core/x.ts');
  });

  it('rekeys a declared package nested under a merged package', () => {
    const edits: PlanEdit[] = [
      { kind: 'create-package', path: 'src/infra/sub' },
      { kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' },
    ];
    const report = planReport(LAYERED, edits, noCycles);
    expect(report.scan.declared).toEqual(['src/core/sub']);
    expect(report.stale).toEqual([null, null]);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'src/core/sub' }], []]);
  });

  it('gives the pinned reasons for splits', () => {
    const parts = (files: string[]) => [
      { name: 'read', files },
      { name: 'write', files: [] },
    ];
    expect(
      staleReasons(LAYERED, [
        { kind: 'split-package', package: 'src/gone', parts: parts([]) },
        { kind: 'split-package', package: 'src/app', parts: parts(['src/infra/db.ts']) },
        { kind: 'split-package', package: 'src/app', parts: parts(['src/app/gone.ts']) },
        { kind: 'split-package', package: 'src/app', parts: [{ name: 'a.ts', files: [] }, { name: 'b.ts', files: [] }] },
      ]),
    ).toEqual(['no such directory src/gone', 'no such file src/infra/db.ts', 'no such file src/app/gone.ts', 'src/app/a.ts already exists']);
    const apple: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/apple/x.ts', test: false }] };
    expect(staleReasons(apple, [{ kind: 'split-package', package: 'src/app', parts: parts(['src/apple/x.ts']) }])).toEqual(['no such file src/apple/x.ts']);
  });

  it('splits listed files into parts, leaves the rest, declares the parts and hides the emptied package', () => {
    const partial = applyPlan(LAYERED, [{ kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: [] }] }]);
    expect(pathsOf(partial)).toContain('src/app/read/a.ts');
    expect(pathsOf(partial)).toContain('src/app/b.ts');
    expect(partial.declared).toEqual(['src/app/read', 'src/app/write']);
    const beside = applyPlan(LAYERED, [{
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts', 'src/app/a.test.ts', 'src/app/save.ts'] },
        { name: 'b', files: [] },
      ],
    }]);
    const atApp = graphView(beside, 'src/app', 'layered');
    expect(atApp?.nodes.find(node => node.id === 'src/app/b')).toMatchObject({ kind: 'package', files: 0 });
    expect(atApp?.nodes.map(node => node.id)).toContain('src/app/b.ts');
    expect(partial).not.toHaveProperty('hidden');
    const full = applyPlan(LAYERED, [SPLIT_APP]);
    expect(full.hidden).toEqual(['src/app']);
    const emptied = applyPlan(LAYERED, [{ kind: 'move-file', file: 'src/infra/db.ts', to: 'src/app' }, { kind: 'move-file', file: 'src/infra/repo.ts', to: 'src/app' }]);
    expect(emptied).not.toHaveProperty('hidden');
  });

  it('hides an emptied package when only a declared package is left under it', () => {
    const planned = applyPlan(LAYERED, [
      { kind: 'create-package', path: 'src/infra/sub' },
      { kind: 'move-file', file: 'src/infra/db.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/infra/repo.ts', to: 'src/domain' },
    ]);
    expect(planned.declared).toEqual(['src/infra/sub']);
    expect(planned.hidden).toEqual(['src/infra']);
  });

  it('hides an emptied package when only a file is left under it', () => {
    const scan: ScanResult = { ...LAYERED, files: [{ path: 'src/domain/model.ts', test: false }, { path: 'src/infra/db.ts', test: false }, { path: 'src/infra/sub/x.ts', test: false }], edges: [], externals: [] };
    const planned = applyPlan(scan, [{ kind: 'move-file', file: 'src/infra/db.ts', to: 'src/domain' }]);
    expect(planned).not.toHaveProperty('declared');
    expect(planned.hidden).toEqual(['src/infra']);
    expect(graphView(planned, 'src', 'repo')?.nodes.map(node => node.id)).toEqual(['src/domain', 'src/infra/sub']);
  });

  it('hides each emptied package down to the one that still holds a file', () => {
    const files = ['src/app/a.ts', 'src/app/sub/b.ts', 'src/app/sub/deep/c.ts', 'src/domain/model.ts'];
    const scan: ScanResult = { ...LAYERED, files: files.map(path => ({ path, test: false })), edges: [], externals: [] };
    const planned = applyPlan(scan, [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' },
    ]);
    expect(planned.hidden).toEqual(['src/app', 'src/app/sub']);
    expect(graphView(planned, 'src', 'repo')?.nodes.map(node => node.id)).toEqual(['src/app/sub/deep', 'src/domain']);
  });

  it('counts a declared package as known to a merge and as taken to a split', () => {
    const merged = planReport(LAYERED, [CREATE_PORTS, { kind: 'merge-packages', packages: ['src/ports', 'src/app'], into: 'src/core' }], noCycles);
    expect(merged.stale).toEqual([null, null]);
    expect(merged.scan).not.toHaveProperty('declared');
    expect(pathsOf(merged.scan).filter(path => path.startsWith('src/core/'))).toEqual(['src/core/a.ts', 'src/core/b.ts', 'src/core/a.test.ts', 'src/core/save.ts']);
    expect(staleReasons(LAYERED, [{ kind: 'create-package', path: 'src/app/read' }, SPLIT_APP])).toEqual([null, 'src/app/read already exists']);
  });

  it('gives the pinned reasons for fates', () => {
    expect(
      staleReasons(LAYERED, [
        { kind: 'fate', file: 'src/app/gone.ts', fate: 'delete' },
        { kind: 'fate', file: 'src/app/save.ts', fate: 'delete' },
        { kind: 'fate', file: 'src/app/save.ts', fate: 'delete' },
        { kind: 'fate', file: 'src/app/gone.ts', fate: 'fold', into: 'src/app/a.ts' },
        { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/gone.ts' },
      ]),
    ).toEqual(['no such file src/app/gone.ts', null, 'src/app/save.ts is already deleted', 'no such file src/app/gone.ts', 'no such file src/app/gone.ts']);
  });

  it('reports the earliest check when two checks fail', () => {
    const twins: ScanResult = {
      files: [
        { path: 'x/a.ts', test: false },
        { path: 'y/a.ts', test: false },
        { path: 'src/domain/model.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    expect(
      staleReasons(LAYERED, [
        { kind: 'create-package', path: 'src/ports' },
        { kind: 'rename-package', from: 'src/ports', to: 'lib/empty' },
        { kind: 'create-package', path: 'lib/empty' },
        { kind: 'rename-package', from: 'src/io', to: 'src/domain' },
        { kind: 'rename-file', from: 'src/app/gone.ts', to: 'b.ts' },
        { kind: 'split-package', package: 'src/app', parts: [{ name: 'a.ts', files: ['src/infra/db.ts'] }, { name: 'write', files: [] }] },
        { kind: 'fate', file: 'src/app/gone.ts', fate: 'fold', into: 'src/app/also.ts' },
      ]),
    ).toEqual([
      null,
      null,
      'no such directory lib',
      'no such directory src/io',
      'no such file src/app/gone.ts',
      'no such file src/infra/db.ts',
      'no such file src/app/gone.ts',
    ]);
    expect(staleReasons(twins, [{ kind: 'merge-packages', packages: ['x', 'y'], into: 'src/domain' }])).toEqual(['src/domain already exists']);
    expect(
      staleReasons(LAYERED, [
        { kind: 'split-package', package: 'src/gone', parts: [{ name: 'read', files: ['src/infra/db.ts'] }, { name: 'write', files: [] }] },
        { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/missing/a.ts'] }, { name: 'write', files: ['src/other/b.ts'] }] },
      ]),
    ).toEqual(['no such directory src/gone', 'no such file src/missing/a.ts']);
    const gone: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/gone/a.ts', test: false }] };
    expect(
      staleReasons(gone, [
        { kind: 'create-package', path: 'src/gone/read' },
        { kind: 'move-file', file: 'src/gone/a.ts', to: 'src/domain' },
        { kind: 'split-package', package: 'src/gone', parts: [{ name: 'read', files: [] }, { name: 'write', files: [] }] },
      ]),
    ).toEqual([null, null, 'no such directory src/gone']);
  });

  it('moves a planned edge endpoint when its file folds', () => {
    const planned = applyPlan(LAYERED, [
      { kind: 'add-edge', from: 'src/infra/repo.ts', to: 'src/app' },
      { kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' },
    ]);
    expect(planned.planned).toEqual([{ from: 'src/infra/db.ts', to: 'src/app' }]);
  });

  it('marks a deleted file that follows a move, and folds a file into another', () => {
    const deleted = applyPlan(LAYERED, [{ kind: 'fate', file: 'src/app/save.ts', fate: 'delete' }, MOVE_SAVE]);
    expect(deleted.deleted).toEqual(['src/infra/save.ts']);
    expect(pathsOf(deleted)).toContain('src/infra/save.ts');
    const folded = applyPlan(LAYERED, [
      { kind: 'fate', file: 'src/infra/repo.ts', fate: 'delete' },
      { kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/domain/shape.ts' },
    ]);
    expect(pathsOf(folded)).not.toContain('src/infra/repo.ts');
    expect(edgesOf(folded)).toContain('src/app/a.ts>src/domain/shape.ts');
    expect(edgesOf(folded)).not.toContain('src/domain/shape.ts>src/domain/shape.ts');
    expect(folded.externals.map(ext => ext.from)).toEqual(['src/domain/shape.ts', 'src/domain/shape.ts']);
    expect(folded).not.toHaveProperty('deleted');
  });
});

describe('planReport', () => {
  it('returns the planned scan and the stale list of the walk', () => {
    const report = planReport(LAYERED, [MOVE_SAVE, { kind: 'move-file', file: 'src/app/gone.ts', to: 'src/infra' }], noCycles);
    expect(report.scan).toEqual(applyPlan(LAYERED, [MOVE_SAVE]));
    expect(report.stale).toEqual([null, 'no such file src/app/gone.ts']);
    expect(report.warnings).toEqual([[], []]);
  });

  it('warns about empty packages on the declaring edit, sorted, with their final paths', () => {
    const report = planReport(
      LAYERED,
      [
        { kind: 'create-package', path: 'src/zeta' },
        { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts', 'src/app/a.test.ts'] }, { name: 'x', files: [] }, { name: 'b', files: [] }] },
        { kind: 'rename-package', from: 'src/zeta', to: 'src/alpha' },
        CREATE_PORTS,
        { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/ports' },
      ],
      noCycles,
    );
    expect(report.warnings).toEqual([
      [{ kind: 'empty-package', path: 'src/alpha' }],
      [
        { kind: 'empty-package', path: 'src/app/b' },
        { kind: 'empty-package', path: 'src/app/x' },
      ],
      [],
      [],
      [],
    ]);
  });

  it('stales a second create of an empty package and keeps the warning on the first', () => {
    const report = planReport(LAYERED, [CREATE_PORTS, CREATE_PORTS], noCycles);
    expect(report.stale).toEqual([null, 'src/ports already exists']);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'src/ports' }], []]);
  });

  it('warns about an empty package on the edit that created it, not the first edit', () => {
    const report = planReport(LAYERED, [MOVE_SAVE, CREATE_PORTS], noCycles);
    expect(report.warnings).toEqual([[], [{ kind: 'empty-package', path: 'src/ports' }]]);
  });

  it('warns when the only new cycle is drawn at the root', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a/p.ts', test: false },
        { path: 'b/q.ts', test: false },
      ],
      edges: [{ from: 'a/p.ts', to: 'b/q.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const report = planReport(scan, [{ kind: 'add-edge', from: 'b', to: 'a' }], cycleTexts);
    expect(report.stale).toEqual([null]);
    expect(report.warnings).toEqual([[{ kind: 'added-cycle', cycle: 'a → b → a' }]]);
  });

  it('warns about a deleted file that is still imported, with its distinct importers sorted', () => {
    const twice: ScanResult = { ...LAYERED, edges: [...LAYERED.edges, { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'type' }] };
    const report = planReport(twice, [{ kind: 'fate', file: 'src/app/a.ts', fate: 'delete' }, { kind: 'fate', file: 'src/app/save.ts', fate: 'delete' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/app/a.ts', importers: ['src/app/a.test.ts', 'src/app/b.ts'] }], []]);
  });

  it('puts a new cycle on the earliest edit after which it holds, and skips cycles the current scan has', () => {
    const cycles = (scan: ScanResult): string[] => (scan.planned ?? []).map(edge => `${edge.from} → ${edge.to}`).concat(['old']);
    const report = planReport(
      LAYERED,
      [ADD_INFRA_APP, { kind: 'move-file', file: 'src/app/missing.ts', to: 'src/infra' }, { kind: 'add-edge', from: 'src/domain', to: 'src/app' }],
      cycles,
    );
    expect(report.stale).toEqual([null, 'no such file src/app/missing.ts', null]);
    expect(report.warnings).toEqual([[{ kind: 'added-cycle', cycle: 'src/infra → src/app' }], [], [{ kind: 'added-cycle', cycle: 'src/domain → src/app' }]]);
  });

  it('does not warn about a split part whose files all sit in a subdirectory', () => {
    const nested: ScanResult = { ...LAYERED, files: [{ path: 'src/app/a.ts', test: false }, { path: 'src/app/deep/b.ts', test: false }], edges: [], externals: [] };
    const split: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: ['src/app/deep/b.ts'] }] };
    const report = planReport(nested, [split], noCycles);
    expect(pathsOf(report.scan)).toEqual(['src/app/read/a.ts', 'src/app/write/deep/b.ts']);
    expect(report.warnings).toEqual([[]]);
  });

  it('lists empty packages before cycles on one edit', () => {
    const cycles = (scan: ScanResult): string[] => ((scan.hidden ?? []).length > 0 ? ['b → a → b', 'a → b → a'] : []);
    const report = planReport(LAYERED, [{ kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts', 'src/app/a.test.ts'] }, { name: 'spare', files: [] }] }], cycles);
    expect(report.warnings).toEqual([
      [
        { kind: 'empty-package', path: 'src/app/spare' },
        { kind: 'added-cycle', cycle: 'a → b → a' },
        { kind: 'added-cycle', cycle: 'b → a → b' },
      ],
    ]);
  });
});
