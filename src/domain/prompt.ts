import { byStrings, everyRead, listOfAtLeast, pendingRound, recordOf, sentenceOf, stringsFrom, within, type FateEdit, type NoteTarget, type PlanDoc, type PlanEdit, type Question, type Round } from './plan.ts';
import type { PlanWarning, ScanResult } from './scan.ts';
import { LAST_TASK_NUMBER, numberedTasks, type Slice } from './tasks.ts';

export type GenerateAsk = { step: 'ask' } | { step: 'answer' | 'write'; answers: string[] };

export type Turn = { interview: Round[]; demanded: boolean };

export type Reply = { questions: Question[] } | { slices: Slice[]; brief: string };

export type PromptFacts = {
  doc: PlanDoc;
  scan: ScanResult;
  warnings: PlanWarning[];
  guide: string;
  names: string[];
  turn: Turn;
};

const BLANK_ANSWER = 'your call';
const LAST_ASKED_ROUND = 3;
const MAX_QUESTIONS = 5;
const SLICE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const JSON_BLOCK = /```json[^\n]*\n([\s\S]*?)```/g;
const INSTRUCTIONS = [
  'Order the slices so each leaves the repository working: leaves and new packages first, then moves, then cuts, then the contract.',
  'A slice that changes no behaviour says so in its first line and freezes everything else.',
  'Each slice names the files it touches, the imports that must be gone when it ends, the contract rules it makes pass, and what must not change.',
  'Write one thin slice per logical step.',
  'Reply with exactly one JSON object, in a fenced json block.',
];
const ASK_LINE = 'To ask, reply {"questions":[{"id":"<id>","text":"<question>","why":"<why you ask>"}]} with at most 5 questions.';
const WRITE_LINE = 'To write, reply {"slices":[{"title":"<title>","slug":"<slug>","body":"<markdown>"}],"brief":"<markdown>"}.';
const DEMAND_LINE = 'Reply with slices now.';

function keysOf(rec: Record<string, unknown>): string {
  return Object.keys(rec).sort(byStrings).join(',');
}

function answeredStep(raw: unknown): 'answer' | 'write' | undefined {
  return raw === 'answer' || raw === 'write' ? raw : undefined;
}

function answeredAsk(rec: Record<string, unknown>): GenerateAsk | undefined {
  const answers = stringsFrom(rec.answers);
  const step = answeredStep(rec.step);
  if (keysOf(rec) !== 'answers,step' || answers === undefined || step === undefined) return undefined;
  return { step, answers };
}

export function generateAskFrom(raw: unknown): GenerateAsk | undefined {
  const rec = recordOf(raw) ?? {};
  if (rec.step === 'ask') return keysOf(rec) === 'step' ? { step: 'ask' } : undefined;
  return answeredAsk(rec);
}

function shownAnswer(answer: string): string {
  return answer.trim() === '' ? BLANK_ANSWER : answer;
}

function filled(interview: Round[], answers: string[]): Round[] {
  return interview.map((round, index) => (index === interview.length - 1 ? { ...round, answers: answers.map(shownAnswer) } : round));
}

function answerTurn(interview: Round[], answers: string[]): Turn | undefined {
  const pending = pendingRound(interview);
  if (pending?.questions.length !== answers.length) return undefined;
  return { interview: filled(interview, answers), demanded: pending.round >= LAST_ASKED_ROUND };
}

function writeTurn(interview: Round[], answers: string[]): Turn | undefined {
  const pending = pendingRound(interview);
  if (pending === undefined) return answers.length === 0 ? { interview, demanded: true } : undefined;
  return pending.questions.length === answers.length ? { interview: filled(interview, answers), demanded: true } : undefined;
}

export function turnFor(ask: GenerateAsk, interview: Round[] = []): Turn | undefined {
  if (ask.step === 'ask') return { interview: [], demanded: false };
  return ask.step === 'answer' ? answerTurn(interview, ask.answers) : writeTurn(interview, ask.answers);
}

