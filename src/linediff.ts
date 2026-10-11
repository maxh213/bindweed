type Mark = ' ' | '-' | '+';

type Step = { mark: Mark; line: string; before: number; after: number };

type Span = { start: number; end: number };

const CONTEXT = 3;

function linesOf(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

function commonTable(before: string[], after: string[]): number[][] {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function sameAt(before: string[], after: string[], at: [number, number]): boolean {
  return at[0] < before.length && before[at[0]] === after[at[1]];
}

function dropsFirst(before: string[], table: number[][], at: [number, number]): boolean {
  const [i, j] = at;
  return i < before.length && table[i + 1][j] >= table[i][j + 1];
}

function nextMark(before: string[], after: string[], table: number[][], at: [number, number]): Mark {
  if (sameAt(before, after, at)) return ' ';
  if (at[1] >= after.length || dropsFirst(before, table, at)) return '-';
  return '+';
}

function stepAt(before: string[], after: string[], table: number[][], at: [number, number]): Step {
  const mark = nextMark(before, after, table, at);
  return { mark, line: mark === '+' ? after[at[1]] : before[at[0]], before: at[0], after: at[1] };
}

function advanced(step: Step): [number, number] {
  return [step.before + (step.mark === '+' ? 0 : 1), step.after + (step.mark === '-' ? 0 : 1)];
}

function stepsOf(before: string[], after: string[]): Step[] {
  const table = commonTable(before, after);
  const steps: Step[] = [];
  let at: [number, number] = [0, 0];
  while (at[0] < before.length || at[1] < after.length) {
    const step = stepAt(before, after, table, at);
    steps.push(step);
    at = advanced(step);
  }
  return steps;
}

function spansOf(steps: Step[]): Span[] {
  const spans: Span[] = [];
  steps.forEach((step, index) => {
    if (step.mark === ' ') return;
    const span = { start: Math.max(0, index - CONTEXT), end: Math.min(steps.length, index + CONTEXT + 1) };
    const last = spans.at(-1);
    if (last !== undefined && span.start <= last.end) last.end = span.end;
    else spans.push(span);
  });
  return spans;
}

function rangeText(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`;
}

function hunkText(steps: Step[]): string {
  const first = steps[0];
  const olds = steps.filter(step => step.mark !== '+').length;
  const news = steps.filter(step => step.mark !== '-').length;
  const head = `@@ -${rangeText(first.before, olds)} +${rangeText(first.after, news)} @@\n`;
  return head + steps.map(step => `${step.mark}${step.line}\n`).join('');
}

export function unifiedDiff(before: string, after: string, name: string): string {
  const steps = stepsOf(linesOf(before), linesOf(after));
  const hunks = spansOf(steps).map(span => hunkText(steps.slice(span.start, span.end)));
  return `--- a/${name}\n+++ b/${name}\n${hunks.join('')}`;
}
