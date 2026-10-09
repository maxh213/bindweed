import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode, GraphView } from '../domain/graph.ts';
import type { PlanDoc, PlanEdit, PlanSummary } from '../domain/plan.ts';
import {
  addedMarkers,
  arrowViewAt,
  changeEntries,
  deleteNameOf,
  diskPathOf,
  drilledFiles,
  entryTarget,
  fieldTarget,
  ghostBoxes,
  keyActionOf,
  liveCuts,
  marksInView,
  noteInk,
  planChoice,
  planDocOf,
  planDropTarget,
  planLabels,
  plansOf,
  rowsFor,
  staleList,
} from './planview.ts';

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

describe('staleList and changeEntries', () => {
  it('aligns reasons with the edits, filling gaps with null', () => {
    expect(staleList([MOVE, CUT], undefined)).toEqual([null, null]);
    expect(staleList([MOVE, CUT], ['gone'])).toEqual(['gone', null]);
    expect(staleList([MOVE, CUT], [null, 'stale'])).toEqual([null, 'stale']);
  });

  it('builds sentences with the edit and the reason attached', () => {
    expect(changeEntries([MOVE, CUT, ADD, NOTE_NODE, NOTE_EDGE], [null, 'stale', null, null, null])).toEqual([
      { edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null },
      { edit: CUT, sentence: 'src/app must not import src/domain (1 import)', stale: 'stale' },
      { edit: ADD, sentence: 'src/infra should use src/app', stale: null },
      { edit: NOTE_NODE, sentence: 'Note on src/domain: "pull an interface out here"', stale: null },
      { edit: NOTE_EDGE, sentence: 'Note on src/app → src/infra: "keep this"', stale: null },
    ]);
    expect(changeEntries([MOVE], [])).toEqual([{ edit: MOVE, sentence: 'Move src/app/save.ts to src/infra', stale: null }]);
  });
});

