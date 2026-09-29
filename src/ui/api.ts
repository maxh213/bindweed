export type TreeJson = {
  root: string;
  entries: import('../domain/tree.ts').TreeEntry[];
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
