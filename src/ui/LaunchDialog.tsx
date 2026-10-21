import { useQuery, useQueryClient } from '@tanstack/react-query';
import { startTransition, useActionState, useEffect, useId, useRef, useState, type SubmitEvent, type ReactElement } from 'react';
import { launchReason, type LaunchBody, type LaunchInfo, type LaunchResult } from '../domain/launch.ts';
import type { PlanDoc } from '../domain/plan.ts';
import { fetchLaunch, postLaunch } from './client.ts';

type Props = { token: string; fetcher: typeof fetch; doc: PlanDoc; onClose: () => void };
type Tool = LaunchBody['tool'];
type Marestail = Extract<LaunchBody, { tool: 'marestail' }>;
type Cannon = Extract<LaunchBody, { tool: 'slop-cannon' }>;
type Drafts = { [T in Tool]: Extract<LaunchBody, { tool: T }> };
type Labelled<T> = [keyof T & string, string][];
type LaunchRun = { kind: 'idle' } | { kind: 'refused'; error: string } | { kind: 'answered'; result: LaunchResult };
type FormProps = Props & { info: LaunchInfo; refresh: () => Promise<void> };

const TOOLS: Tool[] = ['marestail', 'slop-cannon'];
const SAFETIES: Cannon['safety'][] = ['on', 'off'];
const IDLE: LaunchRun = { kind: 'idle' };

const MARESTAIL_FIELDS: Labelled<Marestail> = [
  ['model', 'MODEL'],
  ['scope', 'SCOPE'],
  ['focus', 'FOCUS'],
  ['stopAt', 'STOP_AT'],
];
const CANNON_FIELDS: Labelled<Cannon> = [
  ['ammo', 'Ammo'],
  ['cartridge', 'Cartridge'],
];
const COPY_LINES = [
  ['worktree', 'Copy worktree'],
  ['branch', 'Copy branch'],
  ['watch', 'Copy command'],
] as const;
const CANNON_DEFAULTS: Cannon = { tool: 'slop-cannon', safety: 'on', ammo: '', cartridge: '' };

function draftsFor(focus: string): Drafts {
  return { marestail: { tool: 'marestail', model: 'dandelion/route-best', scope: 'hard', focus, stopAt: 'qa' }, 'slop-cannon': CANNON_DEFAULTS };
}

function toolOf(value: string): Tool {
  return TOOLS.find(tool => tool === value) ?? 'marestail';
}

function safetyOf(value: string): Cannon['safety'] {
  return SAFETIES.find(safety => safety === value) ?? 'on';
}

