import { describe, expect, it } from 'vitest';
import { unifiedDiff } from './linediff.ts';

const HEADER = '--- a/f\n+++ b/f\n';

function numbered(from: number, to: number): string {
  return Array.from({ length: to - from + 1 }, (_, index) => `${from + index}\n`).join('');
}

describe('unifiedDiff', () => {
  it('is only the two headers when nothing changed', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n', 'f')).toBe(HEADER);
    expect(unifiedDiff('', '', 'f')).toBe(HEADER);
  });

  it('adds every line to an empty file and removes every line to an empty text', () => {
    expect(unifiedDiff('', 'a\nb\n', 'f')).toBe(`${HEADER}@@ -0,0 +1,2 @@\n+a\n+b\n`);
    expect(unifiedDiff('a\nb\n', '', 'f')).toBe(`${HEADER}@@ -1,2 +0,0 @@\n-a\n-b\n`);
  });

  it('keeps three lines of context and replaces a changed line', () => {
    const before = numbered(1, 10);
    const after = before.replace('5\n', 'five\n');
    expect(unifiedDiff(before, after, 'f')).toBe(`${HEADER}@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n`);
  });

  it('splits far changes into hunks and joins near ones', () => {
    const before = numbered(1, 20);
    const far = before.replace('2\n', 'two\n').replace('18\n', 'eighteen\n');
    expect(unifiedDiff(before, far, 'f')).toBe(
      `${HEADER}@@ -1,5 +1,5 @@\n 1\n-2\n+two\n 3\n 4\n 5\n@@ -15,6 +15,6 @@\n 15\n 16\n 17\n-18\n+eighteen\n 19\n 20\n`,
    );
    const near = before.replace('5\n', 'five\n').replace('11\n', 'eleven\n');
    expect(unifiedDiff(before, near, 'f').match(/@@ -/g)).toHaveLength(1);
    expect(unifiedDiff(before, near, 'f')).toContain('@@ -2,13 +2,13 @@\n');
  });

  it('changes the first line of a file that keeps later lines', () => {
    expect(unifiedDiff('b\nc\nd\ne\nf\n', 'a\nb\nc\nd\ne\nf\n', 'f')).toBe(`${HEADER}@@ -1,3 +1,4 @@\n+a\n b\n c\n d\n`);
    expect(unifiedDiff('a\nb\nc\nd\ne\n', 'b\nc\nd\ne\n', 'f')).toBe(`${HEADER}@@ -1,4 +1,3 @@\n-a\n b\n c\n d\n`);
  });

  it('replaces the first of two equal lines', () => {
    expect(unifiedDiff('a\na\n', 'b\na\n', 'f')).toBe(`${HEADER}@@ -1,2 +1,2 @@\n-a\n+b\n a\n`);
  });

  it('joins two hunks whose context exactly touches', () => {
    const touching = numbered(1, 20).replace('5\n', 'five\n').replace('12\n', 'twelve\n');
    expect(unifiedDiff(numbered(1, 20), touching, 'f')).toBe(
      `${HEADER}@@ -2,14 +2,14 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n 9\n 10\n 11\n-12\n+twelve\n 13\n 14\n 15\n`,
    );
  });

  it('inserts lines between kept ones', () => {
    expect(unifiedDiff('a\nc\n', 'a\nb\nc\n', 'f')).toBe(`${HEADER}@@ -1,2 +1,3 @@\n a\n+b\n c\n`);
  });
});
