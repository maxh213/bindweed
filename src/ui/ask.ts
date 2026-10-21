import { editSentence, parsePlanEdit, undecided, type ChatTurn, type PlanEdit } from '../domain/plan.ts';

export type ForcedDrop = { index: number; reason: string };

export type OpenRow = { index: number; raw: unknown; stale: string | null; sentence: string };

export type OpenEdit = { index: number; edit: PlanEdit };

export function latestTurn(turns: ChatTurn[]): ChatTurn | null {
  return turns.at(-1) ?? null;
}

export function askTextOk(text: string): boolean {
  return text.trim() !== '';
}

export function withTurn(turns: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  return [...turns.slice(0, -1), turn];
}

export function chatStamp(turns: ChatTurn[]): string {
  const last = turns.at(-1);
  return last === undefined ? '' : `${turns.length}:${last.at}`;
}

export function invoke(fn: (() => void) | null): void {
  if (fn === null) return;
  fn();
}

export function bumpTicket(tickets: { current: number }): number {
  tickets.current += 1;
  return tickets.current;
}

export function reviewIfCurrent(
  ticket: number,
  current: number,
  result: { stale: (string | null)[] } | { error: string },
  apply: (stale: (string | null)[]) => void,
): void {
  if (ticket !== current) return;
  if ('error' in result) return;
  apply(result.stale);
}

export function keptDrop(drop: { stamp: string; forced: ForcedDrop } | null, stamp: string): ForcedDrop | null {
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

export function zipRows(turn: ChatTurn | null, stale: (string | null)[], forced: ForcedDrop | null): OpenRow[] {
  if (turn === null) return [];
  return undecided(turn).map((index, place) => rowAt(turn, index, stale[place] ?? null, forced));
}

function applicable(row: OpenRow): PlanEdit | undefined {
  if (row.stale !== null) return undefined;
  return parsePlanEdit(row.raw);
}

export function openEdits(rows: OpenRow[]): OpenEdit[] {
  const edits: OpenEdit[] = [];
  for (const row of rows) {
    const edit = applicable(row);
    if (edit !== undefined) edits.push({ index: row.index, edit });
  }
  return edits;
}

export function rawAt(turn: ChatTurn | null, index: number): unknown {
  if (turn === null) return undefined;
  return turn.edits[index];
}
