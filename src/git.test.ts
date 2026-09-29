import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitCommonDir, gitListedPaths, gitToplevel, listedRegularFiles, runGit } from './git.ts';

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
