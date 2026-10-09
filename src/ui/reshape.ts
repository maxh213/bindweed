import { childPath, lastSegment, legalName, parentOf, within } from '../domain/plan.ts';

type NamedBox = { id: string; name: string };

export type SplitForm = { pkg: string; names: string[]; files: string[]; assigned: Record<string, string>; taken: Set<string> };

export function nameProblem(name: string): string | null {
  return legalName(name) ? null : 'bad name';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

export function fileRenameName(file: string, typed: string): string {
  if (typed.includes('.')) return typed;
  return `${typed}${extensionOf(lastSegment(file))}`;
}

export function siblingPath(id: string, name: string): string {
  return childPath(parentOf(id), name);
}

export function mergeTarget(name: string, at: string, selected: NamedBox[]): string {
  return selected.find(box => box.name === name)?.id ?? childPath(at, name);
}

export function takenProblem(path: string, taken: Set<string>): string | null {
  return taken.has(path) ? `${path} already exists` : null;
}

function namedParts(names: string[]): string[] {
  return names.map(name => name.trim()).filter(name => name !== '');
}

function namesProblem(named: string[]): string | null {
  if (named.length < 2) return 'name at least two parts';
  if (!named.every(legalName)) return 'bad name';
  return new Set(named).size === named.length ? null : 'duplicate part';
}

function partTaken(path: string, form: SplitForm): boolean {
  return form.taken.has(path) || form.files.some(file => within(path, file));
}

function partsProblem(named: string[], form: SplitForm): string | null {
  if (!form.files.every(file => named.includes(form.assigned[file] ?? ''))) return 'assign every file';
  const clash = named.map(name => `${form.pkg}/${name}`).find(path => partTaken(path, form));
  return clash === undefined ? null : `${clash} already exists`;
}

export function splitProblem(form: SplitForm): string | null {
  const named = namedParts(form.names);
  return namesProblem(named) ?? partsProblem(named, form);
}

export function splitParts(form: SplitForm): { name: string; files: string[] }[] {
  return namedParts(form.names).map(name => ({ name, files: form.files.filter(file => form.assigned[file] === name) }));
}

export function relativeTo(pkg: string, file: string): string {
  return file.slice(pkg.length + 1);
}
