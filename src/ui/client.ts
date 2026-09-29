import type { TreeEntry } from '../domain/tree.ts';

export type TreeJson = {
  root: string;
  entries: TreeEntry[];
};

export type FileJson =
  | { path: string; text: string }
  | { path: string; binary: true }
  | { error: string };

function apiError(body: { error?: string }): { error: string } {
  return { error: body.error ?? 'cannot reach bindweed' };
}

export async function fetchTree(token: string, fetcher: typeof fetch = fetch): Promise<TreeJson | { error: string }> {
  try {
    const res = await fetcher('/api/tree', { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as TreeJson & { error?: string };
    if (!res.ok) return apiError(body);
    return body;
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function fetchFile(
  token: string,
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<FileJson> {
  try {
    const res = await fetcher(`/api/file?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as FileJson & { error?: string };
    if (!res.ok) return apiError(body);
    return body;
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export function takeToken(location: Location, storage: Storage, historyApi: History): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl !== null) {
    storage.setItem('bindweed.token', fromUrl);
    url.searchParams.delete('token');
    historyApi.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return fromUrl;
  }
  return storage.getItem('bindweed.token');
}

export function fileHashFrom(location: Location): string | null {
  const hash = location.hash;
  if (!hash.startsWith('#file=')) return null;
  return hash.slice('#file='.length);
}

export function writeFileHash(historyApi: History, path: string, encode: (p: string) => string): void {
  historyApi.replaceState(null, '', `#file=${encode(path)}`);
}
