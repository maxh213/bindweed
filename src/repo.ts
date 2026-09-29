import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const GIT_BIN = '/usr/bin/git';
const EXCLUDE_LINE = '.bindweed/';

export function exitCode(code: number | null): number {
  if (code === null) return 1;
  return code;
}

export async function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolvePromise => {
    const child = spawn(GIT_BIN, args, { cwd });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (piece: Buffer) => {
      out.push(piece);
    });
    child.stderr.on('data', (piece: Buffer) => {
      err.push(piece);
    });
    child.on('error', () => resolvePromise({ code: 1, stdout: '', stderr: 'git missing' }));
    child.on('close', code => {
      resolvePromise({
        code: exitCode(code),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

export async function gitToplevel(path: string, git: GitRunner = runGit): Promise<string | undefined> {
  const result = await git(['rev-parse', '--show-toplevel'], path);
  if (result.code !== 0) return undefined;
  return result.stdout.trim();
}

export async function gitCommonDir(repoRoot: string, git: GitRunner = runGit): Promise<string> {
  const result = await git(['rev-parse', '--git-common-dir'], repoRoot);
  return result.stdout.trim();
}

export async function gitListedPaths(repoRoot: string, git: GitRunner = runGit): Promise<string[]> {
  const result = await git(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    repoRoot,
  );
  if (result.code !== 0) return [];
  return result.stdout.split('\0').filter(p => p.length > 0);
}

async function isRegularFile(repoRoot: string, rel: string): Promise<boolean> {
  try {
    const st = await lstat(`${repoRoot}/${rel}`);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function listedRegularFiles(repoRoot: string, git: GitRunner = runGit): Promise<string[]> {
  const paths = await gitListedPaths(repoRoot, git);
  const kept: string[] = [];
  for (const path of paths) {
    if (await isRegularFile(repoRoot, path)) kept.push(path);
  }
  return kept;
}

export function withExcludeLine(content: string): string {
  const lines = content.split('\n');
  if (lines.includes(EXCLUDE_LINE)) return content;
  if (content.length === 0) return `${EXCLUDE_LINE}\n`;
  if (content.endsWith('\n')) return `${content}${EXCLUDE_LINE}\n`;
  return `${content}\n${EXCLUDE_LINE}\n`;
}

export function excludeFilePath(commonDir: string, repoRoot: string): string {
  const absolute = isAbsolute(commonDir) ? commonDir : resolve(repoRoot, commonDir);
  return join(absolute, 'info', 'exclude');
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

export async function ensureBindweedDir(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, '.bindweed'), { recursive: true });
}

export async function prepareBindweed(repoRoot: string, git: GitRunner = runGit): Promise<void> {
  await ensureBindweedDir(repoRoot);
  const common = await gitCommonDir(repoRoot, git);
  await ensureExcludeLine(excludeFilePath(common, repoRoot));
}
