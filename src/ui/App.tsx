import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { togglePath, type TreeEntry } from '../domain/tree.ts';
import { ArchView } from './ArchView.tsx';
import { fetchFile, fetchRuns, fetchTree, type RunCard } from './client.ts';
import { FilePanel } from './FilePanel.tsx';
import { useRunsPane } from './RunsPanel.tsx';
import { TreeView } from './TreeView.tsx';
import {
  applyPage,
  applyTitle,
  atFromLocation,
  convergeFromLocation,
  expandedFromLocation,
  nextRuns,
  openSelection,
  pageFromLocation,
  panelFromQuery,
  planFromLocation,
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

const RUNS_POLL_MS = 5000;

type RunsAnswer = { runs: RunCard[] } | { error: string };

function pageVisible(): boolean {
  return document.visibilityState === 'visible';
}

function useRunsWatch(token: string, fetcher: typeof fetch, watching: boolean) {
  const [visible, setVisible] = useState(() => pageVisible());
  const polling = watching && visible;
  const query = useQuery({
    queryKey: ['runs', token] as const,
    queryFn: () => fetchRuns(token, fetcher),
    refetchInterval: polling ? RUNS_POLL_MS : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const { refetch, data, isPending, dataUpdatedAt } = query;
  const wasPolling = useRef(polling);
  useEffect(() => {
    const becameShown = polling && !wasPolling.current;
    wasPolling.current = polling;
    if (becameShown) void refetch({ cancelRefetch: false });
  }, [polling, refetch]);
  useEffect(() => {
    const update = () => setVisible(pageVisible());
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const queryClient = useQueryClient();
  const drop = (worktree: string) => {
    queryClient.setQueryData<RunsAnswer>(['runs', token], current => nextRuns(current, worktree), { updatedAt: dataUpdatedAt });
  };
  return { data, pending: isPending, now: dataUpdatedAt, drop };
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

function TabBar(props: Readonly<{ tab: Tab; running: number; onShowFiles: () => void; onShowArch: () => void; onShowRuns: () => void }>) {
  return (
    <div className="tabbar" role="tablist" aria-label="views">
      <button type="button" role="tab" aria-selected={props.tab === 'files'} onClick={props.onShowFiles}>
        Files
      </button>
      <button type="button" role="tab" aria-selected={props.tab === 'arch'} onClick={props.onShowArch}>
        Architecture
      </button>
      <button type="button" role="tab" aria-selected={props.tab === 'runs'} onClick={props.onShowRuns}>
        Runs
        {props.running > 0 && <span className="badge">{props.running}</span>}
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
  const [plan, setPlan] = useState(() => planFromLocation(props.location));
  const [converge, setConverge] = useState(() => convergeFromLocation(props.location));

  const treeQuery = useQuery({
    queryKey: ['tree', props.token] as const,
    queryFn: () => fetchTree(props.token, props.fetcher),
  });

  const { root, entries } = treeParts(treeQuery.data);
  const openPlan = (slug: string) => {
    setTab('arch');
    setPlan(slug);
    setConverge(null);
    writeHistory(props.historyApi, { kind: 'at', at, plan: slug });
  };
  const openConverge = (slug: string) => {
    setTab('arch');
    setPlan(slug);
    setConverge(slug);
    writeHistory(props.historyApi, { kind: 'at', at, plan: slug, converge: slug });
  };
  const watch = useRunsWatch(props.token, props.fetcher, tab === 'runs');
  const runs = useRunsPane({
    data: watch.data,
    pending: watch.pending,
    now: watch.now,
    at,
    token: props.token,
    fetcher: props.fetcher,
    onOpenPlan: openPlan,
    onConverge: openConverge,
    onGone: watch.drop,
  });

  useEffect(() => {
    applyTitle(document, root);
  }, [root]);

  const events = props.events ?? window;
  useEffect(() => {
    const onPop = () => {
      applyPage({ setTab, setAt, setSelected, setExpanded, setPlan }, pageFromLocation(props.location));
      setConverge(convergeFromLocation(props.location));
    };
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
    setConverge(null);
    writeHistory(props.historyApi, { kind: 'at', at, plan });
  };

  const showRuns = () => {
    setTab('runs');
    writeHistory(props.historyApi, { kind: 'runs' });
  };

  const drillTo = (dir: string) => {
    setTab('arch');
    setAt(dir);
    writeHistory(props.historyApi, { kind: 'at', at: dir, plan, converge });
  };

  const changePlan = (next: string | null) => {
    setPlan(next);
    setConverge(null);
    writeHistory(props.historyApi, { kind: 'at', at, plan: next });
  };

  const changeConverge = (next: string | null) => {
    setConverge(next);
    writeHistory(props.historyApi, { kind: 'at', at, plan, converge: next });
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

  const panes: Record<Tab, ReactElement> = {
    files: (
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
    ),
    arch: (
      <ArchView
        token={props.token}
        at={at}
        plan={plan}
        converge={converge}
        runs={watch.data}
        fetcher={props.fetcher}
        onDrill={drillTo}
        onOpenFile={openFile}
        onPlanChange={changePlan}
        onConverge={changeConverge}
      />
    ),
    runs: runs.pane,
  };

  return (
    <div className="page">
      <TabBar tab={tab} running={runs.running} onShowFiles={showFiles} onShowArch={showArch} onShowRuns={showRuns} />
      {panes[tab]}
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
