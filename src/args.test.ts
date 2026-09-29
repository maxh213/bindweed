import { describe, expect, it } from 'vitest';
import { parseArgs, parsePortValue, shownPath } from './args.ts';

describe('parsePortValue', () => {
  it('accepts ports from 1 to 65535', () => {
    expect(parsePortValue('1')).toBe(1);
    expect(parsePortValue('4477')).toBe(4477);
    expect(parsePortValue('65535')).toBe(65535);
  });

  it('rejects non-numeric and out of range values', () => {
    expect(parsePortValue('abc')).toBeUndefined();
    expect(parsePortValue('0')).toBeUndefined();
    expect(parsePortValue('65536')).toBeUndefined();
    expect(parsePortValue('01')).toBeUndefined();
  });
});

describe('parseArgs', () => {
  it('defaults path and port 4477', () => {
    expect(parseArgs(['node', 'bindweed'], undefined)).toEqual({
      ok: true,
      pathArg: undefined,
      port: { mode: 'range', port: 4477 },
    });
  });

  it('takes a path argument', () => {
    expect(parseArgs(['node', 'bindweed', 'demo-repo/src'], undefined)).toMatchObject({
      ok: true,
      pathArg: 'demo-repo/src',
    });
  });

  it('prefers --port over BINDWEED_PORT', () => {
    expect(parseArgs(['node', 'bindweed', '--port', '4555'], '4600')).toEqual({
      ok: true,
      pathArg: undefined,
      port: { mode: 'fixed', port: 4555 },
    });
  });

  it('uses BINDWEED_PORT as a range start', () => {
    expect(parseArgs(['node', 'bindweed'], '4600')).toEqual({
      ok: true,
      pathArg: undefined,
      port: { mode: 'range', port: 4600 },
    });
  });

  it('rejects a bad --port value', () => {
    expect(parseArgs(['node', 'bindweed', '--port', 'abc'], undefined)).toEqual({
      ok: false,
      message: 'bindweed: port abc is not a number from 1 to 65535',
    });
    expect(parseArgs(['node', 'bindweed', '--port', '0'], undefined)).toEqual({
      ok: false,
      message: 'bindweed: port 0 is not a number from 1 to 65535',
    });
    expect(parseArgs(['node', 'bindweed', '--port', '65536'], undefined)).toEqual({
      ok: false,
      message: 'bindweed: port 65536 is not a number from 1 to 65535',
    });
  });

  it('rejects a bad BINDWEED_PORT', () => {
    expect(parseArgs(['node', 'bindweed'], 'abc')).toEqual({
      ok: false,
      message: 'bindweed: port abc is not a number from 1 to 65535',
    });
  });

  it('rejects malformed command lines', () => {
    const usage = 'bindweed: usage: bindweed [path] [--port N]';
    expect(parseArgs(['node', 'bindweed', '--port'], undefined)).toEqual({ ok: false, message: usage });
    expect(parseArgs(['node', 'bindweed', '--watch'], undefined)).toEqual({ ok: false, message: usage });
    expect(parseArgs(['node', 'bindweed', 'one', 'two'], undefined)).toEqual({ ok: false, message: usage });
  });
});

describe('shownPath', () => {
  it('uses the typed path or the absolute cwd', () => {
    expect(shownPath(undefined, '/tmp/qa/plain')).toBe('/tmp/qa/plain');
    expect(shownPath('../plain', '/tmp/qa/demo-repo')).toBe('../plain');
    expect(shownPath('/tmp/qa/missing', '/tmp/qa/demo-repo')).toBe('/tmp/qa/missing');
  });
});
