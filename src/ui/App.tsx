import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { togglePath, type TreeEntry } from '../domain/tree.ts';
import { ArchView } from './ArchView.tsx';
import { fetchFile, fetchTree } from './client.ts';
import { FilePanel } from './FilePanel.tsx';
import { TreeView } from './TreeView.tsx';
import {
  applyPage,
  applyTitle,
  atFromLocation,
  expandedFromLocation,
  openSelection,
  pageFromLocation,
  panelFromQuery,
  selectedFromLocation,
  tabFromLocation,
  treeParts,
  writeHistory,
  type Tab,
} from './view.ts';

export type AppProps = {
  token: string;
  location: Location;
  historyApi: History;
  fetcher: typeof fetch;
  events?: EventTarget;
};

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, networkMode: 'always' } } });
}

type FileLoaderProps = Readonly<{
  token: string;
  path: string;
  fetcher: typeof fetch;
}>;

function FileLoader(props: FileLoaderProps) {
  const fileQuery = useQuery({
    queryKey: ['file', props.token, props.path] as const,
    queryFn: () => fetchFile(props.token, props.path, props.fetcher),
  });
  return <FilePanel state={panelFromQuery(props.path, fileQuery.data, fileQuery.isPending)} />;
}

function TabBar(props: Readonly<{ tab: Tab; onShowFiles: () => void; onShowArch: () => void }>) {
  return (
    <div className="tabbar" role="tablist" aria-label="views">
      <button type="button" role="tab" aria-selected={props.tab === 'files'} onClick={props.onShowFiles}>
        Files
      </button>
      <button type="button" role="tab" aria-selected={props.tab === 'arch'} onClick={props.onShowArch}>
        Architecture
      </button>
    </div>
  );
}

type FilesPaneProps = Readonly<{
  token: string;
  fetcher: typeof fetch;
  root: string;
  entries: TreeEntry[];
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}>;

function FilesPane(props: FilesPaneProps) {
  return (
    <div className="files-pane">
      <aside>
        <TreeView
          root={props.root}
          entries={props.entries}
          expanded={props.expanded}
          selected={props.selected}
          onToggle={props.onToggle}
          onSelect={props.onSelect}
        />
      </aside>
      <main>
        {props.selected === null ? (
          <FilePanel state={{ kind: 'idle' }} />
        ) : (
          <FileLoader token={props.token} path={props.selected} fetcher={props.fetcher} />
        )}
      </main>
    </div>
  );
}

function BrowserApp(props: Readonly<AppProps>) {
  const [expanded, setExpanded] = useState(() => expandedFromLocation(props.location));
  const [selected, setSelected] = useState(() => selectedFromLocation(props.location));
  const [tab, setTab] = useState(() => tabFromLocation(props.location));
  const [at, setAt] = useState(() => atFromLocation(props.location));

  const treeQuery = useQuery({
    queryKey: ['tree', props.token] as const,
    queryFn: () => fetchTree(props.token, props.fetcher),
  });

  const { root, entries } = treeParts(treeQuery.data);

  useEffect(() => {
    applyTitle(document, root);
  }, [root]);

  const events = props.events ?? window;
  useEffect(() => {
    const onPop = () => applyPage({ setTab, setAt, setSelected, setExpanded }, pageFromLocation(props.location));
    events.addEventListener('popstate', onPop);
    return () => events.removeEventListener('popstate', onPop);
  }, [events, props.location]);

  const showFiles = () => {
    setTab('files');
    if (selected === null) writeHistory(props.historyApi, { kind: 'path', pathname: props.location.pathname });
    else writeHistory(props.historyApi, { kind: 'file', path: selected, mode: 'push' });
  };

  const showArch = () => {
    setTab('arch');
    writeHistory(props.historyApi, { kind: 'at', at });
  };

  const drillTo = (dir: string) => {
    setTab('arch');
    setAt(dir);
    writeHistory(props.historyApi, { kind: 'at', at: dir });
  };

  const openFile = (path: string) => {
    openSelection({ setSelected, setExpanded }, path);
    setTab('files');
    writeHistory(props.historyApi, { kind: 'file', path, mode: 'push' });
  };

  const toggleDir = (path: string) => setExpanded(current => togglePath(current, path));

  const selectFile = (path: string) => {
    writeHistory(props.historyApi, { kind: 'file', path, mode: 'replace' });
    setSelected(path);
  };

  return (
    <div className="page">
      <TabBar tab={tab} onShowFiles={showFiles} onShowArch={showArch} />
      {tab === 'files' ? (
        <FilesPane
          token={props.token}
          fetcher={props.fetcher}
          root={root}
          entries={entries}
          expanded={expanded}
          selected={selected}
          onToggle={toggleDir}
          onSelect={selectFile}
        />
      ) : (
        <ArchView token={props.token} at={at} fetcher={props.fetcher} onDrill={drillTo} onOpenFile={openFile} />
      )}
    </div>
  );
}

export function App(props: Readonly<AppProps>) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <BrowserApp {...props} />
    </QueryClientProvider>
  );
}
