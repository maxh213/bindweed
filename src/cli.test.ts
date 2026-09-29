import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntry, main, runIfMain, defaultIo, bindRunning, installDirFrom, uiDistDir, uiIndexPath, startCli, waitForAbort, cliBoot, type Io } from './cli.ts';
import { runGit, ensureExcludeLine, withExcludeLine } from './repo.ts';
function capture(): Io & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    writeOut: t => out.push(t),
    writeErr: t => err.push(t),
  };
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bw-cli-'));
  await writeFile(join(root, 'README.md'), '# demo\n');
  await runGit(['init'], root);
  await runGit(['config', 'user.name', 'qa'], root);
  await runGit(['config', 'user.email', 'qa@t'], root);
  await runGit(['config', 'commit.gpgsign', 'false'], root);
  await runGit(['add', '-A'], root);
  await runGit(['commit', '-m', 'f'], root);
  return root;
}

async function makeInstall(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bw-inst-'));
  await mkdir(join(dir, 'dist', 'ui', 'assets'), { recursive: true });
  await writeFile(join(dir, 'dist', 'ui', 'index.html'), '<html>ui</html>');
  return dir;
}

async function waitForTwoLines(io: ReturnType<typeof capture>): Promise<void> {
  await new Promise<void>(resolve => {
    const tick = () => {
      if (io.out.length >= 2) resolve();
      else setTimeout(tick, 20);
    };
    tick();
  });
}

async function makeSymlinkInstall(): Promise<{ installCli: string; linkArgv: string; binHome: string }> {
  const outer = await mkdtemp(join(tmpdir(), 'bw-sym-'));
  const install = join(outer, 'pkg');
  const binHome = join(outer, 'prefix');
  await mkdir(join(install, 'src'), { recursive: true });
  await mkdir(join(install, 'dist', 'ui'), { recursive: true });
  await mkdir(join(binHome, 'bin'), { recursive: true });
  await mkdir(join(binHome, 'dist', 'ui'), { recursive: true });
  const realCli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const installCli = join(install, 'src', 'cli.ts');
  await symlink(realCli, installCli);
  await symlink(installCli, join(binHome, 'bin', 'bindweed'));
  await writeFile(join(install, 'dist', 'ui', 'index.html'), '<html>own-ui</html>');
  await writeFile(join(binHome, 'dist', 'ui', 'index.html'), '<html>wrong-ui</html>');
  return { installCli, linkArgv: join(binHome, 'bin', 'bindweed'), binHome };
}

describe('isEntry', () => {
  const self = import.meta.url;
  const selfPath = fileURLToPath(self);
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));

  it('knows when its module is the entry file', () => {
    expect(isEntry(self, selfPath)).toBe(true);
    expect(isEntry(self, undefined)).toBe(false);
    expect(isEntry(pathToFileURL(cliPath).href, selfPath)).toBe(false);
  });
});

describe('runIfMain', () => {
  it('runs main only when it is the entry file', () => {
    const io = capture();
    expect(runIfMain(import.meta.url, ['node'], process.env, process.cwd(), io)).toBeUndefined();
  });

  it('starts main when argv points at the cli module', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bw-entry-'));
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const io = capture();
    const running = runIfMain(pathToFileURL(cliPath).href, ['node', cliPath], {}, plain, io);
    expect(running).toBeDefined();
    expect(await running).toBe(2);
    expect(io.err.join('')).toContain('is not inside a git repository');
  });

  it('stops a serving runIfMain on SIGTERM', async () => {
    const repo = await makeRepo();
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const io = capture();
    const running = runIfMain(
      pathToFileURL(cliPath).href,
      ['node', cliPath, '--port', '19121'],
      {},
      repo,
      io,
    );
    expect(running).toBeDefined();
    await waitForTwoLines(io);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
  });

  it('stops a serving runIfMain on SIGINT', async () => {
    const repo = await makeRepo();
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const io = capture();
    const running = runIfMain(
      pathToFileURL(cliPath).href,
      ['node', cliPath, '--port', '19122'],
      {},
      repo,
      io,
    );
    expect(running).toBeDefined();
    await waitForTwoLines(io);
    process.emit('SIGINT');
    expect(await running).toBe(0);
  });
});