function Options(props: Readonly<{ values: string[] }>) {
  return (
    <>
      {props.values.map(value => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}

function TextFields<T extends LaunchBody>(props: Readonly<{ values: T; fields: Labelled<T>; onChange: (value: T) => void }>) {
  return (
    <>
      {props.fields.map(([key, label]) => (
        <label key={key}>
          {label} <input aria-label={label} value={String(props.values[key])} onInput={event => props.onChange({ ...props.values, [key]: event.currentTarget.value })} />
        </label>
      ))}
    </>
  );
}

function CannonFields(props: Readonly<{ values: Cannon; onChange: (value: Cannon) => void }>) {
  return (
    <>
      <label>
        Safety{' '}
        <select aria-label="Safety" value={props.values.safety} onChange={event => props.onChange({ ...props.values, safety: safetyOf(event.currentTarget.value) })}>
          <Options values={SAFETIES} />
        </select>
      </label>
      <TextFields values={props.values} fields={CANNON_FIELDS} onChange={props.onChange} />
    </>
  );
}

function ToolFields(props: Readonly<{ tool: Tool; drafts: Drafts; onChange: (value: LaunchBody) => void }>): ReactElement {
  switch (props.tool) {
    case 'marestail':
      return <TextFields values={props.drafts.marestail} fields={MARESTAIL_FIELDS} onChange={props.onChange} />;
    case 'slop-cannon':
      return <CannonFields values={props.drafts['slop-cannon']} onChange={props.onChange} />;
  }
}

function CopyLines(props: Readonly<{ source: Partial<LaunchInfo> }>) {
  return (
    <>
      {COPY_LINES.map(([key, label]) => {
        const value = props.source[key];
        if (value === undefined) return null;
        return (
          <p key={key}>
            <code>{value}</code>{' '}
            <button type="button" onClick={() => copy(value)}>
              {label}
            </button>
          </p>
        );
      })}
    </>
  );
}

function Steps(props: Readonly<{ result: LaunchResult }>) {
  return (
    <ol aria-label="Steps">
      {props.result.steps.map(step => (
        <li key={step.name}>
          {step.name} {step.ok ? '✓' : step.error}
        </li>
      ))}
    </ol>
  );
}

function Outcome(props: Readonly<{ run: LaunchRun; info: LaunchInfo }>): ReactElement {
  const run = props.run;
  switch (run.kind) {
    case 'idle':
    case 'refused':
      return <CopyLines source={props.info} />;
    case 'answered':
      return (
        <>
          <Steps result={run.result} />
          <CopyLines source={run.result} />
        </>
      );
  }
}

function shownError(run: LaunchRun, reason: string | null): string | null {
  return run.kind === 'refused' ? run.error : reason;
}

function useLaunchRun(props: Readonly<FormProps>) {
  const held = useRef(false);
  const [run, dispatch, pending] = useActionState(async (_previous: LaunchRun, body: LaunchBody): Promise<LaunchRun> => {
    const answer = await postLaunch(props.token, props.doc.slug, body, props.fetcher);
    held.current = false;
    if ('error' in answer) return { kind: 'refused', error: answer.error };
    await props.refresh();
    return { kind: 'answered', result: answer };
  }, IDLE);
  const launch = (event: SubmitEvent, body: LaunchBody): void => {
    event.preventDefault();
    if (held.current) return;
    held.current = true;
    startTransition(() => dispatch(body));
  };
  return { run, pending, launch };
}

function LaunchForm(props: Readonly<FormProps>) {
  const launch = useLaunchRun(props);
  const [tool, setTool] = useState<Tool>('marestail');
  const [drafts, setDrafts] = useState(() => draftsFor(props.info.focus));
  const reason = launchReason(props.info, props.doc, tool);
  const edit = (value: LaunchBody): void => setDrafts(previous => ({ ...previous, [value.tool]: value }));
  return (
    <form onSubmit={event => launch.launch(event, drafts[tool])}>
      <label>
        Tool{' '}
        <select aria-label="Tool" value={tool} onChange={event => setTool(toolOf(event.currentTarget.value))}>
          <Options values={TOOLS} />
        </select>
      </label>
      <ToolFields tool={tool} drafts={drafts} onChange={edit} />
      <p className="plan-dialog-error">{shownError(launch.run, reason)}</p>
      <button type="submit" disabled={launch.pending || reason !== null}>
        Launch
      </button>
      <Outcome run={launch.run} info={props.info} />
    </form>
  );
}

function LoadedForm(props: Readonly<Props & { data: LaunchInfo | { error: string } | undefined; refresh: () => Promise<void> }>) {
  if (props.data === undefined) return null;
  if ('error' in props.data) return <p className="plan-dialog-error">{props.data.error}</p>;
  return <LaunchForm {...props} info={props.data} />;
}

export function LaunchDialog(props: Readonly<Props>) {
  const opening = useId();
  const queryKey = ['launch', props.token, props.doc.slug, opening];
  const query = useQuery({ queryKey, queryFn: () => fetchLaunch(props.token, props.doc.slug, props.fetcher), gcTime: 0 });
  const queryClient = useQueryClient();
  const refresh = async (): Promise<void> => {
    const fresh = await fetchLaunch(props.token, props.doc.slug, props.fetcher);
    if (!('error' in fresh)) queryClient.setQueryData(queryKey, fresh);
  };
  const { onClose } = props;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div className="plan-dialog-backdrop">
      <dialog open aria-label="Launch" className="plan-dialog">
        <LoadedForm {...props} data={query.data} refresh={refresh} />
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </dialog>
    </div>
  );
}