describe('diskPathOf', () => {
  it('unmoves a moved file, newest first, skipping stale moves', () => {
    expect(diskPathOf('src/app/save.ts', [], [])).toBe('src/app/save.ts');
    expect(diskPathOf('src/infra/save.ts', [MOVE], [null])).toBe('src/app/save.ts');
    expect(diskPathOf('src/infra/save.ts', [MOVE], ['no such file src/app/save.ts'])).toBe('src/infra/save.ts');
    expect(diskPathOf('src/app/a.ts', [MOVE], [null])).toBe('src/app/a.ts');
    const second: PlanEdit = { kind: 'move-file', file: 'src/infra/save.ts', to: '.' };
    expect(diskPathOf('save.ts', [MOVE, second], [null, null])).toBe('src/app/save.ts');
    expect(diskPathOf('src/infra/save.ts', [MOVE, NOTE_NODE], [null, null])).toBe('src/app/save.ts');
    expect(diskPathOf('src/infra/save.ts', [MOVE], [])).toBe('src/app/save.ts');
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

describe('planLabels and planChoice', () => {
  const plans: PlanSummary[] = [
    { name: 'Split app', slug: 'split-app', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
    { name: 'Split app', slug: 'split-app-2', editCount: 1, createdAt: '2026-10-02T00:00:00.000Z' },
    { name: 'Other', slug: 'other', editCount: 0, createdAt: '2026-10-03T00:00:00.000Z' },
  ];

  it('labels a repeated name with its slug', () => {
    const labels = planLabels(plans);
    expect(labels.get('split-app')).toBe('Split app');
    expect(labels.get('split-app-2')).toBe('Split app (split-app-2)');
    expect(labels.get('other')).toBe('Other');
  });

  it('maps the open slug to a combobox value', () => {
    expect(planChoice(null, plans)).toBe('');
    expect(planChoice('split-app-2', plans)).toBe('split-app-2');
    expect(planChoice('missing', plans)).toBe('');
  });
});

describe('plansOf, planDocOf and deleteNameOf', () => {
  const doc: PlanDoc = { version: 1, name: 'Split app', slug: 'split-app', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits: [], redo: [] };

  it('reads the loaded values and falls back on absence and errors', () => {
    expect(plansOf(undefined)).toEqual([]);
    expect(plansOf({ error: 'down' })).toEqual([]);
    expect(plansOf({ plans: [{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }] })).toEqual([{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }]);
    expect(planDocOf(undefined)).toBeNull();
    expect(planDocOf({ error: 'no such plan' })).toBeNull();
    expect(planDocOf(doc)).toBe(doc);
  });

  it('names the plan from the list, then the document, then nothing', () => {
    const plans: PlanSummary[] = [{ name: 'Split app', slug: 'split-app', editCount: 0, createdAt: 'x' }];
    expect(deleteNameOf(plans, 'split-app', null)).toBe('Split app');
    expect(deleteNameOf(plans, 'missing', doc)).toBe('Split app');
    expect(deleteNameOf([], null, null)).toBe('');
  });
});

describe('drilledFiles and rowsFor', () => {
  it('keeps only file nodes of a loaded view', () => {
    const view = viewOf([packageNode('src/app'), fileNode('src/app/a.ts')]);
    expect(drilledFiles(view)).toEqual([{ id: 'src/app/a.ts', name: 'a.ts' }]);
    expect(drilledFiles(undefined)).toEqual([]);
    expect(drilledFiles({ error: 'no such directory' })).toEqual([]);
  });

  it('sorts real rows by name and appends ghost rows for files the shown view lacks', () => {
    const shown = [fileNode('src/app/b.ts'), fileNode('src/app/a.ts')].map(node => ({ id: node.id, name: node.name }));
    const other = [
      { id: 'src/app/a.ts', name: 'a.ts' },
      { id: 'src/app/save.ts', name: 'save.ts' },
      { id: 'src/app/b.ts', name: 'b.ts' },
    ];
    expect(rowsFor(shown, other)).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: false },
      { path: 'src/app/b.ts', name: 'b.ts', ghost: false },
      { path: 'src/app/save.ts', name: 'save.ts', ghost: true },
    ]);
    expect(rowsFor([], [])).toEqual([]);
    expect(rowsFor([{ id: 'a/x.ts', name: 'x.ts' }, { id: 'b/x.ts', name: 'x.ts' }], [])).toEqual([
      { path: 'a/x.ts', name: 'x.ts', ghost: false },
      { path: 'b/x.ts', name: 'x.ts', ghost: false },
    ]);
  });
});

describe('ghostBoxes', () => {
  it('places a ghost where the other graph has the file, honouring pins', () => {
    const other = viewOf([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/b.ts', 0, 1), fileNode('src/app/save.ts', 0, 2)]);
    const ghosts = ghostBoxes([fileNode('src/app/a.ts', 0, 0), fileNode('src/app/b.ts', 0, 1)], other, {});
    expect(ghosts).toEqual([{ id: 'src/app/save.ts', name: 'save.ts', x: 520, y: 0 }]);
    const pinned = ghostBoxes([fileNode('src/app/a.ts', 0, 0)], other, { 'src/app/b.ts': { x: 0, y: 280 } });
    expect(pinned).toEqual([
      { id: 'src/app/b.ts', name: 'b.ts', x: 0, y: 280 },
      { id: 'src/app/save.ts', name: 'save.ts', x: 520, y: 0 },
    ]);
    expect(ghostBoxes([packageNode('src/app')], viewOf([packageNode('src/app')]), {})).toEqual([]);
    expect(ghostBoxes([fileNode('src/app/a.ts')], undefined, {})).toEqual([]);
    expect(ghostBoxes([fileNode('src/app/a.ts')], { error: 'no such directory' }, {})).toEqual([]);
  });
});

describe('noteInk, liveCuts and addedMarkers', () => {
  it('collects the non-stale notes and cuts and skips stale edits', () => {
    const edits = [NOTE_NODE, NOTE_EDGE, CUT, ADD];
    const ink = noteInk(edits, [null, null, null, null]);
    expect(ink.nodes.get('src/domain')).toEqual(['pull an interface out here']);
    expect(ink.edges.get('src/app\nsrc/infra')).toEqual(['keep this']);
    const staleInk = noteInk(edits, ['gone', null, null, null]);
    expect(staleInk.nodes.size).toBe(0);
    expect(liveCuts(edits, [null, null, null, null])).toEqual([{ from: 'src/app', to: 'src/domain' }]);
    expect(liveCuts(edits, [null, null, 'gone', null])).toEqual([]);
    const second: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'again' };
    expect(noteInk([NOTE_NODE, second], [null, null]).nodes.get('src/domain')).toEqual(['pull an interface out here', 'again']);
  });

  it('draws an added arrow as a marker unless the view already has it', () => {
    const edges = [{ from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false }];
    expect(addedMarkers([ADD], [null], [])).toEqual([{ from: 'src/infra', to: 'src/app', runtime: 0, type: 0, cycle: false, planned: true }]);
    expect(addedMarkers([ADD], [null], edges)).toEqual([]);
    expect(addedMarkers([ADD], ['gone'], [])).toEqual([]);
    expect(marksInView([{ from: 'src/app', to: 'src/domain' }], new Set(['src/app', 'src/domain']))).toEqual([{ from: 'src/app', to: 'src/domain' }]);
    expect(marksInView([{ from: 'src/app', to: 'src/domain' }], new Set(['src/app']))).toEqual([]);
  });
});

describe('keyActionOf and fieldTarget', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'MouseEvent', { value: dom.window.MouseEvent, configurable: true });
  });

  it('maps keystrokes to undo, redo and delete, skipping form fields', () => {
    expect(keyActionOf('Delete', false, false, false)).toBe('delete');
    expect(keyActionOf('z', true, false, false)).toBe('undo');
    expect(keyActionOf('Z', true, false, false)).toBe('undo');
    expect(keyActionOf('z', true, true, false)).toBe('redo');
    expect(keyActionOf('z', false, false, false)).toBeNull();
    expect(keyActionOf('x', true, false, false)).toBeNull();
    expect(keyActionOf('Delete', false, false, true)).toBeNull();
  });

  it('spots a form field as the event target', () => {
    expect(fieldTarget(document.createElement('input'))).toBe(true);
    expect(fieldTarget(document.createElement('textarea'))).toBe(true);
    expect(fieldTarget(document.createElement('select'))).toBe(true);
    expect(fieldTarget(document.createElement('div'))).toBe(false);
    expect(fieldTarget(null)).toBe(false);
    expect(fieldTarget(document.createElementNS('http://www.w3.org/2000/svg', 'g'))).toBe(false);
  });
});

describe('planDropTarget', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'MouseEvent', { value: dom.window.MouseEvent, configurable: true });
  });

  function atPoint(elements: Element[]): MouseEvent {
    document.elementsFromPoint = () => elements;
    return new window.MouseEvent('mouseup', { clientX: 5, clientY: 6 });
  }

  it('reads the crumb, then the package, under the drop point', () => {
    const crumb = document.createElement('button');
    crumb.dataset.crumb = 'src';
    const box = document.createElement('div');
    box.className = 'box package';
    box.dataset.id = 'src/infra';
    const plain = document.createElement('div');
    const ghost = document.createElement('div');
    ghost.className = 'box package';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(planDropTarget(atPoint([svg, plain, crumb, box]))).toBe('src');
    expect(planDropTarget(atPoint([svg, plain, ghost, box]))).toBe('src/infra');
    expect(planDropTarget(atPoint([svg, plain]))).toBeNull();
    expect(planDropTarget(atPoint([]))).toBeNull();
    expect(planDropTarget({})).toBeNull();
    expect(planDropTarget(null)).toBeNull();
  });
});
