import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchBody, LaunchInfo, LaunchResult } from '../domain/launch.ts';
import type { PlanDoc } from '../domain/plan.ts';
import { usePlanSession } from './plansession.tsx';

const TASKS = [{ file: '005-core.md', title: 'Core', body: '# Core\n' }];
const FOCUS = 'src/app/a.ts src/domain/model.ts';
const WORKTREE = '/tmp/qa/layered-bw-gate';
const LINES = { worktree: WORKTREE, branch: 'bindweed/gate', watch: 'marestail watch' };
const STEPS = ['Worktree', 'Files', 'Commit', 'Start', 'Record'].map(name => ({ name, ok: true }));
let doc: PlanDoc;
let info: LaunchInfo;
let posts: LaunchBody[];
let outcome: LaunchResult | { error: string };
let hold: boolean;
let getHold: boolean;
let getError: boolean;
let refreshError: boolean;
let release: (() => void) | undefined;
let copied: string[];
let dom: JSDOM;
let root: Root;
let client: QueryClient;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function launchUnavailable() {
  return getError || (refreshError && posts.length > 0);
}

function launchGet() {
  if (getHold) return new Promise<Response>(() => undefined);
  if (launchUnavailable()) return response({ error: 'launch unavailable' }, 503);
  return response(info);
}

async function launchPost(init?: RequestInit) {
  posts.push(JSON.parse(String((init as RequestInit).body)));
  if (hold) await new Promise<void>(done => { release = done; });
  if ('error' in outcome) return response(outcome, 409);
  if (outcome.pid !== undefined) info = { ...info, alive: true, ...LINES };
  return response(outcome);
}

function otherResponse(path: string) {
  const routes: Record<string, unknown> = { '/api/plans': { plans: [doc] }, '/api/plans/gate': doc, '/api/plans/gate/chat': [] };
  return path in routes ? response(routes[path]) : response({ error: 'not found' }, 404);
}

const fetcher = (async (path: string, init?: RequestInit) => {
  if (!path.endsWith('/launch')) return otherResponse(path);
  return init?.method === 'POST' ? launchPost(init) : launchGet();
}) as typeof fetch;

function Harness(props: Readonly<{ slug: string | null }>) {
  const view = usePlanSession({ token: 'tok', fetcher, at: '', slug: props.slug, tests: false, external: false, pins: {}, shown: 'planned', ready: true, nodes: [], edges: [], other: undefined, planned: undefined, named: undefined, ids: new Set(), selection: [], deletable: null, onShown: () => undefined, onPlanChange: () => undefined, onDrill: () => undefined, onOpenFile: () => undefined, onPickNode: () => undefined, onPickArrow: () => undefined });
  return <>{view.toolbar}{view.dialogs}</>;
}

function scope() {
  return within(document.body);
}

function dialog() {
  return scope().getByRole('dialog', { name: 'Launch' });
}

function button(name: string) {
  return within(dialog()).getByRole('button', { name }) as HTMLButtonElement;
}

function field(name: string) {
  return within(dialog()).getByLabelText(name) as HTMLInputElement;
}

async function click(element: Element) {
  await act(async () => { fireEvent.click(element); });
}

async function choose(name: string, value: string) {
  await act(async () => { fireEvent.change(field(name), { target: { value } }); });
}

async function type(name: string, value: string) {
  await act(async () => { fireEvent.input(field(name), { target: { value } }); });
}

async function settled(check: () => void) {
  await act(async () => { await vi.waitFor(check); });
}

async function open() {
  await click(scope().getByRole('button', { name: 'Launch' }));
  await settled(() => expect(field('Tool').value).toBe('marestail'));
}

async function mount(slug: string | null = 'gate') {
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Harness, { slug }))); });
  await settled(() => expect(scope().getByRole('button', { name: 'Tasks' })).toBeDefined());
}

beforeEach(() => {
  doc = { version: 1, name: 'Gate', slug: 'gate', baseCommit: 'a'.repeat(40), createdAt: '2026-10-01T00:00:00.000Z', edits: [], redo: [], tasks: TASKS, brief: '# Brief\n' };
  info = { marestail: true, sc: true, alive: false, focus: FOCUS };
  posts = [];
  outcome = { steps: STEPS, ...LINES, pid: 42 };
  hold = false;
  getHold = false;
  getError = false;
  refreshError = false;
  release = undefined;
  copied = [];
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, KeyboardEvent: dom.window.KeyboardEvent, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true, navigator: { clipboard: { writeText: async (value: string) => { copied.push(value); } } } })) Object.defineProperty(globalThis, key, { value, configurable: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always', refetchOnWindowFocus: false } } });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  dom.window.close();
});

