import { describe, expect, it } from 'vitest';
import type { ChatTurn, PlanEdit } from '../domain/plan.ts';
import { askTextOk, bumpTicket, chatStamp, invoke, keptDrop, latestTurn, openEdits, rawAt, reviewIfCurrent, withTurn, zipRows } from './ask.ts';

const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const fold = { kind: 'fold', file: 'src/app/a.ts' };

function turn(edits: unknown[] = [cut], decisions: ChatTurn['decisions'] = {}): ChatTurn {
  return { at: '2026-10-21T09:00:00.000Z', text: 'hi', summary: 'Done.', edits, decisions };
}

describe('ask rows', () => {
  it('zips the open edits with a stale reason or a forced drop', () => {
    expect(zipRows(null, [], null)).toEqual([]);
    const open = turn([cut, fold]);
    expect(zipRows(open, [], null).map(row => [row.index, row.stale, row.sentence])).toEqual([
      [0, null, 'src/app must not import src/domain (1 import)'],
      [1, null, JSON.stringify(fold)],
    ]);
    expect(zipRows(open, ['gone'], { index: 1, reason: 'forced' }).map(row => row.stale)).toEqual(['gone', 'forced']);
    expect(zipRows(decideAway(open), ['gone'], { index: 0, reason: 'forced' })).toEqual([]);
  });

  it('keeps only an applicable edit, and the latest turn', () => {
    const open = turn([cut, fold, { kind: 'note', target: { node: 'src' }, text: 'n' }]);
    const rows = zipRows(open, ['gone', null, null], null);
    expect(openEdits(rows).map(item => item.index)).toEqual([2]);
    expect(latestTurn([])).toBeNull();
    expect(latestTurn([open])).toBe(open);
    expect(withTurn([open, turn([])], turn([cut]))).toEqual([open, turn([cut])]);
    expect(chatStamp([])).toBe('');
    expect(chatStamp([open, turn([], { '0': 'accepted' })])).toBe('2:2026-10-21T09:00:00.000Z');
    expect(rawAt(null, 0)).toBeUndefined();
    expect(rawAt(open, 1)).toEqual(fold);
    expect(askTextOk('')).toBe(false);
    expect(askTextOk('  ')).toBe(false);
    expect(askTextOk('a')).toBe(true);
    expect(askTextOk('a\nb')).toBe(true);
    const forced = { index: 1, reason: 'no such directory src/ports' };
    expect(keptDrop(null, '1:t')).toBeNull();
    expect(keptDrop({ stamp: '1:t', forced }, '2:t')).toBeNull();
    expect(keptDrop({ stamp: '1:t', forced }, '1:t')).toEqual(forced);
    const tickets = { current: 0 };
    expect(bumpTicket(tickets)).toBe(1);
    expect(bumpTicket(tickets)).toBe(2);
    const applied: (string | null)[][] = [];
    reviewIfCurrent(1, 2, { stale: ['late'] }, stale => applied.push(stale));
    reviewIfCurrent(2, 2, { error: 'down' }, stale => applied.push(stale));
    reviewIfCurrent(2, 2, { stale: ['gone'] }, stale => applied.push(stale));
    expect(applied).toEqual([['gone']]);
    const called: string[] = [];
    invoke(null);
    invoke(() => called.push('ran'));
    expect(called).toEqual(['ran']);
  });
});

function decideAway(open: ChatTurn): ChatTurn {
  return { ...open, decisions: { '0': 'accepted', '1': 'rejected' } };
}
