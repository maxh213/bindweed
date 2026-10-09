import { describe, expect, it } from 'vitest';
import {
  addEdgeIndex,
  freeSlug,
  moveDest,
  parsePlan,
  parsePlanEdit,
  PLAN_SLUG_PATTERN,
  planNameFrom,
  sentenceOf,
  slugOf,
  summarisePlan,
  withEdit,
  withRedo,
  withUndo,
  withoutEdit,
  type PlanDoc,
  type PlanEdit,
} from './domain/plan.ts';

const HEAD = 'a'.repeat(40);
const STAMP = '2026-10-01T00:00:00.000Z';

function docOf(edits: PlanEdit[], redo: PlanEdit[] = []): PlanDoc {
  return { version: 1, name: 'Split app', slug: 'split-app', createdAt: STAMP, baseCommit: HEAD, edits, redo };
}

function goodDoc(): Record<string, unknown> {
  const raw: unknown = JSON.parse(JSON.stringify(docOf([])));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not a document');
  return Object.fromEntries(Object.entries(raw));
}

describe('slugOf', () => {
  it('slugs names by the pinned rules', () => {
    expect(slugOf('Split app')).toBe('split-app');
    expect(slugOf('  Split app  ')).toBe('split-app');
    expect(slugOf('Łódź plan')).toBe('d-plan');
    expect(slugOf('Hello!!!')).toBe('hello');
    expect(slugOf('a  b___c')).toBe('a-b-c');
    expect(slugOf('aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaa x')).toBe('aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa-');
    expect(slugOf('')).toBe('');
    expect(slugOf('   ')).toBe('');
    expect(slugOf('!!!')).toBe('');
  });
});

describe('PLAN_SLUG_PATTERN', () => {
  it('accepts what POST can emit and rejects the rest', () => {
    expect(PLAN_SLUG_PATTERN.test('split-app')).toBe(true);
    expect(PLAN_SLUG_PATTERN.test('aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa-')).toBe(true);
    expect(PLAN_SLUG_PATTERN.test('aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa--2')).toBe(true);
    expect(PLAN_SLUG_PATTERN.test('Split-App')).toBe(false);
    expect(PLAN_SLUG_PATTERN.test('split.app')).toBe(false);
    expect(PLAN_SLUG_PATTERN.test('src/app')).toBe(false);
    expect(PLAN_SLUG_PATTERN.test('')).toBe(false);
    expect(PLAN_SLUG_PATTERN.test('-x')).toBe(false);
  });
});

describe('freeSlug', () => {
  it('takes the base, then -2, then -3', () => {
    expect(freeSlug('split-app', () => false)).toBe('split-app');
    expect(freeSlug('split-app', slug => slug === 'split-app')).toBe('split-app-2');
    expect(freeSlug('split-app', slug => slug !== 'split-app-3')).toBe('split-app-3');
  });
});

describe('moveDest', () => {
  it('joins the target directory and the file name, with "." as the root', () => {
    expect(moveDest('src/app/save.ts', 'src/infra')).toBe('src/infra/save.ts');
    expect(moveDest('src/app/save.ts', '.')).toBe('save.ts');
    expect(moveDest('src/app/save.ts', 'src/app')).toBe('src/app/save.ts');
    expect(moveDest('save.ts', 'src')).toBe('src/save.ts');
  });
});

describe('planNameFrom', () => {
  it('accepts exactly a name that slugs', () => {
    expect(planNameFrom({ name: 'Split app' })).toBe('Split app');
    expect(planNameFrom({ name: '  Split app  ' })).toBe('Split app');
  });

  it('refuses the pinned bad bodies', () => {
    for (const body of ['not json', {}, { name: '' }, { name: '   ' }, { name: '!!!' }, { name: 3 }, { name: 'Split app', slug: 'x' }, [], null]) {
      expect(planNameFrom(body)).toBeUndefined();
    }
  });
});

describe('parsePlanEdit', () => {
  it('parses each kind', () => {
    expect(parsePlanEdit({ kind: 'move-file', file: 'a.ts', to: 'b' })).toEqual({ kind: 'move-file', file: 'a.ts', to: 'b' });
    expect(parsePlanEdit({ kind: 'cut-edge', from: 'a', to: 'b', files: [['a/x.ts', 'b/y.ts']] })).toEqual({
      kind: 'cut-edge',
      from: 'a',
      to: 'b',
      files: [['a/x.ts', 'b/y.ts']],
    });
    expect(parsePlanEdit({ kind: 'add-edge', from: 'a', to: 'b' })).toEqual({ kind: 'add-edge', from: 'a', to: 'b' });
    expect(parsePlanEdit({ kind: 'note', target: { node: 'n' }, text: 't' })).toEqual({ kind: 'note', target: { node: 'n' }, text: 't' });
    expect(parsePlanEdit({ kind: 'note', target: { edge: ['a', 'b'] }, text: 't' })).toEqual({
      kind: 'note',
      target: { edge: ['a', 'b'] },
      text: 't',
    });
  });

  it('refuses malformed edits', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      { kind: 'fold', file: 'a' },
      { kind: 'move-file', file: 'a.ts' },
      { kind: 'move-file', file: 3, to: 'b' },
      { kind: 'move-file', file: 'a.ts', to: 'b', extra: 1 },
      { kind: 'add-edge', from: 'a', to: 'a' },
      { kind: 'add-edge', from: 1, to: 'b' },
      { kind: 'add-edge', from: 'a', to: 2 },
      { kind: 'add-edge', from: 'a' },
      { kind: 'note', target: { node: 'n' }, text: '' },
      { kind: 'note', target: { node: 3 }, text: 't' },
      { kind: 'note', target: { node: 'n', edge: ['a', 'b'] }, text: 't' },
      { kind: 'note', target: { edge: ['a'] }, text: 't' },
      { kind: 'note', target: { edge: ['a', 'b', 'c'] }, text: 't' },
      { kind: 'note', target: { edge: ['a', 2] }, text: 't' },
      { kind: 'note', target: {}, text: 't' },
      { kind: 'note', target: 'n', text: 't' },
      { kind: 'note', text: 't' },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [['a', 'b'], ['c']] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [['a', 2]] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: 'a' },
      { kind: 'cut-edge', from: 'a', files: [['a', 'b']] },
      { kind: 3 },
      { kind: 'note', target: { node: 'n' }, text: 4 },
    ];
    for (const body of bad) expect(parsePlanEdit(body)).toBeUndefined();
  });
});

