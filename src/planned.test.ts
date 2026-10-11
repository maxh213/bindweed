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

  it('still reports an add the graph has when the only edge touches a deleted file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/infra/db.ts', test: false },
      ],
      edges: [{ from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' },
      { kind: 'add-edge', from: 'src/app', to: 'src/infra' },
    ];
    expect(staleReasons(scan, edits)).toEqual([null, 'src/app already imports src/infra']);
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
        { kind: 'create-package', path: 'src/app/a.ts/child' },
        { kind: 'rename-package', from: 'src/app/a.ts', to: 'src/app/x.ts' },
        { kind: 'rename-file', from: 'src/app', to: 'x.ts' },
      ]),
    ).toEqual([
      'no such directory lib',
      'src/infra already exists',
      'src/app/a.ts already exists',
      'no such directory src/io',
      'src/domain already exists',
      'no such file src/app/gone.ts',
      'src/app/b.ts already exists',
      'no such directory src/app/a.ts',
      'no such directory src/app/a.ts',
      'no such file src/app',
    ]);
  });

  it('stales a file rename onto its own name and leaves the file', () => {
    const edit: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'save.ts' };
    expect(staleReasons(LAYERED, [edit])).toEqual(['src/app/save.ts already exists']);
    const planned = applyPlan(LAYERED, [edit]);
    expect(pathsOf(planned)).toEqual(pathsOf(LAYERED));
    expect(planned.edges).toEqual(LAYERED.edges);
  });

  it('refuses a file rename onto a directory and onto a declared package', () => {
    const nested: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/app/deep/x.ts', test: false }] };
    const ontoDir: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'deep' };
    expect(staleReasons(nested, [ontoDir])).toEqual(['src/app/deep already exists']);
    expect(pathsOf(applyPlan(nested, [ontoDir]))).toContain('src/app/save.ts');
    const ontoDeclared: PlanEdit[] = [
      { kind: 'create-package', path: 'src/app/empty' },
      { kind: 'rename-file', from: 'src/app/save.ts', to: 'empty' },
    ];
    expect(staleReasons(LAYERED, ontoDeclared)).toEqual([null, 'src/app/empty already exists']);
    expect(pathsOf(applyPlan(LAYERED, ontoDeclared))).toContain('src/app/save.ts');
  });

  it('refuses a package rename onto a file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/app/read/a.ts', test: false }] };
    const edit: PlanEdit = { kind: 'rename-package', from: 'src/app/read', to: 'src/app/b.ts' };
    expect(staleReasons(scan, [edit])).toEqual(['src/app/b.ts already exists']);
    expect(pathsOf(applyPlan(scan, [edit]))).toContain('src/app/read/a.ts');
  });

  it('keeps a deleted file path taken for a later rename and create', () => {
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      { kind: 'rename-file', from: 'src/app/save.ts', to: 'b.ts' },
      { kind: 'create-package', path: 'src/app/b.ts' },
    ];
    expect(staleReasons(LAYERED, edits)).toEqual([null, 'src/app/b.ts already exists', 'src/app/b.ts already exists']);
    const planned = applyPlan(LAYERED, edits);
    expect(pathsOf(planned)).toContain('src/app/save.ts');
    expect(pathsOf(planned)).toContain('src/app/b.ts');
  });

  it('keeps the outgoing edges of a deleted file', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }]);
    expect(planned.deleted).toEqual(['src/app/b.ts']);
    expect(pathsOf(planned)).toContain('src/app/b.ts');
    expect(edgesOf(planned)).toContain('src/app/b.ts>src/app/a.ts');
    expect(edgesOf(planned)).toContain('src/app/b.ts>src/infra/db.ts');
  });

  it('keeps a deleted file path taken for a later move, merge and split', () => {
    const deleteB: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' };
    const withLib: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/lib/b.ts', test: false }] };
    const move: PlanEdit[] = [deleteB, { kind: 'move-file', file: 'src/lib/b.ts', to: 'src/app' }];
    expect(staleReasons(withLib, move)).toEqual([null, 'src/app/b.ts already exists']);
    const unmoved = applyPlan(withLib, move);
    expect(pathsOf(unmoved)).toContain('src/lib/b.ts');
    expect(pathsOf(unmoved).filter(path => path === 'src/app/b.ts')).toEqual(['src/app/b.ts']);
    const merge: PlanEdit[] = [deleteB, { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/app/b.ts' }];
    expect(staleReasons(LAYERED, merge)).toEqual([null, 'src/app/b.ts already exists']);
    expect(pathsOf(applyPlan(LAYERED, merge))).toEqual(pathsOf(LAYERED));
    const split: PlanEdit[] = [deleteB, {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'b.ts', files: [] },
        { name: 'write', files: ['src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts', 'src/app/a.test.ts'] },
      ],
    }];
    expect(staleReasons(LAYERED, split)).toEqual([null, 'src/app/b.ts already exists']);
    expect(pathsOf(applyPlan(LAYERED, split))).toEqual(pathsOf(LAYERED));
  });

  it('refuses a merge into a package whose only file is deleted', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/probe/only.ts', test: false }] };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/probe/only.ts', fate: 'delete' },
      { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/probe' },
    ];
    expect(staleReasons(scan, edits)).toEqual([null, 'src/probe already exists']);
    const planned = applyPlan(scan, edits);
    expect(pathsOf(planned)).toEqual(pathsOf(scan));
    expect(planned.deleted).toEqual(['src/probe/only.ts']);
  });

  it('refuses a merge when a deleted file and a live file land on one path', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/lib/b.ts', test: false }] };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      { kind: 'merge-packages', packages: ['src/app', 'src/lib'], into: 'src/core' },
    ];
    expect(staleReasons(scan, edits)).toEqual([null, 'src/core/b.ts already exists']);
    expect(pathsOf(applyPlan(scan, edits))).toEqual(pathsOf(scan));
  });

  it('refuses a merge into a listed package when a live file would land on its deleted file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/lib/a.ts', test: false }] };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' },
      { kind: 'merge-packages', packages: ['src/app', 'src/lib'], into: 'src/app' },
    ];
    expect(staleReasons(scan, edits)).toEqual([null, 'src/app/a.ts already exists']);
    expect(pathsOf(applyPlan(scan, edits))).toEqual(pathsOf(scan));
  });

  it('moves a deleted file, its mark and the edge onto it when packages merge', () => {
    const scan: ScanResult = {
      ...LAYERED,
      edges: [...LAYERED.edges, { from: 'src/domain/model.ts', to: 'src/app/save.ts', kind: 'runtime' }],
    };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/save.ts', fate: 'delete' },
      { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/core' },
    ];
    const planned = applyPlan(scan, edits);
    expect(staleReasons(scan, edits)).toEqual([null, null]);
    expect(pathsOf(planned)).toContain('src/core/save.ts');
    expect(pathsOf(planned)).not.toContain('src/app/save.ts');
    expect(planned.deleted).toEqual(['src/core/save.ts']);
    expect(edgesOf(planned)).toContain('src/domain/model.ts>src/core/save.ts');
  });

  it('moves a deleted file and its mark when a split lists it', () => {
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      {
        kind: 'split-package',
        package: 'src/app',
        parts: [
          { name: 'read', files: ['src/app/a.ts'] },
          { name: 'write', files: ['src/app/b.ts'] },
        ],
      },
    ];
    const planned = applyPlan(LAYERED, edits);
    expect(staleReasons(LAYERED, edits)).toEqual([null, null]);
    expect(pathsOf(planned)).toContain('src/app/write/b.ts');
    expect(pathsOf(planned)).not.toContain('src/app/b.ts');
    expect(planned.deleted).toEqual(['src/app/write/b.ts']);
    expect(edgesOf(planned)).toContain('src/app/read/a.ts>src/app/write/b.ts');
  });

  it('keeps a directory known after every file in it is deleted', () => {
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' },
      { kind: 'fate', file: 'src/infra/repo.ts', fate: 'delete' },
      { kind: 'create-package', path: 'src/infra/sub' },
    ];
    expect(staleReasons(LAYERED, edits)).toEqual([null, null, null]);
    expect(applyPlan(LAYERED, edits).declared).toEqual(['src/infra/sub']);
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

  it('moves a planned edge when a merge or a file rename moves its end', () => {
    const merged = applyPlan(LAYERED, [
      { kind: 'add-edge', from: 'src/domain', to: 'src/infra' },
      { kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' },
    ]);
    expect(merged.planned).toEqual([{ from: 'src/domain', to: 'src/core' }]);
    const atSrc = graphView(merged, 'src', 'repo');
    expect(atSrc?.edges.find(edge => edge.from === 'src/domain' && edge.to === 'src/core')).toMatchObject({ planned: true });
    const renamed = applyPlan(LAYERED, [
      { kind: 'add-edge', from: 'src/app/save.ts', to: 'src/app/a.ts' },
      { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' },
    ]);
    expect(renamed.planned).toEqual([{ from: 'src/app/writer.ts', to: 'src/app/a.ts' }]);
    const atApp = graphView(renamed, 'src/app', 'repo');
    expect(atApp?.edges.find(edge => edge.from === 'src/app/writer.ts' && edge.to === 'src/app/a.ts')).toMatchObject({ planned: true });
  });

  it('moves external imports when a merge, a split or a file rename moves their file', () => {
    const merged = applyPlan(LAYERED, [{ kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' }]);
    expect(merged.externals.map(ext => ext.from)).toEqual(['src/core/repo.ts', 'src/core/repo.ts']);
    const split = applyPlan(LAYERED, [{
      kind: 'split-package',
      package: 'src/infra',
      parts: [{ name: 'read', files: ['src/infra/repo.ts'] }, { name: 'write', files: ['src/infra/db.ts'] }],
    }]);
    expect(split.externals.map(ext => ext.from)).toEqual(['src/infra/read/repo.ts', 'src/infra/read/repo.ts']);
    const renamed = applyPlan(LAYERED, [{ kind: 'rename-file', from: 'src/infra/repo.ts', to: 'store.ts' }]);
    expect(renamed.externals.map(ext => ext.from)).toEqual(['src/infra/store.ts', 'src/infra/store.ts']);
  });

  it('renames a file in its directory and keeps its edges', () => {
    const planned = applyPlan(LAYERED, [{ kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }]);
    expect(pathsOf(planned)).toContain('src/app/c.ts');
    expect(edgesOf(planned)).toContain('src/app/a.ts>src/app/c.ts');
  });

  it('moves, renames and folds one file and leaves a longer path beside it', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/app/a.ts.bak', test: false },
        { path: 'src/domain/model.ts', test: false },
        { path: 'src/infra/db.ts', test: false },
      ],
      edges: [{ from: 'src/app/a.ts.bak', to: 'src/domain/model.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const edge = scan.edges;
    const moved = applyPlan(scan, [{ kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' }]);
    expect(pathsOf(moved)).toEqual(['src/infra/a.ts', 'src/app/a.ts.bak', 'src/domain/model.ts', 'src/infra/db.ts']);
    expect(moved.edges).toEqual(edge);
    const renamed = applyPlan(scan, [{ kind: 'rename-file', from: 'src/app/a.ts', to: 'b.ts' }]);
    expect(pathsOf(renamed)).toEqual(['src/app/b.ts', 'src/app/a.ts.bak', 'src/domain/model.ts', 'src/infra/db.ts']);
    expect(renamed.edges).toEqual(edge);
    const folded = applyPlan(scan, [{ kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/domain/model.ts' }]);
    expect(pathsOf(folded)).toEqual(['src/app/a.ts.bak', 'src/domain/model.ts', 'src/infra/db.ts']);
    expect(folded.edges).toEqual(edge);
    const split = applyPlan(scan, [{
      kind: 'split-package',
      package: 'src/app',
      parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: [] }],
    }]);
    expect(pathsOf(split)).toEqual(['src/app/read/a.ts', 'src/app/a.ts.bak', 'src/domain/model.ts', 'src/infra/db.ts']);
    expect(split.edges).toEqual(edge);
    expect(pathsOf(split)).not.toContain('src/app/read/a.ts.bak');
  });

  it('renames one file and leaves another file of the same name', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/b.ts', test: false },
        { path: 'src/lib/b.ts', test: false },
      ],
      edges: [{ from: 'src/lib/b.ts', to: 'src/app/a.ts', kind: 'runtime' }],
      externals: [{ from: 'src/lib/b.ts', name: 'node:fs', kind: 'runtime' }],
      workspaces: [],
    };
    const planned = applyPlan(scan, [{ kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }]);
    expect(pathsOf(planned)).toEqual(['src/app/c.ts', 'src/lib/b.ts']);
    expect(edgesOf(planned)).toEqual(['src/lib/b.ts>src/app/a.ts']);
    expect(planned.externals).toEqual([{ from: 'src/lib/b.ts', name: 'node:fs', kind: 'runtime' }]);
  });

  it('leaves an unlisted file that shares a listed file name', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/lib/a.ts', test: false },
      ],
      edges: [{ from: 'src/lib/a.ts', to: 'src/app/a.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const planned = applyPlan(scan, [{
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts'] },
        { name: 'write', files: [] },
      ],
    }]);
    expect(pathsOf(planned)).toEqual(['src/app/read/a.ts', 'src/lib/a.ts']);
    expect(edgesOf(planned)).toEqual(['src/lib/a.ts>src/app/read/a.ts']);
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
        { kind: 'merge-packages', packages: ['src/app/a.ts', 'src/infra'], into: 'src/core' },
      ]),
    ).toEqual(['no such directory src/gone', 'src/domain already exists', 'src/domain/model.ts already exists', 'src/app/a.ts already exists', 'no such directory src/app/a.ts']);
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

  it('does not stale a merge when two files share only their last segment', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/infra/deep/a.ts', test: false },
        { path: 'src/net/a.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const edit: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/net'], into: 'src/core' };
    expect(staleReasons(scan, [edit])).toEqual([null]);
    expect(pathsOf(applyPlan(scan, [edit]))).toEqual(['src/core/deep/a.ts', 'src/core/a.ts']);
  });

  it('refuses a merge into a directory whose only outside file is nested', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/probe/deep/x.ts', test: false }] };
    const edit: PlanEdit = { kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/probe' };
    expect(staleReasons(scan, [edit])).toEqual(['src/probe already exists']);
    const planned = applyPlan(scan, [edit]);
    expect(pathsOf(planned)).toContain('src/app/a.ts');
    expect(pathsOf(planned)).toContain('src/probe/deep/x.ts');
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

  it('keeps a declared package under the package a merge lands in', () => {
    const edits: PlanEdit[] = [
      { kind: 'create-package', path: 'src/app/spare' },
      { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/app' },
    ];
    const report = planReport(LAYERED, edits, noCycles);
    expect(report.stale).toEqual([null, null]);
    expect(report.scan.declared).toEqual(['src/app/spare']);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'src/app/spare' }], []]);
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
        { kind: 'split-package', package: 'src/app/a.ts', parts: parts([]) },
      ]),
    ).toEqual(['no such directory src/gone', 'no such file src/infra/db.ts', 'no such file src/app/gone.ts', 'src/app/a.ts already exists', 'no such directory src/app/a.ts']);
    const apple: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/apple/x.ts', test: false }] };
    expect(staleReasons(apple, [{ kind: 'split-package', package: 'src/app', parts: parts(['src/apple/x.ts']) }])).toEqual(['no such file src/apple/x.ts']);
  });

  it('refuses a split part that is only an ancestor of a file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/app/deep/x.ts', test: false }] };
    const edit: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'deep', files: [] },
        { name: 'other', files: ['src/app/deep/x.ts'] },
      ],
    };
    expect(staleReasons(scan, [edit])).toEqual(['src/app/deep already exists']);
    const planned = applyPlan(scan, [edit]);
    expect(pathsOf(planned)).toContain('src/app/deep/x.ts');
    expect(pathsOf(planned)).not.toContain('src/app/other/deep/x.ts');
    expect(planned).not.toHaveProperty('declared');
  });

  it('splits a package whose only files sit under a subdirectory', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/deep/a.ts', test: false },
        { path: 'src/app/deep/b.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/deep/a.ts', 'src/app/deep/b.ts'] },
        { name: 'write', files: [] },
      ],
    };
    expect(staleReasons(scan, [split])).toEqual([null]);
    expect(pathsOf(applyPlan(scan, [split]))).toEqual(['src/app/read/deep/a.ts', 'src/app/read/deep/b.ts']);
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

  it('does not hide a package whose only direct file is deleted', () => {
    const scan: ScanResult = { ...LAYERED, files: [{ path: 'src/domain/model.ts', test: false }, { path: 'src/app/a.ts', test: false }, { path: 'src/app/sub/x.ts', test: false }], edges: [], externals: [] };
    const planned = applyPlan(scan, [{ kind: 'fate', file: 'src/app/a.ts', fate: 'delete' }]);
    expect(planned).not.toHaveProperty('hidden');
    expect(graphView(planned, 'src', 'repo')?.nodes.map(node => node.id)).toEqual(['src/app', 'src/domain']);
  });

  it('hides an emptied package when only a deleted file is left under it', () => {
    const scan: ScanResult = { ...LAYERED, files: [{ path: 'src/domain/model.ts', test: false }, { path: 'src/app/a.ts', test: false }, { path: 'src/app/sub/x.ts', test: false }], edges: [], externals: [] };
    const planned = applyPlan(scan, [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'fate', file: 'src/app/sub/x.ts', fate: 'delete' },
    ]);
    expect(planned.hidden).toEqual(['src/app']);
    expect(graphView(planned, 'src', 'repo')?.nodes.map(node => node.id)).toEqual(['src/domain', 'src/app/sub']);
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

  it('draws an empty declared package two levels under hidden packages', () => {
    const files = ['src/app/a.ts', 'src/app/sub/b.ts', 'src/domain/model.ts'];
    const scan: ScanResult = { ...LAYERED, files: files.map(path => ({ path, test: false })), edges: [], externals: [] };
    const planned = applyPlan(scan, [
      { kind: 'create-package', path: 'src/app/sub/deep' },
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' },
    ]);
    expect(planned.hidden).toEqual(['src/app', 'src/app/sub']);
    expect(planned.declared).toEqual(['src/app/sub/deep']);
    const drawn = graphView(planned, 'src', 'repo');
    expect(drawn?.nodes.find(node => node.id === 'src/app/sub/deep')).toMatchObject({ kind: 'package', files: 0 });
    expect(drawn?.nodes.map(node => node.id)).toEqual(['src/app/sub/deep', 'src/domain']);
  });

  it('draws a package recreated after its files moved out, and does not hide it', () => {
    const edits: PlanEdit[] = [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/b.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/domain' },
      { kind: 'create-package', path: 'src/app' },
    ];
    const report = planReport(LAYERED, edits, noCycles);
    expect(report.stale).toEqual([null, null, null, null, null]);
    expect(report.scan).not.toHaveProperty('hidden');
    expect(report.scan.declared).toEqual(['src/app']);
    const drawn = graphView(report.scan, 'src', 'repo');
    expect(drawn?.nodes.map(node => node.id).sort()).toEqual(['src/app', 'src/domain', 'src/infra']);
    expect(drawn?.nodes.find(node => node.id === 'src/app')).toMatchObject({ kind: 'package', files: 0 });
    expect(report.warnings).toEqual([[], [], [], [], [{ kind: 'empty-package', path: 'src/app' }]]);
  });

  it('does not hide a recreated package because a prefix sibling still has a file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/apple/x.ts', test: false }] };
    const edits: PlanEdit[] = [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/b.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/domain' },
      { kind: 'create-package', path: 'src/app' },
    ];
    const report = planReport(scan, edits, noCycles);
    expect(report.stale).toEqual([null, null, null, null, null]);
    expect(report.scan).not.toHaveProperty('hidden');
    const drawn = graphView(report.scan, 'src', 'repo');
    expect(drawn?.nodes.map(node => node.id).sort()).toEqual(['src/app', 'src/apple', 'src/domain', 'src/infra']);
    expect(drawn?.nodes.find(node => node.id === 'src/app')).toMatchObject({ kind: 'package', files: 0 });
  });

  it('draws a created empty package that only holds another empty package', () => {
    const planned = applyPlan(LAYERED, [CREATE_PORTS, { kind: 'create-package', path: 'src/ports/deep' }]);
    expect(planned).not.toHaveProperty('hidden');
    const atSrc = graphView(planned, 'src', 'repo');
    const atNodes = atSrc === null ? [] : atSrc.nodes;
    expect(atNodes.map(node => node.id).sort()).toEqual(['src/app', 'src/domain', 'src/infra', 'src/ports']);
    expect(atNodes.find(node => node.id === 'src/ports')).toMatchObject({ kind: 'package', files: 0 });
    const inside = graphView(planned, 'src/ports', 'repo');
    const inNodes = inside === null ? [] : inside.nodes;
    expect(inNodes.map(node => node.id)).toEqual(['src/ports/deep']);
    expect(inNodes[0]).toMatchObject({ kind: 'package', files: 0 });
  });

  it('omits a planned edge that still names a package a later split hides', () => {
    const edits: PlanEdit[] = [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }, SPLIT_APP];
    const report = planReport(LAYERED, edits, cycleTexts);
    expect(report.stale).toEqual([null, null]);
    expect(report.scan.hidden).toEqual(['src/app']);
    expect(report.scan.planned).toEqual([{ from: 'src/domain', to: 'src/app' }]);
    const drawn = graphView(report.scan, 'src', 'repo');
    expect(drawn?.nodes.map(node => node.id)).toEqual(['src/app/read', 'src/app/write', 'src/infra', 'src/domain']);
    expect(drawn?.edges.filter(edge => edge.planned === true)).toEqual([]);
  });

  it('draws the empty package left under a package a planned edge still names', () => {
    const edits: PlanEdit[] = [
      { kind: 'add-edge', from: 'src/domain', to: 'src/app' },
      { kind: 'create-package', path: 'src/app/spare' },
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/b.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/save.ts', to: 'src/domain' },
    ];
    const report = planReport(LAYERED, edits, cycleTexts);
    expect(report.stale).toEqual([null, null, null, null, null, null]);
    expect(report.scan.hidden).toEqual(['src/app']);
    expect(report.scan.declared).toEqual(['src/app/spare']);
    expect(report.scan.planned).toEqual([{ from: 'src/domain', to: 'src/app' }]);
    const drawn = graphView(report.scan, 'src', 'repo');
    expect(drawn?.nodes.find(node => node.id === 'src/app/spare')).toMatchObject({ kind: 'package', files: 0 });
    expect(drawn?.nodes.map(node => node.id)).not.toContain('src/app');
    expect(drawn?.edges.filter(edge => edge.planned === true)).toEqual([]);
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
        { kind: 'fate', file: 'src/app', fate: 'delete' },
        { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/infra' },
      ]),
    ).toEqual(['no such file src/app/gone.ts', null, 'src/app/save.ts is already deleted', 'no such file src/app/gone.ts', 'no such file src/app/gone.ts', 'no such file src/app', 'no such file src/infra']);
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

  it('keeps an edge onto a longer path when a fold lands on its prefix and drops a self edge', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/a.ts', test: false },
        { path: 'src/b.ts', test: false },
        { path: 'src/b.ts/nested.ts', test: false },
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/b.ts/nested.ts', kind: 'runtime' },
        { from: 'src/a.ts', to: 'src/b.ts', kind: 'runtime' },
      ],
      planned: [
        { from: 'src/a.ts', to: 'src/b.ts/nested.ts' },
        { from: 'src/a.ts', to: 'src/b.ts' },
      ],
      externals: [],
      workspaces: [],
    };
    const folded = applyPlan(scan, [{ kind: 'fate', file: 'src/a.ts', fate: 'fold', into: 'src/b.ts' }]);
    expect(pathsOf(folded)).toEqual(['src/b.ts', 'src/b.ts/nested.ts']);
    expect(folded.edges).toEqual([{ from: 'src/b.ts', to: 'src/b.ts/nested.ts', kind: 'runtime' }]);
    expect(folded.planned).toEqual([{ from: 'src/b.ts', to: 'src/b.ts/nested.ts' }]);
  });

  it('drops a planned edge whose ends become the same file', () => {
    const edits: PlanEdit[] = [
      { kind: 'add-edge', from: 'src/domain/shape.ts', to: 'src/infra/repo.ts' },
      { kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/domain/shape.ts' },
    ];
    expect(staleReasons(LAYERED, edits)).toEqual([null, null]);
    const planned = applyPlan(LAYERED, edits);
    expect(planned.planned).toEqual([]);
    expect(edgesOf(planned)).not.toContain('src/domain/shape.ts>src/domain/shape.ts');
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

  it('keeps a runtime edge and a type edge that a fold lands on the same file', () => {
    const folded = applyPlan(LAYERED, [{ kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/infra/db.ts' }]);
    expect(folded.edges.filter(edge => edge.from === 'src/app/a.ts' && edge.to === 'src/infra/db.ts')).toEqual([
      { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' },
      { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'type' },
    ]);
  });

  it('cuts an edge of a file a delete kept', () => {
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/b.ts', 'src/infra/db.ts']] },
    ];
    const report = planReport(LAYERED, edits, noCycles);
    expect(report.stale).toEqual([null, null]);
    expect(report.scan.edges.some(edge => edge.from === 'src/app/b.ts' && edge.to === 'src/infra/db.ts')).toBe(false);
  });
});

const SHOWN: { tests: true; external: false } = { tests: true, external: false };

describe('a scanned file includes a test file', () => {
  it('treats a directory that holds only a test file as known', () => {
    const scan: ScanResult = { files: [{ path: 'src/probe/only.test.ts', test: true }], edges: [], externals: [], workspaces: [] };
    const report = planReport(scan, [{ kind: 'create-package', path: 'src/probe/child' }], noCycles);
    expect(report.stale).toEqual([null]);
    expect(report.scan.declared).toEqual(['src/probe/child']);
  });

  it('hides a package whose only direct file is a test file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/domain/model.ts', test: false },
        { path: 'src/app/a.test.ts', test: true },
        { path: 'src/app/sub/x.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const planned = applyPlan(scan, [{ kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/domain' }]);
    expect(planned.hidden).toEqual(['src/app']);
    expect(graphView(planned, 'src', 'repo', SHOWN)?.nodes.map(node => node.id)).toEqual(['src/domain', 'src/app/sub']);
  });

  it('hides a package when only a test file remains under it', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/domain/model.ts', test: false },
        { path: 'src/app/a.ts', test: false },
        { path: 'src/app/sub/a.test.ts', test: true },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const planned = applyPlan(scan, [{ kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' }]);
    expect(planned.hidden).toEqual(['src/app']);
    expect(graphView(planned, 'src', 'repo', SHOWN)?.nodes.map(node => node.id)).toEqual(['src/domain', 'src/app/sub']);
  });

  it('refuses a merge into a directory that holds only a test file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/probe/only.test.ts', test: true }] };
    expect(staleReasons(scan, [{ kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/probe' }])).toEqual(['src/probe already exists']);
  });

  it('treats a test file as a taken path for a create and a rename', () => {
    expect(
      staleReasons(LAYERED, [
        { kind: 'create-package', path: 'src/app/a.test.ts' },
        { kind: 'rename-file', from: 'src/app/b.ts', to: 'a.test.ts' },
      ]),
    ).toEqual(['src/app/a.test.ts already exists', 'src/app/a.test.ts already exists']);
  });

  it('refuses a move onto an existing test file of the same name', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.test.ts', test: true },
        { path: 'src/infra/a.test.ts', test: true },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    expect(staleReasons(scan, [{ kind: 'move-file', file: 'src/app/a.test.ts', to: 'src/infra' }])).toEqual(['src/infra/a.test.ts already exists']);
  });

  it('refuses a merge into a test file', () => {
    expect(staleReasons(LAYERED, [{ kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/app/a.test.ts' }])).toEqual([
      'src/app/a.test.ts already exists',
    ]);
  });

  it('renames a test file', () => {
    const edit: PlanEdit = { kind: 'rename-file', from: 'src/app/a.test.ts', to: 'spec.ts' };
    expect(staleReasons(LAYERED, [edit])).toEqual([null]);
    const planned = applyPlan(LAYERED, [edit]);
    expect(pathsOf(planned)).toContain('src/app/spec.ts');
    expect(pathsOf(planned)).not.toContain('src/app/a.test.ts');
  });

  it('deletes a test file', () => {
    const edit: PlanEdit = { kind: 'fate', file: 'src/app/a.test.ts', fate: 'delete' };
    expect(staleReasons(LAYERED, [edit])).toEqual([null]);
    expect(applyPlan(LAYERED, [edit]).deleted).toEqual(['src/app/a.test.ts']);
  });

  it('folds a file into a test file', () => {
    const edit: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/a.test.ts' };
    expect(staleReasons(LAYERED, [edit])).toEqual([null]);
    expect(pathsOf(applyPlan(LAYERED, [edit]))).not.toContain('src/app/b.ts');
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

  it('warns about an empty part whose name is a prefix of a file left beside it', () => {
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts', 'src/app/a.test.ts', 'src/app/save.ts'] },
        { name: 'b', files: [] },
      ],
    };
    const report = planReport(LAYERED, [split], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'src/app/b' }]]);
    expect(pathsOf(report.scan)).toContain('src/app/b.ts');
  });

  it('warns about an empty package on the edit that created it, not the first edit', () => {
    const report = planReport(LAYERED, [MOVE_SAVE, CREATE_PORTS], noCycles);
    expect(report.warnings).toEqual([[], [{ kind: 'empty-package', path: 'src/ports' }]]);
  });

  it('does not warn that a package is empty when its only file is deleted', () => {
    const edits: PlanEdit[] = [CREATE_PORTS, { kind: 'move-file', file: 'src/app/save.ts', to: 'src/ports' }, { kind: 'fate', file: 'src/ports/save.ts', fate: 'delete' }];
    const report = planReport(LAYERED, edits, noCycles);
    expect(report.warnings).toEqual([[], [], []]);
    expect(graphView(report.scan, 'src', 'repo')?.nodes.find(node => node.id === 'src/ports')).toMatchObject({ kind: 'package', files: 1 });
  });

  it('warns about an empty package nested under one a move has filled', () => {
    const report = planReport(
      LAYERED,
      [CREATE_PORTS, { kind: 'create-package', path: 'src/ports/deep' }, { kind: 'move-file', file: 'src/domain/shape.ts', to: 'src/ports' }],
      noCycles,
    );
    expect(report.warnings).toEqual([[], [{ kind: 'empty-package', path: 'src/ports/deep' }], []]);
  });

  it('warns about an empty package created at the root', () => {
    const report = planReport(LAYERED, [{ kind: 'create-package', path: 'top' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'top' }]]);
  });

  it('warns when the only new cycle is drawn at an intermediate directory', () => {
    const scan: ScanResult = {
      files: [
        { path: 'w/x/y/a.ts', test: false },
        { path: 'w/x/z/b.ts', test: false },
      ],
      edges: [{ from: 'w/x/y/a.ts', to: 'w/x/z/b.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const report = planReport(scan, [{ kind: 'add-edge', from: 'w/x/z', to: 'w/x/y' }], cycleTexts);
    expect(report.stale).toEqual([null]);
    expect(report.warnings).toEqual([[{ kind: 'added-cycle', cycle: 'y → z → y' }]]);
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

  it('does not warn about a cycle a later cut removes', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a/p.ts', test: false },
        { path: 'b/q.ts', test: false },
      ],
      edges: [{ from: 'a/p.ts', to: 'b/q.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const report = planReport(
      scan,
      [
        { kind: 'add-edge', from: 'b', to: 'a' },
        { kind: 'cut-edge', from: 'a', to: 'b', files: [['a/p.ts', 'b/q.ts']] },
      ],
      cycleTexts,
    );
    expect(report.stale).toEqual([null, null]);
    expect(report.warnings).toEqual([[], []]);
  });

  it('puts a restored cycle on the edit that first added it, not the move that brings it back', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a/p.ts', test: false },
        { path: 'b/q.ts', test: false },
        { path: 'b/stay.ts', test: false },
      ],
      edges: [{ from: 'a/p.ts', to: 'b/q.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [],
    };
    const add: PlanEdit = { kind: 'add-edge', from: 'b', to: 'a' };
    const away: PlanEdit = { kind: 'move-file', file: 'b/q.ts', to: 'a' };
    const back: PlanEdit = { kind: 'move-file', file: 'a/q.ts', to: 'b' };
    expect(cycleTexts(applyPlan(scan, [add]))).toEqual(['a → b → a']);
    expect(cycleTexts(applyPlan(scan, [add, away]))).toEqual([]);
    expect(cycleTexts(applyPlan(scan, [add, away, back]))).toEqual(['a → b → a']);
    const report = planReport(scan, [add, away, back], cycleTexts);
    expect(report.stale).toEqual([null, null, null]);
    expect(report.warnings).toEqual([[{ kind: 'added-cycle', cycle: 'a → b → a' }], [], []]);
  });

  it('warns about a deleted file that is still imported, with its distinct importers sorted', () => {
    const twice: ScanResult = { ...LAYERED, edges: [...LAYERED.edges, { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'type' }] };
    const report = planReport(twice, [{ kind: 'fate', file: 'src/app/a.ts', fate: 'delete' }, { kind: 'fate', file: 'src/app/save.ts', fate: 'delete' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/app/a.ts', importers: ['src/app/a.test.ts', 'src/app/b.ts'] }], []]);
  });

  it('counts a heritage edge as an import of the deleted file', () => {
    const report = planReport(LAYERED, [{ kind: 'fate', file: 'src/domain/shape.ts', fate: 'delete' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/domain/shape.ts', importers: ['src/infra/repo.ts'] }]]);
  });

  it('does not count an import of a longer path as an import of the deleted file', () => {
    const scan: ScanResult = {
      ...LAYERED,
      files: [...LAYERED.files, { path: 'src/app/a.ts.bak', test: false }],
      edges: [...LAYERED.edges, { from: 'src/infra/db.ts', to: 'src/app/a.ts.bak', kind: 'runtime' }],
    };
    const report = planReport(scan, [{ kind: 'fate', file: 'src/app/a.ts', fate: 'delete' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/app/a.ts', importers: ['src/app/a.test.ts', 'src/app/b.ts'] }]]);
  });

  it('counts a file that imports itself and not an edge into a path under that file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/a.ts', test: false },
        { path: 'src/b.ts', test: false },
        { path: 'src/a.ts/nested.ts', test: false },
      ],
      edges: [
        { from: 'src/a.ts', to: 'src/a.ts', kind: 'runtime' },
        { from: 'src/b.ts', to: 'src/a.ts/nested.ts', kind: 'runtime' },
      ],
      externals: [],
      workspaces: [],
    };
    const report = planReport(scan, [{ kind: 'fate', file: 'src/a.ts', fate: 'delete' }], noCycles);
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/a.ts', importers: ['src/a.ts'] }]]);
  });

  it('deletes a file whose path extends an already deleted file', () => {
    const scan: ScanResult = { ...LAYERED, files: [...LAYERED.files, { path: 'src/app/a.ts.bak', test: false }] };
    const edits: PlanEdit[] = [
      { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' },
      { kind: 'fate', file: 'src/app/a.ts.bak', fate: 'delete' },
    ];
    const report = planReport(scan, edits, noCycles);
    expect(report.stale).toEqual([null, null]);
    expect(report.scan.deleted).toEqual(['src/app/a.ts', 'src/app/a.ts.bak']);
  });

  it('names a deleted file that still imports another deleted file', () => {
    const report = planReport(
      LAYERED,
      [
        { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' },
        { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      ],
      noCycles,
    );
    expect(report.warnings).toEqual([
      [{ kind: 'deleted-imports', file: 'src/app/a.ts', importers: ['src/app/a.test.ts', 'src/app/b.ts'] }],
      [{ kind: 'deleted-imports', file: 'src/app/b.ts', importers: ['src/app/a.ts'] }],
    ]);
  });

  it('names the importers a fold leaves on the deleted file it landed on', () => {
    const report = planReport(
      LAYERED,
      [
        { kind: 'fate', file: 'src/domain/shape.ts', fate: 'delete' },
        { kind: 'fate', file: 'src/infra/repo.ts', fate: 'fold', into: 'src/domain/shape.ts' },
      ],
      noCycles,
    );
    expect(report.warnings).toEqual([
      [{ kind: 'deleted-imports', file: 'src/domain/shape.ts', importers: ['src/app/a.ts'] }],
      [],
    ]);
  });

  it('names the importers a later rename gives the deleted file', () => {
    const report = planReport(
      LAYERED,
      [
        { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
        { kind: 'rename-file', from: 'src/app/a.ts', to: 'z.ts' },
      ],
      noCycles,
    );
    expect(report.warnings).toEqual([[{ kind: 'deleted-imports', file: 'src/app/b.ts', importers: ['src/app/z.ts'] }], []]);
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

  it('keeps a declared package under a package that is split, and warns on the create', () => {
    const report = planReport(LAYERED, [{ kind: 'create-package', path: 'src/app/spare' }, SPLIT_APP], noCycles);
    expect(report.scan.declared).toEqual(['src/app/read', 'src/app/spare', 'src/app/write']);
    expect(report.warnings).toEqual([[{ kind: 'empty-package', path: 'src/app/spare' }], []]);
  });

  it('splits an empty created package into empty parts and keeps the package declared', () => {
    const report = planReport(LAYERED, [
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'split-package', package: 'src/ports', parts: [{ name: 'a', files: [] }, { name: 'b', files: [] }] },
    ], noCycles);
    expect(report.stale).toEqual([null, null]);
    expect(report.scan.declared).toEqual(['src/ports', 'src/ports/a', 'src/ports/b']);
    expect(report.warnings).toEqual([
      [{ kind: 'empty-package', path: 'src/ports' }],
      [{ kind: 'empty-package', path: 'src/ports/a' }, { kind: 'empty-package', path: 'src/ports/b' }],
    ]);
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
