export type ScannedFile = { path: string; test: boolean };

export type ScanEdge = { from: string; to: string; kind: 'runtime' | 'type' };

export type ExternalRef = { from: string; name: string; kind: 'runtime' | 'type' };

export type WorkspacePackage = { dir: string; name: string };

export type ScanResult = {
  files: ScannedFile[];
  edges: ScanEdge[];
  externals: ExternalRef[];
  workspaces: WorkspacePackage[];
};

export type Crumb = { name: string; at: string };

type NodeBase = {
  id: string;
  name: string;
  path: string;
  row: number;
  order: number;
  cycle: boolean;
};

export type ViewNode =
  | (NodeBase & { kind: 'package'; files: number })
  | (NodeBase & { kind: 'file' });

export type ViewEdge = {
  from: string;
  to: string;
  runtime: number;
  type: number;
  cycle: boolean;
  cycleText?: string;
};

export type GraphView = { at: string; crumbs: Crumb[]; nodes: ViewNode[]; edges: ViewEdge[] };

type RawNode =
  | { id: string; kind: 'package'; name: string; path: string; files: number }
  | { id: string; kind: 'file'; name: string; path: string };

type Placed = RawNode & { row: number; order: number; cycle: boolean };

type RawEdge = { from: string; to: string; runtime: number; type: number };

type NodeCount = { file: boolean; count: number };

type TarjanState = {
  index: Record<string, number>;
  low: Record<string, number>;
  seen: Set<string>;
  onStack: Set<string>;
  stack: string[];
  next: number;
  comp: Record<string, number>;
  compCount: number;
};

const TEST_DIR = /(^|\/)(__tests__|test|tests|e2e)(\/|$)/;
const TEST_FILE = /\.(test|spec)\./;

export function isTestPath(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}

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

function byStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
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

function pushTarget(map: Map<string, string[]>, from: string, to: string): void {
  const list = map.get(from);
  if (list === undefined) {
    map.set(from, [to]);
    return;
  }
  list.push(to);
}

function adjacency(edges: RawEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) pushTarget(map, edge.from, edge.to);
  return map;
}

function popComponent(v: string, state: TarjanState): void {
  let w: string;
  do {
    w = state.stack.pop() as string;
    state.onStack.delete(w);
    state.comp[w] = state.compCount;
  } while (w !== v);
  state.compCount += 1;
}

function lowerOrRecurse(v: string, w: string, succ: Map<string, string[]>, state: TarjanState): void {
  if (!state.seen.has(w)) {
    strongConnect(w, succ, state);
    state.low[v] = Math.min(state.low[v], state.low[w]);
    return;
  }
  if (state.onStack.has(w)) state.low[v] = Math.min(state.low[v], state.index[w]);
}

function visitSuccessors(v: string, succ: Map<string, string[]>, state: TarjanState): void {
  for (const w of succ.get(v) ?? []) lowerOrRecurse(v, w, succ, state);
}

function strongConnect(v: string, succ: Map<string, string[]>, state: TarjanState): void {
  state.index[v] = state.next;
  state.low[v] = state.next;
  state.next += 1;
  state.stack.push(v);
  state.seen.add(v);
  state.onStack.add(v);
  visitSuccessors(v, succ, state);
  if (state.low[v] === state.index[v]) popComponent(v, state);
}

function freshTarjanState(): TarjanState {
  return { index: {}, low: {}, seen: new Set(), onStack: new Set(), stack: [], next: 0, comp: {}, compCount: 0 };
}

function componentsOf(nodeIds: string[], edges: RawEdge[]): Record<string, number> {
  const succ = adjacency(edges);
  const state = freshTarjanState();
  for (const id of nodeIds) {
    if (!state.seen.has(id)) strongConnect(id, succ, state);
  }
  return state.comp;
}

function compSizes(comp: Record<string, number>, compCount: number): number[] {
  const sizes = new Array<number>(compCount).fill(0);
  for (const id of Object.keys(comp)) sizes[comp[id]] += 1;
  return sizes;
}

