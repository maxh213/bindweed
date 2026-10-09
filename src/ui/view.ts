import type { GraphView } from '../domain/graph.ts';
import { decodeHashPath, encodeHashPath } from '../domain/lines.ts';
import { withParentsOpen, type TreeEntry, type TreeRoot } from '../domain/tree.ts';
import { panelFromFile, type FilePanelState } from './FilePanel.tsx';

export function selectedFromLocation(location: Location): string | null {
  const encoded = fileHashFrom(location);
  if (encoded === null) return null;
  return decodeHashPath(encoded);
}

export function expandedFromLocation(location: Location): Set<string> {
  const path = selectedFromLocation(location);
  if (path !== null) return withParentsOpen(new Set(), path);
  const opened = new Set<string>();
  opened.add('');
  return opened;
}

export function treeParts(data: TreeRoot | { error: string } | undefined): {
  root: string;
  entries: TreeEntry[];
} {
  if (data === undefined || 'error' in data) return { root: '', entries: [] };
  return { root: data.root, entries: data.entries };
}

function titleForRoot(root: string): string | undefined {
  if (root === '') return undefined;
  return 'bindweed — '.concat(root);
}

export function applyTitle(doc: { title: string }, root: string): void {
  const title = titleForRoot(root);
  if (title === undefined) return;
  doc.title = title;
}

export function panelFromQuery(
  selected: string | null,
  data: { path: string; text: string } | { path: string; binary: true } | { error: string } | undefined,
  pending: boolean,
): FilePanelState {
  if (selected === null) return { kind: 'idle' };
  if (pending || data === undefined) return { kind: 'loading', path: selected };
  return panelFromFile(selected, data);
}

export type Tab = 'files' | 'arch';

export type GraphState =
  | { kind: 'loading' }
  | { kind: 'message'; message: string }
  | { kind: 'ok'; view: GraphView };

export function tabFromLocation(location: Location): Tab {
  return atHashFrom(location) === null ? 'files' : 'arch';
}

export function atFromLocation(location: Location): string {
  const encoded = atHashFrom(location);
  return encoded === null ? '' : decodeHashPath(encoded);
}

export function planFromLocation(location: Location): string | null {
  const encoded = planHashFrom(location);
  if (encoded === null || encoded === '') return null;
  return decodeHashPath(encoded);
}

export type PageState = { tab: Tab; at: string; selected: string | null; plan: string | null };

export function pageFromLocation(location: Location): PageState {
  if (atHashFrom(location) !== null) return { tab: 'arch', at: atFromLocation(location), selected: null, plan: planFromLocation(location) };
  return { tab: 'files', at: '', selected: selectedFromLocation(location), plan: null };
}

export type PageActions = {
  setTab(tab: Tab): void;
  setAt(at: string): void;
  setSelected(path: string | null): void;
  setExpanded(update: (current: Set<string>) => Set<string>): void;
  setPlan(plan: string | null): void;
};

export function openSelection(actions: Pick<PageActions, 'setSelected' | 'setExpanded'>, selected: string): void {
  actions.setSelected(selected);
  actions.setExpanded(current => withParentsOpen(current, selected));
}

export function applyPage(actions: PageActions, page: PageState): void {
  actions.setTab(page.tab);
  actions.setAt(page.at);
  actions.setPlan(page.plan);
  if (page.selected === null) return;
  openSelection(actions, page.selected);
}

export function graphStateOf(data: GraphView | { error: string } | undefined, pending: boolean): GraphState {
  if (pending || data === undefined) return { kind: 'loading' };
  if ('error' in data) return { kind: 'message', message: data.error };
  return { kind: 'ok', view: data };
}

const FILE_HASH_PREFIX = '#file=';
const AT_HASH_PREFIX = '#at=';

type HistoryWrite =
  | { kind: 'file'; path: string; mode: 'push' | 'replace' }
  | { kind: 'at'; at: string; plan?: string | null }
  | { kind: 'path'; pathname: string };

function hashParts(hash: string): Map<string, string> {
  const parts = new Map<string, string>();
  if (!hash.startsWith('#')) return parts;
  for (const piece of hash.slice(1).split('&')) {
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    parts.set(piece.slice(0, eq), piece.slice(eq + 1));
  }
  return parts;
}

function hashValue(location: Location, key: string): string | null {
  return hashParts(location.hash).get(key) ?? null;
}

function fileHashFrom(location: Location): string | null {
  return hashValue(location, 'file');
}

function atHashFrom(location: Location): string | null {
  return hashValue(location, 'at');
}

function planHashFrom(location: Location): string | null {
  return hashValue(location, 'plan');
}

function fileHash(path: string): string {
  return `${FILE_HASH_PREFIX}${encodeHashPath(path)}`;
}

function atHash(at: string, plan?: string | null): string {
  const base = `${AT_HASH_PREFIX}${encodeHashPath(at)}`;
  return plan === undefined || plan === null || plan === '' ? base : `${base}&plan=${encodeHashPath(plan)}`;
}

function pushState(history: History, url: string): void {
  history.pushState(null, '', url);
}

function replaceState(history: History, url: string): void {
  history.replaceState(null, '', url);
}

function pushOther(history: History, write: Exclude<HistoryWrite, { kind: 'file' }>): void {
  switch (write.kind) {
    case 'at':
      pushState(history, atHash(write.at, write.plan));
      return;
    case 'path':
      pushState(history, write.pathname);
  }
}

export function writeHistory(history: History, write: HistoryWrite): void {
  if (write.kind === 'file') {
    switch (write.mode) {
      case 'replace':
        replaceState(history, fileHash(write.path));
        return;
      case 'push':
        pushState(history, fileHash(write.path));
    }
    return;
  }
  pushOther(history, write);
}
