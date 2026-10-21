import { chatLines, oneParagraph, type ChatTurn } from './chat.ts';
import { byStrings, everyRead, listOfAtLeast, pathsOf, pendingRound, recordOf, sentenceOf, stringsFrom, within, type PlanDoc, type PlanEdit, type Question, type Round } from './plan.ts';
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

function sortedUnique(items: string[]): string[] {
  return [...new Set(items)].sort(byStrings);
}

function touchedFiles(edits: PlanEdit[], files: string[]): string[] {
  const paths = edits.flatMap(pathsOf);
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

export type PromptNode = {
  id: string;
  kind: string;
  name: string;
  files?: number;
  ca: number;
  ce: number;
  i: string;
  a: string;
  d: string;
  zone?: string;
  crap?: number | '–';
  coverage?: string;
  mutants?: number;
  cycle: boolean;
};

export type PromptEdge = {
  from: string;
  to: string;
  runtime: number;
  type: number;
  heritage?: number;
  cycle: boolean;
  cycleText?: string;
};

export type PromptView = { at: string; nodes: PromptNode[]; edges: PromptEdge[] };

export type ProposeFacts = {
  name: string;
  text: string;
  at: string;
  views: PromptView[];
  edits: PlanEdit[];
  turns: ChatTurn[];
};

export type Proposal = { summary: string; edits: unknown[] };

const EDIT_JSON = [
  '{"kind":"move-file","file":"<path>","to":"<dir>"}',
  '{"kind":"cut-edge","from":"<box>","to":"<box>","files":[["<file>","<file>"]]}',
  '{"kind":"add-edge","from":"<box>","to":"<box>"}',
  '{"kind":"note","target":{"node":"<box>"},"text":"<text>"}',
  '{"kind":"note","target":{"edge":["<box>","<box>"]},"text":"<text>"}',
  '{"kind":"create-package","path":"<path>"}',
  '{"kind":"rename-package","from":"<path>","to":"<path>"}',
  '{"kind":"rename-file","from":"<path>","to":"<name>"}',
  '{"kind":"merge-packages","packages":["<path>"],"into":"<path>"}',
  '{"kind":"split-package","package":"<path>","parts":[{"name":"<name>","files":["<path>"]}]}',
  '{"kind":"fate","file":"<path>","fate":"delete"}',
  '{"kind":"fate","file":"<path>","fate":"fold","into":"<path>"}',
];

const PROPOSE_REPLY = ['Reply with exactly one JSON object, in a fenced json block.', '{"summary":"<one paragraph>","edits":[<edit>]}'];

function filesPart(node: PromptNode): string {
  return node.files === undefined ? '' : ` files ${node.files}`;
}

function zonePart(node: PromptNode): string {
  return node.zone === undefined ? '' : ` zone ${node.zone}`;
}

function crapPart(node: PromptNode): string {
  return node.crap === undefined ? '' : ` crap ${node.crap}`;
}

function coveragePart(node: PromptNode): string {
  return node.coverage === undefined ? '' : ` coverage ${node.coverage}`;
}

function mutantsPart(node: PromptNode): string {
  return node.mutants === undefined ? '' : ` mutants ${node.mutants}`;
}

function nodeLine(node: PromptNode): string {
  const metrics = `ca ${node.ca} ce ${node.ce} i ${node.i} a ${node.a} d ${node.d}`;
  const health = `${zonePart(node)}${crapPart(node)}${coveragePart(node)}${mutantsPart(node)}`;
  return `node ${node.id} ${node.kind} ${node.name}${filesPart(node)} ${metrics}${health} cycle ${node.cycle}`;
}

function heritagePart(edge: PromptEdge): string {
  return (edge.heritage ?? 0) > 0 ? ` heritage ${edge.heritage}` : '';
}

function textPart(edge: PromptEdge): string {
  return edge.cycleText === undefined ? '' : ` text ${edge.cycleText}`;
}

function edgeLine(edge: PromptEdge): string {
  return `edge ${edge.from} -> ${edge.to} runtime ${edge.runtime} type ${edge.type}${heritagePart(edge)} cycle ${edge.cycle}${textPart(edge)}`;
}

function pairKey(edge: PromptEdge): string {
  return [edge.from, edge.to].sort(byStrings).join('\n');
}

function addCycleText(texts: Map<string, string[]>, edge: PromptEdge): void {
  if (edge.cycleText === undefined) return;
  const key = pairKey(edge);
  texts.set(key, [...(texts.get(key) ?? []), edge.cycleText]);
}

function textsOf(edges: PromptEdge[]): Map<string, string[]> {
  const texts = new Map<string, string[]>();
  for (const edge of edges) addCycleText(texts, edge);
  return texts;
}

function smallestText(list: string[]): string {
  return list.toSorted(byStrings)[0];
}

function cycleTextsOf(edges: PromptEdge[]): string[] {
  return [...textsOf(edges).values()].map(smallestText).sort(byStrings);
}

function cyclesLine(edges: PromptEdge[]): string {
  const texts = cycleTextsOf(edges);
  return texts.length === 0 ? 'cycles none' : `cycles ${texts.join(' | ')}`;
}

function viewLines(view: PromptView): string[] {
  return [`### ${currentView(view.at)}`, ...view.nodes.map(nodeLine), ...view.edges.map(edgeLine), cyclesLine(view.edges)];
}

function currentView(at: string): string {
  return at === '' ? '(root)' : at;
}

function editBlock(edits: PlanEdit[]): string[] {
  if (edits.length === 0) return [];
  return [...edits.map(sentenceOf), JSON.stringify(edits)];
}

function proposeIntro(name: string): string {
  return `You are proposing edits to the plan "${name}". The developer says what they dislike; you propose edits they will accept or reject. You change nothing yourself.`;
}

export function proposePrompt(facts: ProposeFacts): string {
  return [
    proposeIntro(facts.name),
    section('What they dislike', [facts.text]),
    section('Current view', [currentView(facts.at)]),
    section('Planned graph', facts.views.flatMap(viewLines)),
    section("The plan's edits so far", editBlock(facts.edits)),
    section('Edit JSON', EDIT_JSON),
    section('Conversation so far', chatLines(facts.turns)),
    section('What to reply', PROPOSE_REPLY),
  ].join('\n\n');
}

function exactKeys(rec: Record<string, unknown>, keys: string): boolean {
  return keysOf(rec) === keys;
}

function proposalShape(value: unknown): { summary: unknown; edits: unknown } | undefined {
  const rec = recordOf(value);
  if (rec === undefined || !exactKeys(rec, 'edits,summary')) return undefined;
  return { summary: rec.summary, edits: rec.edits };
}

function shapedProposal(summary: string, edits: unknown[]): Proposal | { problem: string } {
  return oneParagraph(summary) ? { summary, edits } : { problem: 'the summary must be one paragraph' };
}

function usableProposal(value: unknown): Proposal | { problem: string } {
  const shape = proposalShape(value);
  if (shape === undefined || typeof shape.summary !== 'string' || !Array.isArray(shape.edits)) {
    return { problem: 'it needs a summary and an edits array' };
  }
  return shapedProposal(shape.summary, shape.edits);
}

export function readProposal(stdout: string): Proposal | { problem: string } {
  const json = parsed(replyText(stdout));
  return json === undefined ? { problem: 'it is not valid JSON' } : usableProposal(json.value);
}
