import { describe, expect, it } from 'vitest';
import { fetchFile, fetchTree, fileHashFrom, takeToken, writeFileHash } from './client.ts';

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
});

describe('fileHashFrom', () => {
  it('reads the file hash', () => {
    expect(fileHashFrom(fakeLocation('http://127.0.0.1:4477/#file=src/a.ts'))).toBe('src/a.ts');
    expect(fileHashFrom(fakeLocation('http://127.0.0.1:4477/'))).toBeNull();
  });
});

describe('writeFileHash', () => {
  it('writes a slash-preserving encoded hash', () => {
    let url = '';
    let state: unknown = 'unset';
    let title = 'unset';
    const historyApi = {
      replaceState: (s: unknown, t: string, next: string) => {
        state = s;
        title = t;
        url = next;
      },
    } as History;
    writeFileHash(historyApi, 'notes/żółw i zając.md', p =>
      p.split('/').map(encodeURIComponent).join('/'),
    );
    expect(state).toBeNull();
    expect(title).toBe('');
    expect(url).toBe('#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
    writeFileHash(historyApi, 'src/a.ts', p => p);
    expect(url).toBe('#file=src/a.ts');
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