describe('parsePlan', () => {
  it('parses a document with all four edit kinds', () => {
    const doc = docOf(
      [
        { kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' },
        { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
        { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
        { kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' },
      ],
      [{ kind: 'note', target: { edge: ['src/app', 'src/infra'] }, text: 'keep this' }],
    );
    expect(parsePlan(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('refuses the pinned non-plan documents', () => {
    const base = goodDoc();
    const bad: unknown[] = [
      'not json',
      null,
      [],
      { ...base, version: 2 },
      { ...base, name: '' },
      { ...base, createdAt: 'yesterday' },
      { ...base, baseCommit: 'abc' },
      { ...base, edits: [{ kind: 'add-edge', from: 'src/app', to: 'src/app' }] },
      { ...base, edits: [{ kind: 'note', target: { node: 'src/domain' }, text: '' }] },
      { ...base, edits: [{ kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [] }] },
      { ...base, edits: [{ kind: 'fold', file: 'src/app/save.ts' }] },
      { ...base, extra: 1 },
      { ...base, redo: [{ kind: 'fold' }] },
      { ...base, edits: 'x' },
      { version: 1 },
    ];
    for (const body of bad) expect(parsePlan(body)).toBeUndefined();
  });

  it('keeps the bytes of a bad document readable elsewhere', () => {
    expect(parsePlan(goodDoc())).toEqual(docOf([]));
  });
});

describe('summarisePlan', () => {
  it('counts edits only, never redo', () => {
    const doc = docOf([{ kind: 'add-edge', from: 'a', to: 'b' }], [{ kind: 'add-edge', from: 'c', to: 'd' }]);
    expect(summarisePlan(doc)).toEqual({ name: 'Split app', slug: 'split-app', editCount: 1, createdAt: STAMP });
  });
});

describe('sentenceOf', () => {
  it('renders each edit kind as its pinned sentence', () => {
    expect(sentenceOf({ kind: 'move-file', file: 'src/app/save.ts', to: 'src/infra' })).toBe('Move src/app/save.ts to src/infra');
    expect(sentenceOf({ kind: 'move-file', file: 'src/app/save.ts', to: '.' })).toBe('Move src/app/save.ts to .');
    expect(sentenceOf({ kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['a', 'b']] })).toBe(
      'src/app must not import src/domain (1 import)',
    );
    expect(sentenceOf({ kind: 'cut-edge', from: 'src/infra', to: 'src/domain', files: [['a', 'b'], ['c', 'd']] })).toBe(
      'src/infra must not import src/domain (2 imports)',
    );
    expect(sentenceOf({ kind: 'add-edge', from: 'src/infra', to: 'src/app' })).toBe('src/infra should use src/app');
    expect(sentenceOf({ kind: 'note', target: { node: 'src/domain' }, text: 'pull an interface out here' })).toBe(
      'Note on src/domain: "pull an interface out here"',
    );
    expect(sentenceOf({ kind: 'note', target: { edge: ['src/app', 'src/infra'] }, text: 'keep this' })).toBe(
      'Note on src/app → src/infra: "keep this"',
    );
  });
});

describe('plan document edits', () => {
  const move: PlanEdit = { kind: 'move-file', file: 'a.ts', to: 'b' };
  const note: PlanEdit = { kind: 'note', target: { node: 'n' }, text: 't' };

  it('appends a new edit and clears redo', () => {
    const doc = docOf([move], [note]);
    expect(withEdit(doc, note)).toEqual(docOf([move, note], []));
  });

  it('undoes the last edit onto the redo stack', () => {
    expect(withUndo(docOf([move, note]))).toEqual(docOf([move], [note]));
    expect(withUndo(docOf([]))).toEqual(docOf([]));
  });

  it('redoes the top of the redo stack', () => {
    expect(withRedo(docOf([move], [note]))).toEqual(docOf([move, note], []));
    expect(withRedo(docOf([move]))).toEqual(docOf([move]));
  });

  it('removes one edit without touching redo', () => {
    const doc = docOf([move, note], [note]);
    expect(withoutEdit(doc, 0)).toEqual(docOf([note], [note]));
  });

  it('finds the non-stale add-edge for a pair', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'a', to: 'b' };
    const other: PlanEdit = { kind: 'add-edge', from: 'a', to: 'c' };
    expect(addEdgeIndex([move, add], [null, null], 'a', 'b')).toBe(1);
    expect(addEdgeIndex([add, add], ['x', null], 'a', 'b')).toBe(1);
    expect(addEdgeIndex([other], [null], 'a', 'b')).toBe(-1);
    expect(addEdgeIndex([], [], 'a', 'b')).toBe(-1);
  });
});
