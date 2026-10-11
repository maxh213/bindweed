import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { graphView, type GraphView } from '../domain/graph.ts';
import { parsePlan, type ContractRule, type PlanDoc, type PlanEdit } from '../domain/plan.ts';
import { contractRules } from '../domain/contract.ts';
import { applyPlan, plannedShape } from '../domain/planned.ts';
import { usePlanSession } from './plansession.tsx';

const REFUSAL = "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array";
const HEAD = 'a'.repeat(40);

const LAYERED = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/domain/model.ts', test: false },
    { path: 'src/infra/db.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' as const },
    { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' as const },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' as const },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' as const },
    { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' as const },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' as const },
  ],
  externals: [],
  workspaces: [],
};

const PACKAGE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const FILE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app/a.ts', to: 'src/app/b.ts', files: [['src/app/a.ts', 'src/app/b.ts']] };
const INFRA_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/infra', to: 'src/domain', files: [['src/infra/db.ts', 'src/domain/model.ts']] };

const FIVE = [
  { comment: 'src/app must not import src/domain', name: 'bindweed:no-src-app-to-src-domain' },
  { comment: 'src/app/a.ts must not import src/app/b.ts', name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts' },
  { comment: 'src/domain does not use src/infra', name: 'bindweed:src-domain-does-not-use-src-infra' },
  { comment: 'src/infra does not use src/app', name: 'bindweed:src-infra-does-not-use-src-app' },
  { comment: 'No circular dependencies', name: 'bindweed:no-circular' },
];

function viewAt(at: string, edits: PlanEdit[]): GraphView {
  const view = graphView(applyPlan(LAYERED, edits), at, 'layered');
  if (view === null) throw new Error(at);
  return view;
}

const SRC_VIEW = viewAt('src', []);

type Hit = { status: number; body: unknown };

type World = { doc: PlanDoc | null; refused: boolean; rulesDown: boolean; previewDown: boolean; previewHangs: boolean; puts: number };

const world: World = { doc: null, refused: false, rulesDown: false, previewDown: false, previewHangs: false, puts: 0 };

function freshDoc(edits: PlanEdit[], contract?: { rules: ContractRule[] }): PlanDoc {
  const doc: PlanDoc = { version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: HEAD, edits, redo: [] };
  return contract === undefined ? doc : { ...doc, contract };
}

function storedDoc(): PlanDoc {
  if (world.doc === null) throw new Error('no plan');
  return world.doc;
}

function generated(): ContractRule[] {
  return contractRules(plannedShape(LAYERED, storedDoc().edits), true);
}

const NO_PLAN: Hit = { status: 404, body: { error: 'no such plan' } };

function namesIn(raw: unknown): string[] {
  return z.object({ names: z.array(z.string()) }).parse(raw).names;
}

function mergedBody(chosen: ContractRule[]): Hit {
  const names = chosen.map(rule => rule.name);
  return { status: 200, body: { text: `text for ${names.join(' ')}\n`, diff: `--- a\n+++ b\n${names.map(name => `+      name: '${name}',\n`).join('')}` } };
}

function refusedBody(chosen: ContractRule[]): Hit {
  return { status: 200, body: { error: REFUSAL, snippet: chosen.map(rule => `    name: '${rule.name}',\n`).join('') } };
}

function previewBody(raw: unknown): Hit {
  const names = namesIn(raw);
  const chosen = generated().filter(rule => names.includes(rule.name));
  if (world.previewDown) return NO_PLAN;
  return world.refused ? refusedBody(chosen) : mergedBody(chosen);
}

function rulesBody(): Hit {
  return world.rulesDown ? NO_PLAN : { status: 200, body: { rules: generated() } };
}

function putBody(raw: unknown): Hit {
  world.puts += 1;
  const doc = parsePlan(raw);
  if (doc === undefined || doc.slug !== storedDoc().slug) return { status: 400, body: { error: 'bad plan' } };
  world.doc = doc;
  return { status: 200, body: doc };
}

function planBody(): Hit {
  return world.doc === null ? NO_PLAN : { status: 200, body: world.doc };
}

function listBody(): Hit {
  const doc = storedDoc();
  return { status: 200, body: { plans: [{ name: 'Gate', slug: 'gate', editCount: doc.edits.length, createdAt: doc.createdAt }] } };
}

function graphBody(url: URL): Hit {
  return { status: 200, body: viewAt(url.searchParams.get('at') ?? '', url.searchParams.has('plan') ? storedDoc().edits : []) };
}

const ROUTES: Record<string, (url: URL, raw: unknown) => Hit> = {
  'GET /api/plans': () => listBody(),
  'GET /api/graph': url => graphBody(url),
  'GET /api/pairs': () => ({ status: 200, body: { pairs: [['src/infra/db.ts', 'src/domain/model.ts']] } }),
  'GET /api/plans/gate': () => planBody(),
  'PUT /api/plans/gate': (_url, raw) => putBody(raw),
  'GET /api/plans/gate/contract': () => rulesBody(),
  'POST /api/plans/gate/contract': (_url, raw) => previewBody(raw),
};

function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

function answer(method: string, url: URL, init: RequestInit | undefined): Response {
  const hit = (ROUTES[`${method} ${url.pathname}`] ?? (() => NO_PLAN))(url, bodyOf(init));
  return { ok: hit.status < 300, status: hit.status, json: async () => hit.body } as Response;
}

function methodOf(init: RequestInit | undefined): string {
  return init?.method ?? 'GET';
}

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = methodOf(init);
  if (world.previewHangs && method === 'POST') return new Promise<Response>(() => undefined);
  return answer(method, new URL(String(url), 'http://127.0.0.1'), init);
}) as typeof fetch;

