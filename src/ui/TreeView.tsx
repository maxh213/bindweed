import type { CSSProperties } from 'react';
import type { TreeEntry } from '../domain/tree.ts';

type Props = Readonly<{
  root: string;
  entries: TreeEntry[];
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}>;

const rowStyle = (depth: number): CSSProperties => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  paddingLeft: depth * 12,
  cursor: 'pointer',
  font: 'inherit',
});

type FileRowProps = Readonly<{
  entry: TreeEntry;
  selected: string | null;
  onSelect: (path: string) => void;
  depth: number;
}>;

function FileRow({ entry, selected, onSelect, depth }: FileRowProps) {
  const current = selected === entry.path;
  return (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      style={rowStyle(depth)}
      onClick={() => onSelect(entry.path)}
    >
      {entry.name}
    </button>
  );
}

type DirRowProps = Readonly<{
  entry: TreeEntry;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}>;

function DirRow({ entry, expanded, selected, onToggle, onSelect, depth }: DirRowProps) {
  const open = expanded.has(entry.path);
  return (
    <>
      <button
        type="button"
        aria-expanded={open ? 'true' : 'false'}
        style={rowStyle(depth)}
        onClick={() => onToggle(entry.path)}
      >
        {entry.name}/
      </button>
      {open
        ? (entry.children ?? []).map(child => (
            <EntryRow
              key={child.path}
              entry={child}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  );
}

type EntryRowProps = Readonly<{
  entry: TreeEntry;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}>;

function EntryRow(props: EntryRowProps) {
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
    <FileRow
      entry={props.entry}
      selected={props.selected}
      onSelect={props.onSelect}
      depth={props.depth}
    />
  );
}

export function TreeView(props: Props) {
  return (
    <nav>
      <button
        type="button"
        aria-expanded={props.expanded.has('') ? 'true' : 'false'}
        style={rowStyle(0)}
        onClick={() => props.onToggle('')}
      >
        {props.root}/
      </button>
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
