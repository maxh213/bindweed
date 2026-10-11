import { describe, expect, it } from 'vitest';
import { declaredPaths, nameEdit, nameTaken, splitEdit, splitRows, type NameAsk, type Scene, type SplitForm } from './reshape.ts';

const FILES = ['src/app/a.test.ts', 'src/app/a.ts', 'src/app/b.ts', 'src/app/save.ts'];

function form(names: string[], assigned: Record<string, string>, taken: string[] = []): SplitForm {
  return { pkg: 'src/app', names, files: FILES, assigned, taken: new Set(taken) };
}

function scene(at: string, taken: string[] = [], selected: Scene['selected'] = []): Scene {
  return { at, taken: new Set(taken), selected };
}

const CREATE: NameAsk = { mode: 'create' };

const MERGE: NameAsk = { mode: 'merge' };

function renameFile(id: string): NameAsk {
  return { mode: 'rename', id, kind: 'file' };
}

function renamePackage(id: string): NameAsk {
  return { mode: 'rename', id, kind: 'package' };
}

const SELECTED = [
  { id: 'src/app/read', name: 'read' },
  { id: 'src/app/write', name: 'write' },
];

const ALL_READ_WRITE = { 'src/app/a.test.ts': 'read', 'src/app/a.ts': 'read', 'src/app/b.ts': 'write', 'src/app/save.ts': 'write' };

