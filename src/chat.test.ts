import { describe, expect, it } from 'vitest';
import { chatLines, decide, editSentence, freshTurn, oneParagraph, parseChat, proposeFrom, rejectOpen, reviewFrom, undecided } from './domain/chat.ts';
import type { PlanEdit } from './domain/plan.ts';

describe('chat documents', () => {
  const at = '2026-10-21T09:00:00.000Z';
  const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
  const fold = { kind: 'fold', file: 'src/app/a.ts' };

  function turn(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { at, text: 'hi', summary: 'Done.', edits: [], decisions: {}, ...over };
  }

  it('reads one paragraph and refuses the rest', () => {
    expect(oneParagraph('Pull it out.')).toBe(true);
    expect(oneParagraph(' a ')).toBe(true);
    for (const value of [1, null, '', '   ', 'a\nb', 'a\rb', 'a\r\nb']) expect(oneParagraph(value)).toBe(false);
  });

  it('parses a chat and refuses a document that is not one', () => {
    const good = turn({ text: ' ', edits: [cut], decisions: { '0': 'accepted' } });
    expect(parseChat([good])).toEqual([{ at, text: ' ', summary: 'Done.', edits: [cut], decisions: { '0': 'accepted' } }]);
    const rejected = turn({ edits: [cut], decisions: { '0': 'rejected' } });
    expect(parseChat([rejected])).toEqual([{ at, text: 'hi', summary: 'Done.', edits: [cut], decisions: { '0': 'rejected' } }]);
    expect(parseChat([])).toEqual([]);
    const bad = [
      null,
      'x',
      [turn({ extra: 1 })],
      [turn({ at: 'yesterday' })],
      [turn({ text: '' })],
      [turn({ text: 1 })],
      [turn({ summary: '   ' })],
      [turn({ summary: 'a\nb' })],
      [turn({ summary: 1 })],
      [turn({ edits: {} })],
      [turn({ decisions: [] })],
      [turn({ decisions: null })],
      [turn({ edits: [cut], decisions: { '01': 'accepted' } })],
      [turn({ edits: [cut], decisions: { '1': 'accepted' } })],
      [turn({ edits: [cut], decisions: { '0': 'open' } })],
      [turn({ edits: [cut], decisions: { '0': 1 } })],
      [turn({ edits: [cut, cut], decisions: { '01': 'accepted' } })],
      [turn({ edits: [cut], decisions: { '0x': 'accepted' } })],
      [turn({ edits: [cut, cut], decisions: { 'x1': 'accepted' } })],
      [turn({ text: ['x'] })],
      [turn(), null],
    ];
    for (const raw of bad) expect(parseChat(raw)).toBeUndefined();
    const eleven = Array.from({ length: 11 }, () => cut);
    expect(parseChat([turn({ edits: eleven, decisions: { '10': 'rejected', '1': 'accepted' } })])?.[0].decisions).toEqual({ '10': 'rejected', '1': 'accepted' });
  });

  it('quotes a turn the way the prompt does, including a value that is not an edit', () => {
    const first = freshTurn('split it\nby job', 'Split app.', [cut, fold], at);
    const second = decide(freshTurn('keep it', 'Leave it.', [fold], '2026-10-21T09:05:00.000Z'), 0, 'rejected');
    expect(editSentence(fold)).toBe(JSON.stringify(fold));
    expect(editSentence(cut)).toBe('src/app must not import src/domain (1 import)');
    expect(chatLines([first, second])).toEqual([
      'They said: split it',
      '  by job',
      'Summary: Split app.',
      '0 open: src/app must not import src/domain (1 import)',
      `1 open: ${JSON.stringify(fold)}`,
      'They said: keep it',
      'Summary: Leave it.',
      `0 rejected: ${JSON.stringify(fold)}`,
    ]);
    expect(undecided(first)).toEqual([0, 1]);
    expect(undecided(second)).toEqual([]);
    expect(rejectOpen(first).decisions).toEqual({ '0': 'rejected', '1': 'rejected' });
    expect(chatLines([freshTurn('one line', 'S.', [], at)])).toEqual(['They said: one line', 'Summary: S.']);
  });

  it('reads a propose body and a review body exactly', () => {
    expect(proposeFrom({ text: 'hi\nthere', at: '' })).toEqual({ text: 'hi\nthere', at: '' });
    expect(proposeFrom({ at: 'src', text: '  x  ' })).toEqual({ text: '  x  ', at: 'src' });
    for (const raw of [null, [], 'x', { text: 'hi' }, { text: 'hi', at: 1 }, { text: 1, at: 'src' }, { text: '  ', at: 'src' }, { text: '', at: '' }, { text: 'hi', at: 'src', extra: 1 }]) {
      expect(proposeFrom(raw)).toBeUndefined();
    }
    expect(reviewFrom({ edits: [cut] })).toEqual([cut]);
    expect(reviewFrom({ edits: [] })).toEqual([]);
    for (const raw of [null, [], { edits: {} }, { edits: [], extra: 1 }, { edits: [cut], x: 1 }]) expect(reviewFrom(raw)).toBeUndefined();
  });
});
