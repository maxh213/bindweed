import { useEffect, useState } from 'react';
import type { TreeEntry } from '../domain/tree.ts';
import { decodeHashPath, encodeHashPath } from '../domain/lines.ts';
import { fetchFile, fetchTree } from './api.ts';
import { FilePanel, panelFromFile, type FilePanelState } from './FilePanel.tsx';
import { TreeView, togglePath, withParentsOpen } from './TreeView.tsx';
import { fileHashFrom, writeFileHash } from './session.ts';

export type AppProps = {
  token: string;
  location: Location;
  historyApi: History;
  fetcher: typeof fetch;
};

async function loadFile(
  token: string,
  path: string,
  fetcher: typeof fetch,
  historyApi: History,
  setSelected: (p: string) => void,
  setPanel: (s: FilePanelState) => void,
): Promise<void> {
  setSelected(path);
  setPanel({ kind: 'loading', path });
  writeFileHash(historyApi, path, encodeHashPath);
  const body = await fetchFile(token, path, fetcher);
  setPanel(panelFromFile(path, body));
}

async function startApp(
  props: AppProps,
  setRoot: (r: string) => void,
  setEntries: (e: TreeEntry[]) => void,
  setExpanded: (fn: (s: Set<string>) => Set<string>) => void,
  setSelected: (p: string) => void,
  setPanel: (s: FilePanelState) => void,
): Promise<void> {
  const body = await fetchTree(props.token, props.fetcher);
  if ('error' in body) return;
  setRoot(body.root);
  setEntries(body.entries);
  document.title = `bindweed — ${body.root}`;
  const encoded = fileHashFrom(props.location);
  if (encoded === null) return;
  const path = decodeHashPath(encoded);
  setExpanded(s => withParentsOpen(s, path));
  await loadFile(props.token, path, props.fetcher, props.historyApi, setSelected, setPanel);
}

export function App(props: AppProps) {
  const [root, setRoot] = useState('');
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<FilePanelState>({ kind: 'idle' });

  useEffect(() => {
    void startApp(props, setRoot, setEntries, setExpanded, setSelected, setPanel);
  }, [props]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 280, borderRight: '1px solid #ccc', overflow: 'auto' }}>
        <TreeView
          root={root}
          entries={entries}
          expanded={expanded}
          selected={selected}
          onToggle={path => setExpanded(s => togglePath(s, path))}
          onSelect={path => {
            void loadFile(props.token, path, props.fetcher, props.historyApi, setSelected, setPanel);
          }}
        />
      </aside>
      <main style={{ flex: 1, padding: 16 }}>
        <FilePanel state={panel} />
      </main>
    </div>
  );
}
