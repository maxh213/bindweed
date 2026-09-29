import { describe, expect, it } from 'vitest';
import { newToken, requestHasToken, tokenFromAuth, tokensEqual } from './token.ts';

describe('newToken', () => {
  it('returns 32 lowercase hex characters', () => {
    const token = newToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(token);
  });
});

describe('tokensEqual', () => {
  it('compares equal tokens as true', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
  });

  it('rejects wrong or differently sized tokens', () => {
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'ab')).toBe(false);
    expect(tokensEqual('', 'x')).toBe(false);
  });
});

describe('tokenFromAuth', () => {
  it('reads a bearer token', () => {
    expect(tokenFromAuth('Bearer deadbeef')).toBe('deadbeef');
    expect(tokenFromAuth('Basic x')).toBeUndefined();
    expect(tokenFromAuth(undefined)).toBeUndefined();
  });
});

describe('requestHasToken', () => {
  const token = 'a'.repeat(32);
  const wrong = '0'.repeat(32);

  it('accepts a bearer header or query token', () => {
    expect(requestHasToken(`Bearer ${token}`, null, token)).toBe(true);
    expect(requestHasToken(undefined, token, token)).toBe(true);
  });

  it('rejects missing or wrong tokens', () => {
    expect(requestHasToken(undefined, null, token)).toBe(false);
    expect(requestHasToken(`Bearer ${wrong}`, null, token)).toBe(false);
    expect(requestHasToken(undefined, wrong, token)).toBe(false);
    expect(requestHasToken(undefined, 'abc', token)).toBe(false);
    expect(requestHasToken(undefined, '', token)).toBe(false);
  });
});
