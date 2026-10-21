import { describe, expect, it } from 'vitest';
import type { ChatTurn } from '../domain/chat.ts';
import type { PlanEdit } from '../domain/plan.ts';
import { acceptance, askTextOk, openList, openRaws, withTurn } from './ask.ts';

const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const fold = { kind: 'fold', file: 'src/app/a.ts' };

function turn(edits: unknown[] = [cut], decisions: ChatTurn['decisions'] = {}): ChatTurn {
  return { at: '2026-10-21T09:00:00.000Z', text: 'hi', summary: 'Done.', edits, decisions };
}

describe('ask rows', () => {
  const stamp = '1:2026-10-21T09:00:00.000Z';

  it('zips the open edits with a stale reason or a forced drop', () => {
    expect(openList([], [], null)).toEqual({ turn: null, stamp: '', rows: [], edits: [] });
    const open = turn([cut, fold]);
    expect(openList([open], [], null).rows.map(row => [row.index, row.stale, row.sentence])).toEqual([
      [0, null, 'src/app must not import src/domain (1 import)'],
      [1, null, JSON.stringify(fold)],
    ]);
    expect(openList([open], ['gone'], { stamp, forced: { index: 1, reason: 'forced' } }).rows.map(row => row.stale)).toEqual(['gone', 'forced']);
    expect(openList([decideAway(open)], ['gone'], { stamp, forced: { index: 0, reason: 'forced' } }).rows).toEqual([]);
  });

  it('keeps only an applicable edit, and the latest turn', () => {
    const open = turn([cut, fold, { kind: 'note', target: { node: 'src' }, text: 'n' }]);
    expect(openList([open], ['gone', null, null], null).edits.map(item => item.index)).toEqual([2]);
    expect(openList([open], [], null).turn).toBe(open);
    expect(withTurn([open, turn([])], turn([cut]))).toEqual([open, turn([cut])]);
    expect(openList([open, turn([], { '0': 'accepted' })], [], null).stamp).toBe('2:2026-10-21T09:00:00.000Z');
    expect(askTextOk('')).toBe(false);
    expect(askTextOk('  ')).toBe(false);
    expect(askTextOk('a')).toBe(true);
    expect(askTextOk('a\nb')).toBe(true);
    const forced = { index: 1, reason: 'no such directory src/ports' };
    const two = turn([cut, fold]);
    expect(openList([two], [], null).rows.map(row => row.stale)).toEqual([null, null]);
    expect(openList([two], [], { stamp: '2:t', forced }).rows.map(row => row.stale)).toEqual([null, null]);
    expect(openList([two], [], { stamp, forced }).rows.map(row => row.stale)).toEqual([null, 'no such directory src/ports']);
    expect(openList([two], [], { stamp, forced }).edits.map(item => item.index)).toEqual([0]);
  });

  it('names the open raws of the latest turn by its stamp', () => {
    expect(openRaws([])).toEqual({ stamp: '', raws: [] });
    expect(openRaws([turn([cut]), turn([cut, fold], { '0': 'rejected' })])).toEqual({ stamp: '2:2026-10-21T09:00:00.000Z', raws: [fold] });
  });

  it('accepts only an applicable edit', () => {
    expect(acceptance(cut, null)).toEqual({ edit: cut });
    expect(acceptance(cut, 'no such file src/no-such.ts')).toEqual({ reason: 'no such file src/no-such.ts' });
    expect(acceptance(fold, null)).toEqual({ reason: 'not an edit' });
  });
});

function decideAway(open: ChatTurn): ChatTurn {
  return { ...open, decisions: { '0': 'accepted', '1': 'rejected' } };
}
