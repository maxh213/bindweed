import { describe, expect, it } from 'vitest';
import {
  addEdgeIndex,
  byStrings,
  childPath,
  freeSlug,
  lastSegment,
  legalName,
  moveDest,
  parentOf,
  renamedFile,
  splitPartPath,
  within,
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
      { kind: 'move-file', file: 'a.ts', to: 3 },
      { kind: 'move-file', file: 'a.ts', to: 'b', extra: 1 },
      { kind: 'add-edge', from: 'a', to: 'a' },
      { kind: 'add-edge', from: 1, to: 'b' },
      { kind: 'add-edge', from: 'a', to: 2 },
      { kind: 'add-edge', from: 'a' },
      { kind: 'add-edge', from: 'a', to: 'b', extra: 1 },
      { kind: 'note', target: { node: 'n' }, text: '' },
      { kind: 'note', target: { node: 3 }, text: 't' },
      { kind: 'note', target: { node: 'n', edge: ['a', 'b'] }, text: 't' },
      { kind: 'note', target: { edge: ['a'] }, text: 't' },
      { kind: 'note', target: { edge: ['a', 'b', 'c'] }, text: 't' },
      { kind: 'note', target: { edge: ['a', 2] }, text: 't' },
      { kind: 'note', target: { edge: [1, 'b'] }, text: 't' },
      { kind: 'note', target: {}, text: 't' },
      { kind: 'note', target: 'n', text: 't' },
      { kind: 'note', text: 't' },
      { kind: 'note', target: { node: 'n' }, text: 't', extra: 1 },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [['a', 'b'], ['c']] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [['a', 2]] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: 'a' },
      { kind: 'cut-edge', from: 'a', files: [['a', 'b']] },
      { kind: 'cut-edge', from: 1, to: 'b', files: [['a', 'b']] },
      { kind: 'cut-edge', from: 'a', to: 'b', files: [['a', 'b']], extra: 1 },
      { kind: 3 },
      { kind: ['move-file'], file: 'a.ts', to: 'b' },
      { kind: 'note', target: { node: 'n' }, text: 4 },
    ];
    for (const body of bad) expect(parsePlanEdit(body)).toBeUndefined();
  });
});

