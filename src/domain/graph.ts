import { byStrings, placeView, type RawEdge, type RawNode, type ViewEdge, type ViewNode } from './place.ts';
import type { ExternalRef, ScanEdge, ScanResult, ScannedFile, WorkspacePackage } from './scan.ts';

export type { ViewEdge };

export type Crumb = { name: string; at: string };

export type GraphView = { at: string; crumbs: Crumb[]; nodes: GraphNode[]; edges: ViewEdge[] };

type NodeCount = { file: boolean; count: number; abstract: boolean; test: boolean };

type EdgeKind = 'runtime' | 'type';

export type GraphFlags = { tests: boolean; external: boolean };

type ExternalNode = {
  id: string;
  kind: 'external';
  name: string;
  path: string;
  row: number;
  order: number;
  cycle: boolean;
};

export type GraphNode = ViewNode | ExternalNode;

type DetailEntry = {
  id: string;
  name: string;
  kind: 'package' | 'file' | 'external';
  runtime: number;
  type: number;
  heritage: number;
};

export type NodeDetail = {
  id: string;
  name: string;
  path: string;
  kind: 'package' | 'file' | 'external';
  files?: number;
  abstract?: true;
  imports: DetailEntry[];
  importedBy: DetailEntry[];
};

const CLOSED_FLAGS: GraphFlags = { tests: false, external: false };

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

function freshCount(isFile: boolean, file: ScannedFile): NodeCount {
  return { file: isFile, count: 1, abstract: file.abstract === true, test: isFile && file.test };
}

function growCount(hit: NodeCount, file: ScannedFile): void {
  hit.count += 1;
  if (file.abstract !== true) hit.abstract = false;
}

function bump(counts: Map<string, NodeCount>, id: string, file: ScannedFile): void {
  const hit = counts.get(id);
  if (hit === undefined) {
    counts.set(id, freshCount(id === file.path, file));
    return;
  }
  growCount(hit, file);
}

function insideView(path: string, at: string): boolean {
  return at === '' || path.startsWith(`${at}/`);
}

function counted(file: ScannedFile, at: string, includeTests: boolean): boolean {
  if (!insideView(file.path, at)) return false;
  return includeTests || !file.test;
}

function addFileNode(counts: Map<string, NodeCount>, file: ScannedFile, at: string, ws: WorkspaceOrder, includeTests: boolean): void {
  if (!counted(file, at, includeTests)) return;
  bump(counts, nodeIdFor(file.path, at, ws), file);
}

function abstractMark(abstract: boolean): { abstract?: true } {
  if (!abstract) return {};
  return { abstract: true };
}

function testMark(info: NodeCount): { test?: true } {
  if (!info.file || !info.test) return {};
  return { test: true };
}

function rawNode(id: string, info: NodeCount, ws: WorkspaceOrder): RawNode {
  const name = ws.byDir.get(id) ?? baseName(id);
  const marks = { ...abstractMark(info.abstract), ...testMark(info) };
  if (info.file) return { id, kind: 'file', name, path: id, ...marks };
  return { id, kind: 'package', name, path: id, files: info.count, ...marks };
}

function viewNodes(scan: ScanResult, at: string, ws: WorkspaceOrder, includeTests: boolean): RawNode[] {
  const counts = new Map<string, NodeCount>();
  for (const file of scan.files) addFileNode(counts, file, at, ws, includeTests);
  return [...counts.entries()].map(([id, info]) => rawNode(id, info, ws));
}

function byEndpoints(a: RawEdge, b: RawEdge): number {
  return byStrings(a.from, b.from) || byStrings(a.to, b.to);
}

function kindCounts(kind: EdgeKind): { runtime: number; type: number } {
  if (kind === 'runtime') return { runtime: 1, type: 0 };
  return { runtime: 0, type: 1 };
}

function freshEdge(from: string, to: string, kind: EdgeKind): RawEdge {
  return { from, to, ...kindCounts(kind) };
}

function addCount(edge: { runtime: number; type: number }, kind: EdgeKind): void {
  if (kind === 'runtime') edge.runtime += 1;
  else edge.type += 1;
}

function addHeritage(edge: RawEdge, heritage: number): void {
  if (heritage === 0) return;
  edge.heritage = (edge.heritage ?? 0) + heritage;
}

function bumpEdge(agg: Map<string, RawEdge>, from: string, to: string, kind: EdgeKind, heritage: number): void {
  const key = `${from} ${to}`;
  const hit = agg.get(key);
  if (hit === undefined) {
    const created = freshEdge(from, to, kind);
    addHeritage(created, heritage);
    agg.set(key, created);
    return;
  }
  addCount(hit, kind);
  addHeritage(hit, heritage);
}

function endpointsVisible(from: string, to: string, nodeIds: Set<string>): [string, string] | undefined {
  if (!nodeIds.has(from) || !nodeIds.has(to)) return undefined;
  return from === to ? undefined : [from, to];
}

