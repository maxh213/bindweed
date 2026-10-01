import { describe, expect, it } from 'vitest';
import type { LayoutDoc } from '../domain/layout.ts';
import { fetchDetail, fetchFile, fetchGraph, fetchLayout, fetchTree, postRescan, putLayout, takeToken } from './client.ts';

describe('fetchTree', () => {
  it('returns the tree with a bearer header and no token in the address', async () => {
    const calls: { url: string; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return {
        ok: true,
        json: async () => ({ root: 'demo-repo', entries: [] }),
      } as Response;
    }) as typeof fetch;
    const body = await fetchTree('tok', fetcher);
    expect(body).toEqual({ root: 'demo-repo', entries: [] });
    expect(calls[0]?.url).toBe('/api/tree');
    expect(calls[0]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('maps network failure to cannot reach bindweed', async () => {
    const fetcher = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({ error: 'cannot reach bindweed' });
  });

  it('surfaces API error text', async () => {
    const fetcher = (async () =>
      ({
        ok: false,
        json: async () => ({ error: 'missing or wrong token' }),
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({ error: 'missing or wrong token' });
    const bare = (async () =>
      ({
        ok: false,
        json: async () => ({}),
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', bare)).toEqual({ error: 'cannot reach bindweed' });
  });

  it('rejects a body that fails the tree schema', async () => {
    const fetcher = (async () =>
      ({
        ok: true,
        json: async () => ({ root: 1, entries: 'nope' }),
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({ error: 'cannot reach bindweed' });
  });

  it('treats a non-object error body as unreachable', async () => {
    const fetcher = (async () =>
      ({
        ok: false,
        json: async () => null,
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({ error: 'cannot reach bindweed' });
  });
});

describe('fetchFile', () => {
  it('requests a file with the bearer header', async () => {
    const fetcher = (async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/file?path=src%2Fa.ts');
      expect(init?.headers).toEqual({ Authorization: 'Bearer tok' });
      return { ok: true, json: async () => ({ path: 'src/a.ts', text: 'x\n' }) } as Response;
    }) as typeof fetch;
    expect(await fetchFile('tok', 'src/a.ts', fetcher)).toEqual({ path: 'src/a.ts', text: 'x\n' });
  });

  it('maps failures to error messages', async () => {
    const down = (async () => {
      throw new Error('x');
    }) as typeof fetch;
    expect(await fetchFile('tok', 'a', down)).toEqual({ error: 'cannot reach bindweed' });
    const large = (async () =>
      ({
        ok: false,
        json: async () => ({ error: 'file too large to show' }),
      }) as Response) as typeof fetch;
    expect(await fetchFile('tok', 'big.txt', large)).toEqual({ error: 'file too large to show' });
    const bad = (async () =>
      ({
        ok: true,
        json: async () => ({ path: 'a', text: 3 }),
      }) as Response) as typeof fetch;
    expect(await fetchFile('tok', 'a', bad)).toEqual({ error: 'cannot reach bindweed' });
    const bareErr = (async () =>
      ({
        ok: false,
        json: async () => ({}),
      }) as Response) as typeof fetch;
    expect(await fetchFile('tok', 'a', bareErr)).toEqual({ error: 'cannot reach bindweed' });
    const nullErr = (async () =>
      ({
        ok: false,
        json: async () => null,
      }) as Response) as typeof fetch;
    expect(await fetchFile('tok', 'a', nullErr)).toEqual({ error: 'cannot reach bindweed' });
  });

  it('returns a binary file marker', async () => {
    const fetcher = (async () =>
      ({
        ok: true,
        json: async () => ({ path: 'blob.bin', binary: true }),
      }) as Response) as typeof fetch;
    expect(await fetchFile('tok', 'blob.bin', fetcher)).toEqual({ path: 'blob.bin', binary: true });
  });
});

function fakeLocation(href: string): Location {
  const url = new URL(href);
  return {
    href: url.href,
    hash: url.hash,
    pathname: url.pathname,
    search: url.search,
  } as Location;
}

describe('takeToken', () => {
  it('stores the token, strips the query, and keeps sessionStorage', () => {
    const storage = new Map<string, string>();
    const keys: string[] = [];
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        keys.push(k);
        storage.set(k, v);
      },
    } as Storage;
    let replaced = '';
    let state: unknown = 'unset';
    let title = 'unset';
    const historyApi = {
      replaceState: (s: unknown, t: string, url: string) => {
        state = s;
        title = t;
        replaced = url;
      },
    } as History;
    const token = takeToken(
      fakeLocation('http://127.0.0.1:4477/?token=abcd1234#file=src/a.ts'),
      store,
      historyApi,
    );
    expect(token).toBe('abcd1234');
    expect(keys).toEqual(['bindweed.token']);
    expect(storage.get('bindweed.token')).toBe('abcd1234');
    expect(state).toBeNull();
    expect(title).toBe('');
    expect(replaced).toBe('/#file=src/a.ts');
  });

  it('reads a stored token when the query has none', () => {
    const asked: string[] = [];
    const store = {
      getItem: (k: string) => {
        asked.push(k);
        return 'from-session';
      },
      setItem: () => undefined,
    } as unknown as Storage;
    const historyApi = { replaceState: () => undefined } as unknown as History;
    expect(takeToken(fakeLocation('http://127.0.0.1:4477/'), store, historyApi)).toBe('from-session');
    expect(asked).toEqual(['bindweed.token']);
  });

  it('takes the token in the address over one the tab stored earlier', () => {
    const storage = new Map([['bindweed.token', 'older']]);
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    } as Storage;
    const historyApi = { replaceState: () => undefined } as unknown as History;
    expect(takeToken(fakeLocation('http://127.0.0.1:4477/?token=newer'), store, historyApi)).toBe('newer');
    expect(storage.get('bindweed.token')).toBe('newer');
  });
});

const GRAPH_BODY = {
  at: 'src',
  crumbs: [
    { name: 'layered', at: '' },
    { name: 'src', at: 'src' },
  ],
  nodes: [
    { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
    { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false },
  ],
  edges: [
    { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
    { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: true, cycleText: 'app → domain → app' },
  ],
};

describe('fetchGraph', () => {
  it('requests the view with the bearer header and the encoded at', async () => {
    const calls: { url: string; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return { ok: true, json: async () => GRAPH_BODY } as Response;
    }) as typeof fetch;
    const body = await fetchGraph('tok', 'src/app', fetcher);
    expect(body).toEqual(GRAPH_BODY);
    expect(calls[0]?.url).toBe('/api/graph?at=src%2Fapp');
    expect(calls[0]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('maps failures and bad bodies to error text', async () => {
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await fetchGraph('tok', '', down)).toEqual({ error: 'cannot reach bindweed' });
    const missing = (async () =>
      ({ ok: false, json: async () => ({ error: 'no such directory' }) }) as Response) as typeof fetch;
    expect(await fetchGraph('tok', 'notes', missing)).toEqual({ error: 'no such directory' });
    const bad = (async () => ({ ok: true, json: async () => ({ at: 5 }) }) as Response) as typeof fetch;
    expect(await fetchGraph('tok', '', bad)).toEqual({ error: 'cannot reach bindweed' });
    const bare = (async () => ({ ok: false, json: async () => null }) as Response) as typeof fetch;
    expect(await fetchGraph('tok', '', bare)).toEqual({ error: 'cannot reach bindweed' });
  });
});

describe('postRescan', () => {
  it('posts with the bearer header and returns the counts', async () => {
    const calls: { url: string; method: string | undefined; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, headers: init?.headers });
      return { ok: true, json: async () => ({ files: 4, ms: 12 }) } as Response;
    }) as typeof fetch;
    expect(await postRescan('tok', fetcher)).toEqual({ files: 4, ms: 12 });
    expect(calls).toEqual([{ url: '/api/rescan', method: 'POST', headers: { Authorization: 'Bearer tok' } }]);
  });

  it('maps failures and bad bodies to error text', async () => {
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await postRescan('tok', down)).toEqual({ error: 'cannot reach bindweed' });
    const denied = (async () =>
      ({ ok: false, json: async () => ({ error: 'missing or wrong token' }) }) as Response) as typeof fetch;
    expect(await postRescan('tok', denied)).toEqual({ error: 'missing or wrong token' });
    const bad = (async () => ({ ok: true, json: async () => ({ files: 'x' }) }) as Response) as typeof fetch;
    expect(await postRescan('tok', bad)).toEqual({ error: 'cannot reach bindweed' });
  });
});

describe('tree schema edge', () => {
  it('accepts a nested directory entry', async () => {
    const fetcher = (async () =>
      ({
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
          ],
        }),
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({
      root: 'demo-repo',
      entries: [
        {
          name: 'src',
          path: 'src',
          kind: 'dir',
          children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }],
        },
      ],
    });
  });

  it('rejects a directory entry without children', async () => {
    const fetcher = (async () =>
      ({
        ok: true,
        json: async () => ({
          root: 'demo-repo',
          entries: [{ name: 'src', path: 'src', kind: 'dir' }],
        }),
      }) as Response) as typeof fetch;
    expect(await fetchTree('tok', fetcher)).toEqual({ error: 'cannot reach bindweed' });
  });
});

const EMPTY_LAYOUT: LayoutDoc = { version: 1, views: {}, settings: { tests: false, external: false } };

const RICH_GRAPH = {
  at: 'src',
  crumbs: [{ name: 'layered', at: '' }],
  nodes: [
    { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 3, row: 0, order: 0, cycle: false },
    { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 2, row: 1, order: 0, cycle: false, abstract: true },
    { id: 'src/app/a.test.ts', kind: 'file', name: 'a.test.ts', path: 'src/app/a.test.ts', row: 0, order: 0, cycle: false, test: true },
    { id: 'node:fs', kind: 'external', name: 'node:fs', path: 'node:fs', row: 2, order: 0, cycle: false },
  ],
  edges: [{ from: 'src/app', to: 'src/domain', runtime: 2, type: 0, heritage: 1, cycle: false }],
};

const RICH_DETAIL = {
  id: 'src/infra',
  name: 'infra',
  path: 'src/infra',
  kind: 'package',
  files: 2,
  imports: [{ id: 'node:fs', name: 'node:fs', kind: 'external', runtime: 1, type: 0, heritage: 0 }],
  importedBy: [],
};

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

describe('fetchLayout', () => {
  it('returns the document the server stored', async () => {
    const calls: { url: string; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return jsonResponse(true, EMPTY_LAYOUT);
    }) as typeof fetch;
    expect(await fetchLayout('tok', fetcher)).toEqual(EMPTY_LAYOUT);
    expect(calls).toEqual([{ url: '/api/layout', headers: { Authorization: 'Bearer tok' } }]);
  });

  it('uses the empty document when the body is refused or the network fails', async () => {
    const saved: LayoutDoc = { version: 1, views: { src: { 'src/domain': { x: 1, y: 2 } } }, settings: { tests: true, external: true } };
    const denied = (async () => jsonResponse(false, saved)) as typeof fetch;
    expect(await fetchLayout('tok', denied)).toEqual(EMPTY_LAYOUT);
    const odd = (async () => jsonResponse(true, { version: 2 })) as typeof fetch;
    expect(await fetchLayout('tok', odd)).toEqual(EMPTY_LAYOUT);
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await fetchLayout('tok', down)).toEqual(EMPTY_LAYOUT);
  });
});

describe('putLayout', () => {
  it('puts the document and reads the saved copy', async () => {
    const calls: { url: string; method: string | undefined; body: BodyInit | null | undefined; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body, headers: init?.headers });
      return jsonResponse(true, EMPTY_LAYOUT);
    }) as typeof fetch;
    expect(await putLayout('tok', EMPTY_LAYOUT, fetcher)).toEqual(EMPTY_LAYOUT);
    expect(await putLayout('', EMPTY_LAYOUT, fetcher)).toEqual(EMPTY_LAYOUT);
    expect(calls[0]).toEqual({
      url: '/api/layout',
      method: 'PUT',
      body: JSON.stringify(EMPTY_LAYOUT),
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    });
    expect(calls[1]?.headers).toEqual({ Authorization: 'Bearer ', 'Content-Type': 'application/json' });
  });

  it('maps a refusal, a bad copy and a network failure', async () => {
    const denied = (async () => jsonResponse(false, { error: 'bad layout' })) as typeof fetch;
    expect(await putLayout('tok', EMPTY_LAYOUT, denied)).toEqual({ error: 'bad layout' });
    const odd = (async () => jsonResponse(true, { version: 2 })) as typeof fetch;
    expect(await putLayout('tok', EMPTY_LAYOUT, odd)).toEqual({ error: 'cannot reach bindweed' });
    const bare = (async () => jsonResponse(false, null)) as typeof fetch;
    expect(await putLayout('tok', EMPTY_LAYOUT, bare)).toEqual({ error: 'cannot reach bindweed' });
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await putLayout('tok', EMPTY_LAYOUT, down)).toEqual({ error: 'cannot reach bindweed' });
  });
});

describe('fetchDetail', () => {
  it('requests the node with the flags that are on', async () => {
    const calls: { url: string; headers: HeadersInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return jsonResponse(true, url.startsWith('/api/graph') ? RICH_GRAPH : RICH_DETAIL);
    }) as typeof fetch;
    expect(await fetchDetail('tok', 'src/infra', 'src', fetcher, { tests: true, external: true })).toEqual(RICH_DETAIL);
    expect(await fetchDetail('', 'src/infra', 'src', fetcher)).toEqual(RICH_DETAIL);
    expect(calls[0]).toEqual({
      url: '/api/detail?id=src%2Finfra&at=src&tests=1&external=1',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(calls[1]?.headers).toEqual({ Authorization: 'Bearer ' });
    expect(await fetchGraph('tok', 'src', fetcher, { tests: true, external: true })).toEqual(RICH_GRAPH);
    expect(calls[2]?.url).toBe('/api/graph?at=src&tests=1&external=1');
  });

  it('maps a missing node, a bad body and a network failure', async () => {
    const missing = (async () => jsonResponse(false, { error: 'no such node' })) as typeof fetch;
    expect(await fetchDetail('tok', 'gone', 'src', missing)).toEqual({ error: 'no such node' });
    const odd = (async () => jsonResponse(true, { id: 1 })) as typeof fetch;
    expect(await fetchDetail('tok', 'src', 'src', odd)).toEqual({ error: 'cannot reach bindweed' });
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await fetchDetail('tok', 'src', 'src', down)).toEqual({ error: 'cannot reach bindweed' });
  });
});