describe('defaultIo and bindRunning', () => {
  it('writes through stdout and stderr', () => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const stdoutWrite = process.stdout.write.bind(process.stdout);
    const stderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const io = defaultIo();
      io.writeOut('hello-out\n');
      io.writeErr('hello-err\n');
      expect(Buffer.concat(out).toString()).toBe('hello-out\n');
      expect(Buffer.concat(err).toString()).toBe('hello-err\n');
    } finally {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    }
  });

  it('sets exitCode when a run finishes', async () => {
    const previous = process.exitCode;
    process.exitCode = undefined;
    bindRunning(Promise.resolve(7));
    await new Promise(r => setTimeout(r, 10));
    expect(process.exitCode).toBe(7);
    process.exitCode = previous;
  });

  it('does not bind a missing run', async () => {
    const previous = process.exitCode;
    process.exitCode = 9;
    bindRunning(undefined);
    await new Promise(r => setTimeout(r, 20));
    expect(process.exitCode).toBe(9);
    process.exitCode = previous;
  });

  it('binds exitCode through startCli for an entry run', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bw-bind-'));
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const io = capture();
    const previous = process.exitCode;
    process.exitCode = undefined;
    const running = startCli(pathToFileURL(cliPath).href, ['node', cliPath], {}, plain, io);
    expect(running).toBeDefined();
    expect(await running).toBe(2);
    await new Promise(r => setTimeout(r, 10));
    expect(process.exitCode).toBe(2);
    process.exitCode = previous;
  });
});

describe('main', () => {
  it('refuses a path outside any git repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bw-plain-'));
    const io = capture();
    const ac = new AbortController();
    const code = await main({
      argv: ['node', 'bindweed'],
      env: {},
      cwd: plain,
      installDir: await makeInstall(),
      io,
      signal: ac.signal,
    });
    expect(code).toBe(2);
    expect(io.err.join('')).toBe(`bindweed: ${plain} is not inside a git repository\n`);
    expect(io.out).toEqual([]);
  });

  it('shows the typed path in the not-a-repository message', async () => {
    const io = capture();
    const code = await main({
      argv: ['node', 'bindweed', '../plain'],
      env: {},
      cwd: await makeRepo(),
      installDir: await makeInstall(),
      io,
      signal: new AbortController().signal,
    });
    expect(code).toBe(2);
    expect(io.err.join('')).toBe('bindweed: ../plain is not inside a git repository\n');
  });

  it('reports an unbuilt ui after the repository check', async () => {
    const repo = await makeRepo();
    const unbuilt = await mkdtemp(join(tmpdir(), 'bw-unbuilt-'));
    const io = capture();
    const code = await main({
      argv: ['node', 'bindweed'],
      env: {},
      cwd: repo,
      installDir: unbuilt,
      io,
      signal: new AbortController().signal,
    });
    expect(code).toBe(1);
    expect(io.err.join('')).toBe(`bindweed: the ui is not built; run npm run build in ${unbuilt}\n`);
  });

  it('checks the repository before the ui', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bw-plain2-'));
    const unbuilt = await mkdtemp(join(tmpdir(), 'bw-unbuilt2-'));
    const io = capture();
    const code = await main({
      argv: ['node', 'bindweed'],
      env: {},
      cwd: plain,
      installDir: unbuilt,
      io,
      signal: new AbortController().signal,
    });
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('is not inside a git repository');
  });

  it('prints the link and serving lines then stops on abort', async () => {
    const repo = await makeRepo();
    const install = await makeInstall();
    const io = capture();
    const ac = new AbortController();
    const done = main({
      argv: ['node', 'bindweed', '--port', '19101'],
      env: {},
      cwd: repo,
      installDir: install,
      io,
      signal: ac.signal,
    });
    await new Promise<void>(resolve => {
      const tick = () => {
        if (io.out.length >= 2) resolve();
        else setTimeout(tick, 20);
      };
      tick();
    });
    expect(io.out[0]).toMatch(/^bindweed: http:\/\/127\.0\.0\.1:19101\/\?token=[0-9a-f]{32}\n$/);
    expect(io.out[1]).toBe(`serving ${repo}\n`);
    expect(existsSync(join(repo, '.bindweed'))).toBe(true);
    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter(l => l === '.bindweed/')).toHaveLength(1);
    ac.abort();
    expect(await done).toBe(0);
  });

  it('stops immediately when the signal is already aborted', async () => {
    const repo = await makeRepo();
    const install = await makeInstall();
    const io = capture();
    const ac = new AbortController();
    ac.abort();
    const code = await main({
      argv: ['node', 'bindweed', '--port', '19102'],
      env: {},
      cwd: repo,
      installDir: install,
      io,
      signal: ac.signal,
    });
    expect(code).toBe(0);
    expect(io.out[0]).toMatch(/token=[0-9a-f]{32}/);
  });

  it('rejects a malformed command line before touching the repo', async () => {
    const io = capture();
    const code = await main({
      argv: ['node', 'bindweed', '--watch'],
      env: {},
      cwd: await makeRepo(),
      installDir: await makeInstall(),
      io,
      signal: new AbortController().signal,
    });
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('usage:');
  });

  it('rejects a taken explicit port', async () => {
    const held = createNetServer();
    await new Promise<void>(r => held.listen(19111, '127.0.0.1', () => r()));
    const io = capture();
    const code = await main({
      argv: ['node', 'bindweed', '--port', '19111'],
      env: {},
      cwd: await makeRepo(),
      installDir: await makeInstall(),
      io,
      signal: new AbortController().signal,
    });
    expect(code).toBe(1);
    expect(io.err.join('')).toBe('bindweed: port 19111 is in use\n');
    await new Promise<void>(r => held.close(() => r()));
  });

  it('appends the exclude line only once across two ensure calls', async () => {
    const repo = await makeRepo();
    const path = join(repo, '.git', 'info', 'exclude');
    await ensureExcludeLine(path);
    await ensureExcludeLine(path);
    const text = await readFile(path, 'utf8');
    expect(text.split('\n').filter(l => l === '.bindweed/')).toHaveLength(1);
    expect(withExcludeLine(text)).toBe(text);
  });
});

