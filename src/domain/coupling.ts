import type { ScanEdge, ScanResult, ScannedFile } from './scan.ts';

const DASH = '–';

type Zone = 'pain' | 'useless' | 'healthy';

export type MartinFields = { ca: number; ce: number; i: string; a: string; d: string; zone?: Zone };

export type MartinIndex = { files: ScannedFile[]; imports: ReadonlyMap<string, ReadonlySet<string>> };

function internalPaths(scan: ScanResult): Set<string> {
  return new Set(scan.files.filter(file => !file.test).map(file => file.path));
}

function internalEdges(scan: ScanResult, internal: ReadonlySet<string>): ScanEdge[] {
  return scan.edges.filter(edge => internal.has(edge.from) && internal.has(edge.to));
}

function importMap(paths: string[], edges: ScanEdge[]): Map<string, Set<string>> {
  const map = new Map(paths.map(path => [path, new Set<string>()]));
  for (const edge of edges) map.get(edge.from)?.add(edge.to);
  return map;
}

export function martinIndex(scan: ScanResult): MartinIndex {
  const internal = internalPaths(scan);
  const files = scan.files.filter(file => !file.test);
  return { files, imports: importMap(files.map(file => file.path), internalEdges(scan, internal)) };
}

function memberOf(id: string, kind: 'package' | 'file', path: string): boolean {
  if (kind === 'file') return path === id;
  return path === id || path.startsWith(`${id}/`);
}

function memberFiles(index: MartinIndex, id: string, kind: 'package' | 'file'): ScannedFile[] {
  return index.files.filter(file => memberOf(id, kind, file.path));
}

function importsOf(index: MartinIndex, path: string): ReadonlySet<string> {
  return index.imports.get(path) ?? new Set<string>();
}

function intersects(imports: ReadonlySet<string>, members: ReadonlySet<string>): boolean {
  for (const target of imports) {
    if (members.has(target)) return true;
  }
  return false;
}

function outside(imports: ReadonlySet<string>, members: ReadonlySet<string>): boolean {
  for (const target of imports) {
    if (!members.has(target)) return true;
  }
  return false;
}

function countAfferent(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const file of index.files) {
    if (members.has(file.path)) continue;
    if (intersects(importsOf(index, file.path), members)) count += 1;
  }
  return count;
}

function countTargets(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const path of members) {
    for (const target of importsOf(index, path)) {
      if (!members.has(target)) count += 1;
    }
  }
  return count;
}

function countImportingFiles(index: MartinIndex, members: ReadonlySet<string>): number {
  let count = 0;
  for (const path of members) {
    if (outside(importsOf(index, path), members)) count += 1;
  }
  return count;
}

function countEfferent(index: MartinIndex, members: ReadonlySet<string>, kind: 'file' | 'package'): number {
  if (kind === 'file') return countTargets(index, members);
  return countImportingFiles(index, members);
}

function abstractRatio(files: ScannedFile[]): number {
  if (files.length === 0) return 0;
  return files.filter(file => file.abstract === true).length / files.length;
}

type Ratios =
  | { ca: number; ce: number; a: number; i: null }
  | { ca: number; ce: number; a: number; i: number; d: number };

function ratiosOf(index: MartinIndex, id: string, kind: 'package' | 'file'): Ratios {
  const members = memberFiles(index, id, kind);
  const paths = new Set(members.map(file => file.path));
  const ca = countAfferent(index, paths);
  const ce = countEfferent(index, paths, kind);
  const a = abstractRatio(members);
  if (ca + ce === 0) return { ca, ce, a, i: null };
  const i = ce / (ca + ce);
  return { ca, ce, a, i, d: Math.abs(a + i - 1) };
}

function zoneOf(a: number, i: number, d: number): Zone {
  if (d <= 0.5) return 'healthy';
  if (a + i < 1) return 'pain';
  return 'useless';
}

export function martinFields(index: MartinIndex, id: string, kind: 'package' | 'file'): MartinFields {
  const ratios = ratiosOf(index, id, kind);
  if (ratios.i === null) return { ca: ratios.ca, ce: ratios.ce, i: DASH, a: ratios.a.toFixed(2), d: DASH };
  const fields = { ca: ratios.ca, ce: ratios.ce, i: ratios.i.toFixed(2), a: ratios.a.toFixed(2), d: ratios.d.toFixed(2) };
  if (kind === 'file') return fields;
  return { ...fields, zone: zoneOf(ratios.a, ratios.i, ratios.d) };
}
