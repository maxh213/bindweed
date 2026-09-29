import { open } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 1048576;
const NUL_WINDOW = 8192;

export type FileResult =
  | { ok: true; path: string; text: string }
  | { ok: true; path: string; binary: true }
  | { ok: false; status: 404 | 413; error: string };

function hasNul(buf: Buffer): boolean {
  return buf.includes(0);
}

export async function readRepoFile(repoRoot: string, relPath: string, allowed: Set<string>): Promise<FileResult> {
  if (!allowed.has(relPath)) return { ok: false, status: 404, error: 'no such file' };
  const handle = await open(join(repoRoot, relPath), 'r');
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_BYTES) return { ok: false, status: 413, error: 'file too large to show' };
    const headSize = Math.min(stat.size, NUL_WINDOW);
    const head = Buffer.alloc(headSize);
    const { bytesRead } = await handle.read(head, 0, headSize, 0);
    if (hasNul(head.subarray(0, bytesRead))) return { ok: true, path: relPath, binary: true };
    const all = Buffer.alloc(stat.size);
    await handle.read(all, 0, stat.size, 0);
    return { ok: true, path: relPath, text: all.toString('utf8') };
  } finally {
    await handle.close();
  }
}
