import { byStrings, placeView, type RawEdge, type RawNode, type ViewEdge, type ViewNode } from './place.ts';
import type { ScanEdge, ScanResult, ScannedFile, WorkspacePackage } from './scan.ts';

export type { ViewEdge, ViewNode };

export type Crumb = { name: string; at: string };

export type GraphView = { at: string; crumbs: Crumb[]; nodes: ViewNode[]; edges: ViewEdge[] };

type NodeCount = { file: boolean; count: number };

type WorkspaceOrder = { ordered: WorkspacePackage[]; byDir: Map<string, string> };

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (text.charAt(end - 1) === '/') end -= 1;
  return text.slice(0, end);
}

function contains(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function workspaceDirFor(path: string, ws: WorkspaceOrder): string | undefined {
  return ws.ordered.find(workspace => contains(workspace.dir, path))?.dir;
}

function firstSegmentId(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

function rootNodeId(path: string, ws: WorkspaceOrder): string {
  return workspaceDirFor(path, ws) ?? firstSegmentId(path);
}

function childNodeId(path: string, at: string): string {
  const prefix = `${at}/`;
  const inside = path.startsWith(prefix);
  const rel = path.slice(prefix.length);
  const slash = rel.indexOf('/');
  return inside && slash !== -1 ? `${at}/${rel.slice(0, slash)}` : path;
}

function nodeIdFor(path: string, at: string, ws: WorkspaceOrder): string {
  if (at === '') return rootNodeId(path, ws);
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

function insideView(path: string, at: string): boolean {
  return at === '' || path.startsWith(`${at}/`);
}

function addFileNode(counts: Map<string, NodeCount>, file: ScannedFile, at: string, ws: WorkspaceOrder): void {
  if (file.test) return;
  if (!insideView(file.path, at)) return;
  const id = nodeIdFor(file.path, at, ws);
  bump(counts, id, id === file.path);
}

function rawNode(id: string, info: NodeCount, ws: WorkspaceOrder): RawNode {
  const name = ws.byDir.get(id) ?? baseName(id);
  if (info.file) return { id, kind: 'file', name, path: id };
  return { id, kind: 'package', name, path: id, files: info.count };
}

function viewNodes(scan: ScanResult, at: string, ws: WorkspaceOrder): RawNode[] {
  const counts = new Map<string, NodeCount>();
  for (const file of scan.files) addFileNode(counts, file, at, ws);
  return [...counts.entries()].map(([id, info]) => rawNode(id, info, ws));
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
  if (!nodeIds.has(from) || !nodeIds.has(to)) return undefined;
  return from === to ? undefined : [from, to];
}

function mappedEndpoints(edge: ScanEdge, at: string, nodeIds: Set<string>, ws: WorkspaceOrder): [string, string] | undefined {
  return endpointsVisible(nodeIdFor(edge.from, at, ws), nodeIdFor(edge.to, at, ws), nodeIds);
}

function edgeEndpoints(edge: ScanEdge, at: string, nodeIds: Set<string>, testFiles: Set<string>, ws: WorkspaceOrder): [string, string] | undefined {
  if (testFiles.has(edge.from) || testFiles.has(edge.to)) return undefined;
  return mappedEndpoints(edge, at, nodeIds, ws);
}

function addEdge(agg: Map<string, RawEdge>, edge: ScanEdge, at: string, nodeIds: Set<string>, testFiles: Set<string>, ws: WorkspaceOrder): void {
  const ends = edgeEndpoints(edge, at, nodeIds, testFiles, ws);
  if (ends === undefined) return;
  bumpEdge(agg, ends[0], ends[1], edge.kind);
}

function testFileSet(scan: ScanResult): Set<string> {
  return new Set(scan.files.filter(file => file.test).map(file => file.path));
}

function viewEdges(scan: ScanResult, at: string, nodeIds: Set<string>, ws: WorkspaceOrder): RawEdge[] {
  const agg = new Map<string, RawEdge>();
  const testFiles = testFileSet(scan);
  for (const edge of scan.edges) addEdge(agg, edge, at, nodeIds, testFiles, ws);
  return [...agg.values()].sort(byEndpoints);
}

function deeperCrumbs(at: string, ws: WorkspaceOrder): Crumb[] {
  const crumbs: Crumb[] = [];
  let prefix = '';
  for (const segment of at.split('/')) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    crumbs.push({ name: ws.byDir.get(prefix) ?? segment, at: prefix });
  }
  return crumbs;
}

function crumbsFor(at: string, rootName: string, ws: WorkspaceOrder): Crumb[] {
  const crumbs: Crumb[] = [{ name: rootName, at: '' }];
  if (at === '') return crumbs;
  return [...crumbs, ...deeperCrumbs(at, ws)];
}

function assemble(scan: ScanResult, dir: string, rootName: string, nodes: RawNode[], ws: WorkspaceOrder): GraphView {
  const nodeIds = new Set(nodes.map(node => node.id));
  const placed = placeView(nodes, viewEdges(scan, dir, nodeIds, ws));
  return { at: dir, crumbs: crumbsFor(dir, rootName, ws), nodes: placed.nodes, edges: placed.edges };
}

export function graphView(scan: ScanResult, at: string, rootName: string): GraphView | null {
  const dir = stripTrailingSlashes(at);
  const ws: WorkspaceOrder = {
    ordered: [...scan.workspaces].sort((a, b) => b.dir.length - a.dir.length),
    byDir: new Map(scan.workspaces.map(workspace => [workspace.dir, workspace.name])),
  };
  const nodes = viewNodes(scan, dir, ws);
  if (nodes.length === 0 && dir !== '') return null;
  return assemble(scan, dir, rootName, nodes, ws);
}
