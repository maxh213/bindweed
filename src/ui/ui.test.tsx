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
    root.render(
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
    await new Promise(r => setTimeout(r, 0));
    const buttons = Array.from(document.querySelectorAll('button'));
    const src = buttons.find(el => el.textContent === 'src/');
    const file = buttons.find(el => el.textContent === 'a.ts');
    const top = buttons.find(el => el.textContent === 'demo-repo/');
    expect(src?.getAttribute('aria-expanded')).toBe('true');
    expect(top?.getAttribute('aria-expanded')).toBe('true');
    expect(file?.getAttribute('aria-current')).toBe('true');
    expect((file as HTMLButtonElement).style.paddingLeft).toBe('24px');
    expect((src as HTMLButtonElement).style.paddingLeft).toBe('12px');
    expect((top as HTMLButtonElement).style.paddingLeft).toBe('0px');
  });

  it('wires tree row styles and click callbacks', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    const toggled: string[] = [];
    const selected: string[] = [];
    root.render(
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
    await new Promise(r => setTimeout(r, 0));
    const buttons = Array.from(document.querySelectorAll('button'));
    const src = buttons.find(el => el.textContent === 'src/');
    const file = buttons.find(el => el.textContent === 'a.ts');
    const top = buttons.find(el => el.textContent === 'demo-repo/');
    expect((top as HTMLButtonElement).style.display).toBe('block');
    expect((top as HTMLButtonElement).style.width).toBe('100%');
    expect((top as HTMLButtonElement).style.textAlign).toBe('left');
    expect((top as HTMLButtonElement).style.borderWidth).toBe('0px');
    expect((top as HTMLButtonElement).style.borderStyle).toBe('none');
    expect((top as HTMLButtonElement).style.background).toBe('transparent');
    expect((top as HTMLButtonElement).style.cursor).toBe('pointer');
    expect((top as HTMLButtonElement).style.font).toContain('inherit');
    src?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    top?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    file?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(toggled).toEqual(['src', '']);
    expect(selected).toEqual(['src/a.ts']);
  });

  it('leaves aria-current unset for files that are not selected', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    root.render(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'README.md', path: 'README.md', kind: 'file' }],
        expanded: new Set(['']),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    await new Promise(r => setTimeout(r, 0));
    const file = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'README.md');
    expect(file?.hasAttribute('aria-current')).toBe(false);
    const rootRow = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'demo-repo/');
    expect(rootRow?.getAttribute('aria-expanded')).toBe('true');
  });

  it('marks a collapsed folder with aria-expanded false', async () => {
    const { TreeView } = await import('./TreeView.tsx');
    root.render(
      createElement(TreeView, {
        root: 'demo-repo',
        entries: [{ name: 'src', path: 'src', kind: 'dir', children: [] }],
        expanded: new Set(['']),
        selected: null,
        onToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    await new Promise(r => setTimeout(r, 0));
    const src = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'src/');
    expect(src?.getAttribute('aria-expanded')).toBe('false');
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
    const pre = document.querySelector('pre') as HTMLElement;
    expect(pre.style.fontFamily).toBe('ui-monospace, monospace');
    const rows = Array.from(pre.querySelectorAll('div'));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.getAttribute('data-line'))).toEqual(['1', '2', '3']);
    expect(rows.map(r => r.getAttribute('data-row-id'))).toEqual([
      '1:export const a = 1;',
      "2:export const name = 'żółw';",
      '3:export const sum = a + 2;',
    ]);
  });

  it('numbers each line of file text in order', async () => {
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
    const rows = Array.from(document.querySelectorAll('pre div'));
    expect(rows[0]?.textContent).toBe('1 export const a = 1;');
    expect(rows[1]?.textContent).toBe("2 export const name = 'żółw';");
    expect(rows[2]?.textContent).toBe('3 export const sum = a + 2;');
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

  async function renderDemoApp(currentRoot: Root): Promise<typeof fetch> {
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
      currentRoot.render(
        createElement(App, {
          token: 'tok',
          location: window.location,
          historyApi: window.history,
          fetcher,
        }),
      );
    });
    return fetcher;
  }

  it('loads the tree, opens a deep link, and selects a file on click', async () => {
    const { waitFor } = await import('@testing-library/dom');
    await renderDemoApp(root);
    await waitFor(() => {
      expect(document.title).toBe('bindweed — demo-repo');
      expect(document.body.textContent).toContain('export const a = 1;');
    });
    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons.find(el => el.textContent === 'demo-repo/')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(buttons.find(el => el.textContent === 'src/')?.getAttribute('aria-expanded')).toBe('true');
    expect(buttons.find(el => el.textContent === 'a.ts')?.getAttribute('aria-current')).toBe('true');
  });

  it('selects a file and updates the hash', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await renderDemoApp(root);
    await waitFor(() => {
      expect(document.body.textContent).toContain('README.md');
    });
    const readme = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'README.md');
    if (readme === undefined) throw new Error('missing README.md');
    await act(async () => {
      readme.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#file=README.md');
      expect(document.body.textContent).toContain('# demo');
    });
    expect(
      Array.from(document.querySelectorAll('button'))
        .find(el => el.textContent === 'README.md')
        ?.getAttribute('aria-current'),
    ).toBe('true');
  });

  it('toggles folders in the app tree', async () => {
    const { act } = await import('react');
    const { waitFor } = await import('@testing-library/dom');
    await renderDemoApp(root);
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('button')).some(el => el.textContent === 'src/')).toBe(true);
    });
    const srcOpen = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'src/');
    if (srcOpen === undefined) throw new Error('missing src/');
    await act(async () => {
      srcOpen.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('button'))
          .find(el => el.textContent === 'src/')
          ?.getAttribute('aria-expanded'),
      ).toBe('false');
    });
    const rootRow = Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'demo-repo/');
    if (rootRow === undefined) throw new Error('missing root');
    await act(async () => {
      rootRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('nav button')).map(el => el.textContent)).toEqual(['demo-repo/']);
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
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(document.body.textContent).toContain('select a file');
    });
    await new Promise(r => setTimeout(r, 2500));
    expect(calls).toBe(1);
    expect(document.title).not.toBe('bindweed — ');
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

  it('boots from the token in the address', async () => {
    const { bootUi } = await import('./boot.tsx');
    const { waitFor } = await import('@testing-library/dom');
    const fetcher = (async () =>
      ({ ok: true, json: async () => ({ root: 'demo-repo', entries: [] }) }) as Response) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    expect(bootUi(document, window.location, window.sessionStorage, window.history)).toBe(true);
    await waitFor(() => {
      expect(document.title).toBe('bindweed — demo-repo');
    });
    expect(window.sessionStorage.getItem('bindweed.token')).toBe('tok');
    globalThis.fetch = original;
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
