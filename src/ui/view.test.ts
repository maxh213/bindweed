import { describe, expect, it } from 'vitest';
import { parentDirs, togglePath, withParentsOpen } from '../domain/tree.ts';
import { panelFromFile } from './FilePanel.tsx';
import {
  applyPage,
  applyTitle,
  atFromLocation,
  expandedFromLocation,
  graphStateOf,
  pageFromLocation,
  panelFromQuery,
  selectedFromLocation,
  tabFromLocation,
  treeParts,
  type PageActions,
} from './view.ts';

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
    const opened = expandedFromLocation(fakeLocation('http://127.0.0.1/'));
    expect(opened.has('')).toBe(true);
    expect(opened.size).toBe(1);
    expect([...opened]).toEqual(['']);
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

describe('applyTitle', () => {
  it('leaves the title alone until a root name arrives', () => {
    const doc = { title: 'keep-me' };
    applyTitle(doc, '');
    expect(doc.title).toBe('keep-me');
    applyTitle(doc, 'demo-repo');
    expect(doc.title).toBe('bindweed — demo-repo');
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

describe('tabFromLocation and atFromLocation', () => {
  it('read the tab and view from the hash', () => {
    expect(tabFromLocation(fakeLocation('http://127.0.0.1/'))).toBe('files');
    expect(tabFromLocation(fakeLocation('http://127.0.0.1/#file=src/a.ts'))).toBe('files');
    expect(tabFromLocation(fakeLocation('http://127.0.0.1/#at=src'))).toBe('arch');
    expect(atFromLocation(fakeLocation('http://127.0.0.1/'))).toBe('');
    expect(atFromLocation(fakeLocation('http://127.0.0.1/#at='))).toBe('');
    expect(atFromLocation(fakeLocation('http://127.0.0.1/#at=src/app'))).toBe('src/app');
    expect(atFromLocation(fakeLocation('http://127.0.0.1/#at=src/%C5%BC%C3%B3%C5%82w'))).toBe('src/żółw');
  });
});

describe('pageFromLocation', () => {
  it('maps hashes to page state', () => {
    expect(pageFromLocation(fakeLocation('http://127.0.0.1/'))).toEqual({ tab: 'files', at: '', selected: null });
    expect(pageFromLocation(fakeLocation('http://127.0.0.1/#file=src/a.ts'))).toEqual({
      tab: 'files',
      at: '',
      selected: 'src/a.ts',
    });
    expect(pageFromLocation(fakeLocation('http://127.0.0.1/#at=src/app'))).toEqual({
      tab: 'arch',
      at: 'src/app',
      selected: null,
    });
  });
});

function recordingActions(): PageActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setTab: tab => calls.push(`tab:${tab}`),
    setAt: at => calls.push(`at:${at}`),
    setSelected: path => calls.push(`selected:${String(path)}`),
    setExpanded: update => {
      const next = update(new Set());
      calls.push(`expanded:${[...next].sort().join(',')}`);
    },
  };
}

describe('applyPage', () => {
  it('applies an architecture page without touching the file selection', () => {
    const actions = recordingActions();
    applyPage(actions, { tab: 'arch', at: 'src', selected: null });
    expect(actions.calls).toEqual(['tab:arch', 'at:src']);
  });

  it('applies a file page and opens its folders', () => {
    const actions = recordingActions();
    applyPage(actions, { tab: 'files', at: '', selected: 'src/lib/util.ts' });
    expect(actions.calls).toEqual(['tab:files', 'at:', 'selected:src/lib/util.ts', 'expanded:,src,src/lib']);
  });
});

describe('graphStateOf', () => {
  it('maps query status to a graph state', () => {
    expect(graphStateOf(undefined, true)).toEqual({ kind: 'loading' });
    expect(graphStateOf(undefined, false)).toEqual({ kind: 'loading' });
    expect(graphStateOf({ error: 'no such directory' }, false)).toEqual({ kind: 'message', message: 'no such directory' });
    const view = { at: '', crumbs: [{ name: 'r', at: '' }], nodes: [], edges: [] };
    expect(graphStateOf(view, false)).toEqual({ kind: 'ok', view });
  });
});
