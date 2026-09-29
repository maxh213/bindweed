import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './files.ts';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bw-files-'));
}

describe('readRepoFile', () => {
  it('returns text for a listed file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'a.ts'), "export const a = 1;\n");
    const result = await readRepoFile(root, 'a.ts', new Set(['a.ts']));
    expect(result).toEqual({ ok: true, path: 'a.ts', text: 'export const a = 1;\n' });
  });

  it('returns 404 when the path is not listed', async () => {
    const root = await scratch();
    expect(await readRepoFile(root, 'nope.ts', new Set())).toEqual({
      ok: false,
      status: 404,
      error: 'no such file',
    });
  });

  it('returns 413 when the file is larger than 1 MiB', async () => {
    const root = await scratch();
    await writeFile(join(root, 'big.txt'), 'x'.repeat(1048577));
    expect(await readRepoFile(root, 'big.txt', new Set(['big.txt']))).toEqual({
      ok: false,
      status: 413,
      error: 'file too large to show',
    });
  });

  it('returns text for a file of exactly 1 MiB', async () => {
    const root = await scratch();
    const text = 'x'.repeat(1048576);
    await writeFile(join(root, 'exact.txt'), text);
    const result = await readRepoFile(root, 'exact.txt', new Set(['exact.txt']));
    expect(result).toEqual({ ok: true, path: 'exact.txt', text });
  });

  it('marks a file binary when a NUL sits in the first 8 KiB', async () => {
    const root = await scratch();
    await writeFile(join(root, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
    expect(await readRepoFile(root, 'blob.bin', new Set(['blob.bin']))).toEqual({
      ok: true,
      path: 'blob.bin',
      binary: true,
    });
  });

  it('marks binary when NUL is at byte 8191', async () => {
    const root = await scratch();
    await writeFile(join(root, 'edge.bin'), Buffer.concat([Buffer.alloc(8191, 0x78), Buffer.from([0])]));
    expect(await readRepoFile(root, 'edge.bin', new Set(['edge.bin']))).toEqual({
      ok: true,
      path: 'edge.bin',
      binary: true,
    });
  });

  it('returns text when NUL is only after the first 8 KiB', async () => {
    const root = await scratch();
    const buf = Buffer.concat([Buffer.alloc(8192, 0x78), Buffer.from([0])]);
    await writeFile(join(root, 'late.txt'), buf);
    const result = await readRepoFile(root, 'late.txt', new Set(['late.txt']));
    expect(result).toEqual({ ok: true, path: 'late.txt', text: buf.toString('utf8') });
  });

  it('returns empty text for an empty file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'empty.txt'), '');
    expect(await readRepoFile(root, 'empty.txt', new Set(['empty.txt']))).toEqual({
      ok: true,
      path: 'empty.txt',
      text: '',
    });
  });

  it('prefers 413 over binary for an oversized NUL file', async () => {
    const root = await scratch();
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(1048577, 0));
    expect(await readRepoFile(root, 'huge.bin', new Set(['huge.bin']))).toEqual({
      ok: false,
      status: 413,
      error: 'file too large to show',
    });
  });
});
