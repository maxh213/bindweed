import { once } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, shownPath } from './args.ts';
import { gitToplevel, prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage, type PortChoice } from './serve.ts';

export type Io = {
  writeOut(text: string): void;
  writeErr(text: string): void;
};

export type MainOpts = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  installDir: string;
  io: Io;
  signal: AbortSignal;
};

function uiDir(installDir: string): string {
  return join(installDir, 'dist', 'ui');
}

function fail(io: Io, message: string, code: number): number {
  io.writeErr(`${message}\n`);
  return code;
}

function repoRootFor(pathArg: string | undefined, cwd: string): Promise<string | undefined> {
  return gitToplevel(pathArg === undefined ? cwd : resolve(cwd, pathArg));
}

async function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await once(signal, 'abort');
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}

async function serve(opts: MainOpts, root: string, choice: PortChoice): Promise<number> {
  const bound = await bindApp({ repoRoot: root, uiDir: uiDir(opts.installDir) }, choice);
  if ('error' in bound) return fail(opts.io, listenErrorMessage(bound.error), 1);
  opts.io.writeOut(`bindweed: http://127.0.0.1:${bound.port}/?token=${bound.token}\n`);
  opts.io.writeOut(`serving ${root}\n`);
  await untilAborted(opts.signal);
  await closeServer(bound.server);
  return 0;
}

export async function main(opts: MainOpts): Promise<number> {
  const parsed = parseArgs(opts.argv, opts.env.BINDWEED_PORT);
  if (!parsed.ok) return fail(opts.io, parsed.message, 2);
  const root = await repoRootFor(parsed.pathArg, opts.cwd);
  if (root === undefined) {
    return fail(opts.io, `bindweed: ${shownPath(parsed.pathArg, opts.cwd)} is not inside a git repository`, 2);
  }
  if (!existsSync(join(uiDir(opts.installDir), 'index.html'))) {
    return fail(opts.io, `bindweed: the ui is not built; run npm run build in ${opts.installDir}`, 1);
  }
  await prepareBindweed(root);
  return serve(opts, root, parsed.port);
}

function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
}

function stdIo(): Io {
  return {
    writeOut: text => {
      process.stdout.write(text);
    },
    writeErr: text => {
      process.stderr.write(text);
    },
  };
}

export function runIfMain(metaUrl: string, argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> | undefined {
  if (!isEntry(metaUrl, argv[1])) return undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const running = main({
    argv,
    env,
    cwd,
    installDir: dirname(dirname(fileURLToPath(metaUrl))),
    io: stdIo(),
    signal: controller.signal,
  });
  void running.then(code => {
    process.exitCode = code;
  });
  return running;
}

runIfMain(import.meta.url, process.argv, process.env, process.cwd());
