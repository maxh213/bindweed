import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { pendingRound, type PlanDoc, type PlanTask, type Question, type Round } from '../domain/plan.ts';
import { editTasks, LAST_TASK_NUMBER, lastTaskNumber, markdownBlocks, type TaskEdit } from '../domain/tasks.ts';
import { fetchRepo, postCancel, postFiles, postGenerate, type GenerateAnswer, type GenerateBody } from './client.ts';

type TasksPanelProps = {
  token: string;
  fetcher: typeof fetch;
  doc: PlanDoc;
  onPlan: (doc: PlanDoc) => void;
  onSave: (doc: PlanDoc) => Promise<void>;
  onClose: () => void;
};

type RunWords = Exclude<GenerateAnswer, { plan: PlanDoc }> | { ran: string; note?: string };

type Listed<T> = { key: string; item: T; index: number };

function listed<T>(items: T[], keyOf: (item: T, index: number) => string): Listed<T>[] {
  return items.map((item, index) => ({ key: keyOf(item, index), item, index }));
}

function answeredRounds(interview: Round[] | undefined): Round[] {
  return (interview ?? []).filter(round => round.answers.length > 0);
}

function boxKey(round: Round, index: number): string {
  return `${round.round}:${index}`;
}

function typedAnswers(round: Round | null, boxes: Record<string, string>): string[] {
  if (round === null) return [];
  return round.questions.map((_, index) => boxes[boxKey(round, index)] ?? '');
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}

