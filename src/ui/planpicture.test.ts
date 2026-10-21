import { describe, expect, it, vi } from 'vitest';
import type { GraphNode, GraphView } from '../domain/graph.ts';
import * as layout from '../domain/layout.ts';
import type { PlanEdit } from '../domain/plan.ts';
import { arrowViewAt, entryTarget, planPicture, proposalInk, type ProposalInput } from './planpicture.ts';

const MOVE: PlanEdit = { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' };
const CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const ADD: PlanEdit = { kind: 'add-edge', from: 'src/infra', to: 'src/app' };
const NOTE_NODE: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' };
const NOTE_EDGE: PlanEdit = { kind: 'note', target: { edge: ['src/app', 'src/infra'] }, text: 'keep this' };

function fileNode(id: string, row = 0, order = 0): GraphNode {
  return { id, kind: 'file', name: id.slice(id.lastIndexOf('/') + 1), path: id, row, order, cycle: false };
}

function packageNode(id: string): GraphNode {
  return { id, kind: 'package', name: id.slice(id.lastIndexOf('/') + 1), path: id, files: 1, row: 0, order: 0, cycle: false };
}

function viewOf(nodes: GraphNode[]): GraphView {
  return { at: '', crumbs: [], nodes, edges: [], crapMax: 4, coverage: 'off', mutation: 'off' };
}

function picture(over: Partial<Parameters<typeof planPicture>[0]> = {}) {
  return planPicture({
    shown: 'planned',
    nodes: [],
    other: undefined,
    pins: {},
    edits: [],
    stale: undefined,
    edges: [],
    ids: new Set<string>(),
    packages: [],
    warnings: undefined,
    ...over,
  });
}

describe('the change list', () => {
  it('aligns reasons with the edits, filling gaps with null', () => {
    expect(picture({ edits: [MOVE, CUT], stale: undefined }).entries.map(entry => entry.stale)).toEqual([null, null]);
    expect(picture({ edits: [MOVE, CUT], stale: ['gone'] }).entries.map(entry => entry.stale)).toEqual(['gone', null]);
    expect(picture({ edits: [MOVE, CUT], stale: [null, 'stale'] }).entries.map(entry => entry.stale)).toEqual([null, 'stale']);
  });

  it('builds sentences with the edit and the reason attached', () => {
    expect(picture({ edits: [MOVE, CUT, ADD, NOTE_NODE, NOTE_EDGE], stale: [null, 'stale', null, null, null] }).entries).toEqual([
      { edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null, warnings: [] },
      { edit: CUT, sentence: 'src/app must not import src/domain (1 import)', stale: 'stale', warnings: [] },
      { edit: ADD, sentence: 'src/infra should use src/app', stale: null, warnings: [] },
      { edit: NOTE_NODE, sentence: 'Note on src/domain: "pull an interface out here"', stale: null, warnings: [] },
      { edit: NOTE_EDGE, sentence: 'Note on src/app → src/infra: "keep this"', stale: null, warnings: [] },
    ]);
    expect(picture({ edits: [MOVE], stale: [] }).entries).toEqual([{ edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null, warnings: [] }]);
  });
});

describe('change warnings', () => {
  it('words each warning under its edit', () => {
    const warnings = [
      [{ kind: 'empty-package' as const, path: 'src/ports' }],
      [{ kind: 'deleted-imports' as const, file: 'src/a.ts', importers: ['src/b.ts'] }],
      [{ kind: 'deleted-imports' as const, file: 'src/m.ts', importers: ['src/b.ts', 'src/c.ts'] }],
      [{ kind: 'added-cycle' as const, cycle: 'read → write → read' }],
    ];
    expect(picture({ edits: [MOVE, MOVE, MOVE, MOVE, MOVE], warnings }).entries.map(entry => entry.warnings)).toEqual([
      [{ text: 'src/ports is empty', importers: [] }],
      [{ text: '1 file still imports src/a.ts, which this plan deletes', importers: ['src/b.ts'] }],
      [{ text: '2 files still import src/m.ts, which this plan deletes', importers: ['src/b.ts', 'src/c.ts'] }],
      [{ text: 'this plan adds a cycle: read → write → read', importers: [] }],
      [],
    ]);
  });

  it('lists every warning on one edit, an empty package before a cycle', () => {
    const warnings = [[
      { kind: 'empty-package' as const, path: 'src/ports' },
      { kind: 'added-cycle' as const, cycle: 'read → write → read' },
    ]];
    expect(picture({ edits: [MOVE], warnings }).entries[0].warnings).toEqual([
      { text: 'src/ports is empty', importers: [] },
      { text: 'this plan adds a cycle: read → write → read', importers: [] },
    ]);
  });
});

describe('diskPath', () => {
  it('unmoves a moved file, newest first, skipping stale moves', () => {
    expect(picture().diskPath('src/app/save.ts')).toBe('src/app/save.ts');
    expect(picture({ edits: [MOVE], stale: [null] }).diskPath('src/infra/save.ts')).toBe('src/app/save.ts');
    expect(picture({ edits: [MOVE], stale: ['no such file src/app/save.ts'] }).diskPath('src/infra/save.ts')).toBe('src/infra/save.ts');
    expect(picture({ edits: [MOVE], stale: [null] }).diskPath('src/app/a.ts')).toBe('src/app/a.ts');
    const second: PlanEdit = { kind: 'move-file', file: 'src/infra/save.ts', to: '.' };
    expect(picture({ edits: [MOVE, second], stale: [null, null] }).diskPath('save.ts')).toBe('src/app/save.ts');
    expect(picture({ edits: [MOVE, NOTE_NODE], stale: [null, null] }).diskPath('src/infra/save.ts')).toBe('src/app/save.ts');
    expect(picture({ edits: [MOVE], stale: [] }).diskPath('src/infra/save.ts')).toBe('src/app/save.ts');
  });
});

describe('entryTarget', () => {
  it('maps each edit kind to its canvas target', () => {
    expect(entryTarget(MOVE)).toEqual({ kind: 'node', id: 'src/infra/save.ts' });
    expect(entryTarget({ kind: 'move-file', file: 'src/app/save.ts', to: '.' })).toEqual({ kind: 'node', id: 'save.ts' });
    expect(entryTarget(CUT)).toEqual({ kind: 'arrow', from: 'src/app', to: 'src/domain', cut: true });
    expect(entryTarget(ADD)).toEqual({ kind: 'arrow', from: 'src/infra', to: 'src/app', cut: false });
    expect(entryTarget(NOTE_NODE)).toEqual({ kind: 'node', id: 'src/domain' });
    expect(entryTarget(NOTE_EDGE)).toEqual({ kind: 'arrow', from: 'src/app', to: 'src/infra', cut: false });
  });

  it('maps each package edit and fate to the box it leaves behind', () => {
    const split: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: [] }, { name: 'write', files: [] }] };
    expect(entryTarget({ kind: 'create-package', path: 'src/ports' })).toEqual({ kind: 'box', id: 'src/ports' });
    expect(entryTarget({ kind: 'rename-package', from: 'src/infra', to: 'src/adapters' })).toEqual({ kind: 'box', id: 'src/adapters' });
    expect(entryTarget({ kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' })).toEqual({ kind: 'box', id: 'src/app/writer.ts' });
    expect(entryTarget({ kind: 'merge-packages', packages: ['src/a', 'src/b'], into: 'src/c' })).toEqual({ kind: 'box', id: 'src/c' });
    expect(entryTarget(split)).toEqual({ kind: 'box', id: 'src/app/read' });
    expect(entryTarget({ kind: 'fate', file: 'src/a.ts', fate: 'delete' })).toEqual({ kind: 'box', id: 'src/a.ts' });
    expect(entryTarget({ kind: 'fate', file: 'src/a.ts', fate: 'fold', into: 'src/b.ts' })).toEqual({ kind: 'box', id: 'src/b.ts' });
  });
});

describe('arrowViewAt', () => {
  it('holds both boxes, or falls back to the root', () => {
    expect(arrowViewAt('src/app', 'src/domain')).toBe('src');
    expect(arrowViewAt('src/app/a.ts', 'src/app/b.ts')).toBe('src/app');
    expect(arrowViewAt('src/app/a.ts', 'src/infra/db.ts')).toBe('');
    expect(arrowViewAt('a.ts', 'b.ts')).toBe('');
  });
});

describe('package rows', () => {
  it('keeps only file nodes of a loaded view', () => {
    const pack = picture({
      shown: 'planned',
      packages: [{ id: 'src/app', now: viewOf([packageNode('src/app'), fileNode('src/app/a.ts')]), planned: viewOf([packageNode('src/app'), fileNode('src/app/a.ts')]) }],
    });
    expect(pack.ink.rows.get('src/app')).toEqual([{ path: 'src/app/a.ts', name: 'a.ts', ghost: false, deleted: false }]);
    const missing = picture({
      packages: [
        { id: 'src/app', now: undefined, planned: undefined },
        { id: 'src/infra', now: { error: 'no such directory' }, planned: { error: 'no such directory' } },
      ],
    });
    expect(missing.ink.rows.get('src/app')).toEqual([]);
    expect(missing.ink.rows.get('src/infra')).toEqual([]);
  });

  it('marks a deleted file on its real row and never on its ghost', () => {
    const doomed: GraphNode = { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: false, fate: 'delete' };
    const planned = viewOf([doomed]);
    const now = viewOf([fileNode('src/app/b.ts')]);
    expect(picture({ shown: 'planned', packages: [{ id: 'src/app', now, planned }] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: false, deleted: true },
      { path: 'src/app/b.ts', name: 'b.ts', ghost: true, deleted: false },
    ]);
    expect(picture({ shown: 'now', packages: [{ id: 'src/app', now, planned }] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/a.ts', name: 'a.ts', ghost: true, deleted: false },
    ]);
  });

  it('sorts real rows by name and appends ghost rows for files the shown view lacks', () => {
    const planned = viewOf([fileNode('src/app/b.ts'), fileNode('src/app/a.ts')]);
    const now = viewOf([fileNode('src/app/a.ts'), fileNode('src/app/save.ts'), fileNode('src/app/b.ts')]);
    expect(picture({ shown: 'planned', packages: [{ id: 'src/app', now, planned }] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: false, deleted: false },
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
    expect(picture({ packages: [{ id: 'src/app', now: viewOf([]), planned: viewOf([]) }] }).ink.rows.get('src/app')).toEqual([]);
    const twins = viewOf([fileNode('a/x.ts'), fileNode('b/x.ts')]);
    expect(picture({ shown: 'now', packages: [{ id: 'src', now: twins, planned: viewOf([]) }] }).ink.rows.get('src')).toEqual([
      { path: 'a/x.ts', name: 'x.ts', ghost: false, deleted: false },
      { path: 'b/x.ts', name: 'x.ts', ghost: false, deleted: false },
    ]);
    expect(picture({ shown: 'planned', packages: [{ id: 'src/app', now, planned: viewOf([]) }] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: true, deleted: false },
      { path: 'src/app/b.ts', name: 'b.ts', ghost: true, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
  });
});

describe('a fold leaves no ghost', () => {
  const FOLD: PlanEdit = { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/b.ts' };
  const NOW = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/b.ts', 0, 1), fileNode('src/app/save.ts', 0, 2)]);
  const PLANNED = viewOf([fileNode('src/app/b.ts', 0, 1)]);

  it('drops the row and the box of a file a non-stale fold removed', () => {
    const pack = [{ id: 'src/app', now: NOW, planned: PLANNED }];
    expect(picture({ packages: pack, edits: [FOLD], stale: [null] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
    expect(picture({ nodes: PLANNED.nodes, other: NOW, edits: [FOLD], stale: [null] }).ink.ghosts).toEqual([
      { id: 'src/app/save.ts', name: 'save.ts', x: 520, y: 0 },
    ]);
  });

  it('keeps the ghost when the fold is stale', () => {
    const pack = [{ id: 'src/app', now: NOW, planned: PLANNED }];
    expect(picture({ packages: pack, edits: [FOLD], stale: ['no such file src/app/a.ts'] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/a.ts', name: 'a.ts', ghost: true, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
  });

  it('keeps a ghost for a file no fold took, in Now too', () => {
    const pack = [{ id: 'src/app', now: viewOf([fileNode('src/app/b.ts')]), planned: NOW }];
    expect(picture({ shown: 'now', packages: pack, edits: [FOLD], stale: [null] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/a.ts', name: 'a.ts', ghost: true, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
  });

  it('follows the file through the earlier edit that moved or renamed it', () => {
    const empty = viewOf([]);
    const pack = [{ id: 'src/app', now: viewOf([fileNode('src/app/save.ts')]), planned: empty }];
    const renamed: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' };
    const foldWriter: PlanEdit = { kind: 'fate', file: 'src/app/writer.ts', fate: 'fold', into: 'src/app/a.ts' };
    expect(picture({ packages: pack, edits: [renamed, foldWriter], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const moved: PlanEdit = { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' };
    const foldMoved: PlanEdit = { kind: 'fate', file: 'src/infra/save.ts', fate: 'fold', into: 'src/infra/db.ts' };
    expect(picture({ packages: pack, edits: [moved, foldMoved], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const renamedPkg: PlanEdit = { kind: 'rename-package', from: 'src/app', to: 'src/adapters' };
    const foldRenamed: PlanEdit = { kind: 'fate', file: 'src/adapters/save.ts', fate: 'fold', into: 'src/adapters/a.ts' };
    expect(picture({ packages: pack, edits: [renamedPkg, foldRenamed], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const merged: PlanEdit = { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/core' };
    const foldMerged: PlanEdit = { kind: 'fate', file: 'src/core/save.ts', fate: 'fold', into: 'src/core/db.ts' };
    expect(picture({ packages: pack, edits: [merged, foldMerged], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const split: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/save.ts'] }, { name: 'write', files: [] }] };
    const foldSplit: PlanEdit = { kind: 'fate', file: 'src/app/read/save.ts', fate: 'fold', into: 'src/app/read/a.ts' };
    expect(picture({ packages: pack, edits: [split, foldSplit], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
  });

  it('follows a nested path through a merge', () => {
    const deep = [{ id: 'src/app', now: viewOf([fileNode('src/app/deep/save.ts')]), planned: viewOf([]) }];
    const merged: PlanEdit = { kind: 'merge-packages', packages: ['src/app', 'src/infra'], into: 'src/core' };
    const foldMerged: PlanEdit = { kind: 'fate', file: 'src/core/deep/save.ts', fate: 'fold', into: 'src/core/db.ts' };
    expect(picture({ packages: deep, edits: [merged, foldMerged], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
  });

  it('follows a nested path and does not rename a prefix sibling', () => {
    const empty = viewOf([]);
    const deep = [{ id: 'src/app', now: viewOf([fileNode('src/app/deep/save.ts')]), planned: empty }];
    const renamedPkg: PlanEdit = { kind: 'rename-package', from: 'src/app', to: 'src/adapters' };
    const foldDeep: PlanEdit = { kind: 'fate', file: 'src/adapters/deep/save.ts', fate: 'fold', into: 'src/adapters/a.ts' };
    expect(picture({ packages: deep, edits: [renamedPkg, foldDeep], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const splitDeep: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [{ name: 'read', files: ['src/app/deep/save.ts'] }, { name: 'write', files: [] }],
    };
    const foldSplitDeep: PlanEdit = { kind: 'fate', file: 'src/app/read/deep/save.ts', fate: 'fold', into: 'src/app/read/a.ts' };
    expect(picture({ packages: deep, edits: [splitDeep, foldSplitDeep], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
    const apple = [{ id: 'src/apple', now: viewOf([fileNode('src/apple/save.ts')]), planned: empty }];
    const foldApple: PlanEdit = { kind: 'fate', file: 'src/apple/save.ts', fate: 'fold', into: 'src/apple/a.ts' };
    expect(picture({ packages: apple, edits: [renamedPkg, foldApple], stale: [null, null] }).ink.rows.get('src/apple')).toEqual([]);
  });

  it('steps through the edits that leave a path alone', () => {
    const edits: PlanEdit[] = [
      CUT,
      ADD,
      NOTE_NODE,
      NOTE_EDGE,
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'move-file', file: 'src/app/other.ts', to: 'src/infra' },
      { kind: 'rename-file', from: 'src/app/other.ts', to: 'thing.ts' },
      { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' },
      { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/other.ts'] }, { name: 'write', files: [] }] },
      { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' },
      FOLD,
      NOTE_NODE,
    ];
    const stale = edits.map(() => null);
    expect(picture({ packages: [{ id: 'src/app', now: NOW, planned: PLANNED }], edits, stale }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false, deleted: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
  });

  it('folds a same-named file in another package after a rename', () => {
    const lib = [{ id: 'src/lib', now: viewOf([fileNode('src/lib/save.ts')]), planned: viewOf([]) }];
    const renamed: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' };
    const foldLib: PlanEdit = { kind: 'fate', file: 'src/lib/save.ts', fate: 'fold', into: 'src/lib/a.ts' };
    expect(picture({ packages: lib, edits: [renamed, foldLib], stale: [null, null] }).ink.rows.get('src/lib')).toEqual([]);
  });

  it('folds a same-named file in another package after a move', () => {
    const lib = [{ id: 'src/lib', now: viewOf([fileNode('src/lib/save.ts')]), planned: viewOf([]) }];
    const moved: PlanEdit = { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' };
    const foldLib: PlanEdit = { kind: 'fate', file: 'src/lib/save.ts', fate: 'fold', into: 'src/lib/a.ts' };
    expect(picture({ packages: lib, edits: [moved, foldLib], stale: [null, null] }).ink.rows.get('src/lib')).toEqual([]);
  });

  it('leaves the ghost of a longer path a move, rename or fold did not name', () => {
    const now = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/a.ts.bak', 0, 1)]);
    const pack = [{ id: 'src/app', now, planned: viewOf([]) }];
    const bak = { path: 'src/app/a.ts.bak', name: 'a.ts.bak', ghost: true, deleted: false };
    const fold: PlanEdit = { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/b.ts' };
    const renamed: PlanEdit = { kind: 'rename-file', from: 'src/app/a.ts', to: 'b.ts' };
    const foldRenamed: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/c.ts' };
    const moved: PlanEdit = { kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' };
    const foldMoved: PlanEdit = { kind: 'fate', file: 'src/infra/a.ts', fate: 'fold', into: 'src/infra/db.ts' };
    const left = (edits: PlanEdit[]) => picture({ packages: pack, edits, stale: edits.map(() => null) }).ink.rows.get('src/app');
    expect(left([fold])).toEqual([bak]);
    expect(left([renamed, foldRenamed])).toEqual([bak]);
    expect(left([moved, foldMoved])).toEqual([bak]);
    const boxes = (edits: PlanEdit[]) => picture({ nodes: [], other: now, edits, stale: edits.map(() => null) }).ink.ghosts.map(box => box.id);
    expect(boxes([fold])).toEqual(['src/app/a.ts.bak']);
    expect(boxes([renamed, foldRenamed])).toEqual(['src/app/a.ts.bak']);
    expect(boxes([moved, foldMoved])).toEqual(['src/app/a.ts.bak']);
  });

  it('drops the ghost of a longer path a later split part listed', () => {
    const now = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/a.ts.bak', 0, 1)]);
    const pack = [{ id: 'src/app', now, planned: viewOf([]) }];
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts'] },
        { name: 'write', files: ['src/app/a.ts.bak'] },
      ],
    };
    const fold: PlanEdit = { kind: 'fate', file: 'src/app/write/a.ts.bak', fate: 'fold', into: 'src/app/write/b.ts' };
    const edits = [split, fold];
    const stale = edits.map(() => null);
    const kept = { path: 'src/app/a.ts', name: 'a.ts', ghost: true, deleted: false };
    expect(picture({ packages: pack, edits, stale }).ink.rows.get('src/app')).toEqual([kept]);
    expect(picture({ nodes: [], other: now, edits, stale }).ink.ghosts).toEqual([{ id: 'src/app/a.ts', name: 'a.ts', x: 0, y: 0 }]);
  });

  it('keeps the ghost of a same-named file a fold did not name', () => {
    const packages = [
      { id: 'src/app', now: viewOf([fileNode('src/app/a.ts')]), planned: viewOf([]) },
      { id: 'src/lib', now: viewOf([fileNode('src/lib/a.ts')]), planned: viewOf([]) },
    ];
    const fold: PlanEdit = { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/b.ts' };
    const rows = picture({ packages, edits: [fold], stale: [null] }).ink.rows;
    expect(rows.get('src/app')).toEqual([]);
    expect(rows.get('src/lib')).toEqual([{ path: 'src/lib/a.ts', name: 'a.ts', ghost: true, deleted: false }]);
  });

  it('follows a file listed in a later split part', () => {
    const deep = [{ id: 'src/app', now: viewOf([fileNode('src/app/deep/save.ts')]), planned: viewOf([]) }];
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: [] },
        { name: 'write', files: ['src/app/deep/save.ts'] },
      ],
    };
    const foldWrite: PlanEdit = { kind: 'fate', file: 'src/app/write/deep/save.ts', fate: 'fold', into: 'src/app/write/a.ts' };
    expect(picture({ packages: deep, edits: [split, foldWrite], stale: [null, null] }).ink.rows.get('src/app')).toEqual([]);
  });

  it('does not apply a stale rename before a later fold', () => {
    const pack = [{ id: 'src/app', now: viewOf([fileNode('src/app/save.ts')]), planned: viewOf([]) }];
    const renamed: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' };
    const foldSave: PlanEdit = { kind: 'fate', file: 'src/app/save.ts', fate: 'fold', into: 'src/app/a.ts' };
    const foldWriter: PlanEdit = { kind: 'fate', file: 'src/app/writer.ts', fate: 'fold', into: 'src/app/a.ts' };
    const stale = ['no such file src/app/save.ts', null];
    expect(picture({ packages: pack, edits: [renamed, foldSave], stale }).ink.rows.get('src/app')).toEqual([]);
    expect(picture({ packages: pack, edits: [renamed, foldWriter], stale }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true, deleted: false },
    ]);
  });
});

describe('ghosts, notes, cuts and added arrows', () => {
  it('places a ghost where the other graph has the file, honouring pins', () => {
    const other = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/b.ts', 0, 1), fileNode('src/app/save.ts', 0, 2)]);
    const ghosts = picture({ nodes: [fileNode('src/app/a.ts', 0, 0), fileNode('src/app/b.ts', 0, 1)], other, pins: {} }).ink.ghosts;
    expect(ghosts).toEqual([{ id: 'src/app/save.ts', name: 'save.ts', x: 520, y: 0 }]);
    const pinned = picture({
      nodes: [fileNode('src/app/a.ts', 0, 0)],
      other,
      pins: { 'src/app/b.ts': { x: 0, y: 280 } },
    }).ink.ghosts;
    expect(pinned).toEqual([
      { id: 'src/app/b.ts', name: 'b.ts', x: 0, y: 280 },
      { id: 'src/app/save.ts', name: 'save.ts', x: 520, y: 0 },
    ]);
    expect(picture({ nodes: [packageNode('src/app')], other: viewOf([packageNode('src/app')]) }).ink.ghosts).toEqual([]);
    expect(picture({ nodes: [], other: viewOf([packageNode('src/app')]) }).ink.ghosts).toEqual([]);
    expect(picture({ nodes: [fileNode('src/app/a.ts')], other: undefined }).ink.ghosts).toEqual([]);
    expect(picture({ nodes: [fileNode('src/app/a.ts')], other: { error: 'no such directory' } }).ink.ghosts).toEqual([]);
    const partial = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/save.ts', 0, 1)]);
    const spy = vi.spyOn(layout, 'arrange').mockReturnValue([{ id: 'src/app/a.ts', x: 0, y: 0 }]);
    expect(picture({ nodes: [], other: partial }).ink.ghosts).toEqual([{ id: 'src/app/a.ts', name: 'a.ts', x: 0, y: 0 }]);
    spy.mockRestore();
  });

  it('collects the non-stale notes and cuts and skips stale edits', () => {
    const edits = [NOTE_NODE, NOTE_EDGE, CUT, ADD];
    const ids = new Set(['src/domain', 'src/app', 'src/infra']);
    const ink = picture({ shown: 'now', edits, stale: [null, null, null, null], ids }).ink;
    expect(ink.notes.nodes.get('src/domain')).toEqual(['pull an interface out here']);
    expect(ink.notes.edges.get('src/app\nsrc/infra')).toEqual(['keep this']);
    const staleInk = picture({ edits, stale: ['gone', null, null, null], ids }).ink;
    expect(staleInk.notes.nodes.size).toBe(0);
    expect(ink.cuts).toEqual([{ from: 'src/app', to: 'src/domain' }]);
    expect(picture({ edits, stale: [null, null, 'gone', null], ids }).ink.cuts).toEqual([]);
    const second: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'again' };
    expect(picture({ edits: [NOTE_NODE, second], stale: [null, null] }).ink.notes.nodes.get('src/domain')).toEqual(['pull an interface out here', 'again']);
  });

  it('draws an added arrow as a marker unless the view already has it', () => {
    const ids = new Set(['src/infra', 'src/app', 'src/domain']);
    const edges = [{ from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false }];
    expect(picture({ shown: 'now', edits: [ADD], stale: [null], edges: [], ids }).ink.added).toEqual([
      { from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false, planned: true },
    ]);
    expect(picture({ shown: 'now', edits: [ADD], stale: [null], edges, ids }).ink.added).toEqual([]);
    const sameTo = [{ from: 'src/domain', to: 'src/app', runtime: 0, type: 0, cycle: false }];
    expect(picture({ shown: 'now', edits: [ADD], stale: [null], edges: sameTo, ids }).ink.added).toEqual([
      { from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false, planned: true },
    ]);
    expect(picture({ shown: 'now', edits: [ADD], stale: [null], edges: undefined, ids }).ink.added).toEqual([
      { from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false, planned: true },
    ]);
    expect(picture({ shown: 'now', edits: [ADD], stale: ['gone'], edges: [], ids }).ink.added).toEqual([]);
    expect(picture({ shown: 'planned', edits: [ADD], stale: [null], edges: [], ids }).ink.added).toEqual([]);
    expect(picture({ shown: 'now', edits: [CUT], stale: [null], ids: new Set(['src/app', 'src/domain']) }).ink.cuts).toEqual([{ from: 'src/app', to: 'src/domain' }]);
    expect(picture({ shown: 'now', edits: [CUT], stale: [null], ids: new Set(['src/app']) }).ink.cuts).toEqual([]);
  });
});

describe('proposalInk', () => {
  function placed(id: string, kind: 'file' | 'package', row: number, order: number): GraphNode {
    const name = id.slice(id.lastIndexOf('/') + 1);
    if (kind === 'package') return { id, kind, name, path: id, row, order, cycle: false, files: 1 };
    return { id, kind, name, path: id, row, order, cycle: false };
  }

  function view(nodes: GraphNode[]): GraphView {
    return { at: '', crumbs: [], nodes, edges: [], crapMax: 4, coverage: 'off', mutation: 'off' };
  }

  function ink(over: Partial<ProposalInput> = {}) {
    return proposalInk({ shown: 'planned', planned: [], pins: {}, proposal: view([]), children: [], edits: [], hover: null, ...over });
  }

  const empty = { boxes: [], rows: [], strikes: [], cuts: [], arrows: [] };
  const app = placed('src/app', 'package', 0, 0);
  const infra = placed('src/infra', 'package', 1, 0);
  const domain = placed('src/domain', 'package', 2, 0);

  it('draws nothing for the current graph, a missing proposal, a note, or an edit that owns no box', () => {
    const note: PlanEdit = { kind: 'note', target: { node: 'src/app' }, text: 'three jobs' };
    expect(ink({ shown: 'now', edits: [{ index: 0, edit: note }] })).toEqual(empty);
    expect(ink({ proposal: null, edits: [{ index: 0, edit: note }] })).toEqual(empty);
    expect(ink({ proposal: view([placed('src/ports', 'package', 0, 1)]), edits: [] })).toEqual(empty);
    expect(ink({ planned: [app], proposal: view([app, placed('src/extra', 'package', 0, 1)]), edits: [{ index: 0, edit: note }] })).toEqual(empty);
  });

  it('places a new box at its cell, then steps right off a taken cell and off an earlier new box', () => {
    const ports = placed('src/ports', 'package', 0, 1);
    const extra = placed('src/extra', 'package', 0, 1);
    const create: PlanEdit = { kind: 'create-package', path: 'src/ports' };
    const move: PlanEdit = { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' };
    const other: PlanEdit = { kind: 'create-package', path: 'src/extra' };
    const planned = [app, infra, domain];
    const open = ink({
      planned,
      proposal: view([...planned, ports]),
      edits: [{ index: 1, edit: create }, { index: 2, edit: move }],
      hover: 1,
      children: [{ id: 'src/ports', planned: null, proposed: view([placed('src/ports/b.ts', 'file', 0, 0)]) }],
    });
    expect(open.boxes).toEqual([{ id: 'src/ports', name: 'ports', x: 260, y: 0, highlight: true, rows: [{ path: 'src/ports/b.ts', name: 'b.ts', highlight: false }] }]);
    const pinned = ink({
      planned,
      pins: { 'src/ports': { x: 10, y: 20 } },
      proposal: view([...planned, ports]),
      edits: [{ index: 0, edit: create }],
    });
    expect(pinned.boxes.map(box => [box.x, box.y])).toEqual([[270, 20]]);
    const both = ink({
      planned,
      proposal: view([...planned, ports, extra]),
      edits: [{ index: 0, edit: create }, { index: 1, edit: other }],
      hover: 0,
    });
    expect(both.boxes.map(box => [box.id, box.x, box.y, box.highlight])).toEqual([
      ['src/ports', 260, 0, true],
      ['src/extra', 520, 0, false],
    ]);
  });

  it('draws a cut and an added arrow only when both ends are in view, and a strike once', () => {
    const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
    const add: PlanEdit = { kind: 'add-edge', from: 'src/domain', to: 'src/app' };
    const away: PlanEdit = { kind: 'cut-edge', from: 'src/missing', to: 'src/app', files: [] };
    const planned = [app, infra, domain];
    const marks = ink({
      planned,
      proposal: view(planned),
      edits: [{ index: 0, edit: cut }, { index: 2, edit: add }, { index: 3, edit: away }],
      hover: 2,
    });
    expect(marks.cuts).toEqual([{ from: 'src/app', to: 'src/domain', highlight: false }]);
    expect(marks.arrows).toEqual([{ from: 'src/domain', to: 'src/app', highlight: true }]);
    const deleted: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' };
    const again: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' };
    const folded: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/a.ts' };
    const strikes = ink({
      planned: [placed('src/infra/db.ts', 'file', 0, 0), placed('src/app/b.ts', 'file', 0, 1)],
      proposal: view([]),
      edits: [{ index: 0, edit: deleted }, { index: 1, edit: again }, { index: 4, edit: folded }],
      hover: 4,
      children: [{
        id: 'src/infra',
        planned: view([]),
        proposed: view([placed('src/infra/db.ts', 'file', 0, 0), placed('src/infra/extra.ts', 'file', 0, 1)]),
      }],
    });
    expect(strikes.strikes).toEqual([
      { id: 'src/infra/db.ts', highlight: false },
      { id: 'src/app/b.ts', highlight: true },
    ]);
    expect(strikes.rows).toEqual([]);
    expect(strikes.boxes).toEqual([]);
  });

  it('draws a split as rows inside the new box, a move as a row in an existing box, and a merge or rename as a new box', () => {
    const split: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'scan', files: [] }, { name: 'jobs', files: ['src/app/a.ts', 'src/app/b.ts'] }] };
    const jobs = placed('src/app/jobs', 'package', 0, 1);
    const splitInk = ink({
      planned: [app],
      proposal: view([app, jobs]),
      edits: [{ index: 0, edit: split }],
      hover: 0,
      children: [{
        id: 'src/app/jobs',
        planned: null,
        proposed: null,
      }, {
        id: 'src/app/jobs',
        planned: view([]),
        proposed: view([placed('src/app/jobs/a.ts', 'file', 0, 0), placed('src/app/jobs/b.ts', 'file', 1, 0)]),
      }],
    });
    expect(splitInk.boxes[0].rows.map(row => row.path)).toEqual(['src/app/jobs/a.ts', 'src/app/jobs/b.ts']);
    expect(splitInk.boxes[0].highlight).toBe(true);
    expect(splitInk.strikes).toEqual([{ id: 'src/app', highlight: true }]);
    const moved: PlanEdit = { kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' };
    const loose = ink({
      planned: [app, infra],
      proposal: view([app, infra]),
      edits: [{ index: 3, edit: moved }],
      hover: 3,
      children: [{ id: 'src/infra', planned: view([placed('src/infra/db.ts', 'file', 0, 0)]), proposed: view([placed('src/infra/db.ts', 'file', 0, 0), placed('src/infra/a.ts', 'file', 1, 0)]) }],
    });
    expect(loose.boxes).toEqual([]);
    expect(loose.rows).toEqual([{ boxId: 'src/infra', path: 'src/infra/a.ts', name: 'a.ts', highlight: true }]);
    const renamed: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/store' };
    const store = placed('src/store', 'package', 1, 1);
    const renameInk = ink({
      planned: [infra],
      proposal: view([store, placed('src/other', 'package', 0, 2)]),
      edits: [{ index: 0, edit: renamed }],
      pins: {},
    });
    expect(renameInk.boxes.map(box => box.id)).toEqual(['src/store']);
    expect(renameInk.strikes).toEqual([{ id: 'src/infra', highlight: false }]);
    const merged: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/kept'], into: 'src/kept' };
    const kept = placed('src/kept', 'package', 0, 1);
    const mergeInk = ink({
      planned: [infra, domain],
      proposal: view([domain, kept]),
      edits: [{ index: 2, edit: merged }],
      hover: 2,
    });
    expect(mergeInk.boxes.map(box => [box.id, box.highlight])).toEqual([['src/kept', true]]);
    expect(mergeInk.strikes.map(mark => mark.id)).toEqual(['src/infra']);
    const fileRename: PlanEdit = { kind: 'rename-file', from: 'src/infra/db.ts', to: 'store.ts' };
    const renamedFile = ink({
      planned: [infra],
      proposal: view([infra]),
      edits: [{ index: 1, edit: fileRename }],
      children: [{ id: 'src/infra', planned: view([placed('src/infra/db.ts', 'file', 0, 0)]), proposed: view([placed('src/infra/store.ts', 'file', 0, 1)]) }],
    });
    expect(renamedFile.rows.map(row => row.path)).toEqual(['src/infra/store.ts']);
    expect(renamedFile.strikes).toEqual([{ id: 'src/infra/db.ts', highlight: false }]);
  });
});
