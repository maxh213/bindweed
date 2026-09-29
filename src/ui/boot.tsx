import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { takeToken } from './client.ts';

export function bootUi(doc: Document, loc: Location, storage: Storage, hist: History): boolean {
  const token = takeToken(loc, storage, hist);
  if (token === null) return false;
  const root = doc.getElementById('root');
  if (root === null) return false;
  createRoot(root).render(
    <App token={token} location={loc} historyApi={hist} fetcher={fetch} />,
  );
  return true;
}
