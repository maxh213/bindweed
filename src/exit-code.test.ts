import { describe, expect, it } from 'vitest';
import { exitCode } from './exit-code.ts';

describe('exitCode', () => {
  it('maps null to 1 and keeps other codes', () => {
    expect(exitCode(null)).toBe(1);
    expect(exitCode(0)).toBe(0);
    expect(exitCode(2)).toBe(2);
  });
});
