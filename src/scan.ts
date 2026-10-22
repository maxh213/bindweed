import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { z } from 'zod';
import type { ExternalRef, ImportLine, RawFunction, ScanEdge, ScanResult, ScannedFile, WorkspacePackage, WorktreeScan } from './domain/scan.ts';
import { filesToScan } from './scanning/paths.ts';
import { parseSource, type RawImport } from './scanning/parse.ts';
import { specifierResolver, type Target } from './scanning/resolve.ts';
import { workspacesOf, type WorkspaceInfo } from './scanning/workspaces.ts';

type CacheEntry = { mtimeMs: number; size: number; imports: RawImport[]; abstract: boolean; functions: RawFunction[] };

type Cache = Record<string, CacheEntry>;

type ScanOut = { files: ScannedFile[]; edges: ScanEdge[]; externals: ExternalRef[]; imports: ImportLine[] };

type Store = { file: string; lined: boolean };

type Parsed = { imports: RawImport[]; abstract: boolean; functions: RawFunction[] };

const rawImportSchema = z.object({ specifier: z.string(), typeOnly: z.boolean(), heritage: z.number().optional(), line: z.number().default(0) });

const rawFunctionSchema = z.object({ name: z.string(), line: z.number(), endLine: z.number(), cc: z.number() });

const cacheSchema = z.object({
  version: z.literal(2),
  files: z.record(
    z.string(),
    z.object({ mtimeMs: z.number(), size: z.number(), imports: z.array(rawImportSchema), abstract: z.boolean(), functions: z.array(rawFunctionSchema) }),
  ),
});

function readCache(store: Store): Cache {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(store.file).toString()));
    return parsed.success ? parsed.data.files : {};
  } catch {
    return {};
  }
}

function unlined(imp: RawImport): Omit<RawImport, 'line'> {
  if (imp.heritage === undefined) return { specifier: imp.specifier, typeOnly: imp.typeOnly };
  return { specifier: imp.specifier, typeOnly: imp.typeOnly, heritage: imp.heritage };
}

function storedEntry(entry: CacheEntry, lined: boolean): unknown {
  return lined ? entry : { ...entry, imports: entry.imports.map(unlined) };
}

function writeCache(store: Store, files: Cache): void {
  const stored = Object.fromEntries(Object.entries(files).map(([path, entry]) => [path, storedEntry(entry, store.lined)]));
  mkdirSync(dirname(store.file), { recursive: true });
  writeFileSync(store.file, JSON.stringify({ version: 2, files: stored }));
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
  return { imports: hit.imports, abstract: hit.abstract, functions: hit.functions };
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

function spelledPath(importer: string, specifier: string): string {
  const spelled = posix.join(posix.dirname(importer), specifier);
  return extname(specifier) === '' ? `${spelled}${extname(importer)}` : spelled;
}

function pushExternal(path: string, imp: RawImport, name: string, out: ScanOut): void {
  out.externals.push(withHeritage({ from: path, name, kind: imp.typeOnly ? 'type' : 'runtime' }, imp.heritage));
  if (imp.specifier.startsWith('.')) out.imports.push({ from: path, to: spelledPath(path, imp.specifier), line: imp.line, resolved: false });
}

function pushResolved(path: string, imp: RawImport, target: Target, out: ScanOut): void {
  if ('external' in target) {
    pushExternal(path, imp, target.external, out);
    return;
  }
  out.edges.push(withHeritage({ from: path, to: target.path, kind: imp.typeOnly ? 'type' : 'runtime' }, imp.heritage));
  out.imports.push({ from: path, to: target.path, line: imp.line, resolved: true });
}

function resolveImport(path: string, imp: RawImport, resolve: (specifier: string, file: string) => Target, root: string, out: ScanOut): void {
  pushResolved(path, imp, resolve(imp.specifier, join(root, path)), out);
}

function fileRecord(file: ScannedFile, parsed: Parsed): ScannedFile {
  const record: ScannedFile = { ...file, functions: parsed.functions };
  if (!parsed.abstract) return record;
  return { ...record, abstract: true };
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
  next[file.path] = { ...stamp, imports: parsed.imports, abstract: parsed.abstract, functions: parsed.functions };
  out.files.push(fileRecord(file, parsed));
  for (const imp of parsed.imports) resolveImport(file.path, imp, resolve, root, out);
}

function toWorkspacePackage(ws: WorkspaceInfo): WorkspacePackage {
  return { dir: ws.dir, name: ws.name };
}

function scanWith(root: string, paths: string[], store: Store): WorktreeScan {
  const workspaces = workspacesOf(root);
  const resolve = specifierResolver(root, workspaces);
  const cache = readCache(store);
  const next: Cache = {};
  const out: ScanOut = { files: [], edges: [], externals: [], imports: [] };
  for (const file of filesToScan(paths)) collectFile(root, file, cache, next, resolve, out);
  writeCache(store, next);
  const { imports, ...found } = out;
  return { scan: { ...found, workspaces: workspaces.map(toWorkspacePackage) }, imports };
}

export function scanRepo(root: string, paths: string[]): ScanResult {
  return scanWith(root, paths, { file: join(root, '.bindweed', 'cache', 'scan.json'), lined: false }).scan;
}

export function scanWorktree(root: string, slug: string, worktree: string, paths: string[]): WorktreeScan {
  return scanWith(worktree, paths, { file: join(root, '.bindweed', 'cache', slug, 'scan.json'), lined: true });
}
