import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, join, relative, sep } from 'node:path';
import * as ts from 'typescript';
import { z } from 'zod';
import { isTestPath, type ExternalRef, type ScanEdge, type ScanResult, type ScannedFile, type WorkspacePackage } from './domain/graph.ts';

type RawImport = { specifier: string; typeOnly: boolean };

type CacheEntry = { mtimeMs: number; size: number; imports: RawImport[] };

type Cache = Record<string, CacheEntry>;

type Target = { kind: 'file' | 'dir'; path: string } | { kind: 'external'; name: string };

type WorkspaceInfo = { dir: string; name: string; manifest: Record<string, unknown> };

type ScanOut = { files: ScannedFile[]; edges: ScanEdge[]; externals: ExternalRef[] };

type ScanCtx = {
  root: string;
  configs: Map<string, ts.CompilerOptions | undefined>;
  workspaces: WorkspaceInfo[];
  wsByName: Map<string, WorkspaceInfo>;
  defaultOptions: ts.CompilerOptions;
};

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_SEGMENT = /(^|\/)(node_modules|dist|build|out|coverage|\.bindweed|\.marestail)(\/|$)/;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const BUILTINS = new Set(builtinModules);

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.tsx': ts.ScriptKind.TSX,
  '.jsx': ts.ScriptKind.JSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
};

const rawImportSchema = z.object({ specifier: z.string(), typeOnly: z.boolean() });

const cacheSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.object({ mtimeMs: z.number(), size: z.number(), imports: z.array(rawImportSchema) })),
});

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCodePath(path: string): boolean {
  return !path.endsWith('.d.ts') && CODE_EXTENSIONS.has(extname(path));
}

function codePaths(paths: string[]): string[] {
  return paths.filter(path => isCodePath(path) && !SKIPPED_SEGMENT.test(path));
}

function scriptKindFor(path: string): ts.ScriptKind {
  return SCRIPT_KINDS[extname(path)] ?? ts.ScriptKind.TS;
}

function namedImportsTypeOnly(bindings: ts.NamedImportBindings): boolean {
  if (ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
}

function bindingsTypeOnly(clause: ts.ImportClause): boolean {
  if (clause.name !== undefined || clause.namedBindings === undefined) return false;
  return namedImportsTypeOnly(clause.namedBindings);
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword || bindingsTypeOnly(clause);
}

function namedExportsTypeOnly(clause: ts.NamedExportBindings | undefined): boolean {
  if (clause === undefined || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  return node.isTypeOnly || namedExportsTypeOnly(node.exportClause);
}

function stringArgOf(node: ts.CallExpression): string | undefined {
  const arg = node.arguments[0];
  if (node.arguments.length !== 1 || arg === undefined || !ts.isStringLiteral(arg)) return undefined;
  return arg.text;
}

function isRequireCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function importOfCall(node: ts.CallExpression): RawImport | undefined {
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword && !isRequireCall(node)) return undefined;
  const specifier = stringArgOf(node);
  return specifier === undefined ? undefined : { specifier, typeOnly: false };
}

function importOfImportEquals(node: ts.ImportEqualsDeclaration): RawImport | undefined {
  const ref = node.moduleReference;
  if (!ts.isExternalModuleReference(ref) || !ts.isStringLiteral(ref.expression)) return undefined;
  return { specifier: ref.expression.text, typeOnly: node.isTypeOnly };
}

function importOfImportDecl(node: ts.ImportDeclaration): RawImport | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  return { specifier: node.moduleSpecifier.text, typeOnly: isTypeOnlyImport(node) };
}

function importOfExportDecl(node: ts.ExportDeclaration): RawImport | undefined {
  const specifier = node.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return undefined;
  return { specifier: specifier.text, typeOnly: isTypeOnlyExport(node) };
}

function importOfStatement(node: ts.Node): RawImport | undefined {
  if (ts.isImportDeclaration(node)) return importOfImportDecl(node);
  if (ts.isExportDeclaration(node)) return importOfExportDecl(node);
  if (ts.isImportEqualsDeclaration(node)) return importOfImportEquals(node);
  return undefined;
}

function importOfNode(node: ts.Node): RawImport | undefined {
  if (ts.isCallExpression(node)) return importOfCall(node);
  return importOfStatement(node);
}

function collectFrom(node: ts.Node, found: RawImport[]): void {
  const hit = importOfNode(node);
  if (hit !== undefined) found.push(hit);
  node.forEachChild(child => collectFrom(child, found));
}

function importsOfText(path: string, text: string): RawImport[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const found: RawImport[] = [];
  collectFrom(source, found);
  return found;
}

function builtinName(specifier: string): string | undefined {
  if (specifier.startsWith('node:')) return specifier;
  return BUILTINS.has(specifier) ? `node:${specifier}` : undefined;
}

