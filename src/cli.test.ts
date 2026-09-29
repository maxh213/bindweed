import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { isEntry, main, runIfMain, defaultIo, bindRunning, installDirFrom, uiDistDir, uiIndexPath, type Io } from './cli.ts';
import { runGit, ensureExcludeLine, withExcludeLine } from './repo.ts';
import { pathToFileURL } from 'node:url';
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

describe('isEntry', () => {
  const self = import.meta.url;
  const selfPath = fileURLToPath(self);

  it('knows when its module is the entry file', () => {
    expect(isEntry(self, selfPath)).toBe(true);
    expect(isEntry(self, undefined)).toBe(false);
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
    await new Promise<void>(resolve => {
      const tick = () => {
        if (io.out.length >= 2) resolve();
        else setTimeout(tick, 20);
      };
      tick();
    });
    process.emit('SIGTERM');
    expect(await running).toBe(0);
  });
});

describe('defaultIo and bindRunning', () => {
  it('writes through stdout and stderr', () => {
    const io = defaultIo();
    expect(typeof io.writeOut).toBe('function');
    expect(typeof io.writeErr).toBe('function');
    expect(io.writeOut('')).toBeUndefined();
    expect(io.writeErr('')).toBeUndefined();
  });

  it('sets exitCode when a run finishes', async () => {
    const previous = process.exitCode;
    bindRunning(undefined);
    bindRunning(Promise.resolve(7));
    await new Promise(r => setTimeout(r, 10));
    expect(process.exitCode).toBe(7);
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
});