function compCountOf(comp: Record<string, number>): number {
  return new Set(Object.values(comp)).size;
}

function pushCompEdge(out: [number, number][], edge: RawEdge, comp: Record<string, number>): void {
  const a = comp[edge.from];
  const b = comp[edge.to];
  if (a === b) return;
  out.push([a, b]);
}

function compEdgesOf(edges: RawEdge[], comp: Record<string, number>): [number, number][] {
  const out: [number, number][] = [];
  for (const edge of edges) pushCompEdge(out, edge, comp);
  return out;
}

function buildDag(compCount: number, compEdges: [number, number][]): number[][] {
  const dag: number[][] = Array.from({ length: compCount }, () => []);
  for (const [a, b] of compEdges) {
    if (!dag[a].includes(b)) dag[a].push(b);
  }
  return dag;
}

function heightOf(c: number, dag: number[][], memo: number[]): number {
  if (memo[c] >= 0) return memo[c];
  let best = 0;
  for (const t of dag[c]) best = Math.max(best, 1 + heightOf(t, dag, memo));
  memo[c] = best;
  return best;
}

function heightsOf(compCount: number, compEdges: [number, number][]): number[] {
  const dag = buildDag(compCount, compEdges);
  const memo = new Array<number>(compCount).fill(-1);
  for (let c = 0; c < compCount; c += 1) heightOf(c, dag, memo);
  return memo;
}

function placeNode(node: RawNode, comp: Record<string, number>, sizes: number[], heights: number[], top: number): Placed {
  const c = comp[node.id];
  return { ...node, row: top - heights[c], order: 0, cycle: sizes[c] > 1 };
}

function adjacentPairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

function adjacencyPairs(edges: RawEdge[]): Set<string> {
  return new Set(edges.map(edge => adjacentPairKey(edge.from, edge.to)));
}

function rowsOf(placed: Placed[]): Placed[][] {
  const maxRow = Math.max(0, ...placed.map(node => node.row));
  const rows: Placed[][] = Array.from({ length: maxRow + 1 }, () => []);
  for (const node of placed) rows[node.row].push(node);
  return rows;
}

function byName(a: { name: string }, b: { name: string }): number {
  return byStrings(a.name, b.name);
}

function reindex(row: Placed[]): void {
  row.forEach((node, index) => {
    node.order = index;
  });
}

function sortAndIndex(row: Placed[]): void {
  row.sort(byName);
  reindex(row);
}

function neighbourOrders(node: Placed, above: Placed[], pairs: Set<string>): number[] {
  const orders: number[] = [];
  for (const other of above) {
    if (pairs.has(adjacentPairKey(node.id, other.id))) orders.push(other.order);
  }
  return orders;
}

function barycentre(node: Placed, above: Placed[], pairs: Set<string>): number {
  const orders = neighbourOrders(node, above, pairs);
  if (orders.length === 0) return Number.POSITIVE_INFINITY;
  return orders.reduce((sum, order) => sum + order, 0) / orders.length;
}

function byBary(a: Placed, b: Placed, above: Placed[], pairs: Set<string>): number {
  const diff = barycentre(a, above, pairs) - barycentre(b, above, pairs);
  if (diff !== 0) return diff;
  return byName(a, b);
}

function sortRowByBary(rows: Placed[][], rowNum: number, pairs: Set<string>): void {
  const above = rows[rowNum - 1];
  const row = rows[rowNum];
  row.sort((a, b) => byBary(a, b, above, pairs));
  reindex(row);
}

function sweepDown(rows: Placed[][], pairs: Set<string>): void {
  for (let rowNum = 1; rowNum < rows.length; rowNum += 1) sortRowByBary(rows, rowNum, pairs);
}

function orderWithinRows(placed: Placed[], edges: RawEdge[]): void {
  const rows = rowsOf(placed);
  for (const row of rows) sortAndIndex(row);
  const pairs = adjacencyPairs(edges);
  for (let sweep = 0; sweep < 2; sweep += 1) sweepDown(rows, pairs);
}

