import { describe, expect, it } from 'vitest';
import { makeQueryClient } from './App.tsx';

describe('makeQueryClient', () => {
  it('disables query retries', () => {
    const opts = makeQueryClient().getDefaultOptions();
    expect(opts.queries?.retry).toBe(0);
    expect(opts.queries?.retryDelay).toBe(0);
  });
});
