import { byStrings, noExtraKeys, pathAfter, recordOf, within, type PlanDoc, type PlanEdit } from './plan.ts';

export type LaunchBody =
  | { tool: 'marestail'; model: string; scope: string; focus: string; stopAt: string }
  | { tool: 'slop-cannon'; safety: 'on' | 'off'; ammo: string; cartridge: string };

export type LaunchInfo = { marestail: boolean; sc: boolean; alive: boolean; focus: string; worktree?: string; branch?: string; watch?: string };
export type LaunchResult = { steps: { name: string; ok: boolean; error?: string }[]; worktree?: string; branch?: string; watch?: string; pid?: number };

const FIELDS = new Map<string, string[]>([['marestail', ['model', 'scope', 'focus', 'stopAt']], ['slop-cannon', ['safety', 'ammo', 'cartridge']]]);

function fieldsOk(rec: Record<string, unknown>, fields: string[]): boolean {
  return noExtraKeys(rec, ['tool', ...fields]) && fields.every(field => typeof rec[field] === 'string');
}

function safetyOk(rec: Record<string, unknown>): boolean {
  return rec.tool !== 'slop-cannon' || ['on', 'off'].includes(String(rec.safety));
}

function bodyFieldsOk(rec: Record<string, unknown>, fields: string[]): boolean {
  return fieldsOk(rec, fields) && safetyOk(rec);
}

function toolFields(rec: Record<string, unknown>): string[] | undefined {
  return typeof rec.tool === 'string' ? FIELDS.get(rec.tool) : undefined;
}

export function launchBody(raw: unknown): LaunchBody | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  const fields = toolFields(rec);
  if (fields === undefined || !bodyFieldsOk(rec, fields)) return undefined;
  return Object.fromEntries(Object.entries(rec).map(([key, value]) => [key, String(value).trim()])) as LaunchBody;
}

export function launchReason(info: LaunchInfo, doc: PlanDoc, tool: LaunchBody['tool']): string | null {
  const command = tool === 'marestail' ? 'marestail' : 'sc';
  if (!info[command]) return `${command} is not on PATH`;
  if (info.alive) return 'a run for this plan is still alive';
  return contentReason(doc, tool);
}

function contentReason(doc: PlanDoc, tool: LaunchBody['tool']): string | null {
  if (tool === 'marestail') return tasksReason(doc.tasks);
  return briefReason(doc.brief);
}

function tasksReason(tasks: PlanDoc['tasks']): string | null {
  return (tasks ?? []).length === 0 ? 'this plan has no tasks' : null;
}

function briefReason(brief: PlanDoc['brief']): string | null {
  return (brief ?? '').trim() === '' ? 'this plan has no brief' : null;
}

function fatePaths(edit: Extract<PlanEdit, { kind: 'fate' }>): string[] {
  return edit.fate === 'fold' ? [edit.file, edit.into] : [edit.file];
}

function reshapePaths(edit: Exclude<PlanEdit, { kind: 'cut-edge' | 'note' | 'fate' | 'move-file' | 'add-edge' | 'create-package' }>): string[] {
  if (edit.kind === 'merge-packages') return edit.packages;
  if (edit.kind === 'split-package') return [edit.package];
  return [edit.from];
}

function placedPaths(edit: Exclude<PlanEdit, { kind: 'cut-edge' | 'note' | 'fate' }>): string[] {
  if (edit.kind === 'create-package') return [];
  if (edit.kind === 'move-file') return [edit.file];
  return edit.kind === 'add-edge' ? [edit.from, edit.to] : reshapePaths(edit);
}

function notePaths(target: Extract<PlanEdit, { kind: 'note' }>['target']): string[] {
  return 'node' in target ? [target.node] : target.edge;
}

function editPaths(edit: PlanEdit): string[] {
  if (edit.kind === 'cut-edge') return edit.files.flat();
  if (edit.kind === 'fate') return fatePaths(edit);
  if (edit.kind === 'note') return notePaths(edit.target);
  return placedPaths(edit);
}

function deletes(edit: PlanEdit, path: string): boolean {
  return edit.kind === 'fate' && edit.fate === 'delete' && edit.file === path;
}

function carried(path: string | null, edit: PlanEdit): string | null {
  if (path === null) return null;
  if (deletes(edit, path)) return null;
  return pathAfter(edit, path);
}

function plannedPath(file: string, active: PlanEdit[]): string | null {
  let path: string | null = file;
  for (const edit of active) path = carried(path, edit);
  return path;
}

export function launchFocus(files: string[], edits: PlanEdit[], stale: (string | null)[]): string {
  const named = edits.flatMap(editPaths);
  const current = files.filter(file => named.some(path => within(path, file)));
  const active = edits.filter((_edit, index) => stale[index] === null);
  const planned = current.map(file => plannedPath(file, active)).filter(path => path !== null);
  const created = active.flatMap(edit => edit.kind === 'create-package' ? [edit.path] : []);
  return [...new Set([...current, ...planned, ...created])].sort(byStrings).join(' ');
}
