import { describe, expect, it, vi } from 'vitest';
import type { GraphNode, GraphView } from '../domain/graph.ts';
import * as layout from '../domain/layout.ts';
import type { PlanEdit } from '../domain/plan.ts';
import { arrowViewAt, entryTarget, planPicture } from './planpicture.ts';

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
      { edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null },
      { edit: CUT, sentence: 'src/app must not import src/domain (1 import)', stale: 'stale' },
      { edit: ADD, sentence: 'src/infra should use src/app', stale: null },
      { edit: NOTE_NODE, sentence: 'Note on src/domain: "pull an interface out here"', stale: null },
      { edit: NOTE_EDGE, sentence: 'Note on src/app → src/infra: "keep this"', stale: null },
    ]);
    expect(picture({ edits: [MOVE], stale: [] }).entries).toEqual([{ edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null }]);
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
    expect(pack.ink.rows.get('src/app')).toEqual([{ path: 'src/app/a.ts', name: 'a.ts', ghost: false }]);
    const missing = picture({
      packages: [
        { id: 'src/app', now: undefined, planned: undefined },
        { id: 'src/infra', now: { error: 'no such directory' }, planned: { error: 'no such directory' } },
      ],
    });
    expect(missing.ink.rows.get('src/app')).toEqual([]);
    expect(missing.ink.rows.get('src/infra')).toEqual([]);
  });

  it('sorts real rows by name and appends ghost rows for files the shown view lacks', () => {
    const planned = viewOf([fileNode('src/app/b.ts'), fileNode('src/app/a.ts')]);
    const now = viewOf([fileNode('src/app/a.ts'), fileNode('src/app/save.ts'), fileNode('src/app/b.ts')]);
    expect(picture({ shown: 'planned', packages: [{ id: 'src/app', now, planned }] }).ink.rows.get('src/app')).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: false },
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true },
    ]);
    expect(picture({ packages: [{ id: 'src/app', now: viewOf([]), planned: viewOf([]) }] }).ink.rows.get('src/app')).toEqual([]);
    const twins = viewOf([fileNode('a/x.ts'), fileNode('b/x.ts')]);
    expect(picture({ shown: 'now', packages: [{ id: 'src', now: twins, planned: viewOf([]) }] }).ink.rows.get('src')).toEqual([
      { path: 'a/x.ts', name: 'x.ts', ghost: false },
      { path: 'b/x.ts', name: 'x.ts', ghost: false },
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
    expect(picture({ shown: 'now', edits: [ADD], stale: ['gone'], edges: [], ids }).ink.added).toEqual([]);
    expect(picture({ shown: 'planned', edits: [ADD], stale: [null], edges: [], ids }).ink.added).toEqual([]);
    expect(picture({ shown: 'now', edits: [CUT], stale: [null], ids: new Set(['src/app', 'src/domain']) }).ink.cuts).toEqual([{ from: 'src/app', to: 'src/domain' }]);
    expect(picture({ shown: 'now', edits: [CUT], stale: [null], ids: new Set(['src/app']) }).ink.cuts).toEqual([]);
  });
});