function fatePaths(edit: FateEdit): string[] {
  return edit.fate === 'fold' ? [edit.file, edit.into] : [edit.file];
}

function notePaths(target: NoteTarget): string[] {
  return 'node' in target ? [target.node] : [...target.edge];
}

type Reshaping = Exclude<PlanEdit, { kind: 'cut-edge' | 'add-edge' | 'note' | 'move-file' | 'fate' | 'create-package' }>;

function reshapedPaths(edit: Reshaping): string[] {
  if (edit.kind === 'merge-packages') return edit.packages;
  if (edit.kind === 'split-package') return [edit.package];
  return [edit.from];
}

function placedPaths(edit: Exclude<PlanEdit, { kind: 'cut-edge' | 'add-edge' | 'note' }>): string[] {
  if (edit.kind === 'move-file') return [edit.file];
  if (edit.kind === 'fate') return fatePaths(edit);
  return edit.kind === 'create-package' ? [] : reshapedPaths(edit);
}

function editPaths(edit: PlanEdit): string[] {
  if (edit.kind === 'cut-edge') return edit.files.flat();
  if (edit.kind === 'add-edge') return [edit.from, edit.to];
  return edit.kind === 'note' ? notePaths(edit.target) : placedPaths(edit);
}

function sortedUnique(items: string[]): string[] {
  return [...new Set(items)].sort(byStrings);
}

function touchedFiles(edits: PlanEdit[], files: string[]): string[] {
  const paths = edits.flatMap(editPaths);
  return sortedUnique(files.filter(file => paths.some(path => within(path, file))));
}

function listedOrNothing(items: string[]): string {
  return items.length === 0 ? 'nothing' : items.join(', ');
}

function importLines(scan: ScanResult, file: string): string[] {
  const imports = sortedUnique(scan.edges.filter(edge => edge.from === file).map(edge => edge.to));
  const importers = sortedUnique(scan.edges.filter(edge => edge.to === file).map(edge => edge.from));
  return [`${file} imports ${listedOrNothing(imports)}`, `${file} is imported by ${listedOrNothing(importers)}`];
}

function deletedLine(warning: Extract<PlanWarning, { kind: 'deleted-imports' }>): string {
  const count = warning.importers.length;
  if (count === 1) return `1 file still imports ${warning.file}, which this plan deletes`;
  return `${count} files still import ${warning.file}, which this plan deletes`;
}

function warningLine(warning: PlanWarning): string {
  if (warning.kind === 'empty-package') return `${warning.path} is empty`;
  if (warning.kind === 'added-cycle') return `this plan adds a cycle: ${warning.cycle}`;
  return deletedLine(warning);
}

function answeredLines(round: Round): string[] {
  return round.questions.slice(0, round.answers.length).flatMap((question, index) => [`Q: ${question.text}`, `A: ${round.answers[index]}`]);
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...(lines.length === 0 ? ['none'] : lines)].join('\n');
}

function replyLines(demanded: boolean): string[] {
  return demanded ? [...INSTRUCTIONS, WRITE_LINE, DEMAND_LINE] : [...INSTRUCTIONS, ASK_LINE, WRITE_LINE];
}

export function promptOf(facts: PromptFacts): string {
  const files = facts.scan.files.map(file => file.path);
  return [
    `You are turning the refactoring plan "${facts.doc.name}" into ordered marestail task files and a slop-cannon brief. Ask about gaps in values, what must not change and the order of work, or write the slices.`,
    section("The plan's edits", [...facts.doc.edits.map(sentenceOf), JSON.stringify(facts.doc.edits)]),
    section('Warnings about the planned graph', facts.warnings.map(warningLine)),
    section('Contract rules', (facts.doc.contract?.rules ?? []).map(rule => `${rule.name}: ${rule.comment}`)),
    section('Files the plan touches', touchedFiles(facts.doc.edits, files).flatMap(file => importLines(facts.scan, file))),
    section('How this repository writes tasks', [facts.guide]),
    section('Files already in tasks/', facts.names),
    section('The interview so far', facts.turn.interview.flatMap(answeredLines)),
    section('What to do', replyLines(facts.turn.demanded)),
  ].join('\n\n');
}

