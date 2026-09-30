import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, sep } from 'node:path';
import * as ts from 'typescript';
import { isInternalTarget, repoPath } from './paths.ts';
import { resolvedWorkspace, type WorkspaceInfo } from './workspaces.ts';

export type Target = { kind: 'file' | 'dir'; path: string } | { kind: 'external'; name: string };

type ScanCtx = {
  root: string;
  configs: Map<string, ts.CompilerOptions | undefined>;
  wsByName: Map<string, WorkspaceInfo>;
  defaultOptions: ts.CompilerOptions;
};

const BUILTINS = new Set(builtinModules);

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
  if (!isInternalTarget(rel)) return externalTarget(specifier);
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
  if (ws !== undefined) return resolvedWorkspace(ctx.root, ws);
  return tsResolve(specifier, file, ctx);
}

function newScanCtx(root: string, workspaces: WorkspaceInfo[]): ScanCtx {
  const ctx: ScanCtx = {
    root,
    configs: new Map(),
    wsByName: new Map(workspaces.map(ws => [ws.name, ws])),
    defaultOptions: { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
  };
  configAt(root, ctx);
  return ctx;
}

export function specifierResolver(root: string, workspaces: WorkspaceInfo[]): (specifier: string, file: string) => Target {
  const ctx = newScanCtx(root, workspaces);
  return (specifier, file) => resolveSpecifier(specifier, file, ctx);
}
