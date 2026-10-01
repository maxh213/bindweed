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
  return existsSync(path) && statSync(path).isFile();
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

export function resolvedWorkspace(root: string, ws: WorkspaceInfo): { path: string } {
  const entry = entryPointOf(ws.manifest);
  if (entry === undefined) return { path: ws.dir };
  const file = resolveAsFile(join(root, ws.dir, entry));
  return { path: file === undefined ? ws.dir : repoPath(root, file) };
}

function packagesField(ws: unknown): string[] {
  if (!isRecord(ws)) return new Array<string>();
  return isStringArray(ws.packages) ? ws.packages : new Array<string>();
}

function pkgPatterns(manifest: Record<string, unknown>): string[] {
  if (isStringArray(manifest.workspaces)) return manifest.workspaces;
  return packagesField(manifest.workspaces);
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!isFile(path)) return {};
  const text = readFileSync(path).toString();
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function unquote(value: string): string {
  const first = value.charAt(0);
  return first === "'" || first === '"' ? value.slice(1, -1) : value;
}

function yamlListItem(line: string): string | undefined {
  const trimmed = line.trim();
  return trimmed.startsWith('-') ? unquote(trimmed.slice(1).trim()) : undefined;
}

function takeItems(lines: string[]): string[] {
  const items = new Array<string>();
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
  if (start === -1) return new Array<string>();
  return takeItems(lines.slice(start + 1));
}

function pnpmPatterns(root: string): string[] {
  const path = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(path)) return new Array<string>();
  return yamlListItems(readFileSync(path).toString(), 'packages');
}

function workspacePatterns(root: string): string[] {
  const fromPkg = pkgPatterns(readJsonObject(join(root, 'package.json')));
  if (fromPkg.length > 0) return fromPkg;
  return pnpmPatterns(root);
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function childDirs(root: string, parent: string): string[] {
  const full = join(root, parent);
  if (!isDirectory(full)) return new Array<string>();
  return readdirSync(full, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(parent, entry.name));
}

function expandPattern(root: string, pattern: string): string[] {
  if (pattern.endsWith('/*')) return childDirs(root, pattern.slice(0, -2));
  return [pattern];
}

function splitPattern(root: string, pattern: string): { dirs: string[]; negated: boolean } {
  const negated = pattern.startsWith('!');
  const base = negated ? pattern.slice(1) : pattern;
  return { dirs: expandPattern(root, base), negated };
}

function patternsToDirs(root: string, patterns: string[]): string[] {
  const include = new Set<string>();
  const excluded = new Set<string>();
  for (const pattern of patterns) {
    const part = splitPattern(root, pattern);
    const target = part.negated ? excluded : include;
    for (const dir of part.dirs) target.add(dir);
  }
  return [...include].filter(dir => !excluded.has(dir)).sort((a, b) => a.localeCompare(b));
}

function workspaceInfo(root: string, dir: string): WorkspaceInfo | undefined {
  const manifest = readJsonObject(join(root, dir, 'package.json'));
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
