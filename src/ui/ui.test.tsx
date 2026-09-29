import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

function installDom(url = 'http://127.0.0.1:4477/?token=abc'): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: w.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: w.Node, configurable: true });
  Object.defineProperty(globalThis, 'DocumentFragment', { value: w.DocumentFragment, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: w.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  return dom;
}

describe('TreeView and FilePanel rendering', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = installDom();
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    root.unmount();
    dom.window.close();
  });

  it('shows collapsed folders and select a file', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const { FilePanel } = await import('./FilePanel.tsx');
    root.render(
      createElement(
        'div',
        null,
        createElement(TreeView, {
          root: 'demo-repo',
          entries: [
            {
              name: 'docs',
              path: 'docs',
              kind: 'dir',
              children: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'file' }],
            },
            {
              name: 'src',
              path: 'src',
              kind: 'dir',
              children: [
                {
                  name: 'lib',
                  path: 'src/lib',
                  kind: 'dir',
                  children: [{ name: 'util.ts', path: 'src/lib/util.ts', kind: 'file' }],
                },
                { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
              ],
            },
            { name: '.gitignore', path: '.gitignore', kind: 'file' },
            { name: 'README.md', path: 'README.md', kind: 'file' },
            { name: 'Zebra.txt', path: 'Zebra.txt', kind: 'file' },
            { name: 'apple.txt', path: 'apple.txt', kind: 'file' },
          ],
          expanded: new Set(['']),
          selected: null,
          onToggle: () => undefined,
          onSelect: () => undefined,
        }),
        createElement(FilePanel, { state: { kind: 'idle' } }),
      ),
    );
    await new Promise(r => setTimeout(r, 0));
    const text = document.body.textContent ?? '';
    expect(text).toContain('demo-repo/');
    expect(text).toContain('docs/');
    expect(text).toContain('src/');
    expect(text).not.toContain('guide.md');
    expect(text).toContain('select a file');
  });

  it('expands a folder and marks a selected file', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const toggled: string[] = [];
    root.render(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [
          {
            name: 'src',
            path: 'src',
            kind: 'dir',
          },
        ],
        expanded: new Set(['', 'src']),
        selected: 'src/a.ts',
        onToggle: path => toggled.push(path),
        onSelect: () => undefined,
      }),
    );
    await new Promise(r => setTimeout(r, 0));
    const src = Array.from(document.querySelectorAll('[role="treeitem"]')).find(el => el.textContent === 'src/');
    src?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const top = Array.from(document.querySelectorAll('[role="treeitem"]')).find(
      el => el.textContent === 'demo-repo/',
    );
    top?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(toggled).toEqual(['src', '']);
  });

  it('collapses the root to a single row', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    root.render(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'src', path: 'src', kind: 'dir', children: [] }],
        expanded: new Set<string>(),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.textContent).toBe('demo-repo/');
  });

  it('renders numbered lines for file text', async () => {
    const { FilePanel } = await import('./FilePanel.tsx');
    root.render(
      createElement(FilePanel, {
        state: {
          kind: 'text',
          path: 'src/a.ts',
          text: "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
        },
      }),
    );
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.textContent).toContain('src/a.ts');
    expect(document.body.textContent).toContain('export const a = 1;');
  });

  it('renders loading and message panels', async () => {
    const { FilePanel } = await import('./FilePanel.tsx');
    root.render(createElement(FilePanel, { state: { kind: 'loading', path: 'x.ts' } }));
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.textContent).toContain('x.ts');
    root.render(
      createElement(FilePanel, { state: { kind: 'message', path: 'blob.bin', message: 'binary file, not shown' } }),
    );
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.textContent).toContain('binary file, not shown');
  });

  it('shows an empty repository with only the root row', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const { FilePanel } = await import('./FilePanel.tsx');
    root.render(
      createElement(
        'div',
        null,
        createElement(TreeView, {
          root: 'empty-repo',
          entries: [],
          expanded: new Set(['']),
          selected: null,
          onToggle: () => undefined,
          onSelect: () => undefined,
        }),
        createElement(FilePanel, { state: { kind: 'idle' } }),
      ),
    );
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.textContent).toBe('empty-repo/select a file');
  });
});

