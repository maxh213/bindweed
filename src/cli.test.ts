import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { isEntry, main, runIfMain } from './cli.ts';

const self = import.meta.url;
const selfPath = fileURLToPath(self);

function capture(): { out: { write(text: string): void }; lines: string[] } {
  const lines: string[] = [];
  return { out: { write: (text: string) => lines.push(text) }, lines };
}

describe('cli', () => {
  it('prints its name and the arguments it was given', () => {
    const { out, lines } = capture();
    expect(main(['node', 'bindweed', 'here', 'now'], out)).toBe(0);
    expect(lines).toEqual(['bindweed here now\n']);
  });

  it('prints only its name when given no arguments', () => {
    const { out, lines } = capture();
    main(['node', 'bindweed'], out);
    expect(lines).toEqual(['bindweed\n']);
  });

  it('knows when its module is the entry file', () => {
    expect(isEntry(self, selfPath)).toBe(true);
    expect(isEntry(self, undefined)).toBe(false);
    expect(isEntry(self, fileURLToPath(new URL('./cli.ts', self)))).toBe(false);
  });

  it('runs main only when it is the entry file', () => {
    const { out, lines } = capture();
    expect(runIfMain(self, ['node', selfPath], out)).toBe(0);
    expect(runIfMain(self, ['node'], out)).toBeUndefined();
    expect(lines).toEqual(['bindweed\n']);
  });
});
