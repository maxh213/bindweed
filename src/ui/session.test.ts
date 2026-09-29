import { describe, expect, it } from 'vitest';
import { fileHashFrom, takeToken, writeFileHash } from './session.ts';

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
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    } as Storage;
    let replaced = '';
    const historyApi = {
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaced = url;
      },
    } as History;
    const token = takeToken(fakeLocation('http://127.0.0.1:4477/?token=abcd1234'), store, historyApi);
    expect(token).toBe('abcd1234');
    expect(storage.get('bindweed.token')).toBe('abcd1234');
    expect(replaced).toBe('/');
  });

  it('reads a stored token when the query has none', () => {
    const store = {
      getItem: () => 'from-session',
      setItem: () => undefined,
    } as unknown as Storage;
    const historyApi = { replaceState: () => undefined } as unknown as History;
    expect(takeToken(fakeLocation('http://127.0.0.1:4477/'), store, historyApi)).toBe('from-session');
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
    const historyApi = {
      replaceState: (_s: unknown, _t: string, next: string) => {
        url = next;
      },
    } as History;
    writeFileHash(historyApi, 'notes/żółw i zając.md', p =>
      p.split('/').map(encodeURIComponent).join('/'),
    );
    expect(url).toBe('#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md');
  });
});
