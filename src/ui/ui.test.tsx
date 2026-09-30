import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
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

function rowByText(text: string): HTMLButtonElement {
  const row = Array.from(document.querySelectorAll('button')).find(el => el.textContent === text);
  if (row === undefined) throw new Error(`missing row ${text}`);
  return row;
}

function rowTexts(): string[] {
  return Array.from(document.querySelectorAll('nav button')).map(el => el.textContent ?? '');
}

function click(row: HTMLElement): void {
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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

  async function show(element: ReactElement): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      root.render(element);
    });
  }

  it('shows collapsed folders and select a file', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const { FilePanel } = await import('./FilePanel.tsx');
    await show(
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
    expect(rowTexts()).toEqual(['demo-repo/', 'docs/', 'src/', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt']);
    expect(document.querySelector('nav + div')?.textContent).toBe('select a file');
  });

  it('expands a folder and marks a selected file', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    await show(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [
          {
            name: 'src',
            path: 'src',
            kind: 'dir',
            children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }],
          },
        ],
        expanded: new Set(['', 'src']),
        selected: 'src/a.ts',
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    const buttons = Array.from(document.querySelectorAll('button'));
    const src = buttons.find(el => el.textContent === 'src/');
    const file = buttons.find(el => el.textContent === 'a.ts');
    const top = buttons.find(el => el.textContent === 'demo-repo/');
    expect(src?.getAttribute('aria-expanded')).toBe('true');
    expect(top?.getAttribute('aria-expanded')).toBe('true');
    expect(file?.getAttribute('aria-current')).toBe('true');
    expect(rowByText('demo-repo/').matches('nav > button')).toBe(true);
    expect(rowByText('src/').matches('nav > ul > li > button')).toBe(true);
    expect(rowByText('a.ts').matches('nav > ul > li > ul > li > button')).toBe(true);
  });

  it('wires tree row click callbacks', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const toggled: string[] = [];
    const selected: string[] = [];
    await show(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [
          {
            name: 'src',
            path: 'src',
            kind: 'dir',
            children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }],
          },
        ],
        expanded: new Set(['', 'src']),
        selected: 'src/a.ts',
        onToggle: path => toggled.push(path),
        onSelect: path => selected.push(path),
      }),
    );
    const buttons = Array.from(document.querySelectorAll('button'));
    const src = buttons.find(el => el.textContent === 'src/');
    const file = buttons.find(el => el.textContent === 'a.ts');
    const top = buttons.find(el => el.textContent === 'demo-repo/');
    src?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    top?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    file?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(toggled).toEqual(['src', '']);
    expect(selected).toEqual(['src/a.ts']);
  });

  it('leaves aria-current unset for files that are not selected', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    await show(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'README.md', path: 'README.md', kind: 'file' }],
        expanded: new Set(['']),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    const file = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'README.md');
    expect(file?.hasAttribute('aria-current')).toBe(false);
    const rootRow = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'demo-repo/');
    expect(rootRow?.getAttribute('aria-expanded')).toBe('true');
  });

  it('marks a collapsed folder with aria-expanded false', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    await show(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'src', path: 'src', kind: 'dir', children: [] }],
        expanded: new Set(['']),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    const src = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'src/');
    expect(src?.getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses the root to a single row', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    await show(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'src', path: 'src', kind: 'dir', children: [] }],
        expanded: new Set<string>(),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(document.body.textContent).toBe('demo-repo/');
  });

  it('renders numbered lines for file text', async () => {
    const { FilePanel } = await import('./FilePanel.tsx');
    await show(
      createElement(FilePanel, {
        state: {
          kind: 'text',
          path: 'src/a.ts',
          text: "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
        },
      }),
    );
    expect(document.body.textContent).toContain('src/a.ts');
    expect(document.body.textContent).toContain('export const a = 1;');
    const pre = document.querySelector('pre') as HTMLElement;
    expect(pre.style.fontFamily).toBe('ui-monospace, monospace');
    const rows = Array.from(pre.querySelectorAll('div'));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.getAttribute('data-line'))).toEqual(['1', '2', '3']);
  });

  it('numbers each line of file text in order', async () => {
    const { FilePanel } = await import('./FilePanel.tsx');
    await show(
      createElement(FilePanel, {
        state: {
          kind: 'text',
          path: 'src/a.ts',
          text: "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
        },
      }),
    );
    const rows = Array.from(document.querySelectorAll('pre div'));
    expect(rows[0]?.textContent).toBe('1 export const a = 1;');
    expect(rows[1]?.textContent).toBe("2 export const name = 'żółw';");
    expect(rows[2]?.textContent).toBe('3 export const sum = a + 2;');
  });

  it('renders loading and message panels', async () => {
    const { FilePanel } = await import('./FilePanel.tsx');
    const { act } = await import('react');
    await act(async () => {
      root.render(createElement(FilePanel, { state: { kind: 'loading', path: 'x.ts' } }));
    });
    expect(document.body.textContent).toContain('x.ts');
    await act(async () => {
      root.render(
        createElement(FilePanel, {
          state: { kind: 'message', path: 'blob.bin', message: 'binary file, not shown' },
        }),
      );
    });
    expect(document.body.textContent).toContain('binary file, not shown');
  });

  it('shows an empty repository with only the root row', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const { FilePanel } = await import('./FilePanel.tsx');
    const { act } = await import('react');
    await act(async () => {
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
    });
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

  type Call = { url: string; headers: HeadersInit | undefined };

  const demoTree = {
    root: 'demo-repo',
    entries: [
      { name: 'docs', path: 'docs', kind: 'dir', children: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'file' }] },
      {
        name: 'notes',
        path: 'notes',
        kind: 'dir',
        children: [{ name: 'żółw i zając.md', path: 'notes/żółw i zając.md', kind: 'file' }],
      },
      {
        name: 'src',
        path: 'src',
        kind: 'dir',
        children: [
          { name: 'lib', path: 'src/lib', kind: 'dir', children: [{ name: 'util.ts', path: 'src/lib/util.ts', kind: 'file' }] },
          { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
        ],
      },
      { name: '.gitignore', path: '.gitignore', kind: 'file' },
      { name: 'README.md', path: 'README.md', kind: 'file' },
      { name: 'Zebra.txt', path: 'Zebra.txt', kind: 'file' },
      { name: 'apple.txt', path: 'apple.txt', kind: 'file' },
    ],
  };

  const demoFiles: Record<string, string> = {
    'src/a.ts': "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n",
    'src/lib/util.ts': 'export const id = 1;\n',
    'README.md': '# demo\n',
    'notes/żółw i zając.md': 'cześć\n',
  };

  function demoBody(url: string): unknown {
    if (url === '/api/tree') return demoTree;
    const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
    return { path, text: demoFiles[path] ?? '' };
  }

  function demoFetcher(calls: Call[], failAfter = Number.POSITIVE_INFINITY): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      if (calls.length > failAfter) throw new Error('down');
      return { ok: true, json: async () => demoBody(url) } as Response;
    }) as typeof fetch;
  }

  async function renderDemoApp(currentRoot: Root, fetcher: typeof fetch): Promise<void> {
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    await act(async () => {
      currentRoot.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher,
        }),
      );
    });
  }

  function freshDom(url: string): void {
    dom.window.close();
    dom = installDom(url);
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  }

  it('loads the tree, opens a deep link, and sends the token as a bearer header', async () => {
    const { waitFor } = await import('@testing-library/dom');
    const calls: Call[] = [];
    await renderDemoApp(root, demoFetcher(calls));
    await waitFor(() => {
      expect(document.title).toBe('bindweed — demo-repo');
      expect(document.body.textContent).toContain('export const sum = a + 2;');
    });
    expect(rowTexts()).toEqual(['demo-repo/', 'docs/', 'notes/', 'src/', 'lib/', 'a.ts', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt']);
    expect(rowByText('demo-repo/').getAttribute('aria-expanded')).toBe('true');
    expect(rowByText('src/').getAttribute('aria-expanded')).toBe('true');
    expect(rowByText('lib/').getAttribute('aria-expanded')).toBe('false');
    expect(rowByText('docs/').getAttribute('aria-expanded')).toBe('false');
    expect(rowByText('a.ts').getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('main header')?.textContent).toBe('src/a.ts');
    expect(Array.from(document.querySelectorAll('pre div')).map(el => el.textContent)).toEqual([
      '1 export const a = 1;',
      "2 export const name = 'żółw';",
      '3 export const sum = a + 2;',
    ]);
    expect(calls.map(c => c.url).sort()).toEqual(['/api/file?path=src%2Fa.ts', '/api/tree']);
    for (const call of calls) expect(call.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('opens a percent-encoded deep link and expands only its folders', async () => {
    const { waitFor } = await import('@testing-library/dom');
    freshDom('http://127.0.0.1:4477/?token=tok#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
    await renderDemoApp(root, demoFetcher([]));
    await waitFor(() => {
      expect(document.body.textContent).toContain('cześć');
      expect(rowTexts()).toContain('żółw i zając.md');
    });
    expect(document.querySelector('main header')?.textContent).toBe('notes/żółw i zając.md');
    expect(Array.from(document.querySelectorAll('pre div')).map(el => el.textContent)).toEqual(['1 cześć']);
    expect(rowByText('żółw i zając.md').getAttribute('aria-current')).toBe('true');
    expect(rowByText('notes/').getAttribute('aria-expanded')).toBe('true');
    expect(rowByText('src/').getAttribute('aria-expanded')).toBe('false');
    expect(rowByText('docs/').getAttribute('aria-expanded')).toBe('false');
    expect(window.location.hash).toBe('#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
  });

  it('selects a file on click and updates the hash', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await renderDemoApp(root, demoFetcher([]));
    await waitFor(() => {
      expect(rowTexts()).toContain('README.md');
    });
    await act(async () => {
      click(rowByText('README.md'));
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#file=README.md');
      expect(document.querySelector('main header')?.textContent).toBe('README.md');
      expect(Array.from(document.querySelectorAll('pre div')).map(el => el.textContent)).toEqual(['1 # demo']);
    });
    expect(document.querySelector('pre')?.style.fontFamily).toBe('ui-monospace, monospace');
    expect(rowByText('README.md').getAttribute('aria-current')).toBe('true');
    expect(rowByText('a.ts').hasAttribute('aria-current')).toBe(false);
  });

  it('writes the encoded hash for a non-ASCII path', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await renderDemoApp(root, demoFetcher([]));
    await waitFor(() => {
      expect(rowByText('notes/').getAttribute('aria-expanded')).toBe('false');
    });
    await act(async () => {
      click(rowByText('notes/'));
    });
    await waitFor(() => {
      expect(rowByText('żółw i zając.md').matches('li > ul > li > button')).toBe(true);
    });
    await act(async () => {
      click(rowByText('żółw i zając.md'));
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
      expect(document.body.textContent).toContain('cześć');
    });
    expect(rowByText('żółw i zając.md').getAttribute('aria-current')).toBe('true');
  });

  it('opens with every folder collapsed and toggles folders on click', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    freshDom('http://127.0.0.1:4477/?token=tok');
    await renderDemoApp(root, demoFetcher([]));
    const collapsed = ['demo-repo/', 'docs/', 'notes/', 'src/', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt'];
    await waitFor(() => {
      expect(rowTexts()).toEqual(collapsed);
    });
    expect(document.title).toBe('bindweed — demo-repo');
    expect(document.querySelector('main')?.textContent).toBe('select a file');
    await act(async () => {
      click(rowByText('src/'));
    });
    await waitFor(() => {
      expect(rowTexts()).toEqual(['demo-repo/', 'docs/', 'notes/', 'src/', 'lib/', 'a.ts', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt']);
    });
    expect(rowByText('src/').getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      click(rowByText('src/'));
    });
    await waitFor(() => {
      expect(rowTexts()).toEqual(collapsed);
    });
    expect(rowByText('src/').getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      click(rowByText('demo-repo/'));
    });
    await waitFor(() => {
      expect(rowTexts()).toEqual(['demo-repo/']);
    });
    expect(rowByText('demo-repo/').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a folder without closing the folders already open', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    freshDom('http://127.0.0.1:4477/?token=tok');
    await renderDemoApp(root, demoFetcher([]));
    await waitFor(() => {
      expect(rowTexts()).toContain('src/');
    });
    for (const folder of ['src/', 'lib/', 'docs/']) {
      await act(async () => {
        click(rowByText(folder));
      });
    }
    expect(rowTexts()).toEqual(['demo-repo/', 'docs/', 'guide.md', 'notes/', 'src/', 'lib/', 'util.ts', 'a.ts', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt']);
  });

  it('keeps the tree and says why a file cannot be shown after bindweed stopped', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    freshDom('http://127.0.0.1:4477/?token=tok');
    const calls: Call[] = [];
    const rows = ['demo-repo/', 'docs/', 'notes/', 'src/', '.gitignore', 'README.md', 'Zebra.txt', 'apple.txt'];
    await renderDemoApp(root, demoFetcher(calls, 1));
    await waitFor(() => {
      expect(rowTexts()).toContain('README.md');
    });
    for (const event of ['visibilitychange', 'focus', 'offline', 'online']) window.dispatchEvent(new window.Event(event));
    await new Promise(r => setTimeout(r, 150));
    expect(calls).toHaveLength(1);
    expect(rowTexts()).toEqual(rows);
    expect(document.title).toBe('bindweed — demo-repo');
    await act(async () => {
      click(rowByText('README.md'));
    });
    await waitFor(() => {
      expect(document.querySelector('main')?.textContent).toBe('README.mdcannot reach bindweed');
    });
    expect(document.querySelector('main header')?.textContent).toBe('README.md');
    expect(document.querySelector('pre')).toBeNull();
    expect(calls.map(c => c.url)).toEqual(['/api/tree', '/api/file?path=README.md']);
    expect(rowTexts()).toEqual(rows);
  });

  it('loads a file while the browser reports being offline', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    freshDom('http://127.0.0.1:4477/?token=tok');
    await renderDemoApp(root, demoFetcher([]));
    await waitFor(() => {
      expect(rowTexts()).toContain('README.md');
    });
    window.dispatchEvent(new window.Event('offline'));
    await act(async () => {
      click(rowByText('README.md'));
    });
    try {
      await waitFor(() => {
        expect(Array.from(document.querySelectorAll('pre div')).map(el => el.textContent)).toEqual(['1 # demo']);
      });
    } finally {
      window.dispatchEvent(new window.Event('online'));
    }
  });

  it('handles a tree fetch error', async () => {
    freshDom('http://127.0.0.1:4477/?token=tok');
    const { App } = await import('./App.tsx');
    const { waitFor } = await import('@testing-library/dom');
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
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
    await waitFor(() => {
      expect(calls).toBe(1);
      expect(document.body.textContent).toContain('select a file');
    });
    expect(document.title).not.toBe('bindweed — ');
  });

  it('loads a tree without a file hash', async () => {
    freshDom('http://127.0.0.1:4477/?token=tok');
    const { App } = await import('./App.tsx');
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
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
    });
    await waitFor(() => {
      expect(document.title).toBe('bindweed — demo-repo');
      expect(document.body.textContent).toContain('select a file');
    });
  });

  it('boots from the token in the address and sends it as a bearer header', async () => {
    const { bootUi } = await import('./boot.tsx');
    const { waitFor } = await import('@testing-library/dom');
    const calls: Call[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = demoFetcher(calls);
    try {
      expect(bootUi(document, window.location, window.sessionStorage, window.history)).toBe(true);
      await waitFor(() => {
        expect(document.title).toBe('bindweed — demo-repo');
        expect(document.body.textContent).toContain('export const a = 1;');
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(window.sessionStorage.getItem('bindweed.token')).toBe('tok');
    expect(window.location.href).toBe('http://127.0.0.1:4477/#file=src/a.ts');
    expect(calls.map(c => c.url).sort()).toEqual(['/api/file?path=src%2Fa.ts', '/api/tree']);
    for (const call of calls) expect(call.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('runs main.tsx against the current document', async () => {
    const { waitFor } = await import('@testing-library/dom');
    const fetcher = (async () =>
      ({ ok: true, json: async () => ({ root: 'demo-repo', entries: [] }) }) as Response) as typeof fetch;
    globalThis.fetch = fetcher;
    await import('./main.tsx');
    await waitFor(() => {
      expect(document.title).toBe('bindweed — demo-repo');
    });
    expect(window.sessionStorage.getItem('bindweed.token')).toBe('tok');
    expect(window.localStorage).toHaveLength(0);
    expect(window.location.href).toBe('http://127.0.0.1:4477/#file=src/a.ts');
  });

  it('skips boot without a token or root node', async () => {
    const { bootUi } = await import('./boot.tsx');
    const blank = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://127.0.0.1:4477/',
    });
    expect(bootUi(blank.window.document, blank.window.location, blank.window.sessionStorage, blank.window.history)).toBe(
      false,
    );
    expect(blank.window.document.body.innerHTML).toBe('');
  });

  it('skips boot when the root node is missing but a token is present', async () => {
    const { bootUi } = await import('./boot.tsx');
    const page = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://127.0.0.1:4477/?token=tok',
    });
    expect(bootUi(page.window.document, page.window.location, page.window.sessionStorage, page.window.history)).toBe(
      false,
    );
  });

  it('skips boot when the token is missing but the root node exists', async () => {
    const { bootUi } = await import('./boot.tsx');
    const page = new JSDOM('<!DOCTYPE html><html><body><div id="root">keep</div></body></html>', {
      url: 'http://127.0.0.1:4477/',
    });
    expect(bootUi(page.window.document, page.window.location, page.window.sessionStorage, page.window.history)).toBe(
      false,
    );
    expect(page.window.document.getElementById('root')?.textContent).toBe('keep');
  });
});
