import { describe, expect, it } from 'vitest';
import { excludeFilePath, withExcludeLine, ensureExcludeLine, ensureBindweedDir } from './exclude.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('withExcludeLine', () => {
  it('adds the line only when it is missing', () => {
    expect(withExcludeLine('')).toBe('.bindweed/\n');
    expect(withExcludeLine('*.tmp')).toBe('*.tmp\n.bindweed/\n');
    expect(withExcludeLine('*.tmp\n.bindweed/\n*.bak\n')).toBe('*.tmp\n.bindweed/\n*.bak\n');
    expect(withExcludeLine('.bindweed\n#.bindweed/\n')).toBe('.bindweed\n#.bindweed/\n.bindweed/\n');
  });
});

describe('excludeFilePath', () => {
  it('resolves a relative common dir against the repo root', () => {
    expect(excludeFilePath('../../.git', '/tmp/qa/demo-repo/src/lib')).toBe(
      '/tmp/qa/demo-repo/.git/info/exclude',
    );
  });

  it('keeps an absolute common dir', () => {
    expect(excludeFilePath('/tmp/qa/demo-repo/.git', '/tmp/qa/demo-wt')).toBe(
      '/tmp/qa/demo-repo/.git/info/exclude',
    );
  });
});

describe('ensureExcludeLine', () => {
  it('creates info/exclude when missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-ex-'));
    await ensureBindweedDir(root);
    const path = join(root, '.git', 'info', 'exclude');
    await ensureExcludeLine(path);
    expect(await readFile(path, 'utf8')).toBe('.bindweed/\n');
    expect(existsSync(join(root, '.bindweed'))).toBe(true);
  });
});
