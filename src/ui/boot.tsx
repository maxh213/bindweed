import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { takeToken } from './client.ts';

export function bootUi(doc: Document, loc: Location, storage: Storage, hist: History): void {
  const token = takeToken(loc, storage, hist);
  const root = doc.getElementById('root');
  if (root === null || token === null) return;
  createRoot(root).render(
    <App token={token} location={loc} historyApi={hist} fetcher={fetch} />,
  );
}
