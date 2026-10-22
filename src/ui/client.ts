import { z } from 'zod';
import type { LaunchBody } from '../domain/launch.ts';
import type { GraphView, NodeDetail } from '../domain/graph.ts';
import { emptyLayout, parseLayout, type LayoutDoc } from '../domain/layout.ts';
import { parseChat, type ChatTurn } from '../domain/chat.ts';
import { parseContract, parsePlan, type Contract, type PlanDoc, type PlanSummary } from '../domain/plan.ts';
import type { TreeEntry } from '../domain/tree.ts';

const treeEntrySchema: z.ZodType<TreeEntry> = z.lazy(() =>
  z.union([
    z.object({
      name: z.string(),
      path: z.string(),
      kind: z.literal('file'),
    }),
    z.object({
      name: z.string(),
      path: z.string(),
      kind: z.literal('dir'),
      children: z.array(treeEntrySchema),
    }),
  ]),
);

const treeJsonSchema = z.object({
  root: z.string(),
  entries: z.array(treeEntrySchema),
});

const fileOkSchema = z.union([
  z.object({ path: z.string(), text: z.string() }),
  z.object({ path: z.string(), binary: z.literal(true) }),
]);

const errorBodySchema = z.object({ error: z.string().optional() });

const nodeMarks = {
  abstract: z.literal(true).optional(),
  test: z.literal(true).optional(),
  fate: z.literal('delete').optional(),
};

const warningSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty-package'), path: z.string() }),
  z.object({ kind: z.literal('deleted-imports'), file: z.string(), importers: z.array(z.string()) }),
  z.object({ kind: z.literal('added-cycle'), cycle: z.string() }),
]);

const healthFields = {
  crap: z.union([z.number(), z.literal('–')]).optional(),
  coverage: z.string().optional(),
  mutants: z.number().optional(),
  ca: z.number().optional(),
  ce: z.number().optional(),
  i: z.string().optional(),
  a: z.string().optional(),
  d: z.string().optional(),
  zone: z.enum(['pain', 'useless', 'healthy']).optional(),
};

const reportFlag = z.enum(['on', 'stale', 'off']);

const hotFunctionSchema = z.object({
  name: z.string(),
  line: z.number(),
  cc: z.number(),
  coverage: z.string(),
  crap: z.number(),
});

const graphNodeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('package'),
    name: z.string(),
    path: z.string(),
    files: z.number(),
    row: z.number(),
    order: z.number(),
    cycle: z.boolean(),
    ...nodeMarks,
    ...healthFields,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('file'),
    name: z.string(),
    path: z.string(),
    row: z.number(),
    order: z.number(),
    cycle: z.boolean(),
    ...nodeMarks,
    ...healthFields,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('external'),
    name: z.string(),
    path: z.string(),
    row: z.number(),
    order: z.number(),
    cycle: z.boolean(),
  }),
]);

const graphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  runtime: z.number(),
  type: z.number(),
  heritage: z.number().optional(),
  planned: z.literal(true).optional(),
  cycle: z.boolean(),
  cycleText: z.string().optional(),
});

const detailEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['package', 'file', 'external']),
  runtime: z.number(),
  type: z.number(),
  heritage: z.number(),
});

const detailSchema: z.ZodType<NodeDetail> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(['package', 'file', 'external']),
  files: z.number().optional(),
  abstract: z.literal(true).optional(),
  imports: z.array(detailEntrySchema),
  importedBy: z.array(detailEntrySchema),
  ...healthFields,
  hot: z.array(hotFunctionSchema).optional(),
});

const graphJsonSchema: z.ZodType<GraphView> = z.object({
  at: z.string(),
  crumbs: z.array(z.object({ name: z.string(), at: z.string() })),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  crapMax: z.number().default(4),
  coverage: reportFlag.default('off'),
  mutation: reportFlag.default('off'),
  stale: z.array(z.string().nullable()).optional(),
  warnings: z.array(z.array(warningSchema)).optional(),
});

const rescanJsonSchema = z.object({ files: z.number(), ms: z.number() });

