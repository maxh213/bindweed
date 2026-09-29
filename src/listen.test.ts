import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { bindOnce, listenErrorMessage, listenForChoice, listenRange } from './listen.ts';

async function hold(port: number): Promise<{ close(): Promise<void> }> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      }),
  };
}

describe('listenErrorMessage', () => {
  it('names a taken explicit port', () => {
    expect(listenErrorMessage({ kind: 'in-use', port: 4555 })).toBe('bindweed: port 4555 is in use');
  });

  it('names the exhausted range', () => {
    expect(listenErrorMessage({ kind: 'none-free', from: 4477, to: 4497 })).toBe(
      'bindweed: no free port between 4477 and 4497',
    );
  });
});

describe('listenRange', () => {
  it('binds the first free port in a range', async () => {
    const held = await hold(19001);
    const server = createServer();
    const result = await listenRange(server, 19001, 19003, false);
    expect(result).toEqual({ port: 19002 });
    server.close();
    await held.close();
  });

  it('errors at once for a fixed taken port', async () => {
    const held = await hold(19011);
    const server = createServer();
    const result = await listenRange(server, 19011, 19011, true);
    expect(result).toEqual({ error: { kind: 'in-use', port: 19011 } });
    server.close();
    await held.close();
  });

  it('errors when every port in the range is taken', async () => {
    const a = await hold(19021);
    const b = await hold(19022);
    const server = createServer();
    const result = await listenRange(server, 19021, 19022, false);
    expect(result).toEqual({ error: { kind: 'none-free', from: 19021, to: 19022 } });
    server.close();
    await a.close();
    await b.close();
  });
});

describe('listenForChoice', () => {
  it('uses a fixed port or a twenty-wide range', async () => {
    const server = createServer();
    const fixed = await listenForChoice(server, { mode: 'fixed', port: 19031 });
    expect(fixed).toEqual({ port: 19031 });
    server.close();
    await new Promise(r => setTimeout(r, 10));
    const server2 = createServer();
    const ranged = await listenForChoice(server2, { mode: 'range', port: 19041 });
    expect(ranged).toEqual({ port: 19041 });
    server2.close();
  });
});

describe('bindOnce', () => {
  it('listens on 127.0.0.1 only', async () => {
    const server = createServer();
    await bindOnce(server, 19051);
    const addr = server.address();
    expect(addr).toMatchObject({ address: '127.0.0.1', port: 19051 });
    server.close();
  });

  it('rethrows errors that are not EADDRINUSE from the range loop', async () => {
    const server = createServer();
    const err = Object.assign(new Error('boom'), { code: 'EACCES' });
    server.listen = ((..._ignored: unknown[]) => {
      void _ignored;
      queueMicrotask(() => server.emit('error', err));
      return server;
    }) as typeof server.listen;
    await expect(listenRange(server, 19071, 19071, false)).rejects.toBe(err);
  });
});
