import { realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, shownPath } from './args.ts';
import { uiIndexPath, installDirFrom, uiDistDir } from './install-dir.ts';
import { gitToplevel, gitCommonDir, type GitRunner } from './git.ts';
import { ensureBindweedDir, ensureExcludeLine, excludeFilePath } from './exclude.ts';
import { newToken } from './token.ts';
import { createAppServer } from './server.ts';
import { listenForChoice, listenErrorMessage } from './listen.ts';

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
  if (running === undefined) return;
  void running.then(code => {
    process.exitCode = code;
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

async function prepareExclude(root: string, git?: GitRunner): Promise<void> {
  await ensureBindweedDir(root);
  const common = await gitCommonDir(root, git);
  await ensureExcludeLine(excludeFilePath(common, root));
}

function waitForAbort(signal: AbortSignal, close: () => Promise<void>): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      void close().then(resolve);
    };
    if (signal.aborted) {
      done();
      return;
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function serve(
  opts: MainOpts,
  root: string,
  portChoice: { mode: 'fixed' | 'range'; port: number },
): Promise<number> {
  const token = newToken();
  const deps = {
    repoRoot: root,
    uiDir: uiDistDir(opts.installDir),
    token,
    port: portChoice.port,
    git: opts.git,
  };
  const server = createAppServer(deps);
  const listened = await listenForChoice(server, portChoice);
  if ('error' in listened) {
    server.close();
    return fail(opts.io, listenErrorMessage(listened.error), 1);
  }
  deps.port = listened.port;
  opts.io.writeOut(`bindweed: http://127.0.0.1:${listened.port}/?token=${token}\n`);
  opts.io.writeOut(`serving ${root}\n`);
  await waitForAbort(opts.signal, () => new Promise(resolve => server.close(() => resolve())));
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

  await prepareExclude(repo.root, opts.git);
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

bindRunning(runIfMain(import.meta.url, process.argv, process.env, process.cwd(), defaultIo()));
