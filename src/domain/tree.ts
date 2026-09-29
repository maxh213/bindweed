export type TreeEntry = {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children?: TreeEntry[];
};

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

function ensureDir(map: Map<string, TreeEntry>, name: string, path: string): TreeEntry {
  const existing = map.get(name);
  if (existing) return existing;
  const dir: TreeEntry = { name, path, kind: 'dir', children: [] };
  map.set(name, dir);
  return dir;
}

function addFile(parent: Map<string, TreeEntry>, parts: string[], index: number, full: string): void {
  const name = parts[index] as string;
  if (index === parts.length - 1) {
    parent.set(name, { name, path: full, kind: 'file' });
    return;
  }
  const dirPath = parts.slice(0, index + 1).join('/');
  const dir = ensureDir(parent, name, dirPath);
  const childMap = childrenMap(dir);
  addFile(childMap, parts, index + 1, full);
  dir.children = sortEntries([...childMap.values()]);
}

function childrenMap(dir: TreeEntry): Map<string, TreeEntry> {
  const map = new Map<string, TreeEntry>();
  for (const child of dir.children as TreeEntry[]) map.set(child.name, child);
  return map;
}

export function buildTree(rootName: string, paths: string[]): TreeRoot {
  const top = new Map<string, TreeEntry>();
  for (const path of paths) {
    if (path.length === 0) continue;
    addFile(top, path.split('/'), 0, path);
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
    else collectFiles(entry.children ?? [], paths);
  }
}
