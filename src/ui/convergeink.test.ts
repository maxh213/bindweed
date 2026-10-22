import { describe, expect, it } from 'vitest';
import type { ConvergeStatus } from '../domain/converge.ts';
import type { PlanEdit } from '../domain/plan.ts';
import { convergeMarks, withConverge } from './convergeink.ts';

const IDS = new Set(['src/app', 'src/infra', 'src/domain', 'src/ports']);

function marksOf(edits: PlanEdit[], statuses: ConvergeStatus[], ids = IDS) {
  return convergeMarks({ edits, statuses: new Map(statuses.map((status, index) => [index, status])), ids });
}

describe('convergeMarks', () => {
  it('colours the planned row of a done or contradicted move or rename, carried through later edits', () => {
    const edits: PlanEdit[] = [
      { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' },
      { kind: 'rename-file', from: 'src/app/model.ts', to: 'entity.ts' },
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' },
      { kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' },
    ];
    const marks = marksOf(edits, ['done', 'contradicted', 'not yet']);
    expect([...marks.rows]).toEqual([
      ['src/app/entity.ts', 'contradicted'],
    ]);
    expect([...marksOf(edits.slice(0, 1), ['done']).rows]).toEqual([['src/app/model.ts', 'done']]);
    expect([...marksOf(edits.slice(2), ['contradicted', 'done']).rows]).toEqual([
      ['src/infra/a.ts', 'contradicted'],
      ['src/infra/b.ts', 'done'],
    ]);
  });

  it('marks the destination boxes of done package edits only', () => {
    const edits: PlanEdit[] = [
      { kind: 'rename-package', from: 'src/infra', to: 'src/data' },
      { kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/core' },
      { kind: 'split-package', package: 'src/ports', parts: [{ name: 'read', files: ['src/ports/a.ts'] }, { name: 'write', files: ['src/ports/b.ts'] }] },
      { kind: 'create-package', path: 'src/web' },
      { kind: 'create-package', path: 'src/later' },
    ];
    expect([...marksOf(edits, ['done', 'done', 'done', 'done', 'contradicted']).boxes]).toEqual(['src/data', 'src/core', 'src/ports/read', 'src/ports/write', 'src/web']);
  });

  it('marks a done cut in view and a done add-edge between the boxes its ends fall in', () => {
    const edits: PlanEdit[] = [
      { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/a.ts', 'src/infra/db.ts']] },
      { kind: 'cut-edge', from: 'src/app', to: 'src/web', files: [['src/app/a.ts', 'src/web/x.ts']] },
      { kind: 'cut-edge', from: 'src/web', to: 'src/app', files: [['src/web/x.ts', 'src/app/a.ts']] },
      { kind: 'cut-edge', from: 'src/domain', to: 'src/app', files: [['src/domain/model.ts', 'src/app/a.ts']] },
      { kind: 'add-edge', from: 'src/domain/model.ts', to: 'src/app' },
      { kind: 'add-edge', from: 'src/web', to: 'src/app' },
      { kind: 'add-edge', from: 'src/app', to: 'src/web' },
      { kind: 'add-edge', from: 'src/infra', to: 'src/app' },
      { kind: 'fate', file: 'src/app/a.ts', fate: 'delete' },
      { kind: 'note', target: { node: 'src/app' }, text: 'here' },
    ];
    const marks = marksOf(edits, ['done', 'done', 'done', 'not yet', 'done', 'done', 'done', 'not yet', 'done', 'note']);
    expect(marks.cuts).toEqual([{ from: 'src/app', to: 'src/infra' }]);
    expect(marks.arrows).toEqual([{ from: 'src/domain', to: 'src/app' }]);
    expect([marks.rows.size, marks.boxes.size]).toEqual([0, 0]);
  });

  it('marks nothing for an edit with no verdict yet', () => {
    const marks = convergeMarks({ edits: [{ kind: 'create-package', path: 'src/web' }], statuses: new Map(), ids: IDS });
    expect(marks).toEqual({ rows: new Map(), boxes: new Set(), cuts: [], arrows: [] });
  });
});

describe('withConverge', () => {
  it('ticks done rows, puts a red ghost row in the planned box, and adds done cuts once', () => {
    const marks = {
      rows: new Map<string, 'done' | 'contradicted'>([
        ['src/app/model.ts', 'done'],
        ['src/infra/db.ts', 'contradicted'],
        ['src/web/gone.ts', 'contradicted'],
      ]),
      boxes: new Set<string>(),
      cuts: [
        { from: 'src/app', to: 'src/infra' },
        { from: 'src/app', to: 'src/domain' },
      ],
      arrows: [],
    };
    const ink = {
      rows: new Map([
        ['src/app', [{ path: 'src/app/a.ts', name: 'a.ts', ghost: false, deleted: false }, { path: 'src/app/model.ts', name: 'model.ts', ghost: false, deleted: false }]],
        ['src/infra', [{ path: 'src/infra/db.ts', name: 'db.ts', ghost: true, deleted: false }]],
      ]),
      cuts: [{ from: 'src/app', to: 'src/infra' }],
      notes: 'kept',
    };
    const drawn = withConverge(ink, marks);
    expect(drawn.notes).toBe('kept');
    expect(drawn.rows.get('src/app')).toEqual([
      { path: 'src/app/a.ts', name: 'a.ts', ghost: false, deleted: false },
      { path: 'src/app/model.ts', name: 'model.ts', ghost: false, deleted: false, converge: 'done' },
    ]);
    expect(drawn.rows.get('src/infra')).toEqual([{ path: 'src/infra/db.ts', name: 'db.ts', ghost: true, deleted: false, converge: 'contradicted' }]);
    expect(drawn.rows.has('src/web')).toBe(false);
    expect(drawn.cuts).toEqual([
      { from: 'src/app', to: 'src/infra' },
      { from: 'src/app', to: 'src/domain' },
    ]);
  });
});
