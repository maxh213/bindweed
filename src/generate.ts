import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byStrings, type PlanDoc } from './domain/plan.ts';
import { generateAskFrom, planAfter, promptOf, proposePrompt, readProposal, readReply, retryPrompt, turnFor, type Proposal, type ProposeFacts, type Turn } from './domain/prompt.ts';
import type { PlanWarning, ScanResult } from './domain/scan.ts';
import { firstFreeNumber } from './domain/tasks.ts';
import { backendFor, parseConfig, readConfig, runProcess, writeConfig, type Backend, type LlmConfig, type Outcome, type RunPlace } from './llm.ts';

export { DEFAULT_LIMITS, readConfig, type Limits } from './llm.ts';
export type { PromptEdge, PromptNode, PromptView, Turn } from './domain/prompt.ts';

export type GenerateJob = {
  place: RunPlace;
  doc: PlanDoc;
  turn: Turn;
  scan: ScanResult;
  warnings: PlanWarning[];
  latest: () => Promise<PlanDoc | undefined>;
};

type Generated = { plan?: PlanDoc; body: Record<string, unknown> };

type Failure = Exclude<Outcome, { kind: 'done' }>;

type Settled<T extends object> = { reply: T; stdout: string } | { body: Record<string, unknown> };

type Attempt<T extends object> = Settled<T> | { problem: string; stdout: string };

type Reader<T extends object> = (stdout: string) => T | { problem: string };

const SHIPPED_GUIDE = fileURLToPath(new URL('../templates/tasks-README.md', import.meta.url));

export function turnOf(raw: unknown, doc: PlanDoc): Turn | undefined {
  const ask = generateAskFrom(raw);
  return ask === undefined ? undefined : turnFor(ask, doc.interview);
}

export async function saveConfig(root: string, raw: unknown): Promise<LlmConfig | undefined> {
  const config = parseConfig(raw);
  if (config !== undefined) await writeConfig(root, config);
  return config;
}

async function taskNames(root: string): Promise<string[]> {
  return readdir(join(root, 'tasks')).then(
    names => names.toSorted(byStrings),
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

async function attemptOf<T extends object>(backend: Backend, prompt: string, place: RunPlace, read: Reader<T>): Promise<Attempt<T>> {
  const outcome = await runProcess(backend.spec, prompt, place, place.limits.llmMs);
  if (outcome.kind !== 'done') return { body: failureBody(outcome) };
  const reply = read(outcome.stdout);
  return 'problem' in reply ? { problem: reply.problem, stdout: outcome.stdout } : { reply, stdout: outcome.stdout };
}

async function repliedOf<T extends object>(backend: Backend, prompt: string, place: RunPlace, read: Reader<T>): Promise<Settled<T>> {
  const first = await attemptOf(backend, prompt, place, read);
  if (!('problem' in first)) return first;
  const second = await attemptOf(backend, retryPrompt(prompt, first.problem), place, read);
  if (!('problem' in second)) return second;
  return { body: { error: `the LLM's reply was not usable: ${second.problem}`, raw: second.stdout } };
}

export async function generate(job: GenerateJob): Promise<Generated> {
  const backend = await backendFor(await readConfig(job.place.root), job.place);
  const names = await taskNames(job.place.root);
  const guide = await guideText(job.place.root);
  const prompt = promptOf({ doc: job.doc, scan: job.scan, warnings: job.warnings, guide, names, turn: job.turn });
  const result = await repliedOf(backend, prompt, job.place, stdout => readReply(stdout, job.turn.demanded));
  if ('body' in result) return { body: told(result.body, backend) };
  const latest = await job.latest();
  if (latest === undefined) return { body: told({ error: 'no such plan' }, backend) };
  const plan = planAfter(latest, job.turn, result.reply, firstFreeNumber(names));
  if ('error' in plan) return { body: told({ error: plan.error, raw: result.stdout }, backend) };
  return { plan, body: told({ plan }, backend) };
}

export type ProposeJob = { place: RunPlace; doc: PlanDoc; facts: ProposeFacts };

export type Proposed = { body: Record<string, unknown>; proposal?: Proposal };

export async function propose(job: ProposeJob): Promise<Proposed> {
  const backend = await backendFor(await readConfig(job.place.root), job.place);
  const result = await repliedOf(backend, proposePrompt(job.facts), job.place, readProposal);
  if ('body' in result) return { body: told(result.body, backend) };
  return { proposal: result.reply, body: told({ summary: result.reply.summary, edits: result.reply.edits }, backend) };
}