function packageRoot(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function externalName(specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return specifier;
  return packageRoot(specifier);
}

function externalTarget(specifier: string): Target {
  return { kind: 'external', name: externalName(specifier) };
}

function stringField(manifest: Record<string, unknown>, key: string): string | undefined {
  const value = manifest[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const hit = stringField(record, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function conditionTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return firstStringField(value, ['import', 'require', 'default', 'types']);
}

function exportsEntry(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField;
  if (!isRecord(exportsField)) return undefined;
  return conditionTarget(exportsField['.']);
}

function entryPointOf(manifest: Record<string, unknown>): string | undefined {
  return (
    exportsEntry(manifest.exports) ??
    stringField(manifest, 'module') ??
    stringField(manifest, 'main') ??
    stringField(manifest, 'types')
  );
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function withExtension(base: string): string | undefined {
  for (const ext of RESOLVE_EXTENSIONS) {
    if (isFile(base + ext)) return base + ext;
  }
  return undefined;
}

function indexFile(base: string): string | undefined {
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = join(base, `index${ext}`);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function resolveAsFile(base: string): string | undefined {
  if (isFile(base)) return base;
  return withExtension(base) ?? indexFile(base);
}

function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

function workspaceTarget(ws: WorkspaceInfo, ctx: ScanCtx): Target {
  const entry = entryPointOf(ws.manifest);
  if (entry === undefined) return { kind: 'dir', path: ws.dir };
  const file = resolveAsFile(join(ctx.root, ws.dir, entry));
  return file === undefined ? { kind: 'dir', path: ws.dir } : { kind: 'file', path: repoPath(ctx.root, file) };
}

function dirsUpTo(start: string, root: string): string[] {
  const dirs: string[] = [];
  let dir = start;
  while (dir !== root && dir.startsWith(`${root}${sep}`)) {
    dirs.push(dir);
    dir = dirname(dir);
  }
  dirs.push(root);
  return dirs;
}

function referenceDir(ref: ts.ProjectReference): string {
  return ref.path.endsWith('.json') ? dirname(ref.path) : ref.path;
}

function parseConfig(path: string, dir: string, ctx: ScanCtx): ts.CompilerOptions {
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(path, ts.sys.readFile).config, ts.sys, dir);
  for (const ref of parsed.projectReferences ?? []) registerReference(ref, ctx);
  return parsed.options;
}

function loadConfigAt(dir: string, path: string, ctx: ScanCtx): ts.CompilerOptions | undefined {
  ctx.configs.set(dir, undefined);
  const options = existsSync(path) ? parseConfig(path, dir, ctx) : undefined;
  ctx.configs.set(dir, options);
  return options;
}

function configAt(dir: string, ctx: ScanCtx): ts.CompilerOptions | undefined {
  if (ctx.configs.has(dir)) return ctx.configs.get(dir);
  return loadConfigAt(dir, join(dir, 'tsconfig.json'), ctx);
}

function registerReference(ref: ts.ProjectReference, ctx: ScanCtx): void {
  const dir = referenceDir(ref);
  if (ctx.configs.has(dir)) return;
  if (ref.path.endsWith('.json')) loadConfigAt(dir, ref.path, ctx);
  else configAt(dir, ctx);
}

function optionsForFile(file: string, ctx: ScanCtx): ts.CompilerOptions {
  for (const dir of dirsUpTo(dirname(file), ctx.root)) {
    const hit = configAt(dir, ctx);
    if (hit !== undefined) return hit;
  }
  return ctx.defaultOptions;
}

function resolvedTarget(absolute: string, specifier: string, ctx: ScanCtx): Target {
  const rel = repoPath(ctx.root, absolute);
  if (rel.startsWith('..') || SKIPPED_SEGMENT.test(rel)) return externalTarget(specifier);
  return { kind: 'file', path: rel };
}

function tsResolve(specifier: string, file: string, ctx: ScanCtx): Target {
  const options = optionsForFile(file, ctx);
  const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
  if (resolved === undefined) return externalTarget(specifier);
  return resolvedTarget(resolved.resolvedFileName, specifier, ctx);
}

function resolveSpecifier(specifier: string, file: string, ctx: ScanCtx): Target {
  const builtin = builtinName(specifier);
  if (builtin !== undefined) return { kind: 'external', name: builtin };
  const ws = ctx.wsByName.get(specifier);
  if (ws !== undefined) return workspaceTarget(ws, ctx);
  return tsResolve(specifier, file, ctx);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function packagesField(ws: unknown): string[] {
  if (!isRecord(ws)) return [];
  return isStringArray(ws.packages) ? ws.packages : [];
}

function pkgPatterns(manifest: Record<string, unknown> | undefined): string[] {
  if (manifest === undefined) return [];
  if (isStringArray(manifest.workspaces)) return manifest.workspaces;
  return packagesField(manifest.workspaces);
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function unquote(value: string): string {
  const first = value.charAt(0);
  const quoted = (first === "'" || first === '"') && value.endsWith(first);
  return quoted ? value.slice(1, -1) : value;
}

function yamlListItem(line: string): string | undefined {
  const trimmed = line.trim();
  if (line.trimStart() !== line && trimmed.startsWith('-')) return unquote(trimmed.slice(1).trim());
  return undefined;
}

function takeItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const item = yamlListItem(line);
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}

function yamlListItems(text: string, key: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.startsWith(`${key}:`));
  if (start === -1) return [];
  return takeItems(lines.slice(start + 1));
}

function pnpmPatterns(root: string): string[] {
  const text = readTextIfExists(join(root, 'pnpm-workspace.yaml'));
  if (text === undefined) return [];
  return yamlListItems(text, 'packages');
}

function workspacePatterns(root: string): string[] {
  const fromPkg = pkgPatterns(readJsonObject(join(root, 'package.json')));
  if (fromPkg.length > 0) return fromPkg;
  return pnpmPatterns(root);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasManifest(root: string, dir: string): boolean {
  return existsSync(join(root, dir, 'package.json'));
}

function childDirsWithManifest(root: string, parent: string): string[] {
  const full = join(root, parent);
  if (!isDirectory(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(parent, entry.name))
    .filter(dir => hasManifest(root, dir));
}

function expandPattern(root: string, pattern: string): string[] {
  if (pattern.endsWith('/*')) return childDirsWithManifest(root, pattern.slice(0, -2));
  return hasManifest(root, pattern) ? [pattern] : [];
}

function patternsToDirs(root: string, patterns: string[]): string[] {
  const include = patterns.filter(pattern => !pattern.startsWith('!'));
  const excluded = new Set(
    patterns.filter(pattern => pattern.startsWith('!')).flatMap(pattern => expandPattern(root, pattern.slice(1))),
  );
  const dirs = include.flatMap(pattern => expandPattern(root, pattern)).filter(dir => !excluded.has(dir));
  return [...new Set(dirs)].sort((a, b) => a.localeCompare(b));
}

function workspaceInfo(root: string, dir: string): WorkspaceInfo | undefined {
  const manifest = readJsonObject(join(root, dir, 'package.json'));
  if (manifest === undefined) return undefined;
  const name = manifest.name;
  return isString(name) && name !== '' ? { dir, name, manifest } : undefined;
}

function workspacesOf(root: string): WorkspaceInfo[] {
  const out: WorkspaceInfo[] = [];
  for (const dir of patternsToDirs(root, workspacePatterns(root))) {
    const info = workspaceInfo(root, dir);
    if (info !== undefined) out.push(info);
  }
  return out;
}

function newScanCtx(root: string): ScanCtx {
  const workspaces = workspacesOf(root);
  const ctx: ScanCtx = {
    root,
    configs: new Map(),
    workspaces,
    wsByName: new Map(workspaces.map(ws => [ws.name, ws])),
    defaultOptions: { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
  };
  configAt(root, ctx);
  return ctx;
}

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

function resolveImport(path: string, imp: RawImport, ctx: ScanCtx, out: ScanOut): void {
  const target = resolveSpecifier(imp.specifier, join(ctx.root, path), ctx);
  const kind = imp.typeOnly ? 'type' : 'runtime';
  if (target.kind === 'external') {
    out.externals.push({ from: path, name: target.name, kind });
    return;
  }
  out.edges.push({ from: path, to: target.path, kind });
}

function collectFile(root: string, path: string, cache: Cache, next: Cache, ctx: ScanCtx, out: ScanOut): void {
  const stamp = stampOf(root, path);
  if (stamp === undefined) return;
  const imports = importsFor(root, path, stamp, cache);
  next[path] = { ...stamp, imports };
  out.files.push({ path, test: isTestPath(path) });
  for (const imp of imports) resolveImport(path, imp, ctx, out);
}

function toWorkspacePackage(ws: WorkspaceInfo): WorkspacePackage {
  return { dir: ws.dir, name: ws.name };
}

export function scanRepo(root: string, paths: string[]): ScanResult {
  const ctx = newScanCtx(root);
  const cache = readCache(root);
  const next: Cache = {};
  const out: ScanOut = { files: [], edges: [], externals: [] };
  for (const path of codePaths(paths)) collectFile(root, path, cache, next, ctx, out);
  writeCache(root, next);
  return { ...out, workspaces: ctx.workspaces.map(toWorkspacePackage) };
}
