import { describe, expect, it } from 'vitest';
import { fetchFile, fetchTree } from './api.ts';

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
  });
});