describe('the reshape dialog rules', () => {
  it('creates a package in the view and names a bad name', () => {
    expect(nameEdit(CREATE, 'ports', scene('src'))).toEqual({ edit: { kind: 'create-package', path: 'src/ports' } });
    expect(nameEdit(CREATE, 'top', scene(''))).toEqual({ edit: { kind: 'create-package', path: 'top' } });
    expect(nameEdit(CREATE, 'has space', scene('src'))).toEqual({ problem: 'bad name' });
    expect(nameEdit(CREATE, '..', scene('src'))).toEqual({ problem: 'bad name' });
  });

  it('keeps the old extension when the typed file name has no dot', () => {
    expect(nameEdit(renameFile('src/app/save.ts'), 'writer', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.ts' } });
    expect(nameEdit(renameFile('src/app/a.test.ts'), 'spec', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/a.test.ts', to: 'spec.ts' } });
    expect(nameEdit(renameFile('src/app/save.ts'), 'writer.tsx', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/save.ts', to: 'writer.tsx' } });
    expect(nameEdit(renameFile('src/app/save.ts'), '.env', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/save.ts', to: '.env' } });
    expect(nameEdit(renameFile('src/app/Makefile'), 'Build', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/Makefile', to: 'Build' } });
    expect(nameEdit(renameFile('src/app/.env'), 'local', scene('src/app'))).toEqual({ edit: { kind: 'rename-file', from: 'src/app/.env', to: 'local' } });
  });

  it('renames a box beside the old one, and keeping the name is no edit', () => {
    expect(nameEdit(renamePackage('src/infra'), 'adapters', scene('src'))).toEqual({ edit: { kind: 'rename-package', from: 'src/infra', to: 'src/adapters' } });
    expect(nameEdit(renamePackage('infra'), 'adapters', scene(''))).toEqual({ edit: { kind: 'rename-package', from: 'infra', to: 'adapters' } });
    expect(nameEdit(renamePackage('src/infra'), 'infra', scene('src', ['src/infra']))).toEqual({ edit: null });
    expect(nameEdit(renameFile('src/app/save.ts'), 'save', scene('src/app', ['src/app/save.ts']))).toEqual({ edit: null });
    expect(nameEdit(renamePackage('src/infra'), 'has space', scene('src'))).toEqual({ problem: 'bad name' });
  });

  it('merges into the view or onto a selected box', () => {
    expect(nameEdit(MERGE, 'read', scene('src', ['src/app/read'], SELECTED))).toEqual({
      edit: { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app/read' },
    });
    expect(nameEdit(MERGE, 'app', scene('src', [], SELECTED))).toEqual({ edit: { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/app' } });
    expect(nameEdit(MERGE, 'app', scene('', [], SELECTED))).toEqual({ edit: { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'app' } });
    expect(nameEdit(MERGE, 'has space', scene('src', [], SELECTED))).toEqual({ problem: 'bad name' });
    expect(nameEdit(MERGE, 'adapters', scene('src', ['src/adapters'], SELECTED))).toEqual({ problem: 'src/adapters already exists' });
  });

  it('names a taken path', () => {
    expect(nameEdit(CREATE, 'infra', scene('src', ['src/infra']))).toEqual({ problem: 'src/infra already exists' });
    expect(nameEdit(CREATE, 'ports', scene('src', ['src/infra']))).toEqual({ edit: { kind: 'create-package', path: 'src/ports' } });
    expect(nameEdit(renamePackage('src/infra'), 'app', scene('src', ['src/app']))).toEqual({ problem: 'src/app already exists' });
  });

  it('counts a hidden parent as taken, except when merging', () => {
    const boxes = [
      { id: 'src/app/read', kind: 'package', files: 1 },
      { id: 'src/app/write/deep', kind: 'package', files: 1 },
      { id: 'src/domain', kind: 'package', files: 2 },
    ];
    const ids = ['src/app/read', 'src/app/write/deep', 'src/domain'];
    const hidden = new Set([...ids, 'src/app', 'src/app/write']);
    expect(nameTaken('src', boxes, 'create', [])).toEqual(hidden);
    expect(nameTaken('src', boxes, 'rename', [])).toEqual(hidden);
    expect(nameTaken('src', boxes, 'merge', [])).toEqual(new Set(ids));
    expect(nameTaken('src', [{ id: 'src/app/write/deep', kind: 'package', files: 1 }], 'create', [])).toEqual(new Set(['src/app/write/deep', 'src/app/write', 'src/app']));
    expect(nameTaken('', [{ id: 'src', kind: 'package', files: 7 }], 'create', [])).toEqual(new Set(['src']));
    expect(nameTaken('src', [], 'create', [])).toEqual(new Set());
  });

  it('takes an empty drawn package only when that path is declared', () => {
    const boxes = [
      { id: 'src/infra/de', kind: 'package', files: 0 },
      { id: 'src/infra/deep', kind: 'package', files: 0 },
      { id: 'src/infra/db.ts', kind: 'file' },
    ];
    const empty = ['src/infra/de', 'src/infra/deep/empty'];
    const taken = nameTaken('src/infra', boxes, 'create', empty);
    expect(taken).toEqual(new Set(['src/infra/de', 'src/infra/db.ts']));
    expect(nameTaken('src/infra', boxes, 'rename', empty)).toEqual(taken);
    expect(nameEdit(CREATE, 'deep', scene('src/infra', [...taken]))).toEqual({ edit: { kind: 'create-package', path: 'src/infra/deep' } });
    expect(nameEdit(CREATE, 'de', scene('src/infra', [...taken]))).toEqual({ problem: 'src/infra/de already exists' });
    expect(nameEdit(renamePackage('src/infra/de'), 'deep', scene('src/infra', [...taken]))).toEqual({
      edit: { kind: 'rename-package', from: 'src/infra/de', to: 'src/infra/deep' },
    });
    expect(nameTaken('src', [{ id: 'src/ports/deep', kind: 'package', files: 0 }], 'create', ['src/ports/deep'])).toEqual(new Set(['src/ports/deep']));
    expect(nameTaken('src', [{ id: 'src/ports', kind: 'package', files: 0 }], 'create', ['src/ports/deep'])).toEqual(new Set());
  });

  it('reads declared paths from empty-package warnings only', () => {
    expect(declaredPaths([[{ kind: 'added-cycle' }], [{ kind: 'empty-package' }], [{ kind: 'empty-package', path: 'src/ports' }]])).toEqual(['src/ports']);
    expect(declaredPaths([])).toEqual([]);
  });

  it('refuses a merge onto a file or a package with files, but not an empty package', () => {
    const boxes = [
      { id: 'src/ports', kind: 'package', files: 0 },
      { id: 'src/domain', kind: 'package', files: 2 },
      { id: 'src/app/a.ts', kind: 'file' },
    ];
    const taken = [...nameTaken('src', boxes, 'merge', ['src/ports'])];
    expect(taken).toEqual(['src/domain', 'src/app/a.ts']);
    expect(nameEdit(MERGE, 'ports', scene('src', taken, SELECTED))).toEqual({
      edit: { kind: 'merge-packages', packages: ['src/app/read', 'src/app/write'], into: 'src/ports' },
    });
    expect(nameEdit(MERGE, 'domain', scene('src', taken, SELECTED))).toEqual({ problem: 'src/domain already exists' });
    expect(nameEdit(MERGE, 'a.ts', scene('src/app', taken, SELECTED))).toEqual({ problem: 'src/app/a.ts already exists' });
  });

  it('checks a split in the pinned order', () => {
    expect(splitEdit(form(['', ''], {}))).toEqual({ problem: 'name at least two parts' });
    expect(splitEdit(form(['read', '  '], ALL_READ_WRITE))).toEqual({ problem: 'name at least two parts' });
    expect(splitEdit(form(['has space', 'write'], ALL_READ_WRITE))).toEqual({ problem: 'bad name' });
    expect(splitEdit(form(['has space', 'has space'], ALL_READ_WRITE))).toEqual({ problem: 'bad name' });
    expect(splitEdit(form(['read', 'read'], ALL_READ_WRITE))).toEqual({ problem: 'duplicate part' });
    expect(splitEdit(form(['read', 'write', 'read'], ALL_READ_WRITE))).toEqual({ problem: 'duplicate part' });
    expect(splitEdit(form(['read', 'write'], { ...ALL_READ_WRITE, 'src/app/a.ts': '' }))).toEqual({ problem: 'assign every file' });
    expect(splitEdit(form(['a.ts', 'write'], { ...ALL_READ_WRITE, 'src/app/a.ts': '' }))).toEqual({ problem: 'assign every file' });
    expect(splitEdit(form(['read', 'other'], ALL_READ_WRITE))).toEqual({ problem: 'assign every file' });
    expect(splitEdit(form(['a.ts', 'write'], { ...ALL_READ_WRITE, 'src/app/a.test.ts': 'a.ts', 'src/app/a.ts': 'a.ts' }))).toEqual({ problem: 'src/app/a.ts already exists' });
    expect(splitEdit(form(['read', 'write'], ALL_READ_WRITE, ['src/app/write']))).toEqual({ problem: 'src/app/write already exists' });
    expect(splitEdit(form([' read ', 'write', ''], ALL_READ_WRITE))).toHaveProperty('edit.kind', 'split-package');
  });

  it('refuses a part that already holds a nested file', () => {
    expect(
      splitEdit({
        pkg: 'src/app',
        names: ['deep', 'other'],
        files: ['src/app/deep/x.ts', 'src/app/b.ts'],
        assigned: { 'src/app/deep/x.ts': 'other', 'src/app/b.ts': 'other' },
        taken: new Set(),
      }),
    ).toEqual({ problem: 'src/app/deep already exists' });
    expect(
      splitEdit({
        pkg: 'src/app',
        names: ['deep', 'other'],
        files: ['src/app/deep2/x.ts', 'src/app/b.ts'],
        assigned: { 'src/app/deep2/x.ts': 'other', 'src/app/b.ts': 'other' },
        taken: new Set(),
      }),
    ).toEqual({
      edit: {
        kind: 'split-package',
        package: 'src/app',
        parts: [
          { name: 'deep', files: [] },
          { name: 'other', files: ['src/app/deep2/x.ts', 'src/app/b.ts'] },
        ],
      },
    });
  });

  it('builds the parts in field order with their files in list order', () => {
    expect(splitEdit(form(['read', '', 'write', 'spare'], ALL_READ_WRITE))).toEqual({
      edit: {
        kind: 'split-package',
        package: 'src/app',
        parts: [
          { name: 'read', files: ['src/app/a.test.ts', 'src/app/a.ts'] },
          { name: 'write', files: ['src/app/b.ts', 'src/app/save.ts'] },
          { name: 'spare', files: [] },
        ],
      },
    });
  });

  it('labels a file by its path under the package', () => {
    expect(splitRows('src/app', ['src/app/sub/a.ts', 'src/app/b.ts'])).toEqual([
      { path: 'src/app/sub/a.ts', label: 'sub/a.ts' },
      { path: 'src/app/b.ts', label: 'b.ts' },
    ]);
  });
});