describe('package edits and file fates', () => {
  it('parses each new kind', () => {
    const good: PlanEdit[] = [
      { kind: 'create-package', path: 'src/ports' },
      { kind: 'create-package', path: 'ports' },
      { kind: 'create-package', path: 'src/...' },
      { kind: 'rename-package', from: 'src/util', to: 'src/text' },
      { kind: 'rename-package', from: 'util', to: 'text' },
      { kind: 'rename-file', from: 'src/app/x.ts', to: 'y.ts' },
      { kind: 'rename-file', from: 'src/app/save.ts', to: 'save.ts' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/infra' },
      { kind: 'merge-packages', packages: ['src/infra', 'src/infra2'], into: 'src/core' },
      { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app/read' },
      { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'spare', files: [] }] },
      { kind: 'fate', file: 'src/legacy.ts', fate: 'delete' },
      { kind: 'fate', file: 'src/helpers.ts', fate: 'fold', into: 'src/text/format.ts' },
    ];
    for (const edit of good) expect(parsePlanEdit(JSON.parse(JSON.stringify(edit)))).toEqual(edit);
  });

  it('refuses malformed new edits', () => {
    const part = (name: unknown, files: unknown) => ({ name, files });
    const bad: unknown[] = [
      { kind: 'create-package', path: 'src/../ports' },
      { kind: 'create-package', path: 'src/./ports' },
      { kind: 'create-package', path: '' },
      { kind: 'create-package', path: 'src/has space' },
      { kind: 'create-package', path: 'src//ports' },
      { kind: 'create-package', path: 'src/ports/' },
      { kind: 'create-package', path: 'src/ ports' },
      { kind: 'create-package', path: 'src/ports ' },
      { kind: 'create-package', path: 3 },
      { kind: 'create-package', path: 'src/ports', extra: 1 },
      { kind: 'rename-package', from: 'src/infra', to: 'lib/adapters' },
      { kind: 'rename-package', from: 'src/infra', to: 'src/infra' },
      { kind: 'rename-package', from: 'src/in fra', to: 'src/infra2' },
      { kind: 'rename-package', from: 'src/infra', to: 'src/..' },
      { kind: 'rename-package', from: 'src/infra', to: 2 },
      { kind: 'rename-package', from: 'src/infra', to: 'src/net', extra: 1 },
      { kind: 'rename-file', from: 'src/app/a.ts', to: 'src/app/b.ts' },
      { kind: 'rename-file', from: 'src/app/a.ts', to: '..' },
      { kind: 'rename-file', from: 1, to: 'b.ts' },
      { kind: 'rename-file', from: 'src/app/a.ts', to: 'b.ts', extra: 1 },
      { kind: 'merge-packages', packages: ['src/app'], into: 'src/app' },
      { kind: 'merge-packages', packages: ['src/app', 'src/app'], into: 'src/x' },
      { kind: 'merge-packages', packages: ['src/app', 'src/app/read'], into: 'src/x' },
      { kind: 'merge-packages', packages: ['src/app/read', 'src/app'], into: 'src/x' },
      { kind: 'merge-packages', packages: ['src/app/read', 'src/net', 'src/app'], into: 'src/x' },
      { kind: 'merge-packages', packages: ['src/app', 3], into: 'src/x' },
      { kind: 'merge-packages', packages: 'src/app', into: 'src/x' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/../x' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src//x' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/x/' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/ x' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/x ' },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 4 },
      { kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/x', extra: 1 },
      { kind: 'split-package', package: 'src/app', parts: [part('read', ['src/app/a.ts'])] },
      { kind: 'split-package', package: 'src/app', parts: 'read' },
      { kind: 'split-package', package: 'src/app', parts: [part('read', []), part('read', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', []), part('write', []), part('read', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', ['src/app/a.ts']), part('write', ['src/app/a.ts'])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', ['src/app/a.ts', 'src/app/a.ts']), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', ['src/app/a.ts']), part('write', []), part('spare', ['src/app/a.ts'])] },
      { kind: 'split-package', package: 'src/app', parts: [{ name: 'read' }, part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('has space', []), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part(5, []), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', 'src/app/a.ts'), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', [6]), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: [], extra: 1 }, part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: ['read', part('write', [])] },
      { kind: 'split-package', package: 7, parts: [part('read', []), part('write', [])] },
      { kind: 'split-package', package: 'src/app', parts: [part('read', []), part('write', [])], extra: 1 },
      { kind: 'fate', file: 'src/app/save.ts', fate: 'fold' },
      { kind: 'fate', file: 'src/app/save.ts', fate: 'fold', into: 9 },
      { kind: 'fate', file: 'src/app/save.ts', fate: 'delete', into: 'src/app/a.ts' },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/a.ts' },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'burn' },
      { kind: 'fate', file: 8, fate: 'delete' },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'delete', extra: 1 },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/app/b.ts', extra: 1 },
    ];
    for (const body of bad) expect(parsePlanEdit(body)).toBeUndefined();
  });

  it('renders each new kind as its pinned sentence', () => {
    const split = (counts: number[]): PlanEdit => ({
      kind: 'split-package',
      package: 'src/app',
      parts: counts.map((count, index) => ({ name: `p${index}`, files: Array.from({ length: count }, (_, at) => `src/app/f${index}${at}.ts`) })),
    });
    expect(sentenceOf({ kind: 'create-package', path: 'src/ports' })).toBe('Create package src/ports');
    expect(sentenceOf({ kind: 'rename-package', from: 'src/util', to: 'src/text' })).toBe('Rename src/util to src/text');
    expect(sentenceOf({ kind: 'rename-file', from: 'src/app/x.ts', to: 'y.ts' })).toBe('Rename src/app/x.ts to y.ts');
    expect(sentenceOf({ kind: 'merge-packages', packages: ['src/io', 'src/net'], into: 'src/infra' })).toBe('Merge src/io and src/net into src/infra');
    expect(sentenceOf({ kind: 'merge-packages', packages: ['src/app', 'src/domain', 'src/infra'], into: 'src/core' })).toBe(
      'Merge src/app, src/domain and src/infra into src/core',
    );
    expect(sentenceOf({ kind: 'merge-packages', packages: ['a', 'b', 'c', 'd'], into: 'e' })).toBe('Merge a, b, c and d into e');
    expect(sentenceOf(split([4, 3]))).toBe('Split src/app into src/app/p0 (4 files) and src/app/p1 (3 files)');
    expect(sentenceOf(split([1, 1, 0]))).toBe('Split src/app into src/app/p0 (1 file), src/app/p1 (1 file) and src/app/p2 (0 files)');
    expect(sentenceOf(split([1, 1, 1, 1]))).toBe(
      'Split src/app into src/app/p0 (1 file), src/app/p1 (1 file), src/app/p2 (1 file) and src/app/p3 (1 file)',
    );
    expect(sentenceOf({ kind: 'fate', file: 'src/legacy.ts', fate: 'delete' })).toBe('Delete src/legacy.ts');
    expect(sentenceOf({ kind: 'fate', file: 'src/helpers.ts', fate: 'fold', into: 'src/text/format.ts' })).toBe('Fold src/helpers.ts into src/text/format.ts');
  });

  it('reads names and paths by the pinned rules', () => {
    expect(['a', 'a.ts', 'A-b_c.9', '.hidden', '...', 'a..b'].map(legalName)).toEqual([true, true, true, true, true, true]);
    expect(['', '.', '..', 'a b', 'a/b', 'é'].map(legalName)).toEqual([false, false, false, false, false, false]);
    expect([parentOf('src/app/a.ts'), parentOf('a.ts')]).toEqual(['src/app', '']);
    expect([lastSegment('src/app/a.ts'), lastSegment('a.ts')]).toEqual(['a.ts', 'a.ts']);
    expect([childPath('src', 'ports'), childPath('', 'ports')]).toEqual(['src/ports', 'ports']);
    expect([renamedFile('src/app/save.ts', 'writer.ts'), renamedFile('save.ts', 'writer.ts')]).toEqual(['src/app/writer.ts', 'writer.ts']);
    expect(splitPartPath('src/app', 'read')).toBe('src/app/read');
    expect([within('src/app', 'src/app'), within('src/app', 'src/app/a.ts'), within('src/app', 'src/apple.ts')]).toEqual([true, true, false]);
  });

  it('orders strings by code unit, not by locale', () => {
    expect(['b', 'a', 'B', 'a-b', 'a.b', 'a'].sort(byStrings)).toEqual(['B', 'a', 'a', 'a-b', 'a.b', 'b']);
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
      { ...base, name: ['x'] },
      { ...base, slug: 3 },
      { ...base, createdAt: 'yesterday' },
      { ...base, createdAt: [STAMP] },
      { ...base, createdAt: `x${STAMP}` },
      { ...base, createdAt: `${STAMP}x` },
      { ...base, baseCommit: 'abc' },
      { ...base, baseCommit: [HEAD] },
      { ...base, baseCommit: `x${HEAD}` },
      { ...base, baseCommit: `${HEAD}x` },
      { ...base, edits: 3 },
      { ...base, redo: null },
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
    const wrongFrom: PlanEdit = { kind: 'add-edge', from: 'z', to: 'b' };
    const ids = new Set(['a', 'b', 'c', 'z']);
    expect(addEdgeIndex([move, add], [null, null], 'a', 'b', '', ids)).toBe(1);
    expect(addEdgeIndex([add, add], ['x', null], 'a', 'b', '', ids)).toBe(1);
    expect(addEdgeIndex([other], [null], 'a', 'b', '', ids)).toBe(-1);
    expect(addEdgeIndex([wrongFrom], [null], 'a', 'b', '', ids)).toBe(-1);
    expect(addEdgeIndex([], [], 'a', 'b', '', ids)).toBe(-1);
  });

  it('finds an add-edge by the arrow later edits draw, grouping included', () => {
    const add = (from: string, to: string): PlanEdit => ({ kind: 'add-edge', from, to });
    const merge: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' };
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/deep/a.ts', 'src/app/save.ts'] },
        { name: 'write', files: ['src/app/b.ts'] },
      ],
    };
    const boxes = (...names: string[]): Set<string> => new Set(names);
    const src = boxes('src/domain', 'src/core', 'src/app', 'src/infra', 'src/adapters', 'src/infra2');
    const splitView = boxes('src/domain', 'src/infra', 'src/app/read', 'src/app/write');
    expect(addEdgeIndex([add('src/domain', 'src/infra'), merge], [null, null], 'src/domain', 'src/core', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/app/save.ts', 'src/app/b.ts'), split], [null, null], 'src/app/read', 'src/app/write', 'src', splitView)).toBe(0);
    expect(addEdgeIndex([add('src/app/save.ts', 'src/domain/model.ts'), split], [null, null], 'src/app/read', 'src/domain', 'src', splitView)).toBe(0);
    expect(addEdgeIndex([add('src/app/save.ts', 'src/app/a.ts'), { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' }], [null, null], 'src/app/writer.ts', 'src/app/a.ts', 'src/app', boxes('src/app/writer.ts', 'src/app/a.ts'))).toBe(0);
    const libSave = boxes('src/lib/save.ts', 'src/domain/model.ts');
    const renameSave: PlanEdit = { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' };
    expect(addEdgeIndex([add('src/lib/save.ts', 'src/domain/model.ts'), renameSave], [null, null], 'src/lib/save.ts', 'src/domain/model.ts', 'src/lib', libSave)).toBe(0);
    expect(addEdgeIndex([add('src/lib/save.ts', 'src/domain/model.ts'), renameSave], [null, null], 'src/lib/writer.ts', 'src/domain/model.ts', 'src/lib', libSave)).toBe(-1);
    expect(addEdgeIndex([add('src/infra/db.ts', 'src/infra2/x.ts'), { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }], [null, null], 'src/adapters', 'src/infra2', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/infra/deep/x.ts', 'src/infra/nest/y.ts'), { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }], [null, null], 'src/adapters/deep', 'src/adapters/nest', 'src/adapters', boxes('src/adapters/deep', 'src/adapters/nest'))).toBe(0);
    const partial: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts'] },
        { name: 'write', files: ['src/app/b.ts'] },
      ],
    };
    const partialIds = boxes('src/app/sub', 'src/app/read', 'src/app/write', 'src/domain');
    expect(addEdgeIndex([add('src/app/sub/c.ts', 'src/domain/model.ts'), partial], [null, null], 'src/app/sub', 'src/domain', 'src', partialIds)).toBe(0);
    expect(addEdgeIndex([add('src/app/sub/c.ts', 'src/domain/model.ts'), partial], [null, null], 'src/app/read', 'src/domain', 'src', partialIds)).toBe(-1);
    const outside = boxes('src/lib', 'src/domain', 'src/app/read');
    expect(addEdgeIndex([add('src/lib/a.ts', 'src/domain/model.ts'), partial], [null, null], 'src/lib', 'src/domain', 'src', outside)).toBe(0);
    expect(addEdgeIndex([add('src/lib/a.ts', 'src/domain/model.ts'), partial], [null, null], 'src/app/read', 'src/domain', 'src', outside)).toBe(-1);
    const nested: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/deep/a.ts', 'src/app/other/b.ts'] }, { name: 'write', files: [] }] };
    expect(addEdgeIndex([add('src/app/deep/a.ts', 'src/app/other/b.ts'), nested], [null, null], 'src/app/read/deep', 'src/app/read/other', 'src/app/read', boxes('src/app/read/deep', 'src/app/read/other'))).toBe(0);
    expect(addEdgeIndex([add('src/domain/model.ts', 'src/infra/repo.ts'), { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' }], [null, null], 'src/domain', 'src/infra', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/domain/model.ts', 'src/infra/repo.ts'), { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' }], [null, null], 'src/app', 'src/infra', 'src', src)).toBe(-1);
    expect(addEdgeIndex([add('src/infra', 'src/app'), { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }], [null, 'no such directory src/infra'], 'src/infra', 'src/app', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/infra', 'src/app'), { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' }], [null, 'no such directory src/infra'], 'src/adapters', 'src/app', 'src', src)).toBe(-1);
    expect(addEdgeIndex([add('src/app/save.ts', 'src/domain/model.ts'), { kind: 'fate', file: 'src/app/save.ts', fate: 'fold', into: 'src/app/a.ts' }], [null, null], 'src/app', 'src/domain', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/infra/db.ts', 'src/domain/model.ts'), { kind: 'fate', file: 'src/infra/db.ts', fate: 'fold', into: 'src/app/a.ts' }], [null, null], 'src/app', 'src/domain', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('src/infra/db.ts', 'src/domain/model.ts'), { kind: 'fate', file: 'src/infra/db.ts', fate: 'fold', into: 'src/app/a.ts' }], [null, null], 'src/infra', 'src/domain', 'src', src)).toBe(-1);
    expect(addEdgeIndex([add('src/lib/a.ts', 'src/domain/model.ts'), { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/domain/shape.ts' }], [null, null], 'src/lib', 'src/domain', 'src', boxes('src/lib', 'src/domain'))).toBe(0);
    expect(addEdgeIndex([add('src/app/save.ts', 'src/domain/model.ts'), { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }], [null, null], 'src/app', 'src/domain', 'src', src)).toBe(0);
    expect(addEdgeIndex([add('a/p.ts', 'b/q.ts')], [null], 'a', 'b', '', boxes('a', 'b'))).toBe(0);
    expect(addEdgeIndex([add('src/domain', 'src/infra')], [null], 'src/domain', 'src/infra', 'src/app', boxes('src/app/a.ts'))).toBe(-1);
  });

  it('follows a rename and a later merge when both move the arrow', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/infra/db.ts', to: 'src/domain/model.ts' };
    const rename: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' };
    const merge: PlanEdit = { kind: 'merge-packages', packages: ['src/adapters', 'src/app'], into: 'src/core' };
    const ids = new Set(['src/core', 'src/domain']);
    expect(addEdgeIndex([add, rename, merge], [null, null, null], 'src/core', 'src/domain', 'src', ids)).toBe(0);
  });

  it('lets a live rename after a stale edit move the arrow', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/infra', to: 'src/app' };
    const gone: PlanEdit = { kind: 'rename-package', from: 'src/gone', to: 'src/elsewhere' };
    const rename: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' };
    const ids = new Set(['src/infra', 'src/adapters', 'src/app']);
    const stale = [null, 'no such directory src/gone', null];
    expect(addEdgeIndex([add, gone, rename], stale, 'src/adapters', 'src/app', 'src', ids)).toBe(0);
    expect(addEdgeIndex([add, gone, rename], stale, 'src/infra', 'src/app', 'src', ids)).toBe(-1);
  });

  it('matches the box drawn after two hidden packages', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/sub/deep/c.ts', to: 'src/domain/model.ts' };
    const moveA: PlanEdit = { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' };
    const moveB: PlanEdit = { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' };
    const ids = new Set(['src/app/sub/deep', 'src/domain']);
    expect(addEdgeIndex([add, moveA, moveB], [null, null, null], 'src/app/sub/deep', 'src/domain', 'src', ids)).toBe(0);
  });

  it('names one file when a fold retargets an added edge', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/a.ts.bak', to: 'src/domain/model.ts' };
    const fold: PlanEdit = { kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/domain/shape.ts' };
    const ids = new Set(['src/app/a.ts.bak', 'src/domain/model.ts', 'src/domain/shape.ts']);
    const edits = [add, fold];
    const stale = [null, null];
    expect(addEdgeIndex(edits, stale, 'src/app/a.ts.bak', 'src/domain/model.ts', 'src/app', ids)).toBe(0);
    expect(addEdgeIndex(edits, stale, 'src/domain/shape.ts', 'src/domain/model.ts', 'src/app', ids)).toBe(-1);
  });

  it('names one file when a rename retargets an added edge', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/a.ts.bak', to: 'src/domain/model.ts' };
    const rename: PlanEdit = { kind: 'rename-file', from: 'src/app/a.ts', to: 'b.ts' };
    const ids = new Set(['src/app/a.ts.bak', 'src/app/b.ts.bak', 'src/domain/model.ts']);
    const edits = [add, rename];
    const stale = [null, null];
    expect(addEdgeIndex(edits, stale, 'src/app/a.ts.bak', 'src/domain/model.ts', 'src/app', ids)).toBe(0);
    expect(addEdgeIndex(edits, stale, 'src/app/b.ts.bak', 'src/domain/model.ts', 'src/app', ids)).toBe(-1);
  });

  it('leaves an unlisted file where a split found it', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/a.ts.bak', to: 'src/domain/model.ts' };
    const split: PlanEdit = {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'read', files: ['src/app/a.ts'] },
        { name: 'write', files: ['src/app/b.ts'] },
      ],
    };
    const ids = new Set(['src/app/a.ts.bak', 'src/domain', 'src/app/read']);
    const edits = [add, split];
    const stale = [null, null];
    expect(addEdgeIndex(edits, stale, 'src/app/a.ts.bak', 'src/domain', 'src', ids)).toBe(0);
    expect(addEdgeIndex(edits, stale, 'src/app/read', 'src/domain', 'src', ids)).toBe(-1);
  });

  it('keeps a nested path when a merge moves an added edge', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/infra/deep/x.ts', to: 'src/infra/nest/y.ts' };
    const merge: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/app'], into: 'src/core' };
    const ids = new Set(['src/core/deep', 'src/core/nest', 'src/core/x.ts', 'src/core/y.ts']);
    const edits = [add, merge];
    const stale = [null, null];
    expect(addEdgeIndex(edits, stale, 'src/core/deep', 'src/core/nest', 'src/core', ids)).toBe(0);
    expect(addEdgeIndex(edits, stale, 'src/core/x.ts', 'src/core/y.ts', 'src/core', ids)).toBe(-1);
  });

  it('keeps an added edge whose end a delete names', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/app/b.ts', to: 'src/lib/z.ts' };
    const drop: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' };
    const ids = new Set(['src/app/b.ts', 'src/lib/z.ts']);
    expect(addEdgeIndex([add, drop], [null, null], 'src/app/b.ts', 'src/lib/z.ts', 'src', ids)).toBe(0);
  });

  it('skips a stale fold when it looks up an added edge', () => {
    const add: PlanEdit = { kind: 'add-edge', from: 'src/infra/db.ts', to: 'src/domain/model.ts' };
    const fold: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'fold', into: 'src/app/a.ts' };
    const ids = new Set(['src/infra', 'src/domain', 'src/app']);
    const stale = [null, 'no such file src/app/a.ts'];
    expect(addEdgeIndex([add, fold], stale, 'src/infra', 'src/domain', 'src', ids)).toBe(0);
    expect(addEdgeIndex([add, fold], stale, 'src/app', 'src/domain', 'src', ids)).toBe(-1);
  });
});
