import { describe, expect, it } from 'vitest';
import { fileRenameName, mergeTarget, nameProblem, relativeTo, siblingPath, splitParts, splitProblem, takenProblem, type SplitForm } from './reshape.ts';

const FILES = ['src/app/a.test.ts', 'src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts'];

function form(names: string[], assigned: Record<string, string>, taken: string[] = []): SplitForm {
  return { pkg: 'src/app', names, files: FILES, assigned, taken: new Set(taken) };
}

const ALL_READ_WRITE = { 'src/app/a.test.ts': 'read', 'src/app/a.ts': 'read', 'src/app/b.ts': 'write', 'src/app/save.ts': 'write' };

describe('the reshape dialog rules', () => {
  it('names a bad name and passes a legal one', () => {
    expect(nameProblem('ports')).toBeNull();
    expect(nameProblem('has space')).toBe('bad name');
    expect(nameProblem('..')).toBe('bad name');
  });

  it('keeps the old extension when the typed file name has no dot', () => {
    expect(fileRenameName('src/app/save.ts', 'writer')).toBe('writer.ts');
    expect(fileRenameName('src/app/save.ts', 'writer.tsx')).toBe('writer.tsx');
    expect(fileRenameName('src/app/Makefile', 'Build')).toBe('Build');
    expect(fileRenameName('src/app/.env', 'local')).toBe('local');
  });

  it('places a renamed box beside the old one and a merge in the view or on a selected box', () => {
    expect(siblingPath('src/infra', 'adapters')).toBe('src/adapters');
    expect(siblingPath('infra', 'adapters')).toBe('adapters');
    const selected = [
      { id: 'src/app/read', name: 'read' },
      { id: 'src/app/write', name: 'write' },
    ];
    expect(mergeTarget('read', 'src', selected)).toBe('src/app/read');
    expect(mergeTarget('app', 'src', selected)).toBe('src/app');
    expect(mergeTarget('app', '', selected)).toBe('app');
  });

  it('names a taken path', () => {
    expect(takenProblem('src/infra', new Set(['src/infra']))).toBe('src/infra already exists');
    expect(takenProblem('src/ports', new Set(['src/infra']))).toBeNull();
  });

  it('checks a split in the pinned order', () => {
    expect(splitProblem(form(['', ''], {}))).toBe('name at least two parts');
    expect(splitProblem(form(['read', '  '], ALL_READ_WRITE))).toBe('name at least two parts');
    expect(splitProblem(form(['has space', 'write'], ALL_READ_WRITE))).toBe('bad name');
    expect(splitProblem(form(['read', 'read'], ALL_READ_WRITE))).toBe('duplicate part');
    expect(splitProblem(form(['read', 'write'], { ...ALL_READ_WRITE, 'src/app/a.ts': '' }))).toBe('assign every file');
    expect(splitProblem(form(['read', 'other'], ALL_READ_WRITE))).toBe('assign every file');
    expect(splitProblem(form(['a.ts', 'write'], { ...ALL_READ_WRITE, 'src/app/a.test.ts': 'a.ts', 'src/app/a.ts': 'a.ts' }))).toBe('src/app/a.ts already exists');
    expect(splitProblem(form(['read', 'write'], ALL_READ_WRITE, ['src/app/write']))).toBe('src/app/write already exists');
    expect(splitProblem(form([' read ', 'write', ''], ALL_READ_WRITE))).toBeNull();
  });

  it('builds the parts in field order with their files in list order', () => {
    expect(splitParts(form(['read', '', 'write', 'spare'], ALL_READ_WRITE))).toEqual([
      { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts'] },
      { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
      { name: 'spare', files: [] },
    ]);
  });

  it('labels a file by its path under the package', () => {
    expect(relativeTo('src/app', 'src/app/sub/a.ts')).toBe('sub/a.ts');
  });
});
