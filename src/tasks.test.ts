import { describe, expect, it } from 'vitest';
import type { PlanTask } from './domain/plan.ts';
import { editTasks, firstFreeNumber, lastTaskNumber, markdownBlocks, numberedTasks } from './domain/tasks.ts';

const THREE: PlanTask[] = numberedTasks(
  [
    { title: 'Add the core package', slug: 'add-core', body: 'Create src/core.\n' },
    { title: 'Move b into infra', slug: 'move-b', body: 'Move src/app/b.ts to src/infra.\n' },
    { title: 'Cut app from domain', slug: 'cut-app-domain', body: '# Cut\nNo behaviour changes.\n' },
  ],
  5,
);

function files(tasks: PlanTask[]): string[] {
  return tasks.map(task => task.file);
}

describe('task numbers', () => {
  it('starts after the highest three-digit name, or at 1', () => {
    expect(firstFreeNumber(['004-x.md', 'README.md', '1234-y.md', '12-z.md', '002-a.md'])).toBe(5);
    expect(firstFreeNumber([])).toBe(1);
    expect(firstFreeNumber(['README.md'])).toBe(1);
  });

  it('reads the last number of a list', () => {
    expect(lastTaskNumber(THREE)).toBe(7);
    expect(lastTaskNumber([])).toBe(0);
  });

  it('writes the heading and drops the reply heading and leading blank lines', () => {
    expect(THREE.map(task => task.body)).toEqual(['# 005 — Add the core package\n\nCreate src/core.\n', '# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n', '# 007 — Cut app from domain\n\nNo behaviour changes.\n']);
    expect(numberedTasks([{ title: 'T', slug: 't', body: '\n \n# Not a heading\n' }], 1)[0].body).toBe('# 001 — T\n\n# Not a heading\n');
  });
});

describe('editTasks', () => {
  it('moves up and down and renumbers files and headings', () => {
    const up = editTasks(THREE, { kind: 'up', index: 2 });
    expect(files(up)).toEqual(['005-add-core.md', '006-cut-app-domain.md', '007-move-b.md']);
    expect(up[1].body.startsWith('# 006 — Cut app from domain')).toBe(true);
    expect(files(editTasks(THREE, { kind: 'down', index: 0 }))).toEqual(['005-move-b.md', '006-add-core.md', '007-cut-app-domain.md']);
  });

  it('merges under the first title and deletes', () => {
    const up = editTasks(THREE, { kind: 'up', index: 2 });
    const merged = editTasks(up, { kind: 'merge', index: 0 });
    expect(files(merged)).toEqual(['005-add-core.md', '006-move-b.md']);
    expect(merged[0]).toEqual({ file: '005-add-core.md', title: 'Add the core package', body: '# 005 — Add the core package\n\nCreate src/core.\n\nNo behaviour changes.\n' });
    expect(files(editTasks(merged, { kind: 'delete', index: 1 }))).toEqual(['005-add-core.md']);
  });

  it('retitles, keeps the slug, splits and edits a body', () => {
    const renamed = editTasks(THREE, { kind: 'title', index: 0, text: 'Add src/core' });
    expect(renamed[0]).toEqual({ file: '005-add-core.md', title: 'Add src/core', body: '# 005 — Add src/core\n\nCreate src/core.\n' });
    const split = editTasks(renamed, { kind: 'split', index: 0 });
    expect(files(split)).toEqual(['005-add-core.md', '006-add-core.md', '007-move-b.md', '008-cut-app-domain.md']);
    expect(split[1].body).toBe('# 006 — Add src/core\n\nCreate src/core.\n');
    const body = editTasks(THREE, { kind: 'body', index: 1, text: '# 999 — wrong\nNew words.\n' });
    expect(body[1].body).toBe('# 006 — Move b into infra\n\nNew words.\n');
  });
});

describe('markdownBlocks', () => {
  it('reads h1, h2 and paragraphs split at blank lines', () => {
    expect(markdownBlocks('# 005 — Add\n\nCreate src/core.\nMore.\n\n## Then\nLast\n')).toEqual([
      { kind: 'h1', text: '005 — Add' },
      { kind: 'p', text: 'Create src/core.\nMore.' },
      { kind: 'h2', text: 'Then' },
      { kind: 'p', text: 'Last' },
    ]);
    expect(markdownBlocks('')).toEqual([]);
  });
});
