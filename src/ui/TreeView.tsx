import type { TreeEntry } from '../domain/tree.ts';

type Props = {
  root: string;
  entries: TreeEntry[];
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function FileRow(props: { entry: TreeEntry; selected: string | null; onSelect: (path: string) => void; depth: number }) {
  const current = props.selected === props.entry.path;
  return (
    <div
      role="treeitem"
      aria-current={current ? 'true' : undefined}
      style={{ paddingLeft: props.depth * 12 }}
      onClick={() => props.onSelect(props.entry.path)}
    >
      {props.entry.name}
    </div>
  );
}

function DirRow(props: {
  entry: TreeEntry;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const open = props.expanded.has(props.entry.path);
  return (
    <>
      <div
        role="treeitem"
        aria-expanded={open ? 'true' : 'false'}
        style={{ paddingLeft: props.depth * 12 }}
        onClick={() => props.onToggle(props.entry.path)}
      >
        {props.entry.name}/
      </div>
      {open
        ? (props.entry.children ?? []).map(child => (
            <EntryRow
              key={child.path}
              entry={child}
              expanded={props.expanded}
              selected={props.selected}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              depth={props.depth + 1}
            />
          ))
        : null}
    </>
  );
}

function EntryRow(props: {
  entry: TreeEntry;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}) {
  if (props.entry.kind === 'dir') {
    return (
      <DirRow
        entry={props.entry}
        expanded={props.expanded}
        selected={props.selected}
        onToggle={props.onToggle}
        onSelect={props.onSelect}
        depth={props.depth}
      />
    );
  }
  return (
    <FileRow entry={props.entry} selected={props.selected} onSelect={props.onSelect} depth={props.depth} />
  );
}

export function TreeView(props: Props) {
  return (
    <nav role="tree">
      <div role="treeitem" aria-expanded={props.expanded.has('') ? 'true' : 'false'} onClick={() => props.onToggle('')}>
        {props.root}/
      </div>
      {props.expanded.has('')
        ? props.entries.map(entry => (
            <EntryRow
              key={entry.path}
              entry={entry}
              expanded={props.expanded}
              selected={props.selected}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              depth={1}
            />
          ))
        : null}
    </nav>
  );
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