function Harness(props: Readonly<{ slug: string | null }>) {
  const view = usePlanSession({
    token: 'tok',
    fetcher,
    at: 'src',
    slug: props.slug,
    tests: false,
    external: false,
    pins: {},
    shown: 'planned',
    ready: true,
    nodes: SRC_VIEW.nodes,
    edges: SRC_VIEW.edges,
    other: undefined,
    planned: SRC_VIEW,
    named: SRC_VIEW,
    ids: new Set(SRC_VIEW.nodes.map(node => node.id)),
    selection: [],
    deletable: { from: 'src/infra', to: 'src/domain' },
    onShown: () => undefined,
    onPlanChange: () => undefined,
    onDrill: () => undefined,
    onOpenFile: () => undefined,
    onPickNode: () => undefined,
    onPickArrow: () => undefined,
  });
  return createElement('div', null, view.toolbar, view.notice, view.changes, view.dialogs);
}

describe('the contract panel', () => {
  let dom: JSDOM;
  let root: Root;
  let copied: string[] = [];

  function install(): void {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5000/#at=src&plan=gate', pretendToBeVisual: true });
    const w = dom.window;
    Object.defineProperty(globalThis, 'window', { value: w, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: w.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: w.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'KeyboardEvent', { value: w.KeyboardEvent, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText: vi.fn(async (text: string) => {
            copied.push(text);
          }),
        },
      },
      configurable: true,
    });
  }

  async function mount(slug: string | null = 'gate'): Promise<void> {
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
    const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, networkMode: 'always', retry: false } } });
    const { act } = await import('react');
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Harness, { slug })));
    });
  }

  async function rerender(slug: string | null): Promise<void> {
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    const { act } = await import('react');
    await act(async () => {
      root.unmount();
    });
    await mount(slug);
  }

  async function settled(check: () => void): Promise<void> {
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(check, { timeout: 4000 });
  }

  async function click(el: Element): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    const { act } = await import('react');
    await act(async () => {
      fireEvent.click(el);
    });
  }

  async function press(key: string): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }

  function maybeButton(text: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll('button')).find(el => el.textContent === text);
  }

  function button(text: string): HTMLButtonElement {
    const found = maybeButton(text);
    if (found === undefined) throw new Error(`missing button ${text}`);
    return found;
  }

  function panel(): HTMLElement | null {
    return document.querySelector('dialog[aria-label="Contract"]');
  }

  function box(name: string): HTMLInputElement {
    const found = document.querySelector(`input[aria-label="${name}"]`);
    if (!(found instanceof window.HTMLInputElement)) throw new Error(`missing box ${name}`);
    return found;
  }

  function partText(li: Element, selector: string): string {
    const found = li.querySelector(selector);
    if (found === null) throw new Error(`missing ${selector}`);
    return found.textContent;
  }

  function rows(): { comment: string; name: string; checked: boolean }[] {
    return Array.from(document.querySelectorAll('.contract-rules li')).map(li => ({
      comment: partText(li, 'span'),
      name: partText(li, 'code'),
      checked: box(partText(li, 'code')).checked,
    }));
  }

  function errorText(): string | null {
    const found = document.querySelector('.contract-panel .plan-dialog-error');
    return found === null ? null : found.textContent;
  }

  function region(label: string): string | null {
    const found = document.querySelector(`section[aria-label="${label}"]`);
    return found === null ? null : found.textContent;
  }

  async function openContract(): Promise<void> {
    await settled(() => expect(maybeButton('Undo')).toBeDefined());
    await click(button('Contract'));
    await settled(() => expect(rows().length).toBeGreaterThan(0));
  }

  beforeEach(async () => {
    Object.assign(world, { doc: freshDoc([PACKAGE_CUT, FILE_CUT]), refused: false, rulesDown: false, previewDown: false, previewHangs: false, puts: 0 });
    copied = [];
    install();
  });

  afterEach(async () => {
    const { act } = await import('react');
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  });

  it('Contract lists the five rules, and the ticks change only the diff until Save', async () => {
    await mount();
    await openContract();
    expect(rows()).toEqual(FIVE.map(row => ({ ...row, checked: true })));
    await settled(() => expect(region('diff')).toContain("+      name: 'bindweed:no-circular',"));
    await click(box('bindweed:no-circular'));
    await settled(() => expect(region('diff')).not.toContain('bindweed:no-circular'));
    expect(region('diff')).toContain("+      name: 'bindweed:no-src-app-to-src-domain',");
    expect(storedDoc().contract).toBeUndefined();
    expect(world.puts).toBe(0);
    await click(button('Close'));
    expect(panel()).toBeNull();
    await click(button('Contract'));
    await settled(() => expect(rows()).toHaveLength(5));
    expect(box('bindweed:no-circular').checked).toBe(true);
    await click(box('bindweed:no-circular'));
    await click(button('Save to plan'));
    expect(panel()).toBeNull();
    await settled(() => expect(storedDoc().contract?.rules.map(rule => rule.name)).toEqual(FIVE.slice(0, 4).map(row => row.name)));
    expect(storedDoc().edits).toEqual([PACKAGE_CUT, FILE_CUT]);
    await rerender('gate');
    await openContract();
    expect(rows().map(row => row.checked)).toEqual([true, true, true, true, false]);
    await settled(() => expect(region('diff')).toContain('bindweed:src-infra-does-not-use-src-app'));
    await click(button('Copy'));
    expect(copied).toEqual([`text for ${FIVE.slice(0, 4).map(row => row.name).join(' ')}\n`]);
    expect(window.location.href).toBe('http://127.0.0.1:5000/#at=src&plan=gate');
  });

  it('A saved contract survives a later cut and Undo without a reload', async () => {
    await mount();
    await openContract();
    await click(box('bindweed:no-circular'));
    await click(button('Save to plan'));
    await settled(() => expect(storedDoc().contract?.rules).toHaveLength(4));
    const saved = storedDoc().contract;
    await press('Delete');
    await settled(() => expect(storedDoc().edits).toEqual([PACKAGE_CUT, FILE_CUT, INFRA_CUT]));
    expect(storedDoc().contract).toEqual(saved);
    await settled(() => expect(button('Undo').disabled).toBe(false));
    await click(button('Undo'));
    await settled(() => expect(storedDoc().redo).toEqual([INFRA_CUT]));
    expect(storedDoc().edits).toEqual([PACKAGE_CUT, FILE_CUT]);
    expect(storedDoc().contract).toEqual(saved);
    await click(button('Contract'));
    await settled(() => expect(rows()).toHaveLength(5));
    expect(rows().map(row => row.checked)).toEqual([true, true, true, true, false]);
  });

  it('With no plan there is no Contract button', async () => {
    await mount(null);
    await settled(() => expect(maybeButton('New plan…')).toBeDefined());
    expect(maybeButton('Contract')).toBeUndefined();
  });

  it('A saved rule that still matches stays ticked, and a new one does not', async () => {
    const empty = contractRules(plannedShape(LAYERED, []), true);
    const contract = { rules: [{ ...empty[0], comment: 'old' }, ...empty.slice(1)] };
    world.doc = freshDoc([], contract);
    await mount();
    await openContract();
    expect(rows().map(row => [row.name, row.checked])).toEqual([
      ['bindweed:src-domain-does-not-use-src-app', false],
      ['bindweed:src-domain-does-not-use-src-infra', true],
      ['bindweed:src-infra-does-not-use-src-app', true],
      ['bindweed:no-circular', true],
    ]);
    world.doc = freshDoc([PACKAGE_CUT], contract);
    await rerender('gate');
    await openContract();
    expect(rows().map(row => [row.name, row.checked])).toEqual([
      ['bindweed:no-src-app-to-src-domain', false],
      ['bindweed:src-domain-does-not-use-src-infra', true],
      ['bindweed:src-infra-does-not-use-src-app', true],
      ['bindweed:no-circular', true],
    ]);
  });

  it('A spread is refused in the panel, Copy copies the snippet, and Save still saves', async () => {
    world.refused = true;
    await mount();
    await openContract();
    await settled(() => expect(document.body.textContent).toContain(REFUSAL));
    expect(region('snippet')).toContain("name: 'bindweed:no-src-app-to-src-domain'");
    expect(region('diff')).toBeNull();
    await click(button('Copy'));
    expect(copied).toEqual([region('snippet')]);
    await click(button('Save to plan'));
    await settled(() => expect(storedDoc().contract?.rules.map(rule => rule.name)).toEqual(FIVE.map(row => row.name)));
  });

  it('Escape closes the panel without saving', async () => {
    await mount();
    await openContract();
    await click(box('bindweed:no-circular'));
    await press('Enter');
    expect(panel()).not.toBeNull();
    await press('Escape');
    expect(panel()).toBeNull();
    expect(world.puts).toBe(0);
  });

  it('shows why the rules or the preview could not be read, and copies nothing then', async () => {
    world.previewDown = true;
    await mount();
    await openContract();
    await settled(() => expect(errorText()).toBe('no such plan'));
    await click(button('Copy'));
    await click(button('Close'));
    Object.assign(world, { previewDown: false, rulesDown: true });
    await click(button('Contract'));
    await settled(() => expect(errorText()).toBe('no such plan'));
    expect(rows()).toEqual([]);
    expect(button('Save to plan').disabled).toBe(true);
    await click(button('Copy'));
    expect(copied).toEqual([]);
  });

  it('copies nothing before the preview answers', async () => {
    world.previewHangs = true;
    await mount();
    await openContract();
    await click(button('Copy'));
    expect(copied).toEqual([]);
    expect(region('diff')).toBeNull();
  });

  it('puts the plan back and says why when Save is refused', async () => {
    await mount();
    await openContract();
    world.doc = { ...storedDoc(), slug: 'elsewhere' };
    await click(button('Save to plan'));
    await settled(() => expect(document.body.textContent).toContain('bad plan'));
    world.doc = { ...storedDoc(), slug: 'gate' };
    await click(button('Contract'));
    await settled(() => expect(rows()).toHaveLength(5));
    expect(rows().every(row => row.checked)).toBe(true);
  });

  it('drops the panel when the open plan cannot be read', async () => {
    await mount();
    await openContract();
    world.doc = null;
    await rerender('gate');
    await settled(() => expect(maybeButton('Contract')).toBeDefined());
    await click(button('Contract'));
    expect(panel()).toBeNull();
  });
});
