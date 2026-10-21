import { editSentence, undecided, type ChatTurn } from '../domain/chat.ts';
import { parsePlanEdit, type PlanEdit } from '../domain/plan.ts';

type ForcedDrop = { index: number; reason: string };

export type HeldDrop = { stamp: string; forced: ForcedDrop };

export type OpenRow = { index: number; raw: unknown; stale: string | null; sentence: string };

type OpenEdit = { index: number; edit: PlanEdit };

export type OpenList = { turn: ChatTurn | null; stamp: string; rows: OpenRow[]; edits: OpenEdit[] };

function latestTurn(turns: ChatTurn[]): ChatTurn | null {
  return turns.at(-1) ?? null;
}

export function askTextOk(text: string): boolean {
  return text.trim() !== '';
}

export function actOnTurn(turn: ChatTurn | null, run: (current: ChatTurn) => void): void {
  if (turn === null) return;
  run(turn);
}

export function withTurn(turns: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  return [...turns.slice(0, -1), turn];
}

function chatStamp(turns: ChatTurn[]): string {
  const last = turns.at(-1);
  return last === undefined ? '' : `${turns.length}:${last.at}`;
}

export function openRaws(turns: ChatTurn[]): { stamp: string; raws: unknown[] } {
  const turn = latestTurn(turns);
  const raws = turn === null ? [] : undecided(turn).map(index => turn.edits[index]);
  return { stamp: chatStamp(turns), raws };
}

export function acceptance(raw: unknown, reason: string | null): { edit: PlanEdit } | { reason: string } {
  if (reason !== null) return { reason };
  const edit = parsePlanEdit(raw);
  return edit === undefined ? { reason: 'not an edit' } : { edit };
}

function keptDrop(drop: HeldDrop | null, stamp: string): ForcedDrop | null {
  if (drop === null) return null;
  if (drop.stamp !== stamp) return null;
  return drop.forced;
}

function shownReason(stale: string | null, forced: ForcedDrop | null, index: number): string | null {
  if (forced !== null && forced.index === index) return forced.reason;
  return stale;
}

function rowAt(turn: ChatTurn, index: number, stale: string | null, forced: ForcedDrop | null): OpenRow {
  const raw = turn.edits[index];
  return { index, raw, stale: shownReason(stale, forced, index), sentence: editSentence(raw) };
}

function zipRows(turn: ChatTurn | null, stale: (string | null)[], forced: ForcedDrop | null): OpenRow[] {
  if (turn === null) return [];
  return undecided(turn).map((index, place) => rowAt(turn, index, stale[place] ?? null, forced));
}

function applicable(row: OpenRow): PlanEdit | undefined {
  if (row.stale !== null) return undefined;
  return parsePlanEdit(row.raw);
}

function openEdits(rows: OpenRow[]): OpenEdit[] {
  const edits: OpenEdit[] = [];
  for (const row of rows) {
    const edit = applicable(row);
    if (edit !== undefined) edits.push({ index: row.index, edit });
  }
  return edits;
}

export function openList(turns: ChatTurn[], stale: (string | null)[], drop: HeldDrop | null): OpenList {
  const turn = latestTurn(turns);
  const stamp = chatStamp(turns);
  const rows = zipRows(turn, stale, keptDrop(drop, stamp));
  return { turn, stamp, rows, edits: openEdits(rows) };
}
