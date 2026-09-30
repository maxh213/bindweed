import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from './paths.ts';

export type WorkspaceInfo = { dir: string; name: string; manifest: Record<string, unknown> };

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
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

export function resolvedWorkspace(root: string, ws: WorkspaceInfo): { kind: 'file' | 'dir'; path: string } {
  const entry = entryPointOf(ws.manifest);
  if (entry === undefined) return { kind: 'dir', path: ws.dir };
  const file = resolveAsFile(join(root, ws.dir, entry));
  return file === undefined ? { kind: 'dir', path: ws.dir } : { kind: 'file', path: repoPath(root, file) };
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

export function workspacesOf(root: string): WorkspaceInfo[] {
  const out: WorkspaceInfo[] = [];
  for (const dir of patternsToDirs(root, workspacePatterns(root))) {
    const info = workspaceInfo(root, dir);
    if (info !== undefined) out.push(info);
  }
  return out;
}
