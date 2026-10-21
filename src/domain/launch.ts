import { byStrings, pathAfter, pathsOf, within, type PlanDoc, type PlanEdit } from './plan.ts';

export type LaunchBody =
  | { tool: 'marestail'; model: string; scope: string; focus: string; stopAt: string }
  | { tool: 'slop-cannon'; safety: 'on' | 'off'; ammo: string; cartridge: string };

export type LaunchInfo = { marestail: boolean; sc: boolean; alive: boolean; focus: string; worktree?: string; branch?: string; watch?: string };
export type LaunchResult = { steps: { name: string; ok: boolean; error?: string }[]; worktree?: string; branch?: string; watch?: string; pid?: number };

function assertNever(value: never): never {
  throw new Error(`unexpected tool ${JSON.stringify(value)}`);
}

function toolNeeds(doc: PlanDoc, tool: LaunchBody['tool']): ['marestail' | 'sc', string | null] {
  switch (tool) {
    case 'marestail':
      return ['marestail', tasksReason(doc.tasks)];
    case 'slop-cannon':
      return ['sc', briefReason(doc.brief)];
    default:
      return assertNever(tool);
  }
}

export function launchReason(info: LaunchInfo, doc: PlanDoc, tool: LaunchBody['tool']): string | null {
  const [command, content] = toolNeeds(doc, tool);
  if (!info[command]) return `${command} is not on PATH`;
  if (info.alive) return 'a run for this plan is still alive';
  return content;
}

function tasksReason(tasks: PlanDoc['tasks']): string | null {
  return (tasks ?? []).length === 0 ? 'this plan has no tasks' : null;
}

function briefReason(brief: PlanDoc['brief']): string | null {
  return (brief ?? '').trim() === '' ? 'this plan has no brief' : null;
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
  const named = edits.flatMap(pathsOf);
  const current = files.filter(file => named.some(path => within(path, file)));
  const active = edits.filter((_edit, index) => stale[index] === null);
  const planned = current.map(file => plannedPath(file, active)).filter(path => path !== null);
  const created = active.flatMap(edit => edit.kind === 'create-package' ? [edit.path] : []);
  return [...new Set([...current, ...planned, ...created])].sort(byStrings).join(' ');
}
