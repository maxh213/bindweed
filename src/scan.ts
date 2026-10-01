import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ExternalRef, ScanEdge, ScanResult, ScannedFile, WorkspacePackage } from './domain/scan.ts';
import { filesToScan } from './scanning/paths.ts';
import { parseSource, type RawImport } from './scanning/parse.ts';
import { specifierResolver, type Target } from './scanning/resolve.ts';
import { workspacesOf, type WorkspaceInfo } from './scanning/workspaces.ts';

type CacheEntry = { mtimeMs: number; size: number; imports: RawImport[]; abstract: boolean };

type Cache = Record<string, CacheEntry>;

type ScanOut = { files: ScannedFile[]; edges: ScanEdge[]; externals: ExternalRef[] };

type Parsed = { imports: RawImport[]; abstract: boolean };

const rawImportSchema = z.object({ specifier: z.string(), typeOnly: z.boolean(), heritage: z.number().optional() });

const cacheSchema = z.object({
  version: z.literal(1),
  files: z.record(
    z.string(),
    z.object({ mtimeMs: z.number(), size: z.number(), imports: z.array(rawImportSchema), abstract: z.boolean() }),
  ),
});

function cachePath(root: string): string {
  return join(root, '.bindweed', 'cache', 'scan.json');
}

function readCache(root: string): Cache {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(cachePath(root)).toString()));
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
  const full = join(root, path);
  if (!existsSync(full)) return undefined;
  const stat = statSync(full);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

function cachedParsed(path: string, stamp: { mtimeMs: number; size: number }, cache: Cache): Parsed | undefined {
  const hit = cache[path];
  if (hit?.mtimeMs !== stamp.mtimeMs || hit.size !== stamp.size) return undefined;
  return { imports: hit.imports, abstract: hit.abstract };
}

function parsedOf(root: string, path: string, stamp: { mtimeMs: number; size: number }, cache: Cache): Parsed {
  const cached = cachedParsed(path, stamp, cache);
  if (cached !== undefined) return cached;
  return parseSource(path, readFileSync(join(root, path), 'utf8'));
}

function withHeritage<T extends { kind: 'runtime' | 'type' }>(base: T, heritage: number | undefined): T {
  if (heritage === undefined) return base;
  return { ...base, heritage };
}

function pushResolved(path: string, imp: RawImport, target: Target, out: ScanOut): void {
  const kind = imp.typeOnly ? 'type' : 'runtime';
  if ('external' in target) {
    out.externals.push(withHeritage({ from: path, name: target.external, kind }, imp.heritage));
    return;
  }
  out.edges.push(withHeritage({ from: path, to: target.path, kind }, imp.heritage));
}

function resolveImport(path: string, imp: RawImport, resolve: (specifier: string, file: string) => Target, root: string, out: ScanOut): void {
  pushResolved(path, imp, resolve(imp.specifier, join(root, path)), out);
}

function fileRecord(file: ScannedFile, abstract: boolean): ScannedFile {
  if (!abstract) return file;
  return { ...file, abstract: true };
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
  const parsed = parsedOf(root, file.path, stamp, cache);
  next[file.path] = { ...stamp, imports: parsed.imports, abstract: parsed.abstract };
  out.files.push(fileRecord(file, parsed.abstract));
  for (const imp of parsed.imports) resolveImport(file.path, imp, resolve, root, out);
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