const planListSchema = z.object({
  plans: z.array(z.object({ name: z.string(), slug: z.string(), editCount: z.number(), createdAt: z.string() })),
});

const pairsSchema = z.object({ pairs: z.array(z.tuple([z.string(), z.string()])) });

export type RescanJson = z.infer<typeof rescanJsonSchema>;

export type TreeJson = z.infer<typeof treeJsonSchema>;
export type FileJson = z.infer<typeof fileOkSchema> | { error: string };

function apiError(body: { error?: string }): { error: string } {
  return { error: body.error ?? 'cannot reach bindweed' };
}

function errorFrom(raw: unknown): { error: string } {
  const err = errorBodySchema.safeParse(raw);
  return apiError(err.success ? err.data : {});
}

function parseBody<T>(schema: z.ZodType<T>, raw: unknown, ok: boolean): T | { error: string } {
  if (!ok) return errorFrom(raw);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : { error: 'cannot reach bindweed' };
}

export type GraphQuery = { tests?: boolean; external?: boolean; plan?: string | null; proposals?: string; converge?: string | null };

function withFlag(params: URLSearchParams, name: string, on: boolean | undefined): void {
  if (on === true) params.set(name, '1');
}

function withSlug(params: URLSearchParams, name: string, slug: string | null | undefined): void {
  if (typeof slug === 'string' && slug !== '') params.set(name, slug);
}

function withProposals(params: URLSearchParams, proposals: string | undefined): void {
  if (proposals !== undefined && proposals !== '') params.set('proposals', proposals);
}

function queryUrl(path: string, params: Record<string, string>, query: GraphQuery): string {
  const search = new URLSearchParams(params);
  withFlag(search, 'tests', query.tests);
  withFlag(search, 'external', query.external);
  withSlug(search, 'plan', query.plan);
  withProposals(search, query.proposals);
  withSlug(search, 'converge', query.converge);
  return `${path}?${search.toString()}`;
}

function graphUrl(at: string, query: GraphQuery): string {
  return queryUrl('/api/graph', { at }, query);
}

