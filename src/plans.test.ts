import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanDoc } from './domain/plan.ts';
import { freePlanSlug, listPlans, readPlan, removePlan, writePlan } from './plans.ts';

function docOf(slug: string, createdAt: string, name = 'Split app'): PlanDoc {
  return {
    version: 1,
    name,
    slug,
    createdAt,
    baseCommit: 'a'.repeat(40),
    edits: [],
    redo: [],
  };
}

describe('plans store', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bw-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('writes and reads a plan document', async () => {
    const doc = docOf('split-app', '2026-10-01T00:00:00.000Z');
    await writePlan(root, doc);
    expect(await readPlan(root, 'split-app')).toEqual(doc);
  });

  it('reads a missing or corrupt file as no plan', async () => {
    expect(await readPlan(root, 'missing')).toBeUndefined();
    await writePlan(root, docOf('split-app', '2026-10-01T00:00:00.000Z'));
    await writeFile(join(root, '.bindweed', 'plans', 'split-app.json'), 'not json');
    expect(await readPlan(root, 'split-app')).toBeUndefined();
    await writeFile(join(root, '.bindweed', 'plans', 'shape.json'), JSON.stringify({ version: 2 }));
    expect(await readPlan(root, 'shape')).toBeUndefined();
  });

  it('removes a plan and reports a missing one', async () => {
    await writePlan(root, docOf('split-app', '2026-10-01T00:00:00.000Z'));
    expect(await removePlan(root, 'split-app')).toBe(true);
    expect(await removePlan(root, 'split-app')).toBe(false);
  });

  it('lists summaries sorted by createdAt then slug, skipping non-plans', async () => {
    await writePlan(root, docOf('b-plan', '2026-10-02T00:00:00.000Z', 'B'));
    await writePlan(root, docOf('a-plan', '2026-10-01T00:00:00.000Z', 'A'));
    await writePlan(root, docOf('z-plan', '2026-10-01T00:00:00.000Z', 'Z'));
    await writeFile(join(root, '.bindweed', 'plans', 'note.txt'), 'hello');
    await writeFile(join(root, '.bindweed', 'plans', 'broken.json'), 'not json');
    expect(await listPlans(root)).toEqual([
      { name: 'A', slug: 'a-plan', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
      { name: 'Z', slug: 'z-plan', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
      { name: 'B', slug: 'b-plan', editCount: 0, createdAt: '2026-10-02T00:00:00.000Z' },
    ]);
  });

  it('lists nothing when the plans directory is absent', async () => {
    expect(await listPlans(root)).toEqual([]);
    expect(await freePlanSlug(root, 'fresh')).toBe('fresh');
  });

  it('skips a non-json file even when a same-named plan exists', async () => {
    await writePlan(root, docOf('evil', '2026-10-01T00:00:00.000Z'));
    await writeFile(join(root, '.bindweed', 'plans', 'evilx.jso'), 'whatever');
    expect(await listPlans(root)).toEqual([{ name: 'Split app', slug: 'evil', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' }]);
  });

  it('counts the edits, not the redo stack', async () => {
    const doc: PlanDoc = {
      ...docOf('split-app', '2026-10-01T00:00:00.000Z'),
      edits: [{ kind: 'add-edge', from: 'src/a', to: 'src/b' }],
      redo: [
        { kind: 'note', target: { node: 'src/a' }, text: 'x' },
        { kind: 'note', target: { node: 'src/b' }, text: 'y' },
      ],
    };
    await writePlan(root, doc);
    const listed = await listPlans(root);
    expect(listed[0]?.editCount).toBe(1);
  });

  it('finds a free slug after clashes', async () => {
    await writePlan(root, docOf('split-app', '2026-10-01T00:00:00.000Z'));
    await writePlan(root, docOf('split-app-2', '2026-10-02T00:00:00.000Z'));
    expect(await freePlanSlug(root, 'split-app')).toBe('split-app-3');
    expect(await freePlanSlug(root, 'fresh')).toBe('fresh');
  });
});
