import { useState } from 'react';
import type { PlanSummary } from '../domain/plan.ts';

type WarningLine = { text: string; importers: string[] };

type ChangeLine = { sentence: string; stale: string | null; warnings: WarningLine[] };

type Shown = 'now' | 'planned';

export function PlanSelect(
  props: Readonly<{ value: string; plans: PlanSummary[]; labels: Map<string, string>; disabled?: boolean; onChoose: (slug: string | null) => void }>,
) {
  return (
    <label>
      Plan{' '}
      <select aria-label="Plan" value={props.value} disabled={props.disabled} onChange={event => props.onChoose(event.currentTarget.value === '' ? null : event.currentTarget.value)}>
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

type NameDialogProps = Readonly<{ error: string | null; onSubmit: (name: string) => void; onCancel: () => void }>;

export function NewPackageDialog(props: NameDialogProps) {
  return <FieldDialog label="New package" field="Name" empty="write a name" submit="Create" error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
}

export function RenameDialog(props: NameDialogProps) {
  return <FieldDialog label="Rename" field="Name" empty="write a name" submit="Rename" error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
}

export function MergeDialog(props: NameDialogProps) {
  return <FieldDialog label="Merge packages" field="Name" empty="write a name" submit="Merge" error={props.error} onSubmit={props.onSubmit} onCancel={props.onCancel} />;
}

type SplitFile = { path: string; label: string };

function PartField(props: Readonly<{ index: number; value: string; onInput: (value: string) => void }>) {
  const label = `Part ${props.index + 1}`;
  return (
    <label>
      {label} <input aria-label={label} value={props.value} onInput={event => props.onInput(event.currentTarget.value)} />
    </label>
  );
}

function FileChoice(props: Readonly<{ file: SplitFile; names: string[]; value: string; onChoose: (value: string) => void }>) {
  return (
    <label>
      {props.file.label}{' '}
      <select aria-label={props.file.label} value={props.value} onChange={event => props.onChoose(event.currentTarget.value)}>
        <option value="">choose</option>
        {props.names.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function typedNames(names: string[]): string[] {
  return [...new Set(names.map(name => name.trim()).filter(name => name !== ''))];
}

function replaced(names: string[], index: number, value: string): string[] {
  return names.map((name, at) => (at === index ? value : name));
}

type KeyedName = { key: string; value: string; index: number };

function keyedNames(names: string[]): KeyedName[] {
  return names.map((value, index) => ({ key: String(index), value, index }));
}

export function SplitDialog(
  props: Readonly<{
    files: SplitFile[];
    error: string | null;
    onSplit: (names: string[], assigned: Record<string, string>) => void;
    onCancel: () => void;
  }>,
) {
  const [names, setNames] = useState(['', '']);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const options = typedNames(names);
  return (
    <DialogFrame label="Split package">
      {keyedNames(names).map(item => (
        <PartField key={item.key} index={item.index} value={item.value} onInput={value => setNames(current => replaced(current, item.index, value))} />
      ))}
      <button type="button" onClick={() => setNames(current => [...current, ''])}>
        Add part
      </button>
      {props.files.map(file => (
        <FileChoice
          key={file.path}
          file={file}
          names={options}
          value={assigned[file.path] ?? ''}
          onChoose={value => setAssigned(current => ({ ...current, [file.path]: value }))}
        />
      ))}
      <DialogError text={props.error} />
      <button type="button" onClick={() => props.onSplit(names, assigned)}>
        Split
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </DialogFrame>
  );
}

export function CanvasMenu(props: Readonly<{ onNewPackage: () => void }>) {
  const [open, setOpen] = useState(false);
  return (
    <span className="canvas-menu">
      <button type="button" onClick={() => setOpen(current => !current)}>
        Canvas
      </button>
      {open ? (
        <span role="menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onNewPackage();
            }}
          >
            New package
          </button>
        </span>
      ) : null}
    </span>
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

function Importers(props: Readonly<{ paths: string[] }>) {
  const [open, setOpen] = useState(false);
  if (props.paths.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(current => !current)}>
        {open ? 'Hide importers' : 'Show importers'}
      </button>
      {open ? (
        <ul className="change-importers">
          {props.paths.map(path => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function WarningList(props: Readonly<{ warnings: WarningLine[] }>) {
  if (props.warnings.length === 0) return null;
  return (
    <ul className="change-warnings">
      {props.warnings.map(warning => (
        <li key={warning.text} className="change-warning">
          <span className="change-warning-text">{warning.text}</span>
          <Importers paths={warning.importers} />
        </li>
      ))}
    </ul>
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
      <WarningList warnings={props.entry.warnings} />
    </li>
  );
}

function warningCount(entries: ChangeLine[]): number {
  return entries.reduce((sum, entry) => sum + entry.warnings.length, 0);
}

function WarningBadge(props: Readonly<{ count: number }>) {
  if (props.count === 0) return null;
  const label = props.count === 1 ? '1 warning' : `${props.count} warnings`;
  return (
    <span className="warning-badge" aria-label={label}>
      {props.count}
    </span>
  );
}

type ListedChange<T extends ChangeLine> = { key: string; entry: T; index: number };

function listedChanges<T extends ChangeLine>(entries: T[]): ListedChange<T>[] {
  return entries.map((entry, index) => ({ key: `${index}:${entry.sentence}`, entry, index }));
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
      <h2 className="changes-heading">
        Changes <WarningBadge count={warningCount(props.entries)} />
      </h2>
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
