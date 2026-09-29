import { decodeHashPath } from '../domain/lines.ts';
import { withParentsOpen } from '../domain/tree.ts';
import { fileHashFrom, type FileJson, type TreeJson } from './client.ts';
import { panelFromFile, type FilePanelState } from './FilePanel.tsx';

export function selectedFromLocation(location: Location): string | null {
  const encoded = fileHashFrom(location);
  if (encoded === null) return null;
  return decodeHashPath(encoded);
}

export function expandedFromLocation(location: Location): Set<string> {
  const path = selectedFromLocation(location);
  if (path === null) return new Set(['']);
  return withParentsOpen(new Set(['']), path);
}

export function treeParts(data: TreeJson | { error: string } | undefined): {
  root: string;
  entries: TreeJson['entries'];
} {
  if (data === undefined || 'error' in data) return { root: '', entries: [] };
  return { root: data.root, entries: data.entries };
}

export function panelFromQuery(
  selected: string | null,
  data: FileJson | undefined,
  pending: boolean,
): FilePanelState {
  if (selected === null) return { kind: 'idle' };
  if (pending || data === undefined) return { kind: 'loading', path: selected };
  return panelFromFile(selected, data);
}
