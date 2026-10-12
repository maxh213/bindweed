import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byStrings, type PlanDoc } from './domain/plan.ts';
import { planAfter, promptOf, readReply, retryPrompt, type Reply, type Turn } from './domain/prompt.ts';
import type { PlanWarning, ScanResult } from './domain/scan.ts';
import { firstFreeNumber } from './domain/tasks.ts';
import { backendFor, runProcess, type Backend, type LlmConfig, type Outcome, type RunPlace } from './llm.ts';

export type GenerateJob = {
  place: RunPlace;
  config: LlmConfig;
  doc: PlanDoc;
  turn: Turn;
  scan: ScanResult;
  warnings: PlanWarning[];
  latest: () => Promise<PlanDoc | undefined>;
};

type Generated = { plan?: PlanDoc; body: Record<string, unknown> };

type Failure = Exclude<Outcome, { kind: 'done' }>;

type Settled = { reply: Reply; stdout: string } | { body: Record<string, unknown> };

type Attempt = Settled | { problem: string; stdout: string };

const SHIPPED_GUIDE = fileURLToPath(new URL('../templates/tasks-README.md', import.meta.url));

async function taskNames(root: string): Promise<string[]> {
  return readdir(join(root, 'tasks')).then(
    names => names.sort(byStrings),
    () => [],
  );
}

async function guideText(root: string): Promise<string> {
  return readFile(join(root, 'tasks', 'README.md'), 'utf8').catch(() => readFile(SHIPPED_GUIDE, 'utf8'));
}

function rawFailure(failure: Extract<Failure, { kind: 'exit' | 'signal' | 'timeout' }>): string {
  if (failure.kind === 'exit') return `the LLM command exited with code ${failure.code}`;
  return failure.kind === 'signal' ? `the LLM command was stopped by ${failure.signal}` : 'the LLM ran past its time limit and was stopped';
}

function failureBody(failure: Failure): Record<string, unknown> {
  if (failure.kind === 'missing') return { error: `${failure.bin} is not on PATH` };
  if (failure.kind === 'cancelled') return { error: 'cancelled' };
  return { error: rawFailure(failure), raw: failure.stdout };
}

function told(body: Record<string, unknown>, backend: Backend): Record<string, unknown> {
  const said = { ...body, ran: backend.ran };
  return backend.note === undefined ? said : { ...said, note: backend.note };
}

async function attempt(backend: Backend, prompt: string, job: GenerateJob): Promise<Attempt> {
  const outcome = await runProcess(backend.spec, prompt, job.place, job.place.limits.llmMs);
  if (outcome.kind !== 'done') return { body: failureBody(outcome) };
  const reply = readReply(outcome.stdout, job.turn.demanded);
  return 'problem' in reply ? { problem: reply.problem, stdout: outcome.stdout } : { reply, stdout: outcome.stdout };
}

async function replied(backend: Backend, prompt: string, job: GenerateJob): Promise<Settled> {
  const first = await attempt(backend, prompt, job);
  if (!('problem' in first)) return first;
  const second = await attempt(backend, retryPrompt(prompt, first.problem), job);
  if (!('problem' in second)) return second;
  return { body: { error: `the LLM's reply was not usable: ${second.problem}`, raw: second.stdout } };
}

export async function generate(job: GenerateJob): Promise<Generated> {
  const backend = await backendFor(job.config, job.place);
  const names = await taskNames(job.place.root);
  const guide = await guideText(job.place.root);
  const prompt = promptOf({ doc: job.doc, scan: job.scan, warnings: job.warnings, guide, names, turn: job.turn });
  const result = await replied(backend, prompt, job);
  if ('body' in result) return { body: told(result.body, backend) };
  const latest = await job.latest();
  if (latest === undefined) return { body: told({ error: 'no such plan' }, backend) };
  const plan = planAfter(latest, job.turn, result.reply, firstFreeNumber(names));
  if ('error' in plan) return { body: told({ error: plan.error, raw: result.stdout }, backend) };
  return { plan, body: told({ plan }, backend) };
}
