import { describe, expect, it } from 'vitest';
import type { PlanDoc, PlanSummary } from '../domain/plan.ts';
import { planRoster } from './planroster.ts';

const PLANS: PlanSummary[] = [
  { name: 'Split app', slug: 'split-app', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
  { name: 'Split app', slug: 'split-app-2', editCount: 1, createdAt: '2026-10-02T00:00:00.000Z' },
  { name: 'Other', slug: 'other', editCount: 0, createdAt: '2026-10-03T00:00:00.000Z' },
];

const DOC: PlanDoc = {
  version: 1,
  name: 'Split app',
  slug: 'split-app',
  createdAt: '2026-10-01T00:00:00.000Z',
  baseCommit: 'a'.repeat(40),
  edits: [],
  redo: [],
};

describe('planRoster', () => {
  it('labels a repeated name with its slug and maps the open slug', () => {
    const open = planRoster({ plans: PLANS }, DOC, 'split-app-2', 'split-app');
    expect(open.labels.get('split-app')).toBe('Split app');
    expect(open.labels.get('split-app-2')).toBe('Split app (split-app-2)');
    expect(open.labels.get('other')).toBe('Other');
    expect(open.choice).toBe('split-app-2');
    expect(open.plans).toBe(PLANS);
    expect(open.doc).toBe(DOC);
    expect(planRoster({ plans: PLANS }, DOC, null, null).choice).toBe('');
    expect(planRoster({ plans: PLANS }, DOC, 'missing', null).choice).toBe('');
  });

  it('reads the loaded values and falls back on absence and errors', () => {
    expect(planRoster(undefined, undefined, null, null)).toEqual({ plans: [], doc: null, labels: new Map(), choice: '', deleteName: '' });
    expect(planRoster({ error: 'down' }, { error: 'no such plan' }, null, null).plans).toEqual([]);
    expect(planRoster({ error: 'down' }, { error: 'no such plan' }, null, null).doc).toBeNull();
    const one = planRoster({ plans: [{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }] }, DOC, 'p', 'p');
    expect(one.plans).toEqual([{ name: 'P', slug: 'p', editCount: 0, createdAt: 'x' }]);
    expect(one.doc).toBe(DOC);
  });

  it('names the plan from the list, then the document, then nothing', () => {
    const plans: PlanSummary[] = [{ name: 'Split app', slug: 'split-app', editCount: 0, createdAt: 'x' }];
    expect(planRoster({ plans }, null, null, 'split-app').deleteName).toBe('Split app');
    expect(planRoster({ plans }, DOC, null, 'missing').deleteName).toBe('Split app');
    expect(planRoster({ plans: [] }, null, null, null).deleteName).toBe('');
  });
});
