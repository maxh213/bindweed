import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { noExtraKeys, recordOf } from './domain/plan.ts';

type BackendName = 'route' | 'claude' | 'command';

export type LlmConfig = { llm: { backend: BackendName; command?: string } };

export type Limits = { llmMs: number; routeMs: number };

type Spawned = { bin: string; args: string[]; env: NodeJS.ProcessEnv };

export type Backend = { spec: Spawned; ran: string; note?: string };

export type Outcome =
  | { kind: 'done'; stdout: string }
  | { kind: 'exit'; code: number; stdout: string }
  | { kind: 'signal'; signal: string; stdout: string }
  | { kind: 'timeout'; stdout: string }
  | { kind: 'cancelled' }
  | { kind: 'missing'; bin: string };

type Failure = Exclude<Outcome, { kind: 'done' }>;

type Stop = 'timeout' | 'cancelled' | null;

export type RunPlace = { root: string; env: NodeJS.ProcessEnv; limits: Limits; signal: AbortSignal };

export const DEFAULT_LIMITS: Limits = { llmMs: 15 * 60 * 1000, routeMs: 60 * 1000 };
const DEFAULT_CONFIG: LlmConfig = { llm: { backend: 'route' } };
const FALLBACK_MODEL = 'claude-opus-5-5';
const CLAUDE_PROVIDERS = new Set(['claude', 'claude-work']);
const DROPPED_ENV = new Set(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);

function backendOf(raw: unknown): BackendName | undefined {
  return raw === 'route' || raw === 'claude' || raw === 'command' ? raw : undefined;
}

function commandFitted(backend: BackendName, command: string): LlmConfig['llm'] | undefined {
  return backend !== 'command' || command.trim() !== '' ? { backend, command } : undefined;
}

function withCommand(backend: BackendName, command: unknown): LlmConfig['llm'] | undefined {
  if (command === undefined) return backend === 'command' ? undefined : { backend };
  return typeof command === 'string' ? commandFitted(backend, command) : undefined;
}

function llmFrom(raw: unknown): LlmConfig['llm'] | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['backend', 'command'])) return undefined;
  const backend = backendOf(rec.backend);
  return backend === undefined ? undefined : withCommand(backend, rec.command);
}

export function parseConfig(raw: unknown): LlmConfig | undefined {
  const rec = recordOf(raw);
  if (rec === undefined || !noExtraKeys(rec, ['llm'])) return undefined;
  const llm = llmFrom(rec.llm);
  return llm === undefined ? undefined : { llm };
}

function configFile(root: string): string {
  return join(root, '.bindweed', 'config.json');
}

export async function readConfig(root: string): Promise<LlmConfig> {
  return readFile(configFile(root), 'utf8')
    .then(text => parseConfig(JSON.parse(text)) ?? DEFAULT_CONFIG)
    .catch(() => DEFAULT_CONFIG);
}

export async function writeConfig(root: string, config: LlmConfig): Promise<void> {
  await mkdir(join(root, '.bindweed'), { recursive: true });
  await writeFile(configFile(root), JSON.stringify(config));
}

function killGroup(pid: number | undefined): void {
  try {
    process.kill(-Number(pid), 'SIGKILL');
  } catch {
    return;
  }
}

function endedOutcome(code: number | null, signal: NodeJS.Signals | null, stdout: string): Outcome {
  if (code === 0) return { kind: 'done', stdout };
  return code === null ? { kind: 'signal', signal: String(signal), stdout } : { kind: 'exit', code, stdout };
}

function closedOutcome(stop: Stop, code: number | null, signal: NodeJS.Signals | null, stdout: string): Outcome {
  if (stop === 'cancelled') return { kind: 'cancelled' };
  return stop === 'timeout' ? { kind: 'timeout', stdout } : endedOutcome(code, signal, stdout);
}

type Child = ChildProcessByStdio<Writable, Readable, null>;

