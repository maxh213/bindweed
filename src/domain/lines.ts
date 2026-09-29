export function textLines(text: string): string[] {
  const parts = text.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

export function encodeHashPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function decodeHashPath(encoded: string): string {
  return encoded.split('/').map(decodeURIComponent).join('/');
}
