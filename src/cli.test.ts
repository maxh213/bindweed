import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { connect, createServer as createNetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main, runIfMain, type Io } from './cli.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 20000 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);
const CLI_PATH = fileURLToPath(new URL('./cli.ts', import.meta.url));
const CLI_URL = pathToFileURL(CLI_PATH).href;
const LINK = /^bindweed: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]{32})\n$/;
const EXCLUDE_LINE = '.bindweed/';
const PATIENCE = 3000;
const SIGNAL_LIMIT = 2000;

type Captured = Io & { out: string[]; err: string[] };

type Started = { io: Captured; controller: AbortController; done: Promise<number> };

type Link = { port: number; token: string };

type Page = { status: number; type: string | null; body: string };

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, writeOut: t => out.push(t), writeErr: t => err.push(t) };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function makeWorkspace(): Promise<{ outer: string; repo: string; plain: string }> {
  const outer = await tempDir('bw-qa-');
  const repo = join(outer, 'demo-repo');
  const plain = join(outer, 'plain');
  await mkdir(join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(plain);
  await writeFile(join(repo, 'README.md'), '# demo\n');
  await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'src', 'lib', 'util.ts'), 'export const id = 1;\n');
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return { outer, repo, plain };
}

async function makeUnbuilt(): Promise<string> {
  const dir = await tempDir('bw-inst-');
  await mkdir(join(dir, 'dist', 'ui', 'assets'), { recursive: true });
  return dir;
}

async function makeInstall(): Promise<string> {
  const dir = await makeUnbuilt();
  await writeFile(join(dir, 'dist', 'ui', 'index.html'), '<html>ui</html>');
  return dir;
}

async function makeSymlinkInstall(): Promise<{ installCli: string; binLink: string }> {
  const outer = await tempDir('bw-sym-');
  const install = join(outer, 'pkg');
  const prefix = join(outer, 'prefix');
  await mkdir(join(install, 'src'), { recursive: true });
  await mkdir(join(install, 'dist', 'ui'), { recursive: true });
  await mkdir(join(prefix, 'bin'), { recursive: true });
  await mkdir(join(prefix, 'dist', 'ui'), { recursive: true });
  const installCli = join(install, 'src', 'cli.ts');
  const binLink = join(prefix, 'bin', 'bindweed');
  await symlink(CLI_PATH, installCli);
  await symlink(installCli, binLink);
  await writeFile(join(install, 'dist', 'ui', 'index.html'), '<html>own-ui</html>');
  await writeFile(join(prefix, 'dist', 'ui', 'index.html'), '<html>wrong-ui</html>');
  return { installCli, binLink };
}

function startMain(args: string[], cwd: string, installDir: string, env: NodeJS.ProcessEnv = {}): Started {
  const io = capture();
  const controller = new AbortController();
  const done = main({ argv: ['node', 'bindweed', ...args], env, cwd, installDir, io, signal: controller.signal });
  return { io, controller, done };
}

function startEntry(metaUrl: string, argv1: string, args: string[], cwd: string): Promise<number> {
  const running = runIfMain(metaUrl, ['node', argv1, ...args], {}, cwd);
  if (running === undefined) throw new Error('runIfMain did not start main');
  return running;
}

function hung(ms: number): Promise<'hung'> {
  return new Promise(resolve => {
    setTimeout(() => resolve('hung'), ms).unref();
  });
}

function within<T>(ms: number, work: Promise<T>): Promise<T | 'hung'> {
  return Promise.race([work, hung(ms)]);
}

async function untilLines(out: string[], count: number): Promise<void> {
  await vi.waitFor(() => expect(out.length).toBeGreaterThanOrEqual(count), { timeout: PATIENCE, interval: 10 });
}

function linkIn(line: string | undefined): Link {
  const match = LINK.exec(line ?? '');
  if (match === null) throw new Error(`no link in ${String(line)}`);
  return { port: Number(match[1]), token: String(match[2]) };
}

async function linkOnceServing(out: string[], done: Promise<number>): Promise<Link> {
  const early = await Promise.race([untilLines(out, 2), done]);
  if (early !== undefined) throw new Error(`bindweed exited with ${early} before serving`);
  return linkIn(out[0]);
}

function serving(started: Started): Promise<Link> {
  return linkOnceServing(started.io.out, started.done);
}

async function exitOf(started: Started): Promise<number | 'hung'> {
  const code = await within(PATIENCE, started.done);
  started.controller.abort();
  return code;
}

function stop(started: Started): Promise<number | 'hung'> {
  started.controller.abort();
  return within(SIGNAL_LIMIT, started.done);
}

async function getJson(port: number, path: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2000),
  });
  return { status: res.status, body: await res.json() };
}

