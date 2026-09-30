import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitToplevel, listedRegularFiles, prepareBindweed } from './repo.ts';

const COMMIT = ['-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm'];
const PATIENCE = 3000;

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function gitRepo(): Promise<string> {
  const root = await tempDir('bw-repo-');
  await writeFile(join(root, 'README.md'), '# demo\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, ...COMMIT, 'fixture');
  return root;
}

async function bareInit(): Promise<{ root: string; exclude: string }> {
  const root = await tempDir('bw-excl-');
  git(root, 'init', '-q', '--template=');
  return { root, exclude: join(root, '.git', 'info', 'exclude') };
}

async function withPath(pathVar: string | undefined, run: () => Promise<void>): Promise<void> {
  const original = process.env.PATH;
  if (pathVar === undefined) delete process.env.PATH;
  else process.env.PATH = pathVar;
  try {
    await run();
  } finally {
    process.env.PATH = original;
  }
}

function toplevel(path: string): Promise<string | undefined> {
  const hung = new Promise<'hung'>(resolve => {
    setTimeout(() => resolve('hung'), PATIENCE).unref();
  });
  return Promise.race([gitToplevel(path), hung]);
}

describe('gitToplevel', () => {
  it('returns the repository root from any folder inside it', async () => {
    const root = await gitRepo();
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    expect(await toplevel(root)).toBe(root);
    expect(await toplevel(join(root, 'src', 'lib'))).toBe(root);
    expect(await toplevel(await tempDir('bw-plain-'))).toBeUndefined();
    expect(await toplevel(join(root, 'missing'))).toBeUndefined();
  });

  it('runs the git found on PATH and gives up when there is none or it cannot start', async () => {
    const root = await gitRepo();
    const bin = await tempDir('bw-bin-');
    await withPath(bin, async () => {
      expect(await toplevel(root)).toBeUndefined();
      await expect(listedRegularFiles(root)).rejects.toThrow('git is not on PATH');
      await writeFile(join(bin, 'git'), '#!/nonexistent/interpreter\n', { mode: 0o755 });
      expect(await toplevel(root)).toBeUndefined();
      await writeFile(join(bin, 'git'), '#!/bin/sh\nprintf "/found/on/path\\n"\n');
      expect(await toplevel(root)).toBe('/found/on/path');
    });
    await withPath(`${join(bin, 'nowhere')}${delimiter}${bin}`, async () => {
      expect(await toplevel(root)).toBe('/found/on/path');
    });
    await withPath(undefined, async () => {
      expect(await toplevel(root)).toBe(root);
    });
  });

  it('gives git no input to wait for and does not stall on what it prints to stderr', async () => {
    const bin = await tempDir('bw-bin-');
    const noisy = '#!/bin/sh\ncat >/dev/null\nhead -c 1000000 /dev/zero >&2\nprintf "/found/on/path\\n"\n';
    await writeFile(join(bin, 'git'), noisy, { mode: 0o755 });
    await withPath(`${bin}${delimiter}${process.env.PATH}`, async () => {
      expect(await toplevel(bin)).toBe('/found/on/path');
    });
  });
});

describe('listedRegularFiles', () => {
  it('lists tracked and untracked files but not ignored, deleted, linked or nested ones', async () => {
    const root = await gitRepo();
    await writeFile(join(root, '.gitignore'), '*.log\n');
    await writeFile(join(root, 'gone.txt'), 'x\n');
    await writeFile(join(root, 'debug.log'), 'secret\n');
    git(root, 'add', '-A');
    git(root, ...COMMIT, 'more');
    await writeFile(join(root, 'notes.txt'), 'todo\n');
    await symlink('README.md', join(root, 'link.txt'));
    await mkdir(join(root, 'vendor'));
    await writeFile(join(root, 'vendor', 'v.txt'), 'v\n');
    git(join(root, 'vendor'), 'init', '-q');
    git(join(root, 'vendor'), 'add', '-A');
    git(join(root, 'vendor'), ...COMMIT, 'v');
    await unlink(join(root, 'gone.txt'));
    expect((await listedRegularFiles(root)).sort()).toEqual(['.gitignore', 'README.md', 'notes.txt']);
  });

  it('lists nothing in a repository without files and fails outside a repository', async () => {
    const { root } = await bareInit();
    expect(await listedRegularFiles(root)).toEqual([]);
    await expect(listedRegularFiles(await tempDir('bw-list-'))).rejects.toThrow('git ls-files failed');
  });
});

describe('prepareBindweed', () => {
  it('creates .bindweed and adds the exclude line once across two starts', async () => {
    const root = await gitRepo();
    const template = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8');
    await prepareBindweed(root);
    await prepareBindweed(root);
    expect(existsSync(join(root, '.bindweed'))).toBe(true);
    expect(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')).toBe(`${template}.bindweed/\n`);
  });

  it.each([
    ['is missing along with .git/info', undefined, '.bindweed/\n'],
    ['is empty', '', '.bindweed/\n'],
    ['ends without a newline', '*.tmp', '*.tmp\n.bindweed/\n'],
    ['already holds the line', '*.tmp\n.bindweed/\n*.bak\n', '*.tmp\n.bindweed/\n*.bak\n'],
    ['holds only look-alikes', '.bindweed\n#.bindweed/\n', '.bindweed\n#.bindweed/\n.bindweed/\n'],
  ])('completes the exclude file when it %s', async (_case, before, after) => {
    const { root, exclude } = await bareInit();
    expect(existsSync(join(root, '.git', 'info'))).toBe(false);
    if (before !== undefined) {
      await mkdir(join(root, '.git', 'info'));
      await writeFile(exclude, before);
    }
    await prepareBindweed(root);
    expect(await readFile(exclude, 'utf8')).toBe(after);
  });

  it('does not rewrite an exclude file that already holds the line', async () => {
    const { root, exclude } = await bareInit();
    await mkdir(join(root, '.git', 'info'));
    await writeFile(exclude, '*.tmp\n.bindweed/\n');
    const old = new Date('2020-01-02T03:04:05Z');
    await utimes(exclude, old, old);
    await chmod(exclude, 0o444);
    await prepareBindweed(root);
    expect((await stat(exclude)).mtime).toEqual(old);
    expect(await readFile(exclude, 'utf8')).toBe('*.tmp\n.bindweed/\n');
  });

  it('excludes .bindweed in a linked worktree through the main repository', async () => {
    const mainRepo = await gitRepo();
    const worktree = join(await tempDir('bw-wt-'), 'demo-wt');
    git(mainRepo, 'worktree', 'add', '-q', worktree, '-b', 'wt');
    const gitFile = await readFile(join(worktree, '.git'), 'utf8');
    const template = await readFile(join(mainRepo, '.git', 'info', 'exclude'), 'utf8');
    expect(await toplevel(worktree)).toBe(worktree);
    await prepareBindweed(worktree);
    await prepareBindweed(worktree);
    await writeFile(join(worktree, '.bindweed', 'state'), 'kept out of git status\n');
    expect(await readFile(join(worktree, '.git'), 'utf8')).toBe(gitFile);
    expect(await readFile(join(mainRepo, '.git', 'info', 'exclude'), 'utf8')).toBe(`${template}.bindweed/\n`);
    expect(existsSync(join(mainRepo, '.bindweed'))).toBe(false);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  });
});
