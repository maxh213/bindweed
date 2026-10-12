import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freeSlug, parsePlan, summarisePlan, type PlanDoc, type PlanSummary } from './domain/plan.ts';

function plansDir(root: string): string {
  return join(root, '.bindweed', 'plans');
}

function planFile(root: string, slug: string): string {
  return join(plansDir(root), `${slug}.json`);
}

export async function readPlan(root: string, slug: string): Promise<PlanDoc | undefined> {
  return readFile(planFile(root, slug))
    .then(bytes => parsePlan(JSON.parse(bytes.toString('utf8'))))
    .catch(() => undefined);
}

export async function writePlan(root: string, doc: PlanDoc): Promise<void> {
  await mkdir(plansDir(root), { recursive: true });
  await writeFile(planFile(root, doc.slug), JSON.stringify(doc));
}

export async function removePlan(root: string, slug: string): Promise<boolean> {
  try {
    await unlink(planFile(root, slug));
    return true;
  } catch {
    return false;
  }
}

async function planFileNames(root: string): Promise<string[] | undefined> {
  return readdir(plansDir(root)).catch(() => undefined);
}

async function readListed(root: string, file: string): Promise<PlanDoc | undefined> {
  if (!file.endsWith('.json')) return undefined;
  return readPlan(root, file.slice(0, -'.json'.length));
}

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

function byCreatedThenSlug(a: PlanSummary, b: PlanSummary): number {
  return byText(a.createdAt, b.createdAt) || byText(a.slug, b.slug);
}

export async function listPlans(root: string): Promise<PlanSummary[]> {
  const names = await planFileNames(root);
  if (names === undefined) return [];
  const docs: PlanDoc[] = [];
  for (const file of names) {
    const doc = await readListed(root, file);
    if (doc !== undefined) docs.push(doc);
  }
  return docs.map(summarisePlan).sort(byCreatedThenSlug);
}

export async function freePlanSlug(root: string, base: string): Promise<string> {
  const names = new Set(await planFileNames(root));
  return freeSlug(base, slug => names.has(`${slug}.json`));
}

export async function saveTaskFiles(root: string, doc: PlanDoc): Promise<string> {
  const dir = join(plansDir(root), doc.slug);
  const tasksDir = join(dir, 'tasks');
  await rm(tasksDir, { recursive: true, force: true });
  await mkdir(tasksDir, { recursive: true });
  for (const task of doc.tasks ?? []) await writeFile(join(tasksDir, task.file), task.body);
  const brief = join(dir, 'brief.md');
  await (doc.brief === undefined ? rm(brief, { force: true }) : writeFile(brief, doc.brief));
  return dir;
}