async function getPage(link: Link): Promise<Page> {
  const res = await fetch(`http://127.0.0.1:${link.port}/?token=${link.token}`, { signal: AbortSignal.timeout(2000) });
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

function connectionOutcome(port: number): Promise<string> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (err: NodeJS.ErrnoException) => resolve(String(err.code)));
  });
}

async function unusedConnection(port: number): Promise<Socket> {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  await once(socket, 'connect');
  return socket;
}

async function hold(port: number): Promise<{ release(): Promise<void> }> {
  const server = createNetServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    release: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function snapshot(dir: string, rel = ''): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = join(rel, entry.name);
    if (entry.isDirectory()) mergeInto(found, path, await snapshot(dir, path));
    else found.set(path, await readFile(join(dir, path), 'base64'));
  }
  return found;
}

function mergeInto(target: Map<string, string>, dirPath: string, children: Map<string, string>): void {
  target.set(`${dirPath}/`, 'dir');
  for (const [key, value] of children) target.set(key, value);
}

function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter(key => before.get(key) !== after.get(key)).sort();
}

function decoded(entries: Map<string, string>, path: string): string {
  return Buffer.from(entries.get(path) ?? '', 'base64').toString();
}

function excludeCount(text: string): number {
  return text.split('\n').filter(line => line === EXCLUDE_LINE).length;
}

function captureStdio(): { out: string[]; err: string[]; restore(): void } {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    out,
    err,
    restore: () => {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    },
  };
}