describe('installDirFrom', () => {
  it('resolves the install directory from the real entry module url', () => {
    const meta = pathToFileURL('/tmp/qa/unbuilt/src/cli.ts').href;
    expect(installDirFrom(meta)).toBe('/tmp/qa/unbuilt');
    expect(uiDistDir('/tmp/qa/unbuilt')).toBe('/tmp/qa/unbuilt/dist/ui');
    expect(uiIndexPath('/tmp/qa/unbuilt')).toBe('/tmp/qa/unbuilt/dist/ui/index.html');
  });

  it('serves bindweed own ui when argv is a symlink under another directory', async () => {
    const { installCli, linkArgv, binHome } = await makeSymlinkInstall();
    const repo = await makeRepo();
    const io = capture();
    const running = runIfMain(
      pathToFileURL(installCli).href,
      ['node', linkArgv, '--port', '19123'],
      {},
      repo,
      io,
    );
    expect(running).toBeDefined();
    await waitForTwoLines(io);
    const url = (io.out[0] ?? '').replace(/^bindweed: /, '').trim();
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>own-ui</html>');
    expect(dirname(dirname(linkArgv))).toBe(binHome);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
  });
});

describe('cliBoot', () => {
  it('is idle when the module is loaded under vitest', () => {
    expect(cliBoot).toBeUndefined();
  });
});

describe('waitForAbort', () => {
  it('closes at once when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    let closed = 0;
    await waitForAbort(ac.signal, async () => {
      closed += 1;
    });
    expect(closed).toBe(1);
  });

  it('closes after the signal aborts', async () => {
    const ac = new AbortController();
    let closed = 0;
    const done = waitForAbort(ac.signal, async () => {
      closed += 1;
    });
    expect(closed).toBe(0);
    ac.abort();
    await done;
    expect(closed).toBe(1);
  });
});

describe('startCli entry', () => {
  it('runs the real entry process and refuses a non-repo cwd', () => {
    const plain = spawnSync('node', [fileURLToPath(new URL('./cli.ts', import.meta.url))], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, BINDWEED_PORT: '19201' },
    });
    expect(plain.status).toBe(2);
    expect(plain.stderr).toContain('is not inside a git repository');
    expect(plain.stdout).toBe('');
  });

  it('returns undefined from startCli when not the entry', () => {
    const io = capture();
    expect(startCli(import.meta.url, ['node'], {}, process.cwd(), io)).toBeUndefined();
  });

  it('binds a serving startCli when argv points at the cli', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bw-start-'));
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const io = capture();
    const previous = process.exitCode;
    process.exitCode = undefined;
    const running = startCli(pathToFileURL(cliPath).href, ['node', cliPath], {}, plain, io);
    expect(running).toBeDefined();
    expect(await running).toBe(2);
    await new Promise(r => setTimeout(r, 10));
    expect(process.exitCode).toBe(2);
    process.exitCode = previous;
  });
});
