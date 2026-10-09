import { describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMock);

import { listPlans } from './plans.ts';

function docText(slug: string, createdAt: string): string {
  return JSON.stringify({ version: 1, name: `Plan ${slug}`, slug, createdAt, baseCommit: 'a'.repeat(40), edits: [], redo: [] });
}

describe('listPlans ordering', () => {
  it('sorts by createdAt then slug whatever the directory order', async () => {
    fsMock.readdir.mockResolvedValue(['z-plan.json', 'b-plan.json', 'a-plan.json']);
    fsMock.readFile.mockImplementation(async path => {
      const text = String(path);
      if (text.includes('z-plan')) return docText('z-plan', '2026-10-01T00:00:00.000Z');
      if (text.includes('b-plan')) return docText('b-plan', '2026-10-02T00:00:00.000Z');
      return docText('a-plan', '2026-10-01T00:00:00.000Z');
    });
    expect(await listPlans('/repo')).toEqual([
      { name: 'Plan a-plan', slug: 'a-plan', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
      { name: 'Plan z-plan', slug: 'z-plan', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
      { name: 'Plan b-plan', slug: 'b-plan', editCount: 0, createdAt: '2026-10-02T00:00:00.000Z' },
    ]);
  });

  it('lists nothing when the plans directory cannot be read', async () => {
    fsMock.readdir.mockRejectedValue(new Error('missing'));
    expect(await listPlans('/repo')).toEqual([]);
  });
});