describe('Launch dialog', () => {
  it('The dialog launches marestail and copies the worktree, the branch and the watch command', async () => {
    await mount();
    const toolbar = scope().getAllByRole('button').map(button => button.textContent);
    expect(toolbar.indexOf('Launch')).toBe(toolbar.indexOf('Tasks') + 1);
    await open();
    expect(field('MODEL').value).toBe('dandelion/route-best');
    expect(field('SCOPE').value).toBe('hard');
    expect(field('FOCUS').value).toBe(FOCUS);
    expect(field('STOP_AT').value).toBe('qa');
    expect(within(dialog()).queryByLabelText('Safety')).toBeNull();
    await click(button('Close'));
    expect(scope().queryByRole('dialog')).toBeNull();
    expect(posts).toEqual([]);
    await open();
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(scope().queryByRole('dialog')).toBeNull();
    await open();
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'x' })); });
    expect(dialog()).toBeDefined();
    await type('MODEL', 'mine');
    await type('SCOPE', 'narrow');
    await click(button('Close'));
    await open();
    expect(field('MODEL').value).toBe('dandelion/route-best');
    expect(field('SCOPE').value).toBe('hard');
    await click(button('Launch'));
    await settled(() => expect(within(dialog()).getByRole('list', { name: 'Steps' }).textContent).toBe('Worktree ✓Files ✓Commit ✓Start ✓Record ✓'));
    expect(posts).toEqual([{ tool: 'marestail', model: 'dandelion/route-best', scope: 'hard', focus: FOCUS, stopAt: 'qa' }]);
    expect(field('Tool').value).toBe('marestail');
    expect(field('MODEL').value).toBe('dandelion/route-best');
    expect(field('SCOPE').value).toBe('hard');
    expect(field('FOCUS').value).toBe(FOCUS);
    expect(field('STOP_AT').value).toBe('qa');
    expect(button('Launch').disabled).toBe(true);
    expect(dialog().textContent).toContain('a run for this plan is still alive');
    for (const label of ['Copy worktree', 'Copy branch', 'Copy command']) await click(button(label));
    expect(copied).toEqual([WORKTREE, 'bindweed/gate', 'marestail watch']);
  });

  it('Slop-cannon shows its own fields and its own watch command', async () => {
    await mount();
    await open();
    await type('MODEL', 'mine');
    await type('SCOPE', 'narrow');
    await choose('Tool', 'slop-cannon');
    expect(within(dialog()).queryByLabelText('MODEL')).toBeNull();
    expect(field('Safety').value).toBe('on');
    expect(field('Ammo').value).toBe('');
    expect(field('Cartridge').value).toBe('');
    await type('Ammo', '3');
    await type('Cartridge', 'wide');
    await choose('Tool', 'marestail');
    expect(field('MODEL').value).toBe('mine');
    expect(field('SCOPE').value).toBe('narrow');
    await type('FOCUS', 'src/mine.ts');
    await type('STOP_AT', 'coder');
    await choose('Tool', 'slop-cannon');
    expect(field('Ammo').value).toBe('3');
    expect(field('Cartridge').value).toBe('wide');
    await choose('Safety', 'off');
    await type('Ammo', '');
    await type('Cartridge', '');
    outcome = { steps: STEPS, ...LINES, watch: `sc status --repo ${WORKTREE}`, pid: 42 };
    await click(button('Launch'));
    await settled(() => expect(button('Copy command')).toBeDefined());
    expect(posts).toEqual([{ tool: 'slop-cannon', safety: 'off', ammo: '', cartridge: '' }]);
    expect(field('Tool').value).toBe('slop-cannon');
    expect(field('Safety').value).toBe('off');
    expect(field('Ammo').value).toBe('');
    expect(field('Cartridge').value).toBe('');
    await click(button('Copy command'));
    expect(copied).toEqual([`sc status --repo ${WORKTREE}`]);
  });

  it('No tasks, a live run and an existing branch are visible from the dialog', async () => {
    delete doc.tasks;
    delete doc.brief;
    await mount();
    await open();
    expect(dialog().textContent).toContain('this plan has no tasks');
    expect(button('Launch').disabled).toBe(true);
    await choose('Tool', 'slop-cannon');
    expect(dialog().textContent).toContain('this plan has no brief');
    expect(button('Launch').disabled).toBe(true);
    await click(button('Close'));
    doc.tasks = TASKS;
    doc.brief = '# Brief\n';
    await act(async () => { client.setQueryData(['plan', 'tok', 'gate'], { ...doc }); });
    info = { ...info, alive: true, ...LINES };
    await open();
    expect(dialog().textContent).toContain('a run for this plan is still alive');
    expect(button('Launch').disabled).toBe(true);
    for (const label of ['Copy worktree', 'Copy branch', 'Copy command']) expect(button(label)).toBeDefined();
    await click(button('Close'));
    info = { marestail: true, sc: true, alive: false, focus: FOCUS };
    outcome = { steps: [{ name: 'Worktree', ok: false, error: "a branch named 'bindweed/gate' already exists" }] };
    await open();
    expect(button('Launch').disabled).toBe(false);
    await click(button('Launch'));
    await settled(() => expect(dialog().textContent).toContain("Worktree a branch named 'bindweed/gate' already exists"));
    expect(dialog().textContent).not.toContain('✓');
    expect(within(dialog()).queryByRole('button', { name: 'Copy worktree' })).toBeNull();
    expect(button('Launch').disabled).toBe(false);
    await type('MODEL', 'editable');
    expect(field('MODEL').value).toBe('editable');
    await choose('Tool', 'slop-cannon');
    expect(field('Safety').value).toBe('on');
    expect(field('Ammo').value).toBe('');
    expect(field('Cartridge').value).toBe('');
    outcome = { steps: STEPS, ...LINES, watch: `sc status --repo ${WORKTREE}`, pid: 42 };
    await click(button('Launch'));
    await settled(() => expect(within(dialog()).getByRole('list', { name: 'Steps' }).textContent).toBe('Worktree ✓Files ✓Commit ✓Start ✓Record ✓'));
    expect(dialog().textContent).toContain(`sc status --repo ${WORKTREE}`);
  });

  it("The dialog's Launch stays disabled until the answer, then the steps are the five ticks", async () => {
    hold = true;
    await mount();
    await open();
    const launch = button('Launch');
    await act(async () => { fireEvent.click(launch); fireEvent.click(launch); });
    expect(launch.disabled).toBe(true);
    expect(posts).toHaveLength(1);
    expect(dialog().textContent).not.toContain('already running');
    await act(async () => { release?.(); });
    await settled(() => expect(within(dialog()).getByRole('list', { name: 'Steps' }).textContent).toBe('Worktree ✓Files ✓Commit ✓Start ✓Record ✓'));
    expect(dialog().textContent).not.toContain('already running');
  });

  it('shows a sole 409, missing commands, and a live source without a branch', async () => {
    info = { ...info, marestail: false, sc: false, alive: true };
    await mount();
    await open();
    expect(dialog().textContent).toContain('marestail is not on PATH');
    await choose('Tool', 'slop-cannon');
    expect(dialog().textContent).toContain('sc is not on PATH');
    await click(button('Close'));
    info = { ...info, marestail: true, sc: true, worktree: WORKTREE, watch: 'marestail watch' };
    await open();
    expect(within(dialog()).queryByRole('button', { name: 'Copy branch' })).toBeNull();
    await click(button('Copy worktree'));
    await click(button('Copy command'));
    expect(copied).toEqual([WORKTREE, 'marestail watch']);
    await click(button('Close'));
    info = { marestail: true, sc: true, alive: false, focus: '' };
    outcome = { error: 'already running' };
    await open();
    await click(button('Launch'));
    await settled(() => expect(dialog().textContent).toContain('already running'));
    expect(within(dialog()).queryByRole('list', { name: 'Steps' })).toBeNull();
  });

  it('falls back to marestail and safety on for a value the selects do not offer', async () => {
    await mount();
    await open();
    await choose('Tool', 'slop-cannon');
    await choose('Safety', 'off');
    await choose('Safety', 'maybe');
    expect(field('Safety').value).toBe('on');
    await choose('Tool', 'other');
    expect(field('Tool').value).toBe('marestail');
    expect(field('MODEL').value).toBe('dandelion/route-best');
  });

  it('shows loading and read errors, and keeps the successful answer when refresh fails', async () => {
    getHold = true;
    await mount();
    await click(scope().getByRole('button', { name: 'Launch' }));
    expect(within(dialog()).queryByLabelText('Tool')).toBeNull();
    await click(button('Close'));
    getHold = false;
    getError = true;
    await click(scope().getByRole('button', { name: 'Launch' }));
    await settled(() => expect(dialog().textContent).toContain('launch unavailable'));
    await click(button('Close'));
    getError = false;
    await open();
    refreshError = true;
    await click(button('Launch'));
    await settled(() => expect(button('Copy command')).toBeDefined());
    expect(within(dialog()).getByRole('list', { name: 'Steps' }).textContent).toContain('Record ✓');
  });
});
