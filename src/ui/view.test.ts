import { describe, expect, it } from 'vitest';
import { parentDirs, togglePath, withParentsOpen } from '../domain/tree.ts';
import { panelFromFile } from './FilePanel.tsx';
import { expandedFromLocation, panelFromQuery, selectedFromLocation, treeParts } from './view.ts';

describe('parentDirs', () => {
  it('lists the root and each folder above a file', () => {
    expect(parentDirs('src/lib/util.ts')).toEqual(['', 'src', 'src/lib']);
    expect(parentDirs('README.md')).toEqual(['']);
  });
});

describe('togglePath', () => {
  it('opens and closes a folder path', () => {
    const opened = togglePath(new Set(['']), 'src');
    expect(opened.has('src')).toBe(true);
    expect(togglePath(opened, 'src').has('src')).toBe(false);
  });
});

describe('withParentsOpen', () => {
  it('expands every folder on the way to a file', () => {
    expect([...withParentsOpen(new Set(), 'src/lib/util.ts')].sort()).toEqual(['', 'src', 'src/lib']);
  });
});

describe('panelFromFile', () => {
  it('maps API bodies to panel states', () => {
    expect(panelFromFile('a.ts', { path: 'a.ts', text: 'x' })).toEqual({
      kind: 'text',
      path: 'a.ts',
      text: 'x',
    });
    expect(panelFromFile('blob.bin', { path: 'blob.bin', binary: true })).toEqual({
      kind: 'message',
      path: 'blob.bin',
      message: 'binary file, not shown',
    });
    expect(panelFromFile('nope.ts', { error: 'no such file' })).toEqual({
      kind: 'message',
      path: 'nope.ts',
      message: 'no such file',
    });
    expect(panelFromFile('big.txt', { error: 'file too large to show' })).toEqual({
      kind: 'message',
      path: 'big.txt',
      message: 'file too large to show',
    });
    expect(panelFromFile('README.md', { error: 'missing or wrong token' })).toEqual({
      kind: 'message',
      path: 'README.md',
      message: 'missing or wrong token',
    });
    expect(panelFromFile('README.md', { error: 'cannot reach bindweed' })).toEqual({
      kind: 'message',
      path: 'README.md',
      message: 'cannot reach bindweed',
    });
  });
});

function fakeLocation(href: string): Location {
  const url = new URL(href);
  return { href: url.href, hash: url.hash, pathname: url.pathname, search: url.search } as Location;
}

describe('selectedFromLocation', () => {
  it('reads a deep-linked file path', () => {
    expect(selectedFromLocation(fakeLocation('http://127.0.0.1/#file=src/a.ts'))).toBe('src/a.ts');
    expect(selectedFromLocation(fakeLocation('http://127.0.0.1/'))).toBeNull();
  });
});

describe('expandedFromLocation', () => {
  it('opens the root alone without a hash', () => {
    expect([...expandedFromLocation(fakeLocation('http://127.0.0.1/'))]).toEqual(['']);
  });

  it('opens parents for a deep link', () => {
    expect([...expandedFromLocation(fakeLocation('http://127.0.0.1/#file=src/lib/a.ts'))].sort()).toEqual([
      '',
      'src',
      'src/lib',
    ]);
  });
});

describe('treeParts', () => {
  it('returns empty parts until a tree arrives', () => {
    expect(treeParts(undefined)).toEqual({ root: '', entries: [] });
    expect(treeParts({ error: 'cannot reach bindweed' })).toEqual({ root: '', entries: [] });
    expect(treeParts({ root: 'demo-repo', entries: [] })).toEqual({ root: 'demo-repo', entries: [] });
  });
});

describe('panelFromQuery', () => {
  it('maps query status to a panel', () => {
    expect(panelFromQuery(null, undefined, false)).toEqual({ kind: 'idle' });
    expect(panelFromQuery('a.ts', undefined, true)).toEqual({ kind: 'loading', path: 'a.ts' });
    expect(panelFromQuery('a.ts', undefined, false)).toEqual({ kind: 'loading', path: 'a.ts' });
    expect(panelFromQuery('a.ts', { path: 'a.ts', text: 'x' }, false)).toEqual({
      kind: 'text',
      path: 'a.ts',
      text: 'x',
    });
  });
});
