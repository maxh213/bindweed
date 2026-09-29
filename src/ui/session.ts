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
