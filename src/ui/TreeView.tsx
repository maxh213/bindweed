import type { TreeDir, TreeEntry } from '../domain/tree.ts';

type TreeState = Readonly<{
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}>;

type Props = TreeState & Readonly<{ root: string; entries: TreeEntry[] }>;

function FileRow({ entry, state }: Readonly<{ entry: TreeEntry; state: TreeState }>) {
  const current = state.selected === entry.path;
  return (
    <li>
      <button
        type="button"
        aria-current={current ? true : undefined}
        onClick={() => state.onSelect(entry.path)}
      >
        {entry.name}
      </button>
    </li>
  );
}

function DirRow({ entry, state }: Readonly<{ entry: TreeDir; state: TreeState }>) {
  const open = state.expanded.has(entry.path);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => state.onToggle(entry.path)}>
        {entry.name}/
      </button>
      {open ? <Rows entries={entry.children} state={state} /> : null}
    </li>
  );
}

function Rows({ entries, state }: Readonly<{ entries: TreeEntry[]; state: TreeState }>) {
  return (
    <ul>
      {entries.map(entry =>
        entry.kind === 'dir' ? (
          <DirRow key={entry.path} entry={entry} state={state} />
        ) : (
          <FileRow key={entry.path} entry={entry} state={state} />
        ),
      )}
    </ul>
  );
}

export function TreeView(props: Props) {
  const open = props.expanded.has('');
  return (
    <nav>
      <button type="button" aria-expanded={open} onClick={() => props.onToggle('')}>
        {props.root}/
      </button>
      {open ? <Rows entries={props.entries} state={props} /> : null}
    </nav>
  );
}
