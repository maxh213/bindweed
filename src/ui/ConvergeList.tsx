import type { ConvergeAnswer } from './client.ts';

type Status = ConvergeAnswer['edits'][number]['status'];

type Verdict = ConvergeAnswer | { error: string } | undefined;

type Row = { sentence: string };

const MARKS: Record<Exclude<Status, 'note'>, { text: string; color: string }> = {
  done: { text: '✓', color: '#16a34a' },
  'not yet': { text: '○', color: '#64748b' },
  contradicted: { text: '✗', color: '#dc2626' },
};

function answerOf(verdict: Verdict): ConvergeAnswer | null {
  if (verdict === undefined || 'error' in verdict) return null;
  return verdict;
}

function Mark(props: Readonly<{ status: Status | undefined }>) {
  if (props.status === undefined || props.status === 'note') return null;
  const mark = MARKS[props.status];
  return (
    <span className="converge-mark" data-status={props.status} style={{ color: mark.color }}>
      {mark.text}
    </span>
  );
}

function Lines(props: Readonly<{ lines: string[] | undefined }>) {
  if (props.lines === undefined) return null;
  return (
    <ul className="converge-remain">
      {props.lines.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function EditRow(props: Readonly<{ row: Row; edit: ConvergeAnswer['edits'][number] | undefined; onPick: () => void }>) {
  return (
    <li className="change">
      <Mark status={props.edit?.status} />
      <button type="button" className="change-sentence" onClick={props.onPick}>
        {props.row.sentence}
      </button>
      <button type="button" aria-label="Remove" disabled>
        ×
      </button>
      <Lines lines={props.edit?.remain} />
    </li>
  );
}

function RuleList(props: Readonly<{ rules: ConvergeAnswer['rules'] }>) {
  if (props.rules.length === 0) return null;
  return (
    <>
      <h3 className="changes-heading">Rules</h3>
      <ul className="converge-rules">
        {props.rules.map(rule => (
          <li key={rule.name}>
            <Mark status={rule.holds ? 'done' : 'not yet'} />
            {rule.comment}
            <Lines lines={rule.breaks} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function ConvergeList(props: Readonly<{ rows: Row[]; verdict: Verdict; onPick: (index: number) => void }>) {
  const answer = answerOf(props.verdict);
  return (
    <aside aria-label="changes">
      <h2 className="changes-heading">Changes</h2>
      {answer === null ? null : <p className="converge-header">{answer.header}</p>}
      <div className="change-actions">
        <button type="button" disabled>
          Undo
        </button>
        <button type="button" disabled>
          Redo
        </button>
      </div>
      <ol>
        {props.rows.map((row, index) => (
          <EditRow key={`${index}:${row.sentence}`} row={row} edit={answer?.edits.find(edit => edit.index === index)} onPick={() => props.onPick(index)} />
        ))}
      </ol>
      <RuleList rules={answer?.rules ?? []} />
    </aside>
  );
}