function outcomeOf(child: Child, bin: string, signal: AbortSignal, limitMs: number): Promise<Outcome> {
  return new Promise(done => {
    const out: Buffer[] = [];
    let stop: Stop = null;
    const halt = (why: Stop): void => {
      stop = why;
      killGroup(child.pid);
    };
    const timer = setTimeout(() => halt('timeout'), limitMs);
    const onAbort = (): void => halt('cancelled');
    const settle = (outcome: Outcome): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      done(outcome);
    };
    signal.addEventListener('abort', onAbort);
    child.stdout.on('data', (piece: Buffer) => out.push(Buffer.from(piece)));
    child.on('error', () => settle({ kind: 'missing', bin }));
    child.on('close', (code, ended) => settle(closedOutcome(stop, code, ended, Buffer.concat(out).toString())));
  });
}

export async function runProcess(spec: Spawned, input: string, place: RunPlace, limitMs: number): Promise<Outcome> {
  if (place.signal.aborted) return { kind: 'cancelled' };
  const child = spawn(spec.bin, spec.args, { cwd: place.root, env: spec.env, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.on('error', () => undefined);
  child.stdin.end(input);
  return outcomeOf(child, spec.bin, place.signal, limitMs);
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !DROPPED_ENV.has(key)));
}

function claudeArgs(model: string, effort: string): string[] {
  return ['-p', '--model', model, '--effort', effort, '--output-format', 'text', '--allowedTools', 'Read,Grep,Glob'];
}

function claudeBackend(env: NodeJS.ProcessEnv, note?: string): Backend {
  const backend: Backend = { spec: { bin: 'claude', args: claudeArgs(FALLBACK_MODEL, 'high'), env: cleanEnv(env) }, ran: `claude: ${FALLBACK_MODEL}, effort high` };
  return note === undefined ? backend : { ...backend, note };
}

function providerEnv(env: NodeJS.ProcessEnv, provider: string): NodeJS.ProcessEnv {
  if (provider === 'claude') return cleanEnv(env);
  return { ...cleanEnv(env), CLAUDE_CONFIG_DIR: `${env.HOME ?? ''}/.claude-work` };
}

function pickedBackend(env: NodeJS.ProcessEnv, model: string, effort: string, provider: string): Backend {
  if (!CLAUDE_PROVIDERS.has(provider)) {
    return claudeBackend(env, `route picked ${provider}; bindweed speaks to claude only, so it used ${FALLBACK_MODEL}`);
  }
  return { spec: { bin: 'claude', args: claudeArgs(model, effort), env: providerEnv(env, provider) }, ran: `route: ${model}, effort ${effort}, provider ${provider}` };
}

export function routePick(stdout: string, env: NodeJS.ProcessEnv): Backend {
  const line = stdout.trim();
  const words = line.split(/\s+/);
  if (words.length !== 3) return claudeBackend(env, `marestail route printed "${line}", which bindweed can't read, so it used ${FALLBACK_MODEL}`);
  const [model, effort, provider] = words;
  return pickedBackend(env, model, effort, provider);
}

function stoppedReason(failure: Exclude<Failure, { kind: 'missing' | 'exit' }>): string {
  if (failure.kind === 'signal') return `marestail route was stopped by ${failure.signal}`;
  return failure.kind === 'timeout' ? 'marestail route ran past its time limit' : 'marestail route was cancelled';
}

function routeFailure(failure: Failure): string {
  if (failure.kind === 'missing') return 'marestail is not on PATH';
  return failure.kind === 'exit' ? `marestail route exited with code ${failure.code}` : stoppedReason(failure);
}

async function routeBackend(place: RunPlace): Promise<Backend> {
  const outcome = await runProcess({ bin: 'marestail', args: ['route', '--high'], env: cleanEnv(place.env) }, '', place, place.limits.routeMs);
  if (outcome.kind === 'done') return routePick(outcome.stdout, place.env);
  return claudeBackend(place.env, `${routeFailure(outcome)}, so bindweed used ${FALLBACK_MODEL}`);
}

function commandBackend(command: string, place: RunPlace): Backend {
  return { spec: { bin: 'sh', args: ['-c', command], env: { ...cleanEnv(place.env), BINDWEED_ROOT: place.root } }, ran: `command: ${command}` };
}

export async function backendFor(config: LlmConfig, place: RunPlace): Promise<Backend> {
  if (config.llm.backend === 'route') return routeBackend(place);
  if (config.llm.backend === 'claude') return claudeBackend(place.env);
  return commandBackend(String(config.llm.command), place);
}
