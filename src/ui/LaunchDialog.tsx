import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { launchReason, type LaunchBody, type LaunchInfo, type LaunchResult } from '../domain/launch.ts';
import type { PlanDoc } from '../domain/plan.ts';
import { fetchLaunch, postLaunch } from './client.ts';

type Props = { token: string; fetcher: typeof fetch; doc: PlanDoc; onClose: () => void };
type Marestail = Extract<LaunchBody, { tool: 'marestail' }>;
type Cannon = Extract<LaunchBody, { tool: 'slop-cannon' }>;

function TextFields<T extends LaunchBody>(props: Readonly<{ values: T; fields: [keyof T & string, string][]; onChange: (value: T) => void }>) {
  return <>{props.fields.map(([key, label]) => <label key={key}>{label} <input aria-label={label} value={String(props.values[key])} onInput={event => props.onChange({ ...props.values, [key]: event.currentTarget.value })} /></label>)}</>;
}

function CannonFields(props: Readonly<{ values: Cannon; onChange: (value: Cannon) => void }>) {
  return <>
    <label>Safety <select aria-label="Safety" value={props.values.safety} onChange={event => props.onChange({ ...props.values, safety: event.currentTarget.value as Cannon['safety'] })}>
      <option value="on">on</option><option value="off">off</option>
    </select></label>
    <TextFields values={props.values} fields={[["ammo", "Ammo"], ["cartridge", "Cartridge"]]} onChange={props.onChange} />
  </>;
}

function ToolFields(props: Readonly<{ tool: LaunchBody['tool']; marestail: Marestail; cannon: Cannon; onMarestail: (value: Marestail) => void; onCannon: (value: Cannon) => void }>) {
  if (props.tool === 'slop-cannon') return <CannonFields values={props.cannon} onChange={props.onCannon} />;
  return <TextFields values={props.marestail} fields={[["model", "MODEL"], ["scope", "SCOPE"], ["focus", "FOCUS"], ["stopAt", "STOP_AT"]]} onChange={props.onMarestail} />;
}

function CopyLines(props: Readonly<{ source: Partial<LaunchInfo> }>) {
  const lines = [['worktree', 'Copy worktree'], ['branch', 'Copy branch'], ['watch', 'Copy command']] as const;
  return <>{lines.map(([key, label]) => {
    const value = props.source[key];
    return value === undefined ? null : <p key={key}><code>{value}</code> <button type="button" onClick={() => void navigator.clipboard.writeText(value)}>{label}</button></p>;
  })}</>;
}

function Steps(props: Readonly<{ result: LaunchResult | null }>) {
  if (props.result === null) return null;
  return <ol aria-label="Steps">{props.result.steps.map(step => <li key={step.name}>{step.name} {step.ok ? '✓' : step.error}</li>)}</ol>;
}

function LaunchForm(props: Readonly<Props & { initial: LaunchInfo }>) {
  const [info, setInfo] = useState(props.initial);
  const [tool, setTool] = useState<LaunchBody['tool']>('marestail');
  const [marestail, setMarestail] = useState<Marestail>({ tool: 'marestail', model: 'dandelion/route-best', scope: 'hard', focus: props.initial.focus, stopAt: 'qa' });
  const [cannon, setCannon] = useState<Cannon>({ tool: 'slop-cannon', safety: 'on', ammo: '', cartridge: '' });
  const [pending, setPending] = useState(false);
  const held = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const reason = launchReason(info, props.doc, tool);
  const launch = async () => {
    if (held.current) return;
    held.current = true;
    setPending(true);
    setError(null);
    const answer = await postLaunch(props.token, props.doc.slug, { marestail, 'slop-cannon': cannon }[tool], props.fetcher);
    if ('error' in answer) {
      setError(answer.error);
      setResult(null);
    } else {
      setResult(answer);
      const fresh = await fetchLaunch(props.token, props.doc.slug, props.fetcher);
      if (!('error' in fresh)) setInfo(fresh);
    }
    held.current = false;
    setPending(false);
  };
  return <>
    <label>Tool <select aria-label="Tool" value={tool} onChange={event => setTool(event.currentTarget.value as LaunchBody['tool'])}>
      <option value="marestail">marestail</option><option value="slop-cannon">slop-cannon</option>
    </select></label>
    <ToolFields tool={tool} marestail={marestail} cannon={cannon} onMarestail={setMarestail} onCannon={setCannon} />
    <p className="plan-dialog-error">{error ?? reason}</p>
    <button type="button" disabled={pending || reason !== null} onClick={() => void launch()}>Launch</button>
    <Steps result={result} />
    <CopyLines source={result ?? info} />
  </>;
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
  return <div className="plan-dialog-backdrop"><dialog open aria-label="Launch" className="plan-dialog">
    <LoadedForm {...props} data={query.data} />
    <button type="button" onClick={props.onClose}>Close</button>
  </dialog></div>;
}