export async function fetchGraph(
  token: string,
  at: string,
  fetcher: typeof fetch = fetch,
  query: GraphQuery = {},
): Promise<GraphView | { error: string }> {
  try {
    const res = await fetcher(graphUrl(at, query), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return parseBody(graphJsonSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

async function layoutDoc(token: string, fetcher: typeof fetch): Promise<LayoutDoc> {
  const res = await fetcher('/api/layout', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return emptyLayout();
  return parseLayout(await res.json()) ?? emptyLayout();
}

export async function fetchLayout(token: string, fetcher: typeof fetch = fetch): Promise<LayoutDoc> {
  try {
    return await layoutDoc(token, fetcher);
  } catch {
    return emptyLayout();
  }
}

async function layoutPut(token: string, doc: LayoutDoc, fetcher: typeof fetch): Promise<LayoutDoc | { error: string }> {
  const res = await fetcher('/api/layout', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  const raw: unknown = await res.json();
  if (!res.ok) return errorFrom(raw);
  return parseLayout(raw) ?? { error: 'cannot reach bindweed' };
}

export async function putLayout(
  token: string,
  doc: LayoutDoc,
  fetcher: typeof fetch = fetch,
): Promise<LayoutDoc | { error: string }> {
  try {
    return await layoutPut(token, doc, fetcher);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

function detailUrl(id: string, at: string, query: GraphQuery): string {
  return queryUrl('/api/detail', { id, at }, query);
}

export async function fetchDetail(
  token: string,
  id: string,
  at: string,
  fetcher: typeof fetch = fetch,
  query: GraphQuery = {},
): Promise<NodeDetail | { error: string }> {
  try {
    const res = await fetcher(detailUrl(id, at, query), { headers: { Authorization: `Bearer ${token}` } });
    return parseBody(detailSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export type { LayoutDoc };

function rescanUrl(converge: string | null): string {
  return converge === null ? '/api/rescan' : `/api/rescan?converge=${encodeURIComponent(converge)}`;
}

export async function postRescan(token: string, fetcher: typeof fetch = fetch, converge: string | null = null): Promise<RescanJson | { error: string }> {
  try {
    const res = await fetcher(rescanUrl(converge), { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return parseBody(rescanJsonSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

function planBody(raw: unknown, ok: boolean): PlanDoc | { error: string } {
  if (!ok) return errorFrom(raw);
  const doc = parsePlan(raw);
  return doc ?? { error: 'cannot reach bindweed' };
}

export async function fetchPlans(token: string, fetcher: typeof fetch = fetch): Promise<{ plans: PlanSummary[] } | { error: string }> {
  try {
    const res = await fetcher('/api/plans', { headers: { Authorization: `Bearer ${token}` } });
    return parseBody(planListSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function postPlan(token: string, name: string, fetcher: typeof fetch = fetch): Promise<PlanDoc | { error: string }> {
  try {
    const res = await fetcher('/api/plans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return planBody(await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function fetchPlan(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<PlanDoc | { error: string }> {
  try {
    const res = await fetcher(`/api/plans/${slug}`, { headers: { Authorization: `Bearer ${token}` } });
    return planBody(await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function putPlan(token: string, doc: PlanDoc, fetcher: typeof fetch = fetch): Promise<PlanDoc | { error: string }> {
  try {
    const res = await fetcher(`/api/plans/${doc.slug}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return planBody(await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function deletePlan(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetcher(`/api/plans/${slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const raw: unknown = await res.json();
    if (!res.ok) return errorFrom(raw);
    return { ok: true };
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

function contractBody(raw: unknown, ok: boolean): Contract | { error: string } {
  if (!ok) return errorFrom(raw);
  return parseContract(raw) ?? { error: 'cannot reach bindweed' };
}

export async function fetchContract(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<Contract | { error: string }> {
  try {
    const res = await fetcher(`/api/plans/${slug}/contract`, { headers: { Authorization: `Bearer ${token}` } });
    return contractBody(await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

const previewSchema = z.union([z.object({ text: z.string(), diff: z.string() }), z.object({ error: z.string(), snippet: z.string() })]);

export type ContractPreview = z.infer<typeof previewSchema>;

export async function postContract(
  token: string,
  slug: string,
  names: string[],
  fetcher: typeof fetch = fetch,
): Promise<ContractPreview | { error: string }> {
  try {
    const res = await fetcher(`/api/plans/${slug}/contract`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    });
    return parseBody(previewSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function fetchPairs(
  token: string,
  from: string,
  to: string,
  at: string,
  query: GraphQuery = {},
  fetcher: typeof fetch = fetch,
): Promise<{ pairs: [string, string][] } | { error: string }> {
  try {
    const res = await fetcher(queryUrl('/api/pairs', { from, to, at }, query), { headers: { Authorization: `Bearer ${token}` } });
    return parseBody(pairsSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function fetchTree(token: string, fetcher: typeof fetch = fetch): Promise<TreeJson | { error: string }> {
  try {
    const res = await fetcher('/api/tree', { headers: { Authorization: `Bearer ${token}` } });
    return parseBody(treeJsonSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function fetchFile(
  token: string,
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<FileJson> {
  try {
    const res = await fetcher(`/api/file?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return parseBody(fileOkSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

const TOKEN_KEY = 'bindweed.token';

export function takeToken(location: Location, storage: Storage, historyApi: History): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl !== null) {
    storage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete('token');
    historyApi.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return fromUrl;
  }
  return storage.getItem(TOKEN_KEY);
}

const configSchema = z.object({ llm: z.object({ backend: z.enum(['route', 'claude', 'command']), command: z.string().optional() }) });

export type LlmConfig = z.infer<typeof configSchema>;

async function answered<T>(fetcher: typeof fetch, path: string, init: RequestInit, read: (raw: unknown, ok: boolean) => T | { error: string }): Promise<T | { error: string }> {
  try {
    const res = await fetcher(path, init);
    return read(await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function sendingJson(token: string, method: string, body: unknown): RequestInit {
  return { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function readWith<T>(schema: z.ZodType<T>): (raw: unknown, ok: boolean) => T | { error: string } {
  return (raw, ok) => parseBody(schema, raw, ok);
}

export function fetchConfig(token: string, fetcher: typeof fetch = fetch): Promise<LlmConfig | { error: string }> {
  return answered(fetcher, '/api/config', bearer(token), readWith(configSchema));
}

export function putConfig(token: string, config: LlmConfig, fetcher: typeof fetch = fetch): Promise<LlmConfig | { error: string }> {
  return answered(fetcher, '/api/config', sendingJson(token, 'PUT', config), readWith(configSchema));
}

const runWordsSchema = z.object({ ran: z.string(), note: z.string().optional() });

const failedRunSchema = runWordsSchema.extend({ error: z.string(), raw: z.string().optional() });

export type GenerateBody = { step: 'ask' } | { step: 'answer' | 'write'; answers: string[] };

export type GenerateAnswer = { plan: PlanDoc; ran: string; note?: string } | { error: string; raw?: string; ran?: string; note?: string };

const doneRunSchema = runWordsSchema.extend({ plan: z.unknown() });

function donePlan(raw: unknown): GenerateAnswer {
  const done = doneRunSchema.safeParse(raw);
  if (!done.success) return { error: 'cannot reach bindweed' };
  const plan = parsePlan(done.data.plan);
  return plan === undefined ? { error: 'cannot reach bindweed' } : { ...done.data, plan };
}

function generateAnswer(raw: unknown, ok: boolean): GenerateAnswer {
  if (!ok) return errorFrom(raw);
  const failed = failedRunSchema.safeParse(raw);
  return failed.success ? failed.data : donePlan(raw);
}

export function postGenerate(token: string, slug: string, body: GenerateBody, fetcher: typeof fetch = fetch): Promise<GenerateAnswer> {
  return answered(fetcher, `/api/plans/${slug}/generate`, sendingJson(token, 'POST', body), generateAnswer);
}

const proposeOkSchema = z.object({
  ran: z.string(),
  summary: z.string(),
  edits: z.array(z.unknown()),
  stale: z.array(z.union([z.string(), z.null()])),
  chat: z.unknown(),
  note: z.string().optional(),
});

export type ProposeAnswer =
  | { ran: string; summary: string; edits: unknown[]; stale: (string | null)[]; chat: ChatTurn[]; note?: string }
  | { error: string; raw?: string; ran?: string; note?: string };

function proposeOk(raw: z.infer<typeof proposeOkSchema>): ProposeAnswer {
  const chat = parseChat(raw.chat);
  if (chat === undefined) return { error: 'cannot reach bindweed' };
  return { ran: raw.ran, summary: raw.summary, edits: raw.edits, stale: raw.stale, chat, note: raw.note };
}

function proposeAnswer(raw: unknown, ok: boolean): ProposeAnswer {
  if (!ok) return errorFrom(raw);
  const failed = failedRunSchema.safeParse(raw);
  if (failed.success) return failed.data;
  const done = proposeOkSchema.safeParse(raw);
  return done.success ? proposeOk(done.data) : { error: 'cannot reach bindweed' };
}

export function postPropose(token: string, slug: string, body: { text: string; at: string }, fetcher: typeof fetch = fetch): Promise<ProposeAnswer> {
  return answered(fetcher, `/api/plans/${slug}/propose`, sendingJson(token, 'POST', body), proposeAnswer);
}

function chatBody(raw: unknown, ok: boolean): ChatTurn[] | { error: string } {
  if (!ok) return errorFrom(raw);
  return parseChat(raw) ?? { error: 'cannot reach bindweed' };
}

export function fetchChat(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<ChatTurn[] | { error: string }> {
  return answered(fetcher, `/api/plans/${slug}/chat`, bearer(token), chatBody);
}

export function putChat(token: string, slug: string, turns: ChatTurn[], fetcher: typeof fetch = fetch): Promise<ChatTurn[] | { error: string }> {
  return answered(fetcher, `/api/plans/${slug}/chat`, sendingJson(token, 'PUT', turns), chatBody);
}

export function postReview(token: string, slug: string, edits: unknown[], fetcher: typeof fetch = fetch): Promise<{ stale: (string | null)[] } | { error: string }> {
  return answered(fetcher, `/api/plans/${slug}/review`, sendingJson(token, 'POST', { edits }), readWith(z.object({ stale: z.array(z.union([z.string(), z.null()])) })));
}

function postPlanAction<T>(token: string, slug: string, action: string, schema: z.ZodType<T>, fetcher: typeof fetch): Promise<T | { error: string }> {
  return answered(fetcher, `/api/plans/${slug}/${action}`, { method: 'POST', ...bearer(token) }, readWith(schema));
}

export function postCancel(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<{ cancelled: boolean } | { error: string }> {
  return postPlanAction(token, slug, 'cancel', z.object({ cancelled: z.boolean() }), fetcher);
}

export function postFiles(token: string, slug: string, fetcher: typeof fetch = fetch): Promise<{ dir: string } | { error: string }> {
  return postPlanAction(token, slug, 'files', z.object({ dir: z.string() }), fetcher);
}

export function fetchRepo(token: string, fetcher: typeof fetch = fetch): Promise<{ root: string } | { error: string }> {
  return answered(fetcher, '/api/repo', bearer(token), readWith(z.object({ root: z.string() })));
}

const launchLines = { worktree: z.string().optional(), branch: z.string().optional(), watch: z.string().optional() };
const launchInfoSchema = z.object({ marestail: z.boolean(), sc: z.boolean(), alive: z.boolean(), focus: z.string(), ...launchLines });
const launchResultSchema = z.object({ steps: z.array(z.object({ name: z.string(), ok: z.boolean(), error: z.string().optional() })), pid: z.number().optional(), ...launchLines });

export function fetchLaunch(token: string, slug: string, fetcher: typeof fetch = fetch) {
  return answered(fetcher, `/api/plans/${slug}/launch`, bearer(token), readWith(launchInfoSchema));
}

export function postLaunch(token: string, slug: string, body: LaunchBody, fetcher: typeof fetch = fetch) {
  return answered(fetcher, `/api/plans/${slug}/launch`, sendingJson(token, 'POST', body), readWith(launchResultSchema));
}

const runSchema = z.object({
  slug: z.string(),
  planName: z.string(),
  planExists: z.boolean(),
  tool: z.string(),
  branch: z.string().nullable(),
  worktree: z.string(),
  worktreeExists: z.boolean(),
  pid: z.number().nullable(),
  startedAt: z.string(),
  state: z.enum(['running', 'stopped for a human', 'failed', 'done', 'dead', 'worktree removed']),
  position: z.string(),
  prs: z.array(z.string()),
  logTail: z.array(z.string()),
});

export type RunCard = z.infer<typeof runSchema>;

const convergeSchema = z.object({
  slug: z.string(),
  worktree: z.string(),
  pidAlive: z.boolean(),
  header: z.string(),
  edits: z.array(z.object({ index: z.number(), status: z.enum(['done', 'not yet', 'contradicted', 'note']), sentence: z.string(), remain: z.array(z.string()).optional() })),
  rules: z.array(z.object({ name: z.string(), comment: z.string(), holds: z.boolean(), breaks: z.array(z.string()).optional() })),
});

export type ConvergeAnswer = z.infer<typeof convergeSchema>;

export function fetchConverge(token: string, slug: string, fetcher: typeof fetch = fetch) {
  return answered(fetcher, `/api/converge?slug=${encodeURIComponent(slug)}`, bearer(token), readWith(convergeSchema));
}

export function fetchRuns(token: string, fetcher: typeof fetch = fetch) {
  return answered(fetcher, '/api/runs', bearer(token), readWith(z.object({ runs: z.array(runSchema) })));
}

export function forgetRun(token: string, worktree: string, fetcher: typeof fetch = fetch) {
  return answered(fetcher, `/api/runs?worktree=${encodeURIComponent(worktree)}`, { ...bearer(token), method: 'DELETE' }, readWith(z.object({ ok: z.literal(true) })));
}
