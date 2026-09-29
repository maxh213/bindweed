import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseArgs, shownPath } from './args.ts';
import { gitToplevel, prepareBindweed, type GitRunner } from './repo.ts';
import { bindApp, listenErrorMessage, newToken } from './serve.ts';

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
  git?: GitRunner;
};

export function installDirFrom(metaUrl: string): string {
  return dirname(dirname(fileURLToPath(metaUrl)));
}

export function uiDistDir(installDir: string): string {
  return join(installDir, 'dist', 'ui');
}

export function uiIndexPath(installDir: string): string {
  return join(uiDistDir(installDir), 'index.html');
}

export function defaultIo(): Io {
  return {
    writeOut: t => {
      process.stdout.write(t);
    },
    writeErr: t => {
      process.stderr.write(t);
    },
  };
}

export function bindRunning(running: Promise<number> | undefined): void {
  void Promise.resolve(running).then(code => {
    if (typeof code === 'number') process.exitCode = code;
  });
}

function fail(io: Io, message: string, code: number): number {
  io.writeErr(message + '\n');
  return code;
}

async function prepareRepo(pathArg: string | undefined, cwd: string, git?: GitRunner): Promise<
  | { ok: true; root: string }
  | { ok: false; shown: string }
> {
  const target = pathArg === undefined ? cwd : resolve(cwd, pathArg);
  const root = await gitToplevel(target, git);
  if (root === undefined) return { ok: false, shown: shownPath(pathArg, cwd) };
  return { ok: true, root };
}

export async function waitForAbort(signal: AbortSignal, close: () => Promise<void>): Promise<void> {
  if (signal.aborted) {
    await close();
    return;
  }
  await once(signal, 'abort');
  await close();
}

async function serve(
  opts: MainOpts,
  root: string,
  portChoice: { mode: 'fixed' | 'range'; port: number },
): Promise<number> {
  const token = newToken();
  const bound = await bindApp(
    {
      repoRoot: root,
      uiDir: uiDistDir(opts.installDir),
      token,
      port: portChoice.port,
      git: opts.git,
    },
    portChoice,
  );
  if ('error' in bound) return fail(opts.io, listenErrorMessage(bound.error), 1);
  opts.io.writeOut(`bindweed: http://127.0.0.1:${bound.port}/?token=${token}\n`);
  opts.io.writeOut(`serving ${root}\n`);
  await waitForAbort(opts.signal, () => new Promise(resolveClose => bound.server.close(() => resolveClose())));
  return 0;
}

export async function main(opts: MainOpts): Promise<number> {
  const parsed = parseArgs(opts.argv, opts.env.BINDWEED_PORT);
  if (!parsed.ok) return fail(opts.io, parsed.message, 2);

  const repo = await prepareRepo(parsed.pathArg, opts.cwd, opts.git);
  if (!repo.ok) return fail(opts.io, `bindweed: ${repo.shown} is not inside a git repository`, 2);

  if (!existsSync(uiIndexPath(opts.installDir))) {
    return fail(opts.io, `bindweed: the ui is not built; run npm run build in ${opts.installDir}`, 1);
  }

  await prepareBindweed(repo.root, opts.git);
  return serve(opts, repo.root, parsed.port);
}

export function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
}

export function runIfMain(metaUrl: string, argv: string[], env: NodeJS.ProcessEnv, cwd: string, io: Io): Promise<number> | undefined {
  if (!isEntry(metaUrl, argv[1])) return undefined;
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return main({
    argv,
    env,
    cwd,
    installDir: installDirFrom(metaUrl),
    io,
    signal: ac.signal,
  });
}

export function startCli(
  metaUrl: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  io: Io,
): Promise<number> | undefined {
  const running = runIfMain(metaUrl, argv, env, cwd, io);
  bindRunning(running);
  return running;
}

export const cliBoot = startCli(import.meta.url, process.argv, process.env, process.cwd(), defaultIo());
