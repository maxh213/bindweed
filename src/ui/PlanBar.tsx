import { useState } from 'react';
import type { PlanSummary } from '../domain/plan.ts';

type ChangeLine = { sentence: string; stale: string | null };

type Shown = 'now' | 'planned';

export function PlanSelect(
  props: Readonly<{ value: string; plans: PlanSummary[]; labels: Map<string, string>; onChoose: (slug: string | null) => void }>,
) {
  return (
    <label>
      Plan{' '}
      <select aria-label="Plan" value={props.value} onChange={event => props.onChoose(event.currentTarget.value === '' ? null : event.currentTarget.value)}>
        <option value="">No plan</option>
        {props.plans.map(plan => (
          <option key={plan.slug} value={plan.slug}>
            {props.labels.get(plan.slug) ?? plan.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function DialogFrame(props: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="plan-dialog-backdrop">
      <dialog open aria-label={props.label} className="plan-dialog">
        {props.children}
      </dialog>
    </div>
  );
}

function DialogError(props: Readonly<{ text: string | null }>) {
  if (props.text === null) return null;
  return <p className="plan-dialog-error">{props.text}</p>;
}

function FieldDialog(
  props: Readonly<{
    label: string;
    field: string;
    empty: string;
    submit: string;
    error: string | null;
    onSubmit: (value: string) => void;
    onCancel: () => void;
  }>,
) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = () => {
    if (value.trim() === '') {
      setLocalError(props.empty);
      return;
    }
    props.onSubmit(value.trim());
  };
  return (
    <DialogFrame label={props.label}>
      <label>
        {props.field}{' '}
        <input
          aria-label={props.field}
          value={value}
          onInput={event => {
            setValue(event.currentTarget.value);
            setLocalError(null);
          }}
        />
      </label>
      <DialogError text={localError ?? props.error} />
      <button type="button" onClick={submit}>
        {props.submit}
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </DialogFrame>
  );
}

export function NewPlanDialog(props: Readonly<{ error: string | null; onCreate: (name: string) => void; onCancel: () => void }>) {
  return (
    <FieldDialog
      label="New plan"
      field="Name"
      empty="write a name"
      submit="Create"
      error={props.error}
      onSubmit={props.onCreate}
      onCancel={props.onCancel}
    />
  );
}

export function DeletePlanDialog(props: Readonly<{ name: string; onDelete: () => void; onCancel: () => void }>) {
  return (
    <DialogFrame label="Delete plan">
      <p>Delete {props.name}?</p>
      <button type="button" onClick={props.onDelete}>
        Delete
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </DialogFrame>
  );
}

export function NoteDialog(props: Readonly<{ error: string | null; onAdd: (text: string) => void; onCancel: () => void }>) {
  return (
    <FieldDialog
      label="Add note"
      field="Note"
      empty="write a note"
      submit="Add"
      error={props.error}
      onSubmit={props.onAdd}
      onCancel={props.onCancel}
    />
  );
}

function ShownChoice(props: Readonly<{ label: string; checked: boolean; onChoose: () => void }>) {
  return (
    <label className="shown-choice">
      <input type="radio" name="shown-graph" checked={props.checked} onChange={props.onChoose} />
      <span>{props.label}</span>
    </label>
  );
}

export function ShownSwitch(props: Readonly<{ shown: Shown; onChoose: (shown: Shown) => void }>) {
  return (
    <div role="radiogroup" aria-label="Shown graph">
      <ShownChoice label="Now" checked={props.shown === 'now'} onChoose={() => props.onChoose('now')} />
      <ShownChoice label="Planned" checked={props.shown === 'planned'} onChoose={() => props.onChoose('planned')} />
    </div>
  );
}

export function Notice(props: Readonly<{ text: string | null }>) {
  return (
    <output className="plan-notice" aria-label="notice">
      {props.text ?? ''}
    </output>
  );
}

function ChangeRow(props: Readonly<{ entry: ChangeLine; onPick: () => void; onRemove: () => void }>) {
  return (
    <li className="change" data-stale={props.entry.stale === null ? undefined : 'true'}>
      <button type="button" className="change-sentence" onClick={props.onPick}>
        {props.entry.sentence}
      </button>
      {props.entry.stale === null ? null : <span className="change-reason">{props.entry.stale}</span>}
      <button type="button" aria-label="Remove" onClick={props.onRemove}>
        ×
      </button>
    </li>
  );
}

type ListedChange<T extends ChangeLine> = { key: string; entry: T; index: number };

function listedChanges<T extends ChangeLine>(entries: T[]): ListedChange<T>[] {
  const seen = new Map<string, number>();
  const rows: ListedChange<T>[] = [];
  entries.forEach((entry, index) => {
    const base = `${entry.sentence}\0${entry.stale ?? ''}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    rows.push({ key: `${count}:${base}`, entry, index });
  });
  return rows;
}

export function ChangeList<T extends ChangeLine>(
  props: Readonly<{
    entries: T[];
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onPick: (entry: T) => void;
    onRemove: (index: number) => void;
  }>,
) {
  return (
    <aside aria-label="changes">
      <div className="change-actions">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo}>
          Undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo}>
          Redo
        </button>
      </div>
      <ol>
        {listedChanges(props.entries).map(row => (
          <ChangeRow key={row.key} entry={row.entry} onPick={() => props.onPick(row.entry)} onRemove={() => props.onRemove(row.index)} />
        ))}
      </ol>
    </aside>
  );
}
