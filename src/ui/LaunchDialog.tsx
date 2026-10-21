import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { launchReason, type LaunchBody, type LaunchInfo, type LaunchResult } from '../domain/launch.ts';
import type { PlanDoc } from '../domain/plan.ts';
import { fetchLaunch, postLaunch } from './client.ts';

type Props = { token: string; fetcher: typeof fetch; doc: PlanDoc; onClose: () => void };
type Tool = LaunchBody['tool'];
type Marestail = Extract<LaunchBody, { tool: 'marestail' }>;
type Cannon = Extract<LaunchBody, { tool: 'slop-cannon' }>;
type Labelled<T> = [keyof T & string, string][];

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

function marestailDefaults(focus: string): Marestail {
  return { tool: 'marestail', model: 'dandelion/route-best', scope: 'hard', focus, stopAt: 'qa' };
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
        <select aria-label="Safety" value={props.values.safety} onChange={event => props.onChange({ ...props.values, safety: event.currentTarget.value as Cannon['safety'] })}>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      </label>
      <TextFields values={props.values} fields={CANNON_FIELDS} onChange={props.onChange} />
    </>
  );
}

function ToolFields(props: Readonly<{ tool: Tool; marestail: Marestail; cannon: Cannon; onMarestail: (value: Marestail) => void; onCannon: (value: Cannon) => void }>) {
  if (props.tool === 'slop-cannon') return <CannonFields values={props.cannon} onChange={props.onCannon} />;
  return <TextFields values={props.marestail} fields={MARESTAIL_FIELDS} onChange={props.onMarestail} />;
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

function Steps(props: Readonly<{ result: LaunchResult | null }>) {
  if (props.result === null) return null;
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

function useLaunchRun(props: Readonly<Props & { initial: LaunchInfo }>) {
  const [info, setInfo] = useState(props.initial);
  const [pending, setPending] = useState(false);
  const held = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const refresh = async (): Promise<void> => {
    const fresh = await fetchLaunch(props.token, props.doc.slug, props.fetcher);
    if (!('error' in fresh)) setInfo(fresh);
  };
  const launch = async (body: LaunchBody): Promise<void> => {
    if (held.current) return;
    held.current = true;
    setPending(true);
    setError(null);
    const answer = await postLaunch(props.token, props.doc.slug, body, props.fetcher);
    if ('error' in answer) {
      setError(answer.error);
      setResult(null);
    } else {
      setResult(answer);
      await refresh();
    }
    held.current = false;
    setPending(false);
  };
  return { info, pending, error, result, launch };
}

function LaunchForm(props: Readonly<Props & { initial: LaunchInfo }>) {
  const run = useLaunchRun(props);
  const [tool, setTool] = useState<Tool>('marestail');
  const [marestail, setMarestail] = useState(marestailDefaults(props.initial.focus));
  const [cannon, setCannon] = useState(CANNON_DEFAULTS);
  const reason = launchReason(run.info, props.doc, tool);
  return (
    <>
      <label>
        Tool{' '}
        <select aria-label="Tool" value={tool} onChange={event => setTool(event.currentTarget.value as Tool)}>
          <option value="marestail">marestail</option>
          <option value="slop-cannon">slop-cannon</option>
        </select>
      </label>
      <ToolFields tool={tool} marestail={marestail} cannon={cannon} onMarestail={setMarestail} onCannon={setCannon} />
      <p className="plan-dialog-error">{run.error ?? reason}</p>
      <button type="button" disabled={run.pending || reason !== null} onClick={() => void run.launch(tool === 'marestail' ? marestail : cannon)}>
        Launch
      </button>
      <Steps result={run.result} />
      <CopyLines source={run.result ?? run.info} />
    </>
  );
}

function LoadedForm(props: Readonly<Props & { data: LaunchInfo | { error: string } | undefined }>) {
  if (props.data === undefined) return null;
  if ('error' in props.data) return <p className="plan-dialog-error">{props.data.error}</p>;
  return <LaunchForm {...props} initial={props.data} />;
}

export function LaunchDialog(props: Readonly<Props>) {
  const opening = useId();
  const query = useQuery({ queryKey: ['launch', props.token, props.doc.slug, opening], queryFn: () => fetchLaunch(props.token, props.doc.slug, props.fetcher), gcTime: 0 });
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
        <LoadedForm {...props} data={query.data} />
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </dialog>
    </div>
  );
}
