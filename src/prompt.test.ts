import { describe, expect, it } from 'vitest';
import { pendingRound, type PlanDoc, type PlanEdit, type Round } from './domain/plan.ts';
import { generateAskFrom, planAfter, promptOf, readReply, retryPrompt, turnFor, type PromptFacts, type Turn } from './domain/prompt.ts';
import type { PlanWarning, ScanResult } from './domain/scan.ts';

const FENCE = '```';
const SCAN: ScanResult = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/app/deep/c.ts', test: false },
    { path: 'src/domain/model.ts', test: false },
    { path: 'src/infra/db.ts', test: false },
    { path: 'src/apple.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'type' },
    { from: 'src/app/b.ts', to: 'src/domain/model.ts', kind: 'runtime' },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' },
  ],
  externals: [],
  workspaces: [],
};

function docOf(edits: PlanEdit[], extra: Partial<PlanDoc> = {}): PlanDoc {
  return { version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: 'a'.repeat(40), edits, redo: [], ...extra };
}

function factsOf(edits: PlanEdit[], turn: Turn = { interview: [], demanded: false }, warnings: PlanWarning[] = []): PromptFacts {
  return { doc: docOf(edits), scan: SCAN, warnings, guide: 'GUIDE', names: [], turn };
}

function touched(edits: PlanEdit[]): string[] {
  return promptOf(factsOf(edits))
    .split('\n')
    .filter(line => line.startsWith('src/') && line.includes(' imports '))
    .map(line => line.slice(0, line.indexOf(' imports ')));
}

const QUESTION = { id: 'q1', text: 'Why?', why: 'Because.' };
const PENDING: Round = { round: 1, questions: [QUESTION, { ...QUESTION, id: 'q2', text: 'How?' }], answers: [] };

describe('generateAskFrom', () => {
  it('reads the three steps exactly', () => {
    expect(generateAskFrom({ step: 'ask' })).toEqual({ step: 'ask' });
    expect(generateAskFrom({ step: 'answer', answers: ['a'] })).toEqual({ step: 'answer', answers: ['a'] });
    expect(generateAskFrom({ answers: [], step: 'write' })).toEqual({ step: 'write', answers: [] });
  });

  it('refuses anything else', () => {
    for (const raw of [null, [], 'ask', { step: 'ask', answers: [] }, { step: 'go', answers: [] }, { step: 'write' }, { step: 'write', answers: [1] }, { step: 'write', answers: 'a' }, { step: 'write', answers: [], x: 1 }]) {
      expect(generateAskFrom(raw)).toBeUndefined();
    }
  });
});

describe('turnFor', () => {
  it('empties the interview on ask', () => {
    expect(turnFor({ step: 'ask' }, [PENDING])).toEqual({ interview: [], demanded: false });
  });

  it('fills the pending round, storing a blank answer as your call', () => {
    expect(turnFor({ step: 'answer', answers: ['yes', ' '] }, [PENDING])).toEqual({ interview: [{ ...PENDING, answers: ['yes', 'your call'] }], demanded: false });
    expect(turnFor({ step: 'write', answers: ['', 'no'] }, [PENDING])).toEqual({ interview: [{ ...PENDING, answers: ['your call', 'no'] }], demanded: true });
  });

  it('demands slices once the third round is answered', () => {
    const answered = { ...PENDING, answers: ['a', 'b'] };
    const third = { ...PENDING, round: 3 };
    expect(turnFor({ step: 'answer', answers: ['c', 'd'] }, [answered, { ...answered, round: 2 }, third])?.demanded).toBe(true);
  });

  it('writes with no answers when nothing is pending, and refuses mismatches', () => {
    expect(turnFor({ step: 'write', answers: [] })).toEqual({ interview: [], demanded: true });
    const done = { ...PENDING, answers: ['a', 'b'] };
    expect(turnFor({ step: 'write', answers: [] }, [done])).toEqual({ interview: [done], demanded: true });
    expect(turnFor({ step: 'write', answers: ['a'] }, [done])).toBeUndefined();
    expect(turnFor({ step: 'write', answers: ['a'] }, [PENDING])).toBeUndefined();
    expect(turnFor({ step: 'answer', answers: [] })).toBeUndefined();
    expect(turnFor({ step: 'answer', answers: ['a'] }, [PENDING])).toBeUndefined();
  });
});

describe('pendingRound', () => {
  it('is the last round while it has questions and no answers', () => {
    expect(pendingRound([PENDING])).toBe(PENDING);
    expect(pendingRound([])).toBeUndefined();
    expect(pendingRound([{ ...PENDING, questions: [] }])).toBeUndefined();
    expect(pendingRound([PENDING, { ...PENDING, answers: ['a', 'b'] }])).toBeUndefined();
  });
});

