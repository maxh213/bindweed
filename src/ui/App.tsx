import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { encodeHashPath } from '../domain/lines.ts';
import { togglePath } from '../domain/tree.ts';
import { fetchFile, fetchTree, writeFileHash } from './client.ts';
import { FilePanel } from './FilePanel.tsx';
import { TreeView } from './TreeView.tsx';
import { expandedFromLocation, panelFromQuery, selectedFromLocation, treeParts } from './view.ts';

export type AppProps = {
  token: string;
  location: Location;
  historyApi: History;
  fetcher: typeof fetch;
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

type FileLoaderProps = Readonly<{
  token: string;
  path: string;
  fetcher: typeof fetch;
}>;

function FileLoader(props: FileLoaderProps) {
  const fileQuery = useQuery({
    queryKey: ['file', props.token, props.path],
    queryFn: () => fetchFile(props.token, props.path, props.fetcher),
  });
  return <FilePanel state={panelFromQuery(props.path, fileQuery.data, fileQuery.isPending)} />;
}

function BrowserApp(props: Readonly<AppProps>) {
  const [expanded, setExpanded] = useState(() => expandedFromLocation(props.location));
  const [selected, setSelected] = useState(() => selectedFromLocation(props.location));

  const treeQuery = useQuery({
    queryKey: ['tree', props.token],
    queryFn: () => fetchTree(props.token, props.fetcher),
  });

  const { root, entries } = treeParts(treeQuery.data);

  useEffect(() => {
    if (root.length > 0) document.title = `bindweed — ${root}`;
  }, [root]);

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
            writeFileHash(props.historyApi, path, encodeHashPath);
            setSelected(path);
          }}
        />
      </aside>
      <main style={{ flex: 1, padding: 16 }}>
        {selected === null ? <FilePanel state={{ kind: 'idle' }} /> : (
          <FileLoader token={props.token} path={selected} fetcher={props.fetcher} />
        )}
      </main>
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
