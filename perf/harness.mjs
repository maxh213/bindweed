import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VALUES = 200;
export const WARMUP = 40;

export const TREE = process.env.MARESTAIL_PERF_TREE_PATH ?? process.cwd();

export function emit(target, values, unit = 'ms') {
  console.log(JSON.stringify({ target, unit, better: 'lower', values }));
}

export function emitOnce(target, value, unit = 'ms') {
  console.log(JSON.stringify({ target, unit, better: 'lower', value }));
}

export function absent(...targets) {
  for (const target of targets) console.log(JSON.stringify({ target, absent: true }));
}

export function moduleUrl(...parts) {
  return pathToFileURL(join(TREE, ...parts)).href;
}

export function hasFile(...parts) {
  return existsSync(join(TREE, ...parts));
}

export async function loadExport(relPath, name) {
  if (!hasFile(...relPath.split('/'))) return undefined;
  const mod = await import(moduleUrl(...relPath.split('/')));
  if (typeof mod[name] !== 'function') return undefined;
  return mod[name];
}

export async function loadModule(relPath) {
  if (!hasFile(...relPath.split('/'))) return undefined;
  return import(moduleUrl(...relPath.split('/')));
}

function runGit(args, cwd) {
  return new Promise(resolve => {
    const child = spawn('/usr/bin/git', args, { cwd });
    const out = [];
    const err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'git missing' }));
    child.on('close', code =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    );
  });
}

export async function gitFixture(root) {
  const commands = [
    ['init', '--template='],
    ['config', 'user.name', 'perf'],
    ['config', 'user.email', 'perf@t'],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'gc.auto', '0'],
    ['add', '-A'],
    ['commit', '-m', 'fixture'],
  ];
  for (const args of commands) {
    const result = await runGit(args, root);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed in ${root}: ${result.stderr.trim()}`);
  }
}

export async function fixtureRepo(fileCount = 40) {
  const root = await mkdtemp(join(tmpdir(), 'bw-perf-repo-'));
  await mkdir(join(root, 'src', 'lib'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '*.log\n');
  await writeFile(join(root, 'README.md'), '# demo\n');
  await writeFile(join(root, 'Zebra.txt'), 'z\n');
  await writeFile(join(root, 'apple.txt'), 'a\n');
  await writeFile(join(root, 'docs', 'guide.md'), '# guide\n');
  await writeFile(
    join(root, 'src', 'a.ts'),
    "export const a = 1;\nexport const name = 'perf';\nexport const sum = a + 2;\n",
  );
  await writeFile(join(root, 'src', 'lib', 'util.ts'), 'export const id = 1;\n');
  for (let i = 0; i < fileCount; i += 1) {
    const dir = join(root, 'gen', String(i % 10));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `f${i}.txt`), `file ${i}\n`.repeat(20));
  }
  await gitFixture(root);
  return root;
}

export async function fixtureUi() {
  const dir = await mkdtemp(join(tmpdir(), 'bw-perf-ui-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body>bindweed</body></html>\n');
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1);\n');
  await writeFile(join(dir, 'assets', 'app.css'), 'body{}\n');
  return dir;
}

export async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

export function hit(agent, port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        agent,
        headers: { Host: `127.0.0.1:${port}`, ...headers },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function timeMs(fn) {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

export async function sample(fn, values = VALUES, warmup = WARMUP) {
  for (let i = 0; i < warmup; i += 1) await fn();
  const out = [];
  for (let i = 0; i < values; i += 1) out.push(await timeMs(fn));
  return out;
}

export function keepAliveAgent() {
  return new Agent({ keepAlive: true, maxSockets: 1 });
}

export async function cleanup(...paths) {
  for (const path of paths) {
    if (path) await rm(path, { recursive: true, force: true });
  }
}

export function manyPaths(count) {
  const paths = [];
  for (let i = 0; i < count; i += 1) {
    paths.push(`pkg${i % 20}/src/mod${i}/file${i}.ts`);
  }
  return paths;
}
