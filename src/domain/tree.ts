export type TreeEntry =
  | { name: string; path: string; kind: 'file' }
  | { name: string; path: string; kind: 'dir'; children: TreeEntry[] };

export type TreeDir = Extract<TreeEntry, { kind: 'dir' }>;

export type TreeRoot = {
  root: string;
  entries: TreeEntry[];
};

function byteOrder(a: string, b: string): number {
  return Buffer.from(a, 'utf8').compare(Buffer.from(b, 'utf8'));
}

function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return byteOrder(a.name, b.name);
  });
}

function ensureDir(map: Map<string, TreeEntry>, name: string, path: string): TreeDir {
  const existing = map.get(name);
  if (existing !== undefined && existing.kind === 'dir') return existing;
  const dir: TreeDir = { name, path, kind: 'dir', children: [] };
  map.set(name, dir);
  return dir;
}

function childrenMap(dir: TreeDir): Map<string, TreeEntry> {
  const map = new Map<string, TreeEntry>();
  for (const child of dir.children) map.set(child.name, child);
  return map;
}

function placeFile(root: Map<string, TreeEntry>, full: string): void {
  const segments = full.split('/');
  let map = root;
  const chain: { dir: TreeDir; kids: Map<string, TreeEntry> }[] = [];
  let depth = 0;
  for (const name of segments) {
    depth += 1;
    if (depth === segments.length) {
      map.set(name, { name, path: full, kind: 'file' });
      break;
    }
    const dirPath = segments.slice(0, depth).join('/');
    const dir = ensureDir(map, name, dirPath);
    const kids = childrenMap(dir);
    chain.push({ dir, kids });
    map = kids;
  }
  for (const { dir, kids } of chain.reverse()) {
    dir.children = sortEntries([...kids.values()]);
  }
}

export function buildTree(rootName: string, paths: string[]): TreeRoot {
  const top = new Map<string, TreeEntry>();
  for (const path of paths) {
    if (path.length === 0) continue;
    placeFile(top, path);
  }
  return { root: rootName, entries: sortEntries([...top.values()]) };
}

export function filePathSet(entries: TreeEntry[]): Set<string> {
  const paths = new Set<string>();
  collectFiles(entries, paths);
  return paths;
}

function collectFiles(entries: TreeEntry[], paths: Set<string>): void {
  for (const entry of entries) {
    if (entry.kind === 'file') paths.add(entry.path);
    else collectFiles(entry.children, paths);
  }
}

export function parentDirs(filePath: string): string[] {
  const parts = filePath.split('/');
  const dirs: string[] = [''];
  for (let i = 0; i < parts.length - 1; i += 1) {
    dirs.push(parts.slice(0, i + 1).join('/'));
  }
  return dirs;
}

export function togglePath(expanded: Set<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function withParentsOpen(expanded: Set<string>, filePath: string): Set<string> {
  const next = new Set(expanded);
  for (const dir of parentDirs(filePath)) next.add(dir);
  return next;
}