export function retryPrompt(prompt: string, problem: string): string {
  return `${prompt}\n\nYour last reply was not usable: ${problem}`;
}

function replyText(stdout: string): string {
  const blocks = [...stdout.matchAll(JSON_BLOCK)];
  return blocks.at(-1)?.[1] ?? stdout;
}

function parsed(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function filledString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

function questionFields(id: string | undefined, text: string | undefined, why: string | undefined): Question | undefined {
  if (id === undefined || text === undefined || why === undefined) return undefined;
  return { id, text, why };
}

function questionOf(raw: unknown): Question | undefined {
  const rec = recordOf(raw) ?? {};
  return questionFields(filledString(rec.id), filledString(rec.text), filledString(rec.why));
}

function sliceSlug(raw: unknown): string | undefined {
  return typeof raw === 'string' && SLICE_SLUG.test(raw) ? raw : undefined;
}

function sliceFields(title: string | undefined, slug: string | undefined, body: unknown): Slice | undefined {
  if (title === undefined || slug === undefined || typeof body !== 'string') return undefined;
  return { title, slug, body };
}

function sliceOf(raw: unknown): Slice | undefined {
  const rec = recordOf(raw) ?? {};
  return sliceFields(filledString(rec.title), sliceSlug(rec.slug), rec.body);
}

function everyOfOneOrMore<T>(raw: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  return everyRead(listOfAtLeast(raw, 1), read);
}

function questionsReply(raw: unknown, demanded: boolean): Reply | { problem: string } {
  if (demanded) return { problem: 'it asked questions, but slices were demanded' };
  const questions = everyOfOneOrMore(raw, questionOf);
  if (questions === undefined || questions.length > MAX_QUESTIONS) return { problem: 'it needs 1 to 5 questions, each with a non-empty id, text and why' };
  return { questions };
}

function slicesReply(rec: Record<string, unknown>): Reply | { problem: string } {
  const slices = everyOfOneOrMore(rec.slices, sliceOf);
  if (slices === undefined || typeof rec.brief !== 'string') {
    return { problem: 'it needs at least one slice, each with a non-empty title, a slug of a-z, 0-9 and dashes, and a body, plus a string brief' };
  }
  return { slices, brief: rec.brief };
}

function shapedReply(value: unknown, demanded: boolean): Reply | { problem: string } {
  const rec = recordOf(value) ?? {};
  if ('slices' in rec) return slicesReply(rec);
  if ('questions' in rec) return questionsReply(rec.questions, demanded);
  return { problem: 'it is neither {"questions":[...]} nor {"slices":[...],"brief":"..."}' };
}

export function readReply(stdout: string, demanded: boolean): Reply | { problem: string } {
  const json = parsed(replyText(stdout));
  if (json === undefined) return { problem: 'it is not valid JSON' };
  return shapedReply(json.value, demanded);
}

function askedPlan(doc: PlanDoc, turn: Turn, questions: Question[]): PlanDoc {
  return { ...doc, interview: [...turn.interview, { round: turn.interview.length + 1, questions, answers: [] }] };
}

export function planAfter(doc: PlanDoc, turn: Turn, reply: Reply, first: number): PlanDoc | { error: string } {
  if ('questions' in reply) return askedPlan(doc, turn, reply.questions);
  if (first + reply.slices.length - 1 > LAST_TASK_NUMBER) return { error: 'task numbers would pass 999' };
  return { ...doc, interview: turn.interview, tasks: numberedTasks(reply.slices, first), brief: reply.brief };
}
