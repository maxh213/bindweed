import { useState } from 'react';
import type { PlanSummary } from '../domain/plan.ts';
import type { ChangeEntry, ShownGraph } from './planview.ts';

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
      <div role="dialog" aria-label={props.label} className="plan-dialog">
        {props.children}
      </div>
    </div>
  );
}

export function NewPlanDialog(props: Readonly<{ error: string | null; onCreate: (name: string) => void; onCancel: () => void }>) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const create = () => {
    if (name.trim() === '') {
      setLocalError('write a name');
      return;
    }
    props.onCreate(name.trim());
  };
  return (
    <DialogFrame label="New plan">
      <label>
        Name{' '}
        <input
          aria-label="Name"
          value={name}
          onInput={event => {
            setName(event.currentTarget.value);
            setLocalError(null);
          }}
        />
      </label>
      <DialogError text={localError ?? props.error} />
      <button type="button" onClick={create}>
        Create
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </DialogFrame>
  );
}

function DialogError(props: Readonly<{ text: string | null }>) {
  if (props.text === null) return null;
  return <p className="plan-dialog-error">{props.text}</p>;
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
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const add = () => {
    if (text.trim() === '') {
      setLocalError('write a note');
      return;
    }
    props.onAdd(text.trim());
  };
  return (
    <DialogFrame label="Add note">
      <label>
        Note{' '}
        <input
          aria-label="Note"
          value={text}
          onInput={event => {
            setText(event.currentTarget.value);
            setLocalError(null);
          }}
        />
      </label>
      <DialogError text={localError ?? props.error} />
      <button type="button" onClick={add}>
        Add
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </DialogFrame>
  );
}

export function ShownSwitch(props: Readonly<{ shown: ShownGraph; onChoose: (shown: ShownGraph) => void }>) {
  return (
    <div role="radiogroup" aria-label="Shown graph">
      <label>
        <input type="radio" name="shown-graph" checked={props.shown === 'now'} onChange={() => props.onChoose('now')} />
        Now
      </label>
      <label>
        <input type="radio" name="shown-graph" checked={props.shown === 'planned'} onChange={() => props.onChoose('planned')} />
        Planned
      </label>
    </div>
  );
}

export function Notice(props: Readonly<{ text: string | null }>) {
  return (
    <div role="status" aria-label="notice">
      {props.text ?? ''}
    </div>
  );
}

function ChangeRow(
  props: Readonly<{ entry: ChangeEntry; onPick: () => void; onRemove: () => void }>,
) {
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

export function ChangeList(
  props: Readonly<{
    entries: ChangeEntry[];
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onPick: (entry: ChangeEntry) => void;
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
        {props.entries.map((entry, index) => (
          <ChangeRow key={index} entry={entry} onPick={() => props.onPick(entry)} onRemove={() => props.onRemove(index)} />
        ))}
      </ol>
    </aside>
  );
}
