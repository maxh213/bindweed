import type { PlanDoc, PlanSummary } from '../domain/plan.ts';

type PlanRoster = {
  plans: PlanSummary[];
  doc: PlanDoc | null;
  labels: Map<string, string>;
  choice: string;
  deleteName: string;
};

function plansOf(data: { plans: PlanSummary[] } | { error: string } | undefined): PlanSummary[] {
  if (data === undefined || 'error' in data) return [];
  return data.plans;
}

function planDocOf(data: PlanDoc | { error: string } | null | undefined): PlanDoc | null {
  if (data === undefined || data === null || 'error' in data) return null;
  return data;
}

function planLabels(plans: PlanSummary[]): Map<string, string> {
  const seen = new Set<string>();
  const labels = new Map<string, string>();
  for (const plan of plans) {
    labels.set(plan.slug, seen.has(plan.name) ? `${plan.name} (${plan.slug})` : plan.name);
    seen.add(plan.name);
  }
  return labels;
}

function planChoice(slug: string | null, plans: PlanSummary[]): string {
  const listed = plans.find(plan => plan.slug === slug);
  return listed?.slug ?? '';
}

function deleteNameOf(plans: PlanSummary[], slug: string | null, doc: PlanDoc | null): string {
  const listed = plans.find(plan => plan.slug === slug);
  if (listed !== undefined) return listed.name;
  return doc?.name ?? '';
}

export function planRoster(
  list: { plans: PlanSummary[] } | { error: string } | undefined,
  loaded: PlanDoc | { error: string } | null | undefined,
  slug: string | null,
  deleteSlug: string | null,
): PlanRoster {
  const plans = plansOf(list);
  const doc = planDocOf(loaded);
  return { plans, doc, labels: planLabels(plans), choice: planChoice(slug, plans), deleteName: deleteNameOf(plans, deleteSlug, doc) };
}