describe('main', () => {
  it('refuses a folder outside any git repository and creates nothing there', async () => {
    const { plain } = await makeWorkspace();
    const started = startMain([], plain, await makeInstall());
    expect(await exitOf(started)).toBe(2);
    expect(started.io.err).toEqual([`bindweed: ${plain} is not inside a git repository\n`]);
    expect(started.io.out).toEqual([]);
    expect(await readdir(plain)).toEqual([]);
  });

  it('shows the path as typed when it is outside a repository or missing', async () => {
    const { repo, plain } = await makeWorkspace();
    const relative = startMain(['../plain'], repo, await makeInstall());
    expect(await exitOf(relative)).toBe(2);
    expect(relative.io.err).toEqual(['bindweed: ../plain is not inside a git repository\n']);
    const absolute = startMain([plain], repo, await makeInstall());
    expect(await exitOf(absolute)).toBe(2);
    expect(absolute.io.err).toEqual([`bindweed: ${plain} is not inside a git repository\n`]);
    const missing = join(plain, 'missing');
    const gone = startMain([missing], repo, await makeInstall());
    expect(await exitOf(gone)).toBe(2);
    expect(gone.io.err).toEqual([`bindweed: ${missing} is not inside a git repository\n`]);
    expect(gone.io.out).toEqual([]);
    expect(await readdir(plain)).toEqual([]);
  });

  it('rejects a malformed command line or port before touching the repository', async () => {
    const { repo } = await makeWorkspace();
    const usage = startMain(['--watch'], repo, await makeInstall());
    expect(await exitOf(usage)).toBe(2);
    expect(usage.io.err).toEqual(['bindweed: usage: bindweed [path] [--port N]\n']);
    const flag = startMain(['--port', 'abc'], repo, await makeInstall());
    expect(await exitOf(flag)).toBe(2);
    expect(flag.io.err).toEqual(['bindweed: port abc is not a number from 1 to 65535\n']);
    const env = startMain([], repo, await makeInstall(), { BINDWEED_PORT: 'abc' });
    expect(await exitOf(env)).toBe(2);
    expect(env.io.err).toEqual(['bindweed: port abc is not a number from 1 to 65535\n']);
    expect(env.io.out).toEqual([]);
    expect(existsSync(join(repo, '.bindweed'))).toBe(false);
  });

  it('reports an unbuilt ui after the repository check', async () => {
    const { repo, plain } = await makeWorkspace();
    await mkdir(join(repo, 'dist', 'ui'), { recursive: true });
    await writeFile(join(repo, 'dist', 'ui', 'index.html'), '<html>the repository page</html>');
    const unbuilt = await makeUnbuilt();
    const inRepo = startMain([], repo, unbuilt);
    expect(await exitOf(inRepo)).toBe(1);
    expect(inRepo.io.err).toEqual([`bindweed: the ui is not built; run npm run build in ${unbuilt}\n`]);
    expect(inRepo.io.out).toEqual([]);
    expect(existsSync(join(repo, '.bindweed'))).toBe(false);
    const inPlain = startMain([], plain, unbuilt);
    expect(await exitOf(inPlain)).toBe(2);
    expect(inPlain.io.err).toEqual([`bindweed: ${plain} is not inside a git repository\n`]);
  });

  it('serves the git top level from a subfolder and prints exactly two lines', async () => {
    const { repo } = await makeWorkspace();
    const port = PORT_BASE;
    const started = startMain(['--port', String(port)], join(repo, 'src', 'lib'), await makeInstall());
    const link = await serving(started);
    expect(link.port).toBe(port);
    expect(started.io.out[1]).toBe(`serving ${repo}\n`);
    const tree = await getJson(port, '/api/tree', link.token);
    expect(tree.status).toBe(200);
    expect(tree.body).toMatchObject({ root: basename(repo) });
    const file = await getJson(port, '/api/file?path=src/a.ts', link.token);
    expect(file.body).toEqual({ path: 'src/a.ts', text: 'export const a = 1;\n' });
    expect(started.io.out).toHaveLength(2);
    expect(started.io.err).toEqual([]);
    expect(existsSync(join(repo, '.bindweed'))).toBe(true);
    expect(existsSync(join(repo, 'src', 'lib', '.bindweed'))).toBe(false);
    expect(excludeCount(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8'))).toBe(1);
    expect(await stop(started)).toBe(0);
    expect(await connectionOutcome(port)).toBe('ECONNREFUSED');
  });

  it('serves the repository named by a relative or absolute path argument', async () => {
    const { outer, repo, plain } = await makeWorkspace();
    const port = PORT_BASE + 1;
    const relative = startMain([`${basename(repo)}/src`, '--port', String(port)], outer, await makeInstall());
    expect((await serving(relative)).port).toBe(port);
    expect(relative.io.out[1]).toBe(`serving ${repo}\n`);
    expect(await stop(relative)).toBe(0);
    const absolute = startMain(['--port', String(port), repo], plain, await makeInstall());
    await serving(absolute);
    expect(absolute.io.out[1]).toBe(`serving ${repo}\n`);
    expect(await stop(absolute)).toBe(0);
    expect(await readdir(plain)).toEqual([]);
    expect(await readdir(outer)).toEqual(['demo-repo', 'plain']);
  });

  it('starts at BINDWEED_PORT and moves on when that port is taken', async () => {
    const { repo } = await makeWorkspace();
    const first = PORT_BASE + 2;
    const free = startMain([], repo, await makeInstall(), { BINDWEED_PORT: String(first) });
    expect((await serving(free)).port).toBe(first);
    expect(await stop(free)).toBe(0);
    const held = await hold(first);
    const next = startMain([], repo, await makeInstall(), { BINDWEED_PORT: String(first) });
    const link = await serving(next);
    expect(link.port).toBe(first + 1);
    const tree = await getJson(first + 1, '/api/tree', link.token);
    expect(tree.status).toBe(200);
    expect(tree.body).toMatchObject({ root: basename(repo) });
    expect(await stop(next)).toBe(0);
    await held.release();
  });

  it('prefers --port over BINDWEED_PORT and fails at once when that port is taken', async () => {
    const { repo } = await makeWorkspace();
    const port = PORT_BASE + 4;
    const held = await hold(port);
    const taken = startMain(['--port', String(port)], repo, await makeInstall(), { BINDWEED_PORT: String(PORT_BASE + 5) });
    expect(await exitOf(taken)).toBe(1);
    expect(taken.io.err).toEqual([`bindweed: port ${port} is in use\n`]);
    expect(taken.io.out).toEqual([]);
    await held.release();
  });

  it('gives up when the first port and the twenty after it are taken', async () => {
    const { repo } = await makeWorkspace();
    const first = PORT_BASE + 6;
    const holds = await Promise.all(Array.from({ length: 21 }, (_, i) => hold(first + i)));
    const started = startMain([], repo, await makeInstall(), { BINDWEED_PORT: String(first) });
    expect(await exitOf(started)).toBe(1);
    expect(started.io.err).toEqual([`bindweed: no free port between ${first} and ${first + 20}\n`]);
    expect(started.io.out).toEqual([]);
    await Promise.all(holds.map(h => h.release()));
  });

  it('stops at once when the signal is already aborted', async () => {
    const { repo } = await makeWorkspace();
    const port = PORT_BASE + 27;
    const started = startMain(['--port', String(port)], repo, await makeInstall());
    started.controller.abort();
    expect(await within(PATIENCE, started.done)).toBe(0);
    expect(started.io.out).toHaveLength(2);
    expect(await connectionOutcome(port)).toBe('ECONNREFUSED');
  });

  it('changes nothing across two starts but .bindweed and the exclude line', async () => {
    const { repo } = await makeWorkspace();
    const before = await snapshot(repo);
    const port = PORT_BASE + 28;
    const first = startMain(['--port', String(port)], repo, await makeInstall());
    const firstLink = await serving(first);
    expect((await getJson(port, '/api/tree', firstLink.token)).status).toBe(200);
    expect((await getJson(port, '/api/file?path=src/a.ts', firstLink.token)).status).toBe(200);
    expect(await stop(first)).toBe(0);
    const second = startMain(['--port', String(port)], repo, await makeInstall());
    const secondLink = await serving(second);
    expect(secondLink.token).not.toBe(firstLink.token);
    expect(await stop(second)).toBe(0);
    const after = await snapshot(repo);
    expect(changedPaths(before, after)).toEqual(['.bindweed/', '.git/info/exclude']);
    expect(decoded(after, '.git/info/exclude')).toBe(`${decoded(before, '.git/info/exclude')}${EXCLUDE_LINE}\n`);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('runIfMain', () => {
  it('does nothing unless argv names this module', () => {
    expect(runIfMain(CLI_URL, ['node'], {}, process.cwd())).toBeUndefined();
    expect(runIfMain(import.meta.url, ['node', CLI_PATH], {}, process.cwd())).toBeUndefined();
  });

  it('runs main on the process streams and records the exit code', async () => {
    const { plain } = await makeWorkspace();
    const stdio = captureStdio();
    let code: number | 'hung' | undefined;
    try {
      code = await within(PATIENCE, startEntry(CLI_URL, CLI_PATH, [], plain));
    } finally {
      stdio.restore();
    }
    expect(code).toBe(2);
    expect(stdio.err.join('')).toBe(`bindweed: ${plain} is not inside a git repository\n`);
    expect(stdio.out).toEqual([]);
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
  });

  it.each([
    ['SIGINT', PORT_BASE + 29],
    ['SIGTERM', PORT_BASE + 30],
  ] as const)('exits with 0 within two seconds of %s while a browser holds the page open', async (signal, port) => {
    const { installCli } = await makeSymlinkInstall();
    const { repo } = await makeWorkspace();
    const stdio = captureStdio();
    let code: number | 'hung' | undefined;
    let spare: Socket | undefined;
    try {
      const running = startEntry(pathToFileURL(installCli).href, installCli, ['--port', String(port)], repo);
      const link = await linkOnceServing(stdio.out, running);
      spare = await unusedConnection(port);
      expect((await getPage(link)).body).toBe('<html>own-ui</html>');
      process.emit(signal);
      code = await within(SIGNAL_LIMIT, running);
    } finally {
      stdio.restore();
      spare?.destroy();
    }
    expect(code).toBe(0);
    expect(stdio.out).toEqual([expect.stringMatching(LINK), `serving ${repo}\n`]);
    expect(stdio.err).toEqual([]);
    expect(await connectionOutcome(port)).toBe('ECONNREFUSED');
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it('serves its own dist/ui when argv is a bin symlink under another prefix', async () => {
    const { installCli, binLink } = await makeSymlinkInstall();
    const { repo } = await makeWorkspace();
    const port = PORT_BASE + 31;
    const stdio = captureStdio();
    let code: number | 'hung' | undefined;
    let page: Page | undefined;
    try {
      const running = startEntry(pathToFileURL(installCli).href, binLink, ['--port', String(port)], repo);
      page = await getPage(await linkOnceServing(stdio.out, running));
      process.emit('SIGTERM');
      code = await within(SIGNAL_LIMIT, running);
    } finally {
      stdio.restore();
    }
    expect(page).toEqual({ status: 200, type: 'text/html; charset=utf-8', body: '<html>own-ui</html>' });
    expect(stdio.out[1]).toBe(`serving ${repo}\n`);
    expect(code).toBe(0);
    process.exitCode = undefined;
  });
});

describe('the entry process', () => {
  it('runs main from the module level when argv names cli.ts', async () => {
    const { plain } = await makeWorkspace();
    const argv = process.argv;
    const stdio = captureStdio();
    try {
      process.argv = ['node', CLI_PATH, plain];
      vi.resetModules();
      await import('./cli.ts');
      await vi.waitFor(() => expect(process.exitCode).toBe(2), { timeout: PATIENCE, interval: 10 });
    } finally {
      process.argv = argv;
      stdio.restore();
    }
    expect(stdio.err.join('')).toBe(`bindweed: ${plain} is not inside a git repository\n`);
    expect(stdio.out).toEqual([]);
    process.exitCode = undefined;
  });

  it('runs main when node starts cli.ts directly', async () => {
    const { plain } = await makeWorkspace();
    const result = spawnSync('node', [CLI_PATH], { cwd: plain, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(`bindweed: ${plain} is not inside a git repository\n`);
    expect(result.stdout).toBe('');
  });
});
