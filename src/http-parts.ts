export function httpPath(url: string | undefined): string {
  if (url === undefined) return '/';
  if (url.length === 0) return '/';
  return url;
}

export function httpMethod(method: string | undefined): string {
  if (method === undefined) return 'GET';
  return method;
}
