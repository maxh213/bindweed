import { describe, expect, it } from 'vitest';
import { buildTree, filePathSet } from './domain/tree.ts';

describe('buildTree', () => {
  it('lists folders first then files in byte order', () => {
    const tree = buildTree('demo-repo', [
      '.gitignore',
      'README.md',
      'Zebra.txt',
      'apple.txt',
      'docs/guide.md',
      'src/a.ts',
      'src/lib/util.ts',
    ]);
    expect(tree).toEqual({
      root: 'demo-repo',
      entries: [
        {
          name: 'docs',
          path: 'docs',
          kind: 'dir',
          children: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'file' }],
        },
        {
          name: 'src',
          path: 'src',
          kind: 'dir',
          children: [
            {
              name: 'lib',
              path: 'src/lib',
              kind: 'dir',
              children: [{ name: 'util.ts', path: 'src/lib/util.ts', kind: 'file' }],
            },
            { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
          ],
        },
        { name: '.gitignore', path: '.gitignore', kind: 'file' },
        { name: 'README.md', path: 'README.md', kind: 'file' },
        { name: 'Zebra.txt', path: 'Zebra.txt', kind: 'file' },
        { name: 'apple.txt', path: 'apple.txt', kind: 'file' },
      ],
    });
  });

  it('lists no entries for an empty path list', () => {
    expect(buildTree('empty-repo', [])).toEqual({ root: 'empty-repo', entries: [] });
  });

  it('skips blank paths from a zero-byte ls-files split', () => {
    expect(buildTree('empty-repo', [''])).toEqual({ root: 'empty-repo', entries: [] });
  });

  it('holds a non-ASCII file under its folder', () => {
    const tree = buildTree('demo-repo', ['notes/żółw i zając.md']);
    expect(tree.entries[0]).toEqual({
      name: 'notes',
      path: 'notes',
      kind: 'dir',
      children: [{ name: 'żółw i zając.md', path: 'notes/żółw i zając.md', kind: 'file' }],
    });
  });
});

describe('filePathSet', () => {
  it('collects only file paths', () => {
    const tree = buildTree('r', ['a/b.ts', 'c.txt']);
    expect([...filePathSet(tree.entries)].sort()).toEqual(['a/b.ts', 'c.txt']);
    expect([...filePathSet([{ name: 'empty', path: 'empty', kind: 'dir' }])]).toEqual([]);
  });
});
