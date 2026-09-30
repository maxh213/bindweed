import { byStrings, placeView, type RawEdge, type RawNode, type ViewEdge, type ViewNode } from './place.ts';
import type { ScanEdge, ScanResult, ScannedFile, WorkspacePackage } from './scan.ts';

export type { ViewEdge, ViewNode };

export type Crumb = { name: string; at: string };

export type GraphView = { at: string; crumbs: Crumb[]; nodes: ViewNode[]; edges: ViewEdge[] };

type NodeCount = { file: boolean; count: number };

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

function normalizeAt(at: string): string | null {
  const cleaned = stripTrailingSlashes(at);
  if (cleaned === '') return '';
  return validPath(cleaned) ? cleaned : null;
}

function validPath(path: string): boolean {
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function contains(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function longerMatch(best: string | undefined, dir: string, path: string): string | undefined {
  if (!contains(dir, path)) return best;
  if (best === undefined) return dir;
  return dir.length > best.length ? dir : best;
}

function workspaceDirFor(path: string, workspaces: WorkspacePackage[]): string | undefined {
  let best: string | undefined;
  for (const ws of workspaces) best = longerMatch(best, ws.dir, path);
  return best;
}

function firstSegmentId(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

function rootNodeId(path: string, workspaces: WorkspacePackage[]): string {
  const ws = workspaceDirFor(path, workspaces);
  if (ws !== undefined) return ws;
  return firstSegmentId(path);
}

function childNodeId(path: string, at: string): string | undefined {
  if (!path.startsWith(`${at}/`)) return undefined;
  const rel = path.slice(at.length + 1);
  const slash = rel.indexOf('/');
  return slash === -1 ? path : `${at}/${rel.slice(0, slash)}`;
}

function nodeIdFor(path: string, at: string, workspaces: WorkspacePackage[]): string | undefined {
  if (at === '') return rootNodeId(path, workspaces);
  return childNodeId(path, at);
}

function bump(counts: Map<string, NodeCount>, id: string, isFile: boolean): void {
  const hit = counts.get(id);
  if (hit === undefined) {
    counts.set(id, { file: isFile, count: 1 });
    return;
  }
  hit.count += 1;
}

function addFileNode(counts: Map<string, NodeCount>, file: ScannedFile, at: string, workspaces: WorkspacePackage[]): void {
  if (file.test) return;
  const id = nodeIdFor(file.path, at, workspaces);
  if (id === undefined) return;
  bump(counts, id, id === file.path);
}

function rawNode(id: string, info: NodeCount, wsByDir: Map<string, string>): RawNode {
  const name = wsByDir.get(id) ?? baseName(id);
  if (info.file) return { id, kind: 'file', name, path: id };
  return { id, kind: 'package', name, path: id, files: info.count };
}

function viewNodes(scan: ScanResult, at: string, wsByDir: Map<string, string>): RawNode[] {
  const counts = new Map<string, NodeCount>();
  for (const file of scan.files) addFileNode(counts, file, at, scan.workspaces);
  return [...counts.entries()].map(([id, info]) => rawNode(id, info, wsByDir));
}

function byEndpoints(a: RawEdge, b: RawEdge): number {
  return byStrings(a.from, b.from) || byStrings(a.to, b.to);
}

function freshEdge(from: string, to: string, kind: 'runtime' | 'type'): RawEdge {
  return { from, to, runtime: kind === 'runtime' ? 1 : 0, type: kind === 'runtime' ? 0 : 1 };
}

function bumpEdge(agg: Map<string, RawEdge>, from: string, to: string, kind: 'runtime' | 'type'): void {
  const key = `${from} ${to}`;
  const hit = agg.get(key);
  if (hit === undefined) {
    agg.set(key, freshEdge(from, to, kind));
    return;
  }
  if (kind === 'runtime') hit.runtime += 1;
  else hit.type += 1;
}

function endpointsVisible(from: string, to: string, nodeIds: Set<string>): [string, string] | undefined {
  if (from === to || !nodeIds.has(to)) return undefined;
  return [from, to];
}

function mappedEndpoints(
  edge: ScanEdge,
  at: string,
  nodeIds: Set<string>,
  workspaces: WorkspacePackage[],
): [string, string] | undefined {
  const from = nodeIdFor(edge.from, at, workspaces);
  const to = nodeIdFor(edge.to, at, workspaces);
  if (from === undefined || to === undefined) return undefined;
  return endpointsVisible(from, to, nodeIds);
}

function edgeEndpoints(
  edge: ScanEdge,
  at: string,
  nodeIds: Set<string>,
  testFiles: Set<string>,
  workspaces: WorkspacePackage[],
): [string, string] | undefined {
  if (testFiles.has(edge.from) || testFiles.has(edge.to)) return undefined;
  return mappedEndpoints(edge, at, nodeIds, workspaces);
}

function addEdge(
  agg: Map<string, RawEdge>,
  edge: ScanEdge,
  at: string,
  nodeIds: Set<string>,
  testFiles: Set<string>,
  workspaces: WorkspacePackage[],
): void {
  const ends = edgeEndpoints(edge, at, nodeIds, testFiles, workspaces);
  if (ends === undefined) return;
  bumpEdge(agg, ends[0], ends[1], edge.kind);
}

function testFileSet(scan: ScanResult): Set<string> {
  return new Set(scan.files.filter(file => file.test).map(file => file.path));
}

function viewEdges(scan: ScanResult, at: string, nodeIds: Set<string>): RawEdge[] {
  const agg = new Map<string, RawEdge>();
  const testFiles = testFileSet(scan);
  for (const edge of scan.edges) addEdge(agg, edge, at, nodeIds, testFiles, scan.workspaces);
  return [...agg.values()].sort(byEndpoints);
}

function deeperCrumbs(at: string, wsByDir: Map<string, string>): Crumb[] {
  const crumbs: Crumb[] = [];
  let prefix = '';
  for (const segment of at.split('/')) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    crumbs.push({ name: wsByDir.get(prefix) ?? segment, at: prefix });
  }
  return crumbs;
}

function crumbsFor(at: string, rootName: string, wsByDir: Map<string, string>): Crumb[] {
  const crumbs: Crumb[] = [{ name: rootName, at: '' }];
  if (at === '') return crumbs;
  return [...crumbs, ...deeperCrumbs(at, wsByDir)];
}

function assemble(scan: ScanResult, dir: string, rootName: string, nodes: RawNode[], wsByDir: Map<string, string>): GraphView {
  const nodeIds = new Set(nodes.map(node => node.id));
  const placed = placeView(nodes, viewEdges(scan, dir, nodeIds));
  return { at: dir, crumbs: crumbsFor(dir, rootName, wsByDir), nodes: placed.nodes, edges: placed.edges };
}

export function graphView(scan: ScanResult, at: string, rootName: string): GraphView | null {
  const dir = normalizeAt(at);
  if (dir === null) return null;
  const wsByDir = new Map(scan.workspaces.map(ws => [ws.dir, ws.name]));
  const nodes = viewNodes(scan, dir, wsByDir);
  if (nodes.length === 0 && dir !== '') return null;
  return assemble(scan, dir, rootName, nodes, wsByDir);
}
