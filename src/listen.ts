import type { Server } from 'node:http';

export type ListenError = { kind: 'in-use'; port: number } | { kind: 'none-free'; from: number; to: number };

export function listenErrorMessage(err: ListenError): string {
  if (err.kind === 'in-use') return `bindweed: port ${err.port} is in use`;
  return `bindweed: no free port between ${err.from} and ${err.to}`;
}

function isAddrInUse(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EADDRINUSE';
}

export function bindOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function tryPort(
  server: Server,
  port: number,
  fixed: boolean,
): Promise<'ok' | 'next' | ListenError> {
  try {
    await bindOnce(server, port);
    return 'ok';
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    if (fixed) return { kind: 'in-use', port };
    return 'next';
  }
}

export async function listenRange(
  server: Server,
  start: number,
  end: number,
  fixed: boolean,
): Promise<{ port: number } | { error: ListenError }> {
  for (let port = start; port <= end; port += 1) {
    const result = await tryPort(server, port, fixed);
    if (result === 'ok') return { port };
    if (result !== 'next') return { error: result };
  }
  return { error: { kind: 'none-free', from: start, to: end } };
}

export async function listenForChoice(
  server: Server,
  choice: { mode: 'fixed' | 'range'; port: number },
): Promise<{ port: number } | { error: ListenError }> {
  if (choice.mode === 'fixed') return listenRange(server, choice.port, choice.port, true);
  return listenRange(server, choice.port, choice.port + 20, false);
}
