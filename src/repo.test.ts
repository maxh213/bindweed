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
  exitCode,
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
});

describe('runGit', () => {
  it('captures stdout from git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bw-run-'));
    await gitInit(root);
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], root);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('true');
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

describe('exitCode', () => {
  it('maps null to 1 and keeps other codes', () => {
    expect(exitCode(null)).toBe(1);
    expect(exitCode(0)).toBe(0);
    expect(exitCode(2)).toBe(2);
  });
});
