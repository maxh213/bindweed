import { describe, expect, it } from 'vitest';
import { decodeHashPath, encodeHashPath, textLines } from './domain/lines.ts';

describe('textLines', () => {
  it('splits text without a trailing empty line from a final newline', () => {
    expect(textLines("export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n")).toEqual([
      'export const a = 1;',
      "export const name = 'żółw';",
      'export const sum = a + 2;',
    ]);
    expect(textLines('one\ntwo')).toEqual(['one', 'two']);
    expect(textLines('one\n\ntwo\n')).toEqual(['one', '', 'two']);
    expect(textLines('')).toEqual([]);
  });
});

describe('encodeHashPath', () => {
  it('encodes each segment and keeps slashes', () => {
    expect(encodeHashPath('src/a.ts')).toBe('src/a.ts');
    expect(encodeHashPath('notes/żółw i zając.md')).toBe('notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
  });
});

describe('decodeHashPath', () => {
  it('decodes a slash-preserving hash path', () => {
    expect(decodeHashPath('notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md')).toBe('notes/żółw i zając.md');
  });
});