function whenChanged(original: string, commit: (text: string) => void): (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void {
  return event => {
    if (event.currentTarget.value !== original) commit(event.currentTarget.value);
  };
}

function briefCommand(root: string, slug: string): string {
  return `sc --repo ${root} --safety on -m "$(cat ${root}/.bindweed/plans/${slug}/brief.md)"`;
}

function Interview(props: Readonly<{ rounds: Round[] }>) {
  if (props.rounds.length === 0) return null;
  return (
    <ol aria-label="Interview" className="tasks-interview">
      {props.rounds.flatMap(round =>
        listed(round.questions, question => `${round.round}:${question.id}`).map(row => (
          <li key={row.key}>
            {row.item.text} — {round.answers[row.index]}
          </li>
        )),
      )}
    </ol>
  );
}

function QuestionBox(props: Readonly<{ question: Question; value: string; onType: (value: string) => void }>) {
  return (
    <li>
      <label>
        {props.question.text} <input aria-label={props.question.text} value={props.value} onInput={event => props.onType(event.currentTarget.value)} />
      </label>
      <p className="tasks-why">{props.question.why}</p>
    </li>
  );
}

function Questions(props: Readonly<{ round: Round | null; boxes: Record<string, string>; onType: (key: string, value: string) => void }>) {
  const round = props.round;
  if (round === null) return null;
  return (
    <ol aria-label="Questions" className="tasks-questions">
      {listed(round.questions, (question, index) => `${index}:${question.id}`).map(row => (
        <QuestionBox
          key={row.key}
          question={row.item}
          value={props.boxes[boxKey(round, row.index)] ?? ''}
          onType={value => props.onType(boxKey(round, row.index), value)}
        />
      ))}
    </ol>
  );
}

function RunState(props: Readonly<{ running: boolean; seconds: number; words: RunWords | null; onCancel: () => void }>) {
  if (props.running) {
    return (
      <p className="tasks-running">
        running for {props.seconds} s{' '}
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </p>
    );
  }
  return <RunWordsView words={props.words} />;
}

function RawOutput(props: Readonly<{ raw: string | undefined }>) {
  if (props.raw === undefined) return null;
  return (
    <section aria-label="Raw output" className="contract-text">
      <pre>{props.raw}</pre>
    </section>
  );
}

function RunError(props: Readonly<{ words: RunWords }>) {
  if (!('error' in props.words)) return null;
  return (
    <>
      <p className="plan-dialog-error">{props.words.error}</p>
      <RawOutput raw={props.words.raw} />
    </>
  );
}

function RunWordsView(props: Readonly<{ words: RunWords | null }>) {
  const words = props.words;
  if (words === null) return null;
  return (
    <>
      <RunError words={words} />
      {words.ran === undefined ? null : <output aria-label="ran">{words.ran}</output>}
      {words.note === undefined ? null : <output aria-label="note">{words.note}</output>}
    </>
  );
}

function SliceBody(props: Readonly<{ task: PlanTask; preview: boolean; onBody: (text: string) => void }>) {
  if (props.preview) {
    return (
      <div className="tasks-preview">
        {listed(markdownBlocks(props.task.body), (block, index) => `${index}:${block.kind}`).map(row => {
          const Tag = row.item.kind;
          return <Tag key={row.key}>{row.item.text}</Tag>;
        })}
      </div>
    );
  }
  return (
    <textarea
      key={props.task.body}
      aria-label={`Body of ${props.task.file}`}
      defaultValue={props.task.body}
      onBlur={whenChanged(props.task.body, props.onBody)}
    />
  );
}

type SliceProps = {
  task: PlanTask;
  index: number;
  count: number;
  canSplit: boolean;
  preview: boolean;
  onEdit: (edit: TaskEdit) => void;
  onPreview: () => void;
};

function ActionButton(props: Readonly<{ label: string; text: string; disabled?: boolean; onClick: () => void }>) {
  return (
    <button type="button" aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
      {props.text}
    </button>
  );
}

function SliceActions(props: Readonly<SliceProps>) {
  const file = props.task.file;
  const last = props.index === props.count - 1;
  const edit = (kind: 'up' | 'down' | 'merge' | 'split' | 'delete') => () => props.onEdit({ kind, index: props.index });
  return (
    <div className="tasks-actions">
      <button type="button" aria-label={`Preview ${file}`} aria-pressed={props.preview} onClick={props.onPreview}>
        Preview
      </button>
      <ActionButton label={`Move ${file} up`} text="↑" disabled={props.index === 0} onClick={edit('up')} />
      <ActionButton label={`Move ${file} down`} text="↓" disabled={last} onClick={edit('down')} />
      <ActionButton label={`Merge ${file} with next`} text="Merge" disabled={last} onClick={edit('merge')} />
      <ActionButton label={`Split ${file}`} text="Split" disabled={!props.canSplit} onClick={edit('split')} />
      <ActionButton label={`Delete ${file}`} text="Delete" onClick={edit('delete')} />
      <ActionButton label={`Copy ${file}`} text="Copy" onClick={() => copy(props.task.body)} />
    </div>
  );
}

function SliceRow(props: Readonly<SliceProps>) {
  const task = props.task;
  return (
    <li className="tasks-slice">
      <code className="tasks-file">{task.file}</code>{' '}
      <input
        key={task.title}
        aria-label={`Title of ${task.file}`}
        defaultValue={task.title}
        onBlur={whenChanged(task.title, text => props.onEdit({ kind: 'title', index: props.index, text }))}
      />
      <SliceActions {...props} />
      <SliceBody task={task} preview={props.preview} onBody={text => props.onEdit({ kind: 'body', index: props.index, text })} />
    </li>
  );
}

function Slices(props: Readonly<{ tasks: PlanTask[]; onEdit: (edit: TaskEdit) => void }>) {
  const [previews, setPreviews] = useState<ReadonlySet<string>>(new Set());
  const canSplit = lastTaskNumber(props.tasks) < LAST_TASK_NUMBER;
  const toggle = (file: string): void =>
    setPreviews(current => {
      const next = new Set(current);
      if (!next.delete(file)) next.add(file);
      return next;
    });
  return (
    <ol aria-label="Slices" className="tasks-slices">
      {listed(props.tasks, (task, index) => `${index}:${task.file}`).map(row => (
        <SliceRow
          key={row.key}
          task={row.item}
          index={row.index}
          count={props.tasks.length}
          canSplit={canSplit}
          preview={previews.has(row.item.file)}
          onEdit={props.onEdit}
          onPreview={() => toggle(row.item.file)}
        />
      ))}
    </ol>
  );
}

function BriefCommand(props: Readonly<{ token: string; fetcher: typeof fetch; slug: string }>) {
  const repoQuery = useQuery({ queryKey: ['repo', props.token] as const, queryFn: () => fetchRepo(props.token, props.fetcher) });
  const repo = repoQuery.data;
  if (repo === undefined || 'error' in repo) return null;
  const command = briefCommand(repo.root, props.slug);
  return (
    <p className="tasks-command">
      <code>{command}</code>{' '}
      <button type="button" onClick={() => copy(command)}>
        Copy command
      </button>
    </p>
  );
}

function Brief(props: Readonly<{ brief: string | undefined; onBrief: (text: string) => void }>) {
  const brief = props.brief ?? '';
  return (
    <label className="tasks-brief">
      Brief{' '}
      <textarea
        key={brief}
        aria-label="Brief"
        defaultValue={brief}
        onBlur={whenChanged(brief, props.onBrief)}
      />
    </label>
  );
}

function useTicker(running: boolean): [number, () => void] {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds(current => current + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return [seconds, () => setSeconds(0)];
}

function pendingOf(doc: PlanDoc): Round | null {
  return pendingRound(doc.interview ?? []) ?? null;
}

function tasksOf(doc: PlanDoc): PlanTask[] {
  return doc.tasks ?? [];
}

function GenerateButtons(props: Readonly<{ pending: boolean; onRun: (step: GenerateBody['step']) => void }>) {
  return (
    <div className="tasks-buttons">
      <button type="button" onClick={() => props.onRun('ask')}>
        Generate
      </button>
      {props.pending ? (
        <button type="button" onClick={() => props.onRun('answer')}>
          Continue
        </button>
      ) : null}
      <button type="button" onClick={() => props.onRun('write')}>
        Just write it
      </button>
    </div>
  );
}

function bodyFor(step: GenerateBody['step'], answers: string[]): GenerateBody {
  return step === 'ask' ? { step } : { step, answers };
}

export function TasksPanel(props: Readonly<TasksPanelProps>) {
  const doc = props.doc;
  const [running, setRunning] = useState(false);
  const [words, setWords] = useState<RunWords | null>(null);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [seconds, restartTicker] = useTicker(running);
  const pending = pendingOf(doc);
  const store = (next: PlanDoc): void => {
    saving.current = props.onSave(next);
  };
  const run = async (step: GenerateBody['step']): Promise<void> => {
    await saving.current;
    restartTicker();
    setRunning(true);
    setWords(null);
    const answer = await postGenerate(props.token, doc.slug, bodyFor(step, typedAnswers(pending, boxes)), props.fetcher);
    setRunning(false);
    if (!('plan' in answer)) {
      setWords(answer);
      return;
    }
    props.onPlan(answer.plan);
    setBoxes({});
    setWords({ ran: answer.ran, note: answer.note });
  };
  const saveFiles = async (): Promise<void> => {
    await saving.current;
    const result = await postFiles(props.token, doc.slug, props.fetcher);
    setSaved('error' in result ? result.error : `saved to ${result.dir}/tasks/`);
  };
  return (
    <div className="plan-dialog-backdrop">
      <dialog open aria-label="Tasks" className="plan-dialog tasks-panel">
        <RunState running={running} seconds={seconds} words={words} onCancel={() => void postCancel(props.token, doc.slug, props.fetcher)} />
        <fieldset disabled={running} className="tasks-fields">
          <Interview rounds={answeredRounds(doc.interview)} />
          <Questions round={pending} boxes={boxes} onType={(key, value) => setBoxes(current => ({ ...current, [key]: value }))} />
          <GenerateButtons pending={pending !== null} onRun={step => void run(step)} />
          <Slices tasks={tasksOf(doc)} onEdit={edit => store({ ...doc, tasks: editTasks(tasksOf(doc), edit) })} />
          <Brief brief={doc.brief} onBrief={text => store({ ...doc, brief: text })} />
          <BriefCommand token={props.token} fetcher={props.fetcher} slug={doc.slug} />
          <button type="button" onClick={() => void saveFiles()}>
            Save as files
          </button>
          {saved === null ? null : <output aria-label="saved">{saved}</output>}
        </fieldset>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </dialog>
    </div>
  );
}
