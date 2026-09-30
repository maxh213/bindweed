import { z } from 'zod';
import type { GraphView } from '../domain/graph.ts';
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
  }),
  z.object({
    id: z.string(),
    kind: z.literal('file'),
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
  cycle: z.boolean(),
  cycleText: z.string().optional(),
});

const graphJsonSchema: z.ZodType<GraphView> = z.object({
  at: z.string(),
  crumbs: z.array(z.object({ name: z.string(), at: z.string() })),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const rescanJsonSchema = z.object({ files: z.number(), ms: z.number() });

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

export async function fetchGraph(
  token: string,
  at: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphView | { error: string }> {
  try {
    const res = await fetcher(`/api/graph?at=${encodeURIComponent(at)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return parseBody(graphJsonSchema, await res.json(), res.ok);
  } catch {
    return { error: 'cannot reach bindweed' };
  }
}

export async function postRescan(token: string, fetcher: typeof fetch = fetch): Promise<RescanJson | { error: string }> {
  try {
    const res = await fetcher('/api/rescan', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return parseBody(rescanJsonSchema, await res.json(), res.ok);
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
