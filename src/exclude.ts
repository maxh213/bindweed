import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const LINE = '.bindweed/';

export function withExcludeLine(content: string): string {
  const lines = content.split('\n');
  if (lines.includes(LINE)) return content;
  if (content.length === 0) return `${LINE}\n`;
  if (content.endsWith('\n')) return `${content}${LINE}\n`;
  return `${content}\n${LINE}\n`;
}

export function excludeFilePath(commonDir: string, repoRoot: string): string {
  const absolute = isAbsolute(commonDir) ? commonDir : resolve(repoRoot, commonDir);
  return join(absolute, 'info', 'exclude');
}

export async function ensureBindweedDir(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, '.bindweed'), { recursive: true });
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function ensureExcludeLine(excludePath: string): Promise<void> {
  await mkdir(dirname(excludePath), { recursive: true });
  const content = await readOrEmpty(excludePath);
  const next = withExcludeLine(content);
  if (next !== content) await writeFile(excludePath, next);
}
