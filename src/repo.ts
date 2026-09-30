import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

const EXCLUDE_LINE = '.bindweed/';
const DEFAULT_PATH = '/usr/bin';

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
  } catch {
    return false;
  }
  return true;
}

function gitOnPath(): string | undefined {
  for (const dir of (process.env.PATH ?? DEFAULT_PATH).split(delimiter)) {
    const candidate = join(dir, 'git');
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((done, failed) => {
    const bin = gitOnPath();
    if (bin === undefined) {
      failed(new Error('git is not on PATH'));
      return;
    }
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (piece: Buffer) => {
      out.push(piece);
    });
    child.on('error', () => undefined);
    child.on('close', code => {
      if (code === 0) done(Buffer.concat(out).toString());
      else failed(new Error(`git ${args[0]} failed`));
    });
  });
}

export function gitToplevel(path: string): Promise<string | undefined> {
  return runGit(['rev-parse', '--show-toplevel'], path).then(out => out.trim(), () => undefined);
}

export async function listedRegularFiles(repoRoot: string): Promise<string[]> {
  const listing = await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], repoRoot);
  const kept: string[] = [];
  for (const path of listing.split('\0')) {
    const onDisk = await lstat(join(repoRoot, path)).catch(() => undefined);
    if (onDisk?.isFile()) kept.push(path);
  }
  return kept;
}

function withExcludeLine(content: string): string {
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${EXCLUDE_LINE}\n`;
}

function excludeFilePath(commonDir: string, repoRoot: string): string {
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

async function ensureExcludeLine(excludePath: string): Promise<void> {
  const content = await readOrEmpty(excludePath);
  if (content.split('\n').includes(EXCLUDE_LINE)) return;
  await mkdir(dirname(excludePath), { recursive: true });
  await writeFile(excludePath, withExcludeLine(content));
}

export async function prepareBindweed(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, '.bindweed'), { recursive: true });
  const common = await runGit(['rev-parse', '--git-common-dir'], repoRoot);
  await ensureExcludeLine(excludeFilePath(common.trim(), repoRoot));
}