describe('App and boot', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = installDom('http://127.0.0.1:4477/?token=tok#file=src/a.ts');
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    root.unmount();
    dom.window.close();
  });

  it('loads the tree, opens a deep link, and selects a file on click', async () => {
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    const files: Record<string, string> = {
      'src/a.ts': "export const a = 1;\n",
      'README.md': '# demo\n',
    };
    const fetcher = (async (url: string) => {
      if (url === '/api/tree') {
        return {
          ok: true,
          json: async () => ({
            root: 'demo-repo',
            entries: [
              {
                name: 'src',
                path: 'src',
                kind: 'dir',
                children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }],
              },
              { name: 'README.md', path: 'README.md', kind: 'file' },
            ],
          }),
        } as Response;
      }
      const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
      return { ok: true, json: async () => ({ path, text: files[path] ?? '' }) } as Response;
    }) as typeof fetch;
    await act(async () => {
      root.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher,
        }),
      );
      await new Promise(r => setTimeout(r, 50));
    });
    expect(document.title).toBe('bindweed — demo-repo');
    expect(document.body.textContent).toContain('export const a = 1;');
    const readme = Array.from(document.querySelectorAll('[role="treeitem"]')).find(
      el => el.textContent === 'README.md',
    );
    await act(async () => {
      readme?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
    });
    expect(document.body.textContent).toContain('# demo');
    const src = Array.from(document.querySelectorAll('[role="treeitem"]')).find(el => el.textContent === 'src/');
    await act(async () => {
      src?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const rootRow = Array.from(document.querySelectorAll('[role="treeitem"]')).find(
        el => el.textContent === 'demo-repo/',
      );
      rootRow?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });
  });

  it('handles a tree fetch error', async () => {
    dom.window.close();
    dom = installDom('http://127.0.0.1:4477/?token=tok');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
    const { App } = await import('./App.tsx');
    const fetcher = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    root.render(
      createElement(App, {
        token: 'tok',
        location: window.location,
        historyApi: window.history,
        fetcher,
      }),
    );
    await new Promise(r => setTimeout(r, 30));
    expect(document.body.textContent).toContain('select a file');
  });

  it('loads a tree without a file hash', async () => {
    dom.window.close();
    dom = installDom('http://127.0.0.1:4477/?token=tok');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    const fetcher = (async () =>
      ({
        ok: true,
        json: async () => ({ root: 'demo-repo', entries: [] }),
      }) as Response) as typeof fetch;
    await act(async () => {
      root.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher,
        }),
      );
      await new Promise(r => setTimeout(r, 30));
    });
    expect(document.title).toBe('bindweed — demo-repo');
    expect(document.body.textContent).toContain('select a file');
  });

  it('boots from the token in the address', async () => {
    const { bootUi } = await import('./boot.tsx');
    const fetcher = (async () =>
      ({ ok: true, json: async () => ({ root: 'demo-repo', entries: [] }) }) as Response) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    bootUi(document, window.location, window.sessionStorage, window.history);
    await new Promise(r => setTimeout(r, 30));
    expect(document.title).toBe('bindweed — demo-repo');
    expect(window.sessionStorage.getItem('bindweed.token')).toBe('tok');
    globalThis.fetch = original;
  });

  it('runs main.tsx against the current document', async () => {
    const fetcher = (async () =>
      ({ ok: true, json: async () => ({ root: 'demo-repo', entries: [] }) }) as Response) as typeof fetch;
    globalThis.fetch = fetcher;
    await import('./main.tsx');
    await new Promise(r => setTimeout(r, 30));
    expect(document.title).toBe('bindweed — demo-repo');
  });

  it('skips boot without a token or root node', async () => {
    const { bootUi } = await import('./boot.tsx');
    const blank = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://127.0.0.1:4477/',
    });
    bootUi(blank.window.document, blank.window.location, blank.window.sessionStorage, blank.window.history);
    expect(blank.window.document.body.innerHTML).toBe('');
  });
});
