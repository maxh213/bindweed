import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchConfig, putConfig, type LlmConfig } from './client.ts';

type Backend = LlmConfig['llm']['backend'];

type SettingsProps = { token: string; fetcher: typeof fetch; onClose: () => void };

const DEFAULT_CONFIG: LlmConfig = { llm: { backend: 'route' } };
const BACKENDS: Backend[] = ['route', 'claude', 'command'];

function configOf(data: LlmConfig | { error: string }): LlmConfig {
  return 'error' in data ? DEFAULT_CONFIG : data;
}

function configToSave(backend: Backend, command: string): LlmConfig {
  return command.trim() === '' ? { llm: { backend } } : { llm: { backend, command } };
}

function backendOf(value: string): Backend {
  return BACKENDS.find(backend => backend === value) ?? 'route';
}

function SettingsForm(props: Readonly<SettingsProps & { initial: LlmConfig }>) {
  const [backend, setBackend] = useState<Backend>(props.initial.llm.backend);
  const [command, setCommand] = useState(props.initial.llm.command ?? '');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const save = async (): Promise<void> => {
    if (backend === 'command' && command.trim() === '') {
      setError('write a command');
      return;
    }
    const saved = await putConfig(props.token, configToSave(backend, command), props.fetcher);
    if ('error' in saved) {
      setError(saved.error);
      return;
    }
    queryClient.setQueryData(['config', props.token], saved);
    props.onClose();
  };
  return (
    <>
      <label>
        Backend{' '}
        <select aria-label="Backend" value={backend} onChange={event => setBackend(backendOf(event.currentTarget.value))}>
          {BACKENDS.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Command <input aria-label="Command" value={command} onInput={event => setCommand(event.currentTarget.value)} />
      </label>
      {error === null ? null : <p className="plan-dialog-error">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Save
      </button>
    </>
  );
}

export function SettingsDialog(props: Readonly<SettingsProps>) {
  const configQuery = useQuery({ queryKey: ['config', props.token] as const, queryFn: () => fetchConfig(props.token, props.fetcher), gcTime: 0 });
  const data = configQuery.data;
  return (
    <div className="plan-dialog-backdrop">
      <dialog open aria-label="Settings" className="plan-dialog">
        {data === undefined ? null : <SettingsForm token={props.token} fetcher={props.fetcher} onClose={props.onClose} initial={configOf(data)} />}
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
      </dialog>
    </div>
  );
}
