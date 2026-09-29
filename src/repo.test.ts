import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gitCommonDir,
  gitListedPaths,
  gitToplevel,
  listedRegularFiles,
  runGit,
  excludeFilePath,
  withExcludeLine,
  ensureExcludeLine,
  ensureBindweedDir,
  prepareBindweed,
  exitCode,
  isRegularFile,
  type GitRunner,
} from './repo.ts';

async function gitInit(dir: string): Promise<void> {
  await runGit(['init'], dir);
  await runGit(['config', 'user.name', 'qa'], dir);
  await runGit(['config', 'user.email', 'qa@example.test'], dir);
  await runGit(['config', 'commit.gpgsign', 'false'], dir);
}

describe('gitToplevel', () => {
  it('returns the repository root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-git-'));
    await gitInit(root);
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    expect(await gitToplevel(join(root, 'src', 'lib'))).toBe(root);
    expect(await gitToplevel(await mkdtemp(join(tmpdir(), 'bw-plain-')))).toBeUndefined();
  });
});

describe('gitCommonDir', () => {
  it('returns the common git directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-common-'));
    await gitInit(root);
    const common = await gitCommonDir(root);
    expect(common === '.git' || common.endsWith('/.git')).toBe(true);
  });
});

describe('listedRegularFiles', () => {
  it('lists tracked and untracked files but not ignored or non-files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-ls-'));
    await gitInit(root);
    await writeFile(join(root, '.gitignore'), '*.log\n');
    await writeFile(join(root, 'README.md'), '# demo\n');
    await writeFile(join(root, 'gone.txt'), 'x\n');
    await writeFile(join(root, 'debug.log'), 'secret\n');
    await runGit(['add', '-A'], root);
    await runGit(['commit', '-m', 'fixture'], root);
    await writeFile(join(root, 'notes.txt'), 'todo\n');
    await symlink('README.md', join(root, 'link.txt'));
    await mkdir(join(root, 'vendor'));
    await gitInit(join(root, 'vendor'));
    await writeFile(join(root, 'vendor', 'v.txt'), 'v\n');
    await runGit(['add', '-A'], join(root, 'vendor'));
    await runGit(['commit', '-m', 'v'], join(root, 'vendor'));
    const { unlink } = await import('node:fs/promises');
    await unlink(join(root, 'gone.txt'));
    const files = await listedRegularFiles(root);
    expect(files.sort()).toEqual(['.gitignore', 'README.md', 'notes.txt']);
    expect(await gitListedPaths(root)).toContain('vendor/');
    expect(await gitListedPaths(root)).toContain('gone.txt');
  });

  it('returns no paths when git fails', async () => {
    const git = async () => ({ code: 1, stdout: '', stderr: 'fail' });
    expect(await gitListedPaths('/tmp', git)).toEqual([]);
  });

  it('drops blank entries from a zero-byte ls-files split', async () => {
    const git = async () => ({ code: 0, stdout: '\0', stderr: '' });
    expect(await gitListedPaths('/tmp', git)).toEqual([]);
    const withBlanks = async () => ({ code: 0, stdout: '\0a.txt\0\0b.txt\0', stderr: '' });
    expect(await gitListedPaths('/tmp', withBlanks)).toEqual(['a.txt', 'b.txt']);
  });

  it('returns no paths when git reports failure even if stdout has names', async () => {
    const git = async () => ({ code: 1, stdout: 'a.txt\0', stderr: 'fail' });
    expect(await gitListedPaths('/tmp', git)).toEqual([]);
  });
});

describe('isRegularFile', () => {
  it('is false for missing paths and true for regular files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-reg-'));
    await writeFile(join(root, 'a.txt'), 'x');
    expect(await isRegularFile(root, 'a.txt')).toBe(true);
    expect(await isRegularFile(root, 'missing.txt')).toBe(false);
  });
});

describe('runGit', () => {
  it('captures stdout from git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-run-'));
    await gitInit(root);
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], root);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('true');
  });

  it('reports git missing when the binary cannot start', async () => {
    const result = await runGit(['status'], await mkdtemp(join(tmpdir(), 'bw-miss-')), '/nonexistent/git-bin');
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'git missing' });
  });

  it('captures stderr from a failing git command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-err-'));
    await gitInit(root);
    const result = await runGit(['rev-parse', 'no-such-ref'], root);
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

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

describe('prepareBindweed', () => {
  it('writes the exclude line into a linked worktree common dir', async () => {
    const mainRepo = await mkdtemp(join(tmpdir(), 'bw-main-'));
    const worktree = await mkdtemp(join(tmpdir(), 'bw-wt-'));
    const mainGit = join(mainRepo, '.git');
    await mkdir(mainGit, { recursive: true });
    const git: GitRunner = async (args, cwd) => {
      expect(cwd).toBe(worktree);
      expect(args).toEqual(['rev-parse', '--git-common-dir']);
      return { code: 0, stdout: `${mainGit}\n`, stderr: '' };
    };
    await prepareBindweed(worktree, git);
    await prepareBindweed(worktree, git);
    expect(existsSync(join(worktree, '.bindweed'))).toBe(true);
    expect(existsSync(join(worktree, '.git'))).toBe(false);
    const exclude = await readFile(join(mainGit, 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter(l => l === '.bindweed/')).toHaveLength(1);
  });
});

describe('ensureExcludeLine', () => {
  it('creates info/exclude when missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-ex-'));
    await ensureBindweedDir(root);
    await ensureBindweedDir(root);
    const path = join(root, '.git', 'info', 'exclude');
    await ensureExcludeLine(path);
    expect(await readFile(path, 'utf8')).toBe('.bindweed/\n');
    expect(existsSync(join(root, '.bindweed'))).toBe(true);
  });
});

describe('exitCode', () => {
  it('maps null to 1 and keeps other codes', () => {
    expect(exitCode(null)).toBe(1);
    expect(exitCode(0)).toBe(0);
    expect(exitCode(2)).toBe(2);
  });
});
