import { randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken(): string {
  return randomBytes(16).toString('hex');
}

export function tokensEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenFromAuth(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return undefined;
  return header.slice(prefix.length);
}

export function requestHasToken(
  authHeader: string | undefined,
  queryToken: string | null,
  expected: string,
): boolean {
  const bearer = tokenFromAuth(authHeader);
  if (bearer !== undefined) return tokensEqual(bearer, expected);
  if (queryToken === null) return false;
  return tokensEqual(queryToken, expected);
}
