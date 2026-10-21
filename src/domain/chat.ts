import { createdAtOk, everyRead, noExtraKeys, parsePlanEdit, recordOf, sentenceOf } from './plan.ts';

export type ChatDecision = 'accepted' | 'rejected';

export type ChatTurn = {
  at: string;
  text: string;
  summary: string;
  edits: unknown[];
  decisions: Record<string, ChatDecision>;
};

const DECISION_INDEX = /^(0|[1-9]\d*)$/;

function paragraphText(value: string): boolean {
  return value.trim() !== '' && !value.includes('\n') && !value.includes('\r');
}

export function oneParagraph(value: unknown): value is string {
  return typeof value === 'string' && paragraphText(value);
}

function filledText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function decisionValue(value: unknown): ChatDecision | undefined {
  if (value === 'accepted' || value === 'rejected') return value;
  return undefined;
}

function decisionEntry(key: string, value: unknown, count: number): ChatDecision | undefined {
  const decision = decisionValue(value);
  if (!DECISION_INDEX.test(key) || Number(key) >= count || decision === undefined) return undefined;
  return decision;
}

function decisionMap(rec: Record<string, unknown>, count: number): Record<string, ChatDecision> | undefined {
  const out: Record<string, ChatDecision> = {};
  for (const [key, value] of Object.entries(rec)) {
    const decision = decisionEntry(key, value, count);
    if (decision === undefined) return undefined;
    out[key] = decision;
  }
  return out;
}

function decisionsOf(raw: unknown, count: number): Record<string, ChatDecision> | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return decisionMap(rec, count);
}

function turnTextOk(rec: Record<string, unknown>): boolean {
  return createdAtOk(rec.at) && filledText(rec.text) && oneParagraph(rec.summary);
}

function turnEdits(rec: Record<string, unknown>): unknown[] | undefined {
  return Array.isArray(rec.edits) ? rec.edits : undefined;
}

function turnCore(rec: Record<string, unknown>): Pick<ChatTurn, 'at' | 'text' | 'summary' | 'edits'> | undefined {
  const edits = turnEdits(rec);
  if (edits === undefined || !turnTextOk(rec)) return undefined;
  return { at: String(rec.at), text: String(rec.text), summary: String(rec.summary), edits };
}

function turnHead(raw: unknown): Record<string, unknown> | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['at', 'text', 'summary', 'edits', 'decisions'])) return undefined;
  return rec;
}

function turnFrom(raw: unknown): ChatTurn | undefined {
  const rec = turnHead(raw);
  if (rec === undefined) return undefined;
  const core = turnCore(rec);
  if (core === undefined) return undefined;
  const decisions = decisionsOf(rec.decisions, core.edits.length);
  return decisions === undefined ? undefined : { ...core, decisions };
}

export function parseChat(raw: unknown): ChatTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return everyRead(raw, turnFrom);
}

export function editSentence(raw: unknown): string {
  const edit = parsePlanEdit(raw);
  return edit === undefined ? JSON.stringify(raw) : sentenceOf(edit);
}

function saidLines(text: string): string[] {
  const [first, ...rest] = text.split('\n');
  return [`They said: ${first}`, ...rest.map(line => `  ${line}`)];
}

function decisionWord(decisions: Record<string, ChatDecision>, index: number): string {
  return decisions[String(index)] ?? 'open';
}

function decisionLine(turn: ChatTurn, raw: unknown, index: number): string {
  return `${index} ${decisionWord(turn.decisions, index)}: ${editSentence(raw)}`;
}

function turnLines(turn: ChatTurn): string[] {
  return [...saidLines(turn.text), `Summary: ${turn.summary}`, ...turn.edits.map((raw, index) => decisionLine(turn, raw, index))];
}

export function chatLines(turns: ChatTurn[]): string[] {
  return turns.flatMap(turnLines);
}

export function undecided(turn: ChatTurn): number[] {
  return turn.edits.flatMap((_, index) => (turn.decisions[String(index)] === undefined ? [index] : []));
}

export function decide(turn: ChatTurn, index: number, decision: ChatDecision): ChatTurn {
  return { ...turn, decisions: { ...turn.decisions, [String(index)]: decision } };
}

export function rejectOpen(turn: ChatTurn): ChatTurn {
  const decisions = { ...turn.decisions };
  for (const index of undecided(turn)) decisions[String(index)] = 'rejected';
  return { ...turn, decisions };
}

export function freshTurn(text: string, summary: string, edits: unknown[], at: string): ChatTurn {
  return { at, text, summary, edits, decisions: {} };
}

function proposeFields(rec: Record<string, unknown>): { text: string; at: string } | undefined {
  if (typeof rec.text !== 'string' || rec.text.trim() === '' || typeof rec.at !== 'string') return undefined;
  return { text: rec.text, at: rec.at };
}

export function proposeFrom(raw: unknown): { text: string; at: string } | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['text', 'at'])) return undefined;
  return proposeFields(rec);
}

export function reviewFrom(raw: unknown): unknown[] | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['edits'])) return undefined;
  return Array.isArray(rec.edits) ? rec.edits : undefined;
}