function mappedEndpoints(edge: ScanEdge, at: string, nodeIds: Set<string>, ws: WorkspaceOrder): [string, string] | undefined {
  return endpointsVisible(nodeIdFor(edge.from, at, ws), nodeIdFor(edge.to, at, ws), nodeIds);
}

function hidesTest(path: string, testFiles: Set<string>, includeTests: boolean): boolean {
  if (includeTests) return false;
  return testFiles.has(path);
}

function hidesEdge(from: string, to: string, testFiles: Set<string>, includeTests: boolean): boolean {
  return hidesTest(from, testFiles, includeTests) || hidesTest(to, testFiles, includeTests);
}

function edgeEnds(edge: ScanEdge, at: string, nodeIds: Set<string>, testFiles: Set<string>, includeTests: boolean, ws: WorkspaceOrder): [string, string] | undefined {
  if (hidesEdge(edge.from, edge.to, testFiles, includeTests)) return undefined;
  return mappedEndpoints(edge, at, nodeIds, ws);
}

function addEdge(agg: Map<string, RawEdge>, edge: ScanEdge, at: string, nodeIds: Set<string>, testFiles: Set<string>, includeTests: boolean, ws: WorkspaceOrder): void {
  const ends = edgeEnds(edge, at, nodeIds, testFiles, includeTests, ws);
  if (ends === undefined) return;
  bumpEdge(agg, ends[0], ends[1], edge.kind, edge.heritage ?? 0);
}

function testFileSet(scan: ScanResult): Set<string> {
  return new Set(scan.files.filter(file => file.test).map(file => file.path));
}

function viewEdges(scan: ScanResult, at: string, nodeIds: Set<string>, includeTests: boolean, ws: WorkspaceOrder): RawEdge[] {
  const agg = new Map<string, RawEdge>();
  const testFiles = testFileSet(scan);
  for (const edge of scan.edges) addEdge(agg, edge, at, nodeIds, testFiles, includeTests, ws);
  return [...agg.values()].sort(byEndpoints);
}

function noteExternal(agg: Map<string, RawEdge>, ext: ExternalRef, at: string, nodeIds: Set<string>, testFiles: Set<string>, includeTests: boolean, ws: WorkspaceOrder): void {
  if (hidesTest(ext.from, testFiles, includeTests)) return;
  const from = nodeIdFor(ext.from, at, ws);
  if (!nodeIds.has(from)) return;
  bumpEdge(agg, from, ext.name, ext.kind, ext.heritage ?? 0);
}

function externalEdges(scan: ScanResult, at: string, nodeIds: Set<string>, includeTests: boolean, ws: WorkspaceOrder): RawEdge[] {
  const agg = new Map<string, RawEdge>();
  const testFiles = testFileSet(scan);
  for (const ext of scan.externals) noteExternal(agg, ext, at, nodeIds, testFiles, includeTests, ws);
  return [...agg.values()].sort(byEndpoints);
}

function externalNames(edges: RawEdge[]): string[] {
  return [...new Set(edges.map(edge => edge.to))].sort(byStrings);
}

function externalNodes(names: string[], row: number): ExternalNode[] {
  return names.map((name, order) => ({ id: name, kind: 'external', name, path: name, row, order, cycle: false }));
}

function nextRow(nodes: ViewNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.row), -1) + 1;
}

function plainEdge(edge: RawEdge): ViewEdge {
  const base: ViewEdge = { from: edge.from, to: edge.to, runtime: edge.runtime, type: edge.type, cycle: false };
  if (edge.heritage === undefined || edge.heritage === 0) return base;
  return { ...base, heritage: edge.heritage };
}

function applyMarks(node: ViewNode, source: ViewNode): ViewNode {
  if (source.abstract === true) node.abstract = true;
  if (source.test === true) node.test = true;
  return node;
}

function orderedNode(node: ViewNode): ViewNode {
  if (node.abstract !== true && node.test !== true) return node;
  const copy = { ...node };
  delete copy.abstract;
  delete copy.test;
  return applyMarks(copy, node);
}

