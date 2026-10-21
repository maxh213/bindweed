import { describe, expect, it } from 'vitest';
import { pendingRound, type PlanDoc, type PlanEdit, type Round } from './domain/plan.ts';
import { generateAskFrom, planAfter, promptOf, proposePrompt, readProposal, readReply, retryPrompt, turnFor, type PromptEdge, type PromptFacts, type PromptNode, type ProposeFacts, type Turn } from './domain/prompt.ts';
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

  it('keeps the sections in the pinned order', () => {
    const doc = docOf([{ kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' }], { contract: { rules: [{ name: 'bindweed:r', severity: 'error', comment: 'C', from: {}, to: { circular: true } }] } });
    const interview = [{ ...PENDING, answers: ['yes', 'your call'] }];
    const facts: PromptFacts = { doc, scan: SCAN, warnings: [{ kind: 'empty-package', path: 'src/core' }], guide: 'GUIDE', names: ['004-x.md'], turn: { interview, demanded: false } };
    const asked = [
      'Move src/app/a.ts to src/infra',
      'src/core is empty',
      'bindweed:r: C',
      'src/app/a.ts imports src/app/b.ts',
      'GUIDE',
      '004-x.md',
      'Q: Why?',
      'Order the slices so each leaves the repository working: leaves and new packages first, then moves, then cuts, then the contract.',
      'Reply with exactly one JSON object, in a fenced json block.',
      'To ask, reply {"questions":[{"id":"<id>","text":"<question>","why":"<why you ask>"}]} with at most 5 questions.',
      'To write, reply {"slices":[{"title":"<title>","slug":"<slug>","body":"<markdown>"}],"brief":"<markdown>"}.',
    ];
    const indexesIn = (text: string, lines: string[]) => lines.map(line => text.split('\n').indexOf(line));
    const ascending = (indexes: number[]) => [...indexes].sort((a, b) => a - b);
    const askIndexes = indexesIn(promptOf(facts), asked);
    expect(askIndexes).not.toContain(-1);
    expect(askIndexes).toEqual(ascending(askIndexes));
    const demanded = [...asked.filter(line => !line.startsWith('To ask')), 'Reply with slices now.'];
    const demandIndexes = indexesIn(promptOf({ ...facts, turn: { interview, demanded: true } }), demanded);
    expect(demandIndexes).not.toContain(-1);
    expect(demandIndexes).toEqual(ascending(demandIndexes));
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

describe('proposePrompt', () => {
  const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
  const move: PlanEdit = { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' };

  function node(over: Partial<PromptNode> = {}): PromptNode {
    return { id: 'src/a.ts', kind: 'file', name: 'a.ts', ca: 1, ce: 0, i: '0.00', a: '0.00', d: '1.00', cycle: false, ...over };
  }

  function edge(over: Partial<PromptEdge> = {}): PromptEdge {
    return { from: 'src/a', to: 'src/b', runtime: 1, type: 0, cycle: false, ...over };
  }

  function facts(over: Partial<ProposeFacts> = {}): ProposeFacts {
    return { name: 'Gate', text: 'the ui knows about the scanner', at: 'src', views: [], edits: [], turns: [], ...over };
  }

  it('writes the sections, health fields, heritage and the smaller cycle text', () => {
    const prompt = proposePrompt(facts({
      at: '',
      text: 'split it\nby job',
      edits: [cut, move],
      turns: [
        { at: '2026-10-21T09:00:00.000Z', text: 'the ui knows about the scanner', summary: 'Pull scanning out.', edits: [cut], decisions: { '0': 'accepted' } },
      ],
      views: [
        {
          at: '',
          nodes: [
            node({ id: 'src', kind: 'package', name: 'src', files: 4, zone: 'healthy', crap: '–', mutants: 0 }),
            node({ id: 'src/rule.ts', name: 'rule.ts', crap: 2.5, coverage: '0.50', mutants: 1, i: '–' }),
            node({ id: 'src/bare.ts', name: 'bare.ts' }),
          ],
          edges: [
            edge({ heritage: 2, cycle: true, cycleText: 'b → a → b' }),
            edge({ from: 'src/b', to: 'src/a', heritage: 0, cycle: true, cycleText: 'a → b → a' }),
            edge({ from: 'src/c', to: 'src/d', runtime: 0, type: 1 }),
          ],
        },
        { at: 'src', nodes: [node({ id: 'src/app', kind: 'package', name: 'app', files: 2 })], edges: [] },
      ],
    }));
    expect(prompt.startsWith('You are proposing edits to the plan "Gate". The developer says what they dislike; you propose edits they will accept or reject. You change nothing yourself.')).toBe(true);
    expect(prompt).toContain('## What they dislike\nsplit it\nby job');
    expect(prompt).toContain('## Current view\n(root)');
    expect(prompt).toContain('node src package src files 4 ca 1 ce 0 i 0.00 a 0.00 d 1.00 zone healthy crap – mutants 0 cycle false');
    expect(prompt).toContain('node src/rule.ts file rule.ts ca 1 ce 0 i – a 0.00 d 1.00 crap 2.5 coverage 0.50 mutants 1 cycle false');
    expect(prompt).toContain('node src/bare.ts file bare.ts ca 1 ce 0 i 0.00 a 0.00 d 1.00 cycle false');
    expect(prompt).toContain('edge src/a -> src/b runtime 1 type 0 heritage 2 cycle true text b → a → b');
    expect(prompt).toContain('edge src/b -> src/a runtime 1 type 0 cycle true text a → b → a');
    expect(prompt).toContain('edge src/c -> src/d runtime 0 type 1 cycle false');
    expect(prompt).toContain('cycles a → b → a');
    expect(prompt).not.toContain('cycles b → a → b');
    expect(prompt).toContain('### src\nnode src/app package app files 2');
    expect(prompt).toContain('## The plan\'s edits so far\nsrc/app must not import src/domain (1 import)\nMove src/app/b.ts to src/ports\n' + JSON.stringify([cut, move]));
    expect(prompt).toContain('{"kind":"fate","file":"<path>","fate":"fold","into":"<path>"}');
    expect(prompt).toContain('## Conversation so far\nThey said: the ui knows about the scanner\nSummary: Pull scanning out.\n0 accepted: src/app must not import src/domain (1 import)');
    expect(prompt).toContain('## What to reply\nReply with exactly one JSON object, in a fenced json block.\n{"summary":"<one paragraph>","edits":[<edit>]}');
    expect(prompt).not.toContain('crapMax');
    expect(prompt).not.toContain('coverage on');
    expect(prompt).not.toContain('mutation on');
  });

  it('says none when there is no graph, no edit and no turn', () => {
    const prompt = proposePrompt(facts());
    expect(prompt).toContain('## Current view\nsrc');
    expect(prompt).toContain('## Planned graph\nnone');
    expect(prompt).toContain('## The plan\'s edits so far\nnone');
    expect(prompt).toContain('## Conversation so far\nnone');
    const quiet = proposePrompt(facts({ views: [{ at: 'src', nodes: [], edges: [edge()] }] }));
    expect(quiet).toContain('### src\nedge src/a -> src/b runtime 1 type 0 cycle false\ncycles none');
  });
});

describe('readProposal', () => {
  const good = { summary: 'Pull it out.', edits: [{ kind: 'note', target: { node: 'src' }, text: 'x' }] };

  function fence(value: unknown): string {
    return `prose\n\`\`\`json\n{"example":1}\n\`\`\`\nProposed.\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`;
  }

  it('reads the last fenced object and names the first failing reason', () => {
    expect(readProposal(fence(good))).toEqual(good);
    expect(readProposal(JSON.stringify(good))).toEqual(good);
    expect(readProposal('{"summary":"ok","edits":[]}')).toEqual({ summary: 'ok', edits: [] });
    const reasons: [string, string][] = [
      ['nope', 'it is not valid JSON'],
      [fence([1]), 'it needs a summary and an edits array'],
      [fence({ summary: 'ok', edits: [], extra: 1 }), 'it needs a summary and an edits array'],
      [fence({ summary: 'ok' }), 'it needs a summary and an edits array'],
      [fence({ summary: 1, edits: [] }), 'it needs a summary and an edits array'],
      [fence({ summary: 'ok', edits: {} }), 'it needs a summary and an edits array'],
      [fence({ edits: [], summary: '' }), 'the summary must be one paragraph'],
      [fence({ edits: [], summary: '   ' }), 'the summary must be one paragraph'],
      [fence({ edits: [], summary: 'one\ntwo' }), 'the summary must be one paragraph'],
      [fence({ edits: [], summary: 'one\rtwo' }), 'the summary must be one paragraph'],
    ];
    for (const [stdout, reason] of reasons) expect(readProposal(stdout)).toEqual({ problem: reason });
  });
});
