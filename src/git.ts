import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { exitCode } from './exit-code.ts';

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const GIT_BIN = '/usr/bin/git';

export async function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(GIT_BIN, args, { cwd });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (piece: Buffer) => {
      out.push(piece);
    });
    child.stderr.on('data', (piece: Buffer) => {
      err.push(piece);
    });
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'git missing' }));
    child.on('close', code => {
      resolve({
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