describe('promptOf', () => {
  it('names the files each kind of edit touches, expanding packages', () => {
    expect(touched([{ kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' }])).toEqual(['src/app/a.ts']);
    expect(touched([{ kind: 'fate', file: 'src/app/a.ts', fate: 'fold', into: 'src/infra/db.ts' }])).toEqual(['src/app/a.ts', 'src/infra/db.ts']);
    expect(touched([{ kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }])).toEqual(['src/app/b.ts']);
    expect(touched([{ kind: 'add-edge', from: 'src/infra/db.ts', to: 'src/apple.ts' }])).toEqual(['src/apple.ts', 'src/infra/db.ts']);
    expect(touched([{ kind: 'note', target: { edge: ['src/infra', 'src/domain'] }, text: 'x' }])).toEqual(['src/domain/model.ts', 'src/infra/db.ts']);
    expect(touched([{ kind: 'rename-package', from: 'src/app', to: 'src/core' }])).toEqual(['src/app/a.ts', 'src/app/b.ts', 'src/app/deep/c.ts']);
    expect(touched([{ kind: 'merge-packages', packages: ['src/domain', 'src/infra'], into: 'src/core' }])).toEqual(['src/domain/model.ts', 'src/infra/db.ts']);
    expect(touched([{ kind: 'split-package', package: 'src/app/deep', parts: [] }])).toEqual(['src/app/deep/c.ts']);
    expect(touched([{ kind: 'create-package', path: 'src' }, { kind: 'move-file', file: 'src/gone.ts', to: 'src' }])).toEqual([]);
  });

  it('lists imports once and sorted, with nothing when empty', () => {
    const lines = promptOf(factsOf([{ kind: 'note', target: { node: 'src/app' }, text: 'x' }])).split('\n');
    expect(lines).toContain('src/app/a.ts imports src/app/b.ts');
    expect(lines).toContain('src/app/a.ts is imported by nothing');
    expect(lines).toContain('src/app/b.ts is imported by src/app/a.ts');
  });

  it('words each warning as the Changes list does', () => {
    const text = promptOf(
      factsOf([], undefined, [
        { kind: 'empty-package', path: 'src/core' },
        { kind: 'added-cycle', cycle: 'a → b → a' },
        { kind: 'deleted-imports', file: 'src/x.ts', importers: ['src/y.ts'] },
        { kind: 'deleted-imports', file: 'src/z.ts', importers: ['a', 'b', 'c'] },
      ]),
    );
    for (const line of ['src/core is empty', 'this plan adds a cycle: a → b → a', '1 file still imports src/x.ts, which this plan deletes', '3 files still import src/z.ts, which this plan deletes']) {
      expect(text.split('\n')).toContain(line);
    }
  });

  it('writes the answered questions, the guide, the names and the demand', () => {
    const facts = { ...factsOf([], { interview: [{ ...PENDING, answers: ['yes', 'your call'] }], demanded: true }), names: ['004-x.md'] };
    const text = promptOf(facts);
    expect(text).toContain('Q: Why?\nA: yes\nQ: How?\nA: your call');
    expect(text).toContain('GUIDE');
    expect(text).toContain('004-x.md');
    expect(text.endsWith('Reply with slices now.')).toBe(true);
    expect(text).not.toContain('To ask, reply');
  });

  it('adds the reason to a retry', () => {
    expect(retryPrompt('P', 'why')).toBe('P\n\nYour last reply was not usable: why');
  });
});

describe('readReply', () => {
  const slices = { slices: [{ title: 'T', slug: 'a-1', body: '' }], brief: '' };

  it('reads the last fenced json block, else all of stdout', () => {
    expect(readReply(`${FENCE}json\n{"questions":[]}\n${FENCE}\nthen\n${FENCE}json\n${JSON.stringify(slices)}\n${FENCE}`, true)).toEqual(slices);
    expect(readReply(JSON.stringify({ questions: [QUESTION] }), false)).toEqual({ questions: [QUESTION] });
  });

  it('says why a reply is not usable', () => {
    const many = { questions: Array.from({ length: 6 }, (_, index) => ({ ...QUESTION, id: `q${index}` })) };
    const cases: [string, boolean, string][] = [
      ['{', false, 'it is not valid JSON'],
      ['[1]', false, 'it is neither'],
      [JSON.stringify(many), false, 'it needs 1 to 5 questions'],
      [JSON.stringify({ questions: [{ ...QUESTION, why: ' ' }] }), false, 'it needs 1 to 5 questions'],
      [JSON.stringify({ questions: [{ id: 'q', text: 't' }] }), false, 'it needs 1 to 5 questions'],
      [JSON.stringify({ questions: ['q'] }), false, 'it needs 1 to 5 questions'],
      [JSON.stringify({ questions: {} }), false, 'it needs 1 to 5 questions'],
      [JSON.stringify({ questions: [QUESTION] }), true, 'it asked questions, but slices were demanded'],
      [JSON.stringify({ ...slices, brief: 1 }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: [], brief: '' }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: ['s'], brief: '' }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: [{ title: '', slug: 'a', body: '' }], brief: '' }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: [{ title: 't', slug: '-a', body: '' }], brief: '' }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: [{ title: 't', slug: 'a' }], brief: '' }), false, 'it needs at least one slice'],
      [JSON.stringify({ slices: [{ title: 't', slug: 7, body: '' }], brief: '' }), false, 'it needs at least one slice'],
    ];
    for (const [stdout, demanded, reason] of cases) {
      const reply = readReply(stdout, demanded);
      expect('problem' in reply ? reply.problem : '').toContain(reason);
    }
  });
});

describe('planAfter', () => {
  const doc = docOf([]);
  const turn: Turn = { interview: [{ ...PENDING, answers: ['a', 'b'] }], demanded: false };

  it('appends asked questions as the next pending round', () => {
    expect(planAfter(doc, turn, { questions: [QUESTION] }, 1)).toEqual({ ...doc, interview: [...turn.interview, { round: 2, questions: [QUESTION], answers: [] }] });
  });

  it('numbers slices from the first free number and stops past 999', () => {
    const reply = { slices: [{ title: 'T', slug: 't', body: '# old\n\n\nbody\n' }, { title: 'U', slug: 'u', body: '# only' }], brief: 'B' };
    expect(planAfter(doc, turn, reply, 998)).toEqual({
      ...doc,
      interview: turn.interview,
      tasks: [
        { file: '998-t.md', title: 'T', body: '# 998 — T\n\nbody\n' },
        { file: '999-u.md', title: 'U', body: '# 999 — U\n\n' },
      ],
      brief: 'B',
    });
    expect(planAfter(doc, turn, reply, 999)).toEqual({ error: 'task numbers would pass 999' });
  });
});