function withExternals(nodes: ViewNode[], edges: ViewEdge[], ext: RawEdge[]): { nodes: GraphNode[]; edges: ViewEdge[] } {
  if (ext.length === 0) return { nodes, edges };
  return {
    nodes: [...nodes, ...externalNodes(externalNames(ext), nextRow(nodes))],
    edges: [...edges, ...ext.map(plainEdge)],
  };
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

function orderOf(scan: ScanResult): WorkspaceOrder {
  return {
    ordered: [...scan.workspaces].sort((a, b) => b.dir.length - a.dir.length),
    byDir: new Map(scan.workspaces.map(workspace => [workspace.dir, workspace.name])),
  };
}

function assemble(scan: ScanResult, dir: string, rootName: string, nodes: RawNode[], flags: GraphFlags, ws: WorkspaceOrder): GraphView {
  const nodeIds = new Set(nodes.map(node => node.id));
  const placed = placeView(nodes, viewEdges(scan, dir, nodeIds, flags.tests, ws));
  const ext = flags.external ? externalEdges(scan, dir, nodeIds, flags.tests, ws) : [];
  const drawn = withExternals(placed.nodes.map(orderedNode), placed.edges, ext);
  return { at: dir, crumbs: crumbsFor(dir, rootName, ws), nodes: drawn.nodes, edges: drawn.edges };
}

export function graphView(scan: ScanResult, at: string, rootName: string, flags: GraphFlags = CLOSED_FLAGS): GraphView | null {
  const dir = stripTrailingSlashes(at);
  const ws = orderOf(scan);
  const nodes = viewNodes(scan, dir, ws, flags.tests);
  if (nodes.length === 0 && dir !== '') return null;
  return assemble(scan, dir, rootName, nodes, flags, ws);
}

type Tally = { runtime: number; type: number; heritage: number };

type Sides = { imports: Map<string, Tally>; importedBy: Map<string, Tally> };

function freshTally(kind: EdgeKind, heritage: number): Tally {
  return { ...kindCounts(kind), heritage };
}

function growTally(hit: Tally, kind: EdgeKind, heritage: number): void {
  addCount(hit, kind);
  hit.heritage += heritage;
}

function tallyAdd(map: Map<string, Tally>, id: string, kind: EdgeKind, heritage: number): void {
  const hit = map.get(id);
  if (hit === undefined) {
    map.set(id, freshTally(kind, heritage));
    return;
  }
  growTally(hit, kind, heritage);
}

function sideOf(from: string, to: string, id: string): 'import' | 'importedBy' | undefined {
  if (from === to) return undefined;
  if (from === id) return 'import';
  if (to === id) return 'importedBy';
  return undefined;
}

function recordLink(sides: Sides, from: string, to: string, id: string, kind: EdgeKind, heritage: number): void {
  const side = sideOf(from, to, id);
  if (side === 'import') tallyAdd(sides.imports, to, kind, heritage);
  else if (side === 'importedBy') tallyAdd(sides.importedBy, from, kind, heritage);
}

function recordScan(edge: ScanEdge, at: string, id: string, testFiles: Set<string>, includeTests: boolean, ws: WorkspaceOrder, sides: Sides): void {
  if (hidesEdge(edge.from, edge.to, testFiles, includeTests)) return;
  recordLink(sides, nodeIdFor(edge.from, at, ws), nodeIdFor(edge.to, at, ws), id, edge.kind, edge.heritage ?? 0);
}

function recordExternal(ext: ExternalRef, at: string, id: string, testFiles: Set<string>, includeTests: boolean, ws: WorkspaceOrder, sides: Sides): void {
  if (hidesTest(ext.from, testFiles, includeTests)) return;
  recordLink(sides, nodeIdFor(ext.from, at, ws), ext.name, id, ext.kind, ext.heritage ?? 0);
}

function linksFor(scan: ScanResult, at: string, id: string, flags: GraphFlags, ws: WorkspaceOrder): Sides {
  const sides: Sides = { imports: new Map(), importedBy: new Map() };
  const testFiles = testFileSet(scan);
  for (const edge of scan.edges) recordScan(edge, at, id, testFiles, flags.tests, ws, sides);
  if (!flags.external) return sides;
  for (const ext of scan.externals) recordExternal(ext, at, id, testFiles, flags.tests, ws, sides);
  return sides;
}

function entryFrom(id: string, tally: Tally, nodes: Map<string, GraphNode>): DetailEntry {
  const known = nodes.get(id);
  const name = known === undefined ? baseName(id) : known.name;
  const kind = known === undefined ? 'file' : known.kind;
  return { id, name, kind, runtime: tally.runtime, type: tally.type, heritage: tally.heritage };
}

function byEntry(a: DetailEntry, b: DetailEntry): number {
  return byStrings(a.id, b.id);
}

function entriesOf(map: Map<string, Tally>, nodes: Map<string, GraphNode>): DetailEntry[] {
  return [...map.entries()].map(([id, tally]) => entryFrom(id, tally, nodes)).sort(byEntry);
}

function fileAbstract(node: GraphNode): { abstract?: true } {
  if (node.kind !== 'file') return {};
  if (node.abstract !== true) return {};
  return { abstract: true };
}

function packageMeta(node: GraphNode): { files?: number; abstract?: true } {
  if (node.kind !== 'package') return fileAbstract(node);
  if (node.abstract === true) return { files: node.files, abstract: true };
  return { files: node.files };
}

export function nodeDetail(scan: ScanResult, id: string, at: string, rootName: string, flags: GraphFlags = CLOSED_FLAGS): NodeDetail | null {
  const view = graphView(scan, at, rootName, flags);
  if (view === null) return null;
  const node = view.nodes.find(item => item.id === id);
  if (node === undefined) return null;
  const dir = stripTrailingSlashes(at);
  const sides = linksFor(scan, dir, id, flags, orderOf(scan));
  const nodes = new Map(view.nodes.map(item => [item.id, item]));
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    kind: node.kind,
    ...packageMeta(node),
    imports: entriesOf(sides.imports, nodes),
    importedBy: entriesOf(sides.importedBy, nodes),
  };
}
