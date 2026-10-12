import type { PlanTask } from './plan.ts';

export type Slice = { title: string; slug: string; body: string };

export type TaskEdit =
  | { kind: 'up' | 'down' | 'merge' | 'split' | 'delete'; index: number }
  | { kind: 'title' | 'body'; index: number; text: string };

export type MarkdownBlock = { kind: 'h1' | 'h2' | 'p'; text: string };

export const LAST_TASK_NUMBER = 999;
const NUMBERED = /^(\d{3})-/;
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;

function numberOf(name: string): number {
  const match = NUMBERED.exec(name);
  return match === null ? 0 : Number(match[1]);
}

export function firstFreeNumber(names: string[]): number {
  return Math.max(0, ...names.map(numberOf)) + 1;
}

function padded(number: number): string {
  return String(number).padStart(3, '0');
}

function withoutHeading(body: string): string {
  if (!body.startsWith('# ')) return body;
  const end = body.indexOf('\n');
  return end === -1 ? '' : body.slice(end + 1);
}

function bodyRest(body: string): string {
  return withoutHeading(body).replace(LEADING_BLANK_LINES, '');
}

function taskAt(number: number, slug: string, title: string, body: string): PlanTask {
  return { file: `${padded(number)}-${slug}.md`, title, body: `# ${padded(number)} — ${title}\n\n${bodyRest(body)}` };
}

export function numberedTasks(slices: Slice[], first: number): PlanTask[] {
  return slices.map((slice, index) => taskAt(first + index, slice.slug, slice.title, slice.body));
}

function slugOfFile(file: string): string {
  return file.replace(NUMBERED, '').slice(0, -'.md'.length);
}

function renumbered(tasks: PlanTask[], first: number): PlanTask[] {
  return tasks.map((task, index) => taskAt(first + index, slugOfFile(task.file), task.title, task.body));
}

export function lastTaskNumber(tasks: PlanTask[]): number {
  return Math.max(0, ...tasks.map(task => numberOf(task.file)));
}

function swapped(tasks: PlanTask[], at: number): PlanTask[] {
  const next = [...tasks];
  next.splice(at, 2, tasks[at + 1], tasks[at]);
  return next;
}

function withoutTrailingNewlines(text: string): string {
  let end = text.length;
  while (text[end - 1] === '\n') end -= 1;
  return text.slice(0, end);
}

function mergedBody(first: PlanTask, second: PlanTask): string {
  return `${withoutTrailingNewlines(first.body)}\n\n${bodyRest(second.body)}`;
}

function merged(tasks: PlanTask[], at: number): PlanTask[] {
  const joined = { ...tasks[at], body: mergedBody(tasks[at], tasks[at + 1]) };
  return [...tasks.slice(0, at), joined, ...tasks.slice(at + 2)];
}

function replaced(tasks: PlanTask[], at: number, change: Partial<PlanTask>): PlanTask[] {
  return tasks.map((task, index) => (index === at ? { ...task, ...change } : task));
}

const LIST_EDITS: Record<TaskEdit['kind'], (tasks: PlanTask[], at: number, text: string) => PlanTask[]> = {
  up: (tasks, at) => swapped(tasks, at - 1),
  down: swapped,
  merge: merged,
  split: (tasks, at) => [...tasks.slice(0, at + 1), tasks[at], ...tasks.slice(at + 1)],
  delete: (tasks, at) => tasks.filter((_, index) => index !== at),
  title: (tasks, at, text) => replaced(tasks, at, { title: text }),
  body: (tasks, at, text) => replaced(tasks, at, { body: text }),
};

function lowestNumber(tasks: PlanTask[]): number {
  return Math.min(...tasks.map(task => numberOf(task.file)));
}

export function editTasks(tasks: PlanTask[], edit: TaskEdit): PlanTask[] {
  const text = 'text' in edit ? edit.text : '';
  return renumbered(LIST_EDITS[edit.kind](tasks, edit.index, text), lowestNumber(tasks));
}

type BlockState = { blocks: MarkdownBlock[]; lines: string[] };

function flushed(state: BlockState): BlockState {
  if (state.lines.length === 0) return state;
  return { blocks: [...state.blocks, { kind: 'p', text: state.lines.join('\n') }], lines: [] };
}

function headingOf(line: string): MarkdownBlock | null {
  if (line.startsWith('# ')) return { kind: 'h1', text: line.slice(2) };
  if (line.startsWith('## ')) return { kind: 'h2', text: line.slice(3) };
  return null;
}

function blockStep(state: BlockState, line: string): BlockState {
  const heading = headingOf(line);
  if (heading !== null) return { blocks: [...flushed(state).blocks, heading], lines: [] };
  if (line.trim() === '') return flushed(state);
  return { blocks: state.blocks, lines: [...state.lines, line] };
}

export function markdownBlocks(body: string): MarkdownBlock[] {
  let state: BlockState = { blocks: [], lines: [] };
  for (const line of body.split('\n')) state = blockStep(state, line);
  return flushed(state).blocks;
}
