import { childPath, lastSegment, legalName, parentOf, splitPartPath, within, type PlanEdit } from '../domain/plan.ts';

type NamedBox = { id: string; name: string };

export type NameAsk = { mode: 'create' } | { mode: 'rename'; id: string; kind: 'package' | 'file' } | { mode: 'merge' };

export type Scene = { at: string; taken: Set<string>; selected: NamedBox[] };

export type SplitForm = { pkg: string; names: string[]; files: string[]; assigned: Record<string, string>; taken: Set<string> };

export type Reshaped = { problem: string } | { edit: PlanEdit | null };

function settled(problem: string | null, edit: PlanEdit): Reshaped {
  return problem === null ? { edit } : { problem };
}

function nameProblem(name: string): string | null {
  return legalName(name) ? null : 'bad name';
}

function takenProblem(path: string, taken: Set<string>): string | null {
  return taken.has(path) ? `${path} already exists` : null;
}

function freshProblem(name: string, path: string, taken: Set<string>): string | null {
  return nameProblem(name) ?? takenProblem(path, taken);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

function fileRenameName(file: string, typed: string): string {
  if (typed.includes('.')) return typed;
  return `${typed}${extensionOf(lastSegment(file))}`;
}

function siblingPath(id: string, name: string): string {
  return childPath(parentOf(id), name);
}

function created(name: string, scene: Scene): Reshaped {
  const path = childPath(scene.at, name);
  return settled(freshProblem(name, path, scene.taken), { kind: 'create-package', path });
}

function renamedTo(id: string, name: string, scene: Scene, edit: PlanEdit): Reshaped {
  const dest = siblingPath(id, name);
  if (dest === id) return { edit: null };
  return settled(freshProblem(name, dest, scene.taken), edit);
}

function renamed(id: string, kind: 'package' | 'file', typed: string, scene: Scene): Reshaped {
  if (kind === 'package') return renamedTo(id, typed, scene, { kind: 'rename-package', from: id, to: siblingPath(id, typed) });
  const name = fileRenameName(id, typed);
  return renamedTo(id, name, scene, { kind: 'rename-file', from: id, to: name });
}

function mergeTarget(name: string, scene: Scene): string {
  return scene.selected.find(box => box.name === name)?.id ?? childPath(scene.at, name);
}

function merged(name: string, scene: Scene): Reshaped {
  const into = mergeTarget(name, scene);
  const packages = scene.selected.map(box => box.id);
  const clash = packages.includes(into) ? null : takenProblem(into, scene.taken);
  return settled(nameProblem(name) ?? clash, { kind: 'merge-packages', packages, into });
}

function addAncestors(at: string, parent: string, taken: Set<string>): void {
  if (!parent.startsWith(`${at}/`)) return;
  taken.add(parent);
  addAncestors(at, parentOf(parent), taken);
}

type TakenBox = { id: string; kind: string; files?: number };

type NamedWarning = { kind: string; path?: string };

function mergeClash(box: TakenBox): boolean {
  if (box.kind !== 'package') return true;
  return box.files !== 0;
}

function holdsFile(box: TakenBox): boolean {
  return box.kind !== 'package' || box.files !== 0;
}

function takeBox(at: string, box: TakenBox, empty: ReadonlySet<string>, taken: Set<string>): void {
  if (holdsFile(box)) {
    taken.add(box.id);
    addAncestors(at, parentOf(box.id), taken);
    return;
  }
  if (empty.has(box.id)) taken.add(box.id);
}

function declaredPath(warning: NamedWarning): string[] {
  if (warning.kind !== 'empty-package' || warning.path === undefined) return [];
  return [warning.path];
}

export function declaredPaths(warnings: readonly NamedWarning[][]): string[] {
  return warnings.flat().flatMap(declaredPath);
}

export function nameTaken(at: string, boxes: readonly TakenBox[], mode: NameAsk['mode'], empty: readonly string[]): Set<string> {
  if (mode === 'merge') return new Set(boxes.filter(mergeClash).map(box => box.id));
  const taken = new Set<string>();
  const declared = new Set(empty);
  for (const box of boxes) takeBox(at, box, declared, taken);
  return taken;
}

export function nameEdit(ask: NameAsk, typed: string, scene: Scene): Reshaped {
  if (ask.mode === 'create') return created(typed, scene);
  if (ask.mode === 'merge') return merged(typed, scene);
  return renamed(ask.id, ask.kind, typed, scene);
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
  const clash = named.map(name => splitPartPath(form.pkg, name)).find(path => partTaken(path, form));
  return clash === undefined ? null : `${clash} already exists`;
}

export function splitEdit(form: SplitForm): Reshaped {
  const named = namedParts(form.names);
  const parts = named.map(name => ({ name, files: form.files.filter(file => form.assigned[file] === name) }));
  return settled(namesProblem(named) ?? partsProblem(named, form), { kind: 'split-package', package: form.pkg, parts });
}

export function splitRows(pkg: string, files: string[]): { path: string; label: string }[] {
  return files.map(path => ({ path, label: path.slice(pkg.length + 1) }));
}
