import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LOCK = '/tmp/bindweed-qa-build.lock';
const FLAG = '--bindweed-qa-ensure-ui';

function filesOf(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...filesOf(full));
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

function fingerprint(root: string): string {
  const hash = createHash('sha256');
  const files = [...filesOf(path.join(root, 'src/ui')), path.join(root, 'vite.config.ts'), path.join(root, 'package.json')];
  for (const full of files) {
    hash.update(path.relative(root, full));
    hash.update('\0');
    hash.update(fs.readFileSync(full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assetsReady(root: string): boolean {
  const htmlPath = path.join(root, 'dist/ui/index.html');
  if (!fs.existsSync(htmlPath)) return false;
  const refs = [...fs.readFileSync(htmlPath, 'utf8').matchAll(/\/assets\/[^"' ]+/g)].map((match) => match[0]);
  if (refs.length === 0) return false;
  return refs.every((ref) => fs.existsSync(path.join(root, 'dist', 'ui', ref.slice(1))));
}

function markerPath(root: string): string {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return path.join('/tmp', `bindweed-qa-ui-${id}`);
}

function apply(root: string): void {
  const resolved = fs.realpathSync(root);
  const marker = markerPath(resolved);
  const saved = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
  if (saved === fingerprint(resolved) && assetsReady(resolved)) return;
  const built = spawnSync('npm', ['run', 'build'], { cwd: resolved, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`npm run build failed\n${built.stdout}\n${built.stderr}`);
  if (!assetsReady(resolved)) throw new Error('ui build produced no assets');
  const next = `${fingerprint(resolved)}\n`;
  const tmp = `${marker}.${process.pid}`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, marker);
}

export function ensureUiBuilt(root: string): void {
  const self = path.join(root, 'qa/ensure-ui.ts');
  const result = spawnSync('flock', ['-w', '180', LOCK, process.execPath, '--experimental-strip-types', self, FLAG, root], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`ui build failed (${result.status ?? 'signal'})\n${result.stdout}\n${result.stderr}`);
  }
}

if (process.argv[2] === FLAG) apply(process.argv[3] ?? '');
