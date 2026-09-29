import { describe, expect, it } from 'vitest';
import { httpMethod, httpPath } from './http-parts.ts';

describe('httpPath', () => {
  it('defaults missing or empty paths', () => {
    expect(httpPath(undefined)).toBe('/');
    expect(httpPath('')).toBe('/');
    expect(httpPath('/api/tree')).toBe('/api/tree');
  });
});

describe('httpMethod', () => {
  it('defaults a missing method to GET', () => {
    expect(httpMethod(undefined)).toBe('GET');
    expect(httpMethod('POST')).toBe('POST');
  });
});
