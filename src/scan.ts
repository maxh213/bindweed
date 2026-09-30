import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ExternalRef, ScanEdge, ScanResult, ScannedFile, WorkspacePackage } from './domain/scan.ts';
import { filesToScan } from './scanning/paths.ts';
import { importsOfText, type RawImport } from './scanning/parse.ts';
import { specifierResolver, type Target } from './scanning/resolve.ts';
import { workspacesOf, type WorkspaceInfo } from './scanning/workspaces.ts';

type CacheEntry = { mtimeMs: number; size: number; imports: RawImport[] };

type Cache = Record<string, CacheEntry>;

type ScanOut = { files: ScannedFile[]; edges: ScanEdge[]; externals: ExternalRef[] };

const rawImportSchema = z.object({ specifier: z.string(), typeOnly: z.boolean() });

const cacheSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.object({ mtimeMs: z.number(), size: z.number(), imports: z.array(rawImportSchema) })),
});

function cachePath(root: string): string {
  return join(root, '.bindweed', 'cache', 'scan.json');
}

function readCache(root: string): Cache {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(cachePath(root), 'utf8')));
    return parsed.success ? parsed.data.files : {};
  } catch {
    return {};
  }
}

function writeCache(root: string, files: Cache): void {
  mkdirSync(dirname(cachePath(root)), { recursive: true });
  writeFileSync(cachePath(root), JSON.stringify({ version: 1, files }));
}

function stampOf(root: string, path: string): { mtimeMs: number; size: number } | undefined {
  try {
    const stat = statSync(join(root, path));
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

function importsFor(root: string, path: string, stamp: { mtimeMs: number; size: number }, cache: Cache): RawImport[] {
  const hit = cache[path];
  if (hit?.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.imports;
  return importsOfText(path, readFileSync(join(root, path), 'utf8'));
}

function resolveImport(path: string, imp: RawImport, resolve: (specifier: string, file: string) => Target, root: string, out: ScanOut): void {
  const target = resolve(imp.specifier, join(root, path));
  const kind = imp.typeOnly ? 'type' : 'runtime';
  if (target.kind === 'external') {
    out.externals.push({ from: path, name: target.name, kind });
    return;
  }
  out.edges.push({ from: path, to: target.path, kind });
}

function collectFile(
  root: string,
  file: ScannedFile,
  cache: Cache,
  next: Cache,
  resolve: (specifier: string, file: string) => Target,
  out: ScanOut,
): void {
  const stamp = stampOf(root, file.path);
  if (stamp === undefined) return;
  const imports = importsFor(root, file.path, stamp, cache);
  next[file.path] = { ...stamp, imports };
  out.files.push(file);
  for (const imp of imports) resolveImport(file.path, imp, resolve, root, out);
}

function toWorkspacePackage(ws: WorkspaceInfo): WorkspacePackage {
  return { dir: ws.dir, name: ws.name };
}

export function scanRepo(root: string, paths: string[]): ScanResult {
  const workspaces = workspacesOf(root);
  const resolve = specifierResolver(root, workspaces);
  const cache = readCache(root);
  const next: Cache = {};
  const out: ScanOut = { files: [], edges: [], externals: [] };
  for (const file of filesToScan(paths)) collectFile(root, file, cache, next, resolve, out);
  writeCache(root, next);
  return { ...out, workspaces: workspaces.map(toWorkspacePackage) };
}
