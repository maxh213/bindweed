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

  it('inserts lines between kept ones', () => {
    expect(unifiedDiff('a\nc\n', 'a\nb\nc\n', 'f')).toBe(`${HEADER}@@ -1,2 +1,3 @@\n a\n+b\n c\n`);
  });
});