function placeNodes(nodes: RawNode[], edges: RawEdge[], comp: Record<string, number>, sizes: number[]): Placed[] {
  const heights = heightsOf(compCountOf(comp), compEdgesOf(edges, comp));
  const top = Math.max(0, ...heights);
  const placed = nodes.map(node => placeNode(node, comp, sizes, heights, top));
  orderWithinRows(placed, edges);
  return placed;
}

function byPlace(a: Placed, b: Placed): number {
  return a.row - b.row || a.order - b.order;
}

function inSameCycle(edge: RawEdge, comp: Record<string, number>, sizes: number[]): boolean {
  return comp[edge.from] === comp[edge.to] && sizes[comp[edge.from]] > 1;
}

function pushWithin(map: Record<string, string[]>, edge: RawEdge, compId: number, comp: Record<string, number>): void {
  if (comp[edge.from] !== compId) return;
  const existing = map[edge.from];
  if (existing === undefined) {
    map[edge.from] = [edge.to];
    return;
  }
  existing.push(edge.to);
}

function edgesWithin(edges: RawEdge[], compId: number, comp: Record<string, number>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const edge of edges) pushWithin(map, edge, compId, comp);
  return map;
}

function enqueueNeighbours(cur: string, succ: Record<string, string[]>, prev: Map<string, string | null>, queue: string[]): void {
  for (const nxt of succ[cur]) {
    if (prev.has(nxt)) continue;
    prev.set(nxt, cur);
    queue.push(nxt);
  }
}

function unwind(prev: Map<string, string | null>, goal: string): string[] {
  const path: string[] = [];
  let cur: string | null = goal;
  while (cur !== null) {
    path.push(cur);
    cur = prev.get(cur) ?? null;
  }
  return path.reverse();
}

function shortestPath(start: string, goal: string, succ: Record<string, string[]>): string[] {
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  let head = 0;
  for (;;) {
    const cur = queue[head];
    head += 1;
    if (cur === goal) return unwind(prev, goal);
    enqueueNeighbours(cur, succ, prev, queue);
  }
}

function nameMapOf(placed: Placed[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const node of placed) names[node.id] = node.name;
  return names;
}

function cycleTextFor(edge: RawEdge, edges: RawEdge[], comp: Record<string, number>, names: Record<string, string>): string {
  const within = edgesWithin(edges, comp[edge.from], comp);
  const path = shortestPath(edge.to, edge.from, within);
  return [edge.from, ...path].map(id => names[id]).join(' → ');
}

function finishEdge(
  edge: RawEdge,
  edges: RawEdge[],
  comp: Record<string, number>,
  sizes: number[],
  names: Record<string, string>,
): ViewEdge {
  const cycle = inSameCycle(edge, comp, sizes);
  const base: ViewEdge = { from: edge.from, to: edge.to, runtime: edge.runtime, type: edge.type, cycle };
  if (!cycle) return base;
  return { ...base, cycleText: cycleTextFor(edge, edges, comp, names) };
}

function finishEdges(edges: RawEdge[], comp: Record<string, number>, sizes: number[], names: Record<string, string>): ViewEdge[] {
  return edges.map(edge => finishEdge(edge, edges, comp, sizes, names));
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
  const edges = viewEdges(scan, dir, nodeIds);
  const comp = componentsOf([...nodeIds], edges);
  const sizes = compSizes(comp, compCountOf(comp));
  const placed = placeNodes(nodes, edges, comp, sizes);
  return {
    at: dir,
    crumbs: crumbsFor(dir, rootName, wsByDir),
    nodes: [...placed].sort(byPlace),
    edges: finishEdges(edges, comp, sizes, nameMapOf(placed)),
  };
}

export function graphView(scan: ScanResult, at: string, rootName: string): GraphView | null {
  const dir = normalizeAt(at);
  if (dir === null) return null;
  const wsByDir = new Map(scan.workspaces.map(ws => [ws.dir, ws.name]));
  const nodes = viewNodes(scan, dir, wsByDir);
  if (nodes.length === 0 && dir !== '') return null;
  return assemble(scan, dir, rootName, nodes, wsByDir);
}
