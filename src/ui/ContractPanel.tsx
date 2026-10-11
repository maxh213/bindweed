import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Contract, ContractRule, PlanDoc } from '../domain/plan.ts';
import { fetchContract, postContract, type ContractPreview } from './client.ts';

type Preview = ContractPreview | { error: string };

type ContractPanelProps = {
  token: string;
  fetcher: typeof fetch;
  opening: number;
  doc: PlanDoc;
  onSave: (rules: ContractRule[]) => void;
  onClose: () => void;
};

function rulesOf(data: Contract | { error: string } | undefined): ContractRule[] | null {
  if (data === undefined || 'error' in data) return null;
  return data.rules;
}

function savedTick(contract: Contract | undefined, rule: ContractRule): boolean {
  if (contract === undefined) return true;
  const wanted = JSON.stringify(rule);
  return contract.rules.some(saved => JSON.stringify(saved) === wanted);
}

function copiedText(preview: Preview | undefined): string | null {
  if (preview === undefined) return null;
  if ('snippet' in preview) return preview.snippet;
  return 'text' in preview ? preview.text : null;
}

function RuleRows(props: Readonly<{ rules: ContractRule[]; checked: (rule: ContractRule) => boolean; onTick: (name: string, on: boolean) => void }>) {
  return (
    <ul className="contract-rules">
      {props.rules.map(rule => (
        <li key={rule.name}>
          <label>
            <input type="checkbox" aria-label={rule.name} checked={props.checked(rule)} onChange={event => props.onTick(rule.name, event.currentTarget.checked)} />{' '}
            <span>{rule.comment}</span> <code>{rule.name}</code>
          </label>
        </li>
      ))}
    </ul>
  );
}

function PreviewView(props: Readonly<{ preview: Preview | undefined }>) {
  const preview = props.preview;
  if (preview === undefined) return null;
  if ('snippet' in preview) {
    return (
      <>
        <p className="plan-dialog-error">{preview.error}</p>
        <section aria-label="snippet" className="contract-text">
          <pre>{preview.snippet}</pre>
        </section>
      </>
    );
  }
  if ('diff' in preview) {
    return (
      <section aria-label="diff" className="contract-text">
        <pre>{preview.diff}</pre>
      </section>
    );
  }
  return <p className="plan-dialog-error">{preview.error}</p>;
}

function RulesError(props: Readonly<{ data: Contract | { error: string } | undefined }>) {
  if (props.data === undefined || !('error' in props.data)) return null;
  return <p className="plan-dialog-error">{props.data.error}</p>;
}

export function ContractPanel(props: Readonly<ContractPanelProps>) {
  const slug = props.doc.slug;
  const rulesQuery = useQuery({
    queryKey: ['contract', props.token, slug, props.opening] as const,
    queryFn: () => fetchContract(props.token, slug, props.fetcher),
    gcTime: 0,
  });
  const [ticks, setTicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const rules = rulesOf(rulesQuery.data);
  const checked = (rule: ContractRule): boolean => ticks.get(rule.name) ?? savedTick(props.doc.contract, rule);
  const chosen = (rules ?? []).filter(checked);
  const names = chosen.map(rule => rule.name);
  const previewQuery = useQuery({
    queryKey: ['contract-preview', props.token, slug, props.opening, names] as const,
    queryFn: () => postContract(props.token, slug, names, props.fetcher),
    enabled: rules !== null,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
  const preview = rules === null ? undefined : previewQuery.data;
  const copy = (): void => {
    const text = copiedText(preview);
    if (text !== null) void navigator.clipboard.writeText(text);
  };
  const onEscape = useEffectEvent(props.onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="plan-dialog-backdrop">
      <dialog open aria-label="Contract" className="plan-dialog contract-panel">
        <RulesError data={rulesQuery.data} />
        <RuleRows rules={rules ?? []} checked={checked} onTick={(name, on) => setTicks(current => new Map(current).set(name, on))} />
        <PreviewView preview={preview} />
        <button type="button" onClick={copy}>
          Copy
        </button>
        <button type="button" disabled={rules === null} onClick={() => props.onSave(chosen)}>
          Save to plan
        </button>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </dialog>
    </div>
  );
}
