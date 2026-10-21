import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { RunCard } from './client.ts';

const NOW = Date.parse('2026-10-21T13:00:00.000Z');
let dom: JSDOM;
let root: Root;
let cards: RunCard[];
let runCalls: number;
let deletes: string[];
let deleteAnswers: [number, unknown][];
let held: (() => void) | null;
let holding: boolean;
let runsAnswer: [number, unknown] | null;
let copied: string[];
let visibility: string;

function card(name: string, state: RunCard['state'], position: string, extra: Partial<RunCard> = {}): RunCard {
  return { slug: `plan-${name}`, planName: `plan-${name}`, planExists: false, tool: 'marestail', branch: `bindweed/plan-${name}`, worktree: `/tmp/qa/runs/wt-${name}`, worktreeExists: state !== 'worktree removed', pid: 7, startedAt: '2026-10-21T12:00:00.000Z', state, position, prs: [], logTail: [], ...extra };
}

const PANEL: RunCard[] = [
  card('sc-err', 'dead', 'sc status failed: no slop-cannon state here · pid gone', { tool: 'slop-cannon' }),
  card('sc', 'running', 'running · 4 agents · 7 open · 3 done · 2 PRs', { tool: 'slop-cannon', prs: ['https://example.test/pull/41', 'https://example.test/pull/42'] }),
  card('dead', 'dead', 'task 001-task · 0 of 1 tasks', { logTail: ['starting'] }),
  card('running', 'running', 'task 002-step · hardener · attempt 1 · 1 of 3 tasks', { planName: 'Plan Running', planExists: true, logTail: ['starting', '== coder (07-coder) attempt 2', '== hardener (07-hardener) attempt 1'] }),
  card('failed', 'failed', 'task 001-f · coder · attempt 1 · 0 of 1 tasks'),
  card('stopped', 'stopped for a human', 'task 002-x · coder · attempt 2 · 1 of 2 tasks'),
  card('done', 'done', 'all tasks complete · 2 of 2 tasks'),
  card('removed', 'worktree removed', 'worktree removed', { branch: null }),
];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function runsResponse(): Promise<Response> {
  runCalls += 1;
  if (holding) await new Promise<void>(done => { held = done; });
  const [status, body] = runsAnswer ?? [200, { runs: cards }];
  return response(body, status);
}

function deleteResponse(path: string): Response {
  deletes.push(path);
  const [status, body] = deleteAnswers.shift() ?? [200, { ok: true }];
  return response(body, status);
}

const fetcher = (async (path: string, init?: RequestInit) => {
  if (path === '/api/runs') return runsResponse();
  if (init?.method === 'DELETE') return deleteResponse(path);
  return response({ error: 'not found' }, 404);
}) as typeof fetch;

function scope() {
  return within(document.body);
}

function tab(name: string): HTMLElement {
  return scope().getByRole('tab', { name: new RegExp(`^${name}`) });
}

function cardOf(name: string): HTMLElement {
  return scope().getByRole('article', { name });
}

function titles(): string[] {
  return Array.from(document.querySelectorAll('.run-title')).map(el => el.textContent ?? '');
}

async function click(element: Element): Promise<void> {
  await act(async () => { fireEvent.click(element); });
}

async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function open(hash: string): Promise<void> {
  window.history.replaceState(null, '', `/${hash}`);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root.render(createElement(App, { token: 'tok', location: window.location, historyApi: window.history, fetcher })); });
  await settle();
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function setVisibility(state: string): Promise<void> {
  visibility = state;
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  cards = PANEL;
  runCalls = 0;
  deletes = [];
  deleteAnswers = [];
  held = null;
  holding = false;
  runsAnswer = null;
  copied = [];
  visibility = 'visible';
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1:4477/', pretendToBeVisual: true });
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, navigator: { clipboard: { writeText: async (value: string) => { copied.push(value); } } } };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  dom.window.close();
  vi.useRealTimers();
});

describe('Runs panel', () => {
  it('The panel shows every run with its state and badge', async () => {
    await open('#runs');
    expect(tab('Runs').getAttribute('aria-selected')).toBe('true');
    expect(tab('Runs').querySelector('.badge')?.textContent).toBe('2');
    expect(document.querySelectorAll('.badge.pill')).toHaveLength(0);
    expect(titles()).toEqual(['plan-sc-err', 'plan-sc', 'plan-dead', 'Plan Running', 'plan-failed', 'plan-stopped', 'plan-done', 'plan-removed']);
    expect(Array.from(document.querySelectorAll('.pill')).map(pill => `${pill.className} ${pill.textContent}`)).toEqual([
      'pill pill-dead dead', 'pill pill-running running', 'pill pill-dead dead', 'pill pill-running running', 'pill pill-failed failed', 'pill pill-stopped stopped for a human', 'pill pill-done done', 'pill pill-removed worktree removed',
    ]);
    expect(Array.from(document.querySelectorAll('.run-position')).map(el => el.textContent)).toEqual(PANEL.map(run => run.position));
    expect(within(cardOf('plan-sc')).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['https://example.test/pull/41', 'https://example.test/pull/41'],
      ['https://example.test/pull/42', 'https://example.test/pull/42'],
    ]);
    expect(scope().getAllByRole('button', { name: 'Forget' })).toHaveLength(1);
    expect(within(cardOf('plan-removed')).getByRole('button', { name: 'Forget' })).toBeDefined();
    expect(cardOf('plan-removed').textContent).toContain('marestail/tmp/qa/runs/wt-removed');
    expect(cardOf('plan-sc').textContent).toContain('slop-cannon · bindweed/plan-sc');
    expect(Array.from(document.querySelectorAll('details')).every(details => !details.open)).toBe(true);
    expect(runCalls).toBe(1);
  });

  it('The pills have their state colours and white text', () => {
    const css = process.getBuiltinModule('node:fs').readFileSync(new URL('./app.css', import.meta.url), 'utf8').replaceAll(/\s+/g, ' ');
    expect(css).toContain('.pill { padding: 0.1rem 0.6rem; border-radius: 999px; color: #ffffff;');
    for (const [name, colour] of [['running', '#2563eb'], ['stopped', '#d97706'], ['failed', '#dc2626'], ['done', '#16a34a'], ['dead', '#6b7280'], ['removed', '#9ca3af']]) {
      expect(css).toContain(`.pill-${name} { background: ${colour}; }`);
    }
  });

  it('A plan file bindweed cannot load gives a plain title', async () => {
    cards = [card('dead', 'dead', 'task 001-task · 0 of 1 tasks')];
    await open('#runs');
    expect(titles()).toEqual(['plan-dead']);
    expect(within(cardOf('plan-dead')).queryAllByRole('link')).toHaveLength(0);
  });

  it("A card's log tail, copy and plan link", async () => {
    cards = [PANEL[3]];
    await open('#at=src');
    expect(tab('Runs').querySelector('.badge')?.textContent).toBe('1');
    await click(tab('Runs'));
    expect(window.location.hash).toBe('#runs');
    const running = cardOf('Plan Running');
    const details = running.querySelector('details') as HTMLDetailsElement;
    await click(within(running).getByText('Log tail'));
    details.open = true;
    expect(details.querySelector('pre')?.textContent).toBe('starting\n== coder (07-coder) attempt 2\n== hardener (07-hardener) attempt 1');
    await click(within(running).getByRole('button', { name: 'Copy worktree' }));
    expect(copied).toEqual(['/tmp/qa/runs/wt-running']);
    const link = within(running).getByRole('link', { name: 'Plan Running' });
    expect(link.getAttribute('href')).toBe('#at=src&plan=plan-running');
    await click(link);
    expect(window.location.hash).toBe('#at=src&plan=plan-running');
    expect(tab('Architecture').getAttribute('aria-selected')).toBe('true');
  });

  it.each([
    [42_000, '42s'],
    [90_000, '1m'],
    [(3 * 60 + 5) * 60_000, '3h 5m'],
    [((2 * 24 + 3) * 60 + 1) * 60_000, '2d 3h'],
    [-5_000, '0s'],
  ])('Elapsed time: %s ms', async (age, elapsed) => {
    const startedAt = new Date(NOW - age).toISOString();
    cards = [card('dead', 'dead', 'x', { startedAt })];
    await open('#runs');
    expect(cardOf('plan-dead').textContent).toContain(`started ${startedAt} · ${elapsed}`);
  });

  it('Forget removes the card, and a refused Forget keeps it', async () => {
    cards = [PANEL[6], PANEL[7]];
    deleteAnswers = [[400, { error: 'worktree still exists' }]];
    await open('#runs');
    await click(within(cardOf('plan-removed')).getByRole('button', { name: 'Forget' }));
    await settle();
    expect(within(cardOf('plan-removed')).getByRole('alert').textContent).toBe('Forget failed: worktree still exists');
    await click(within(cardOf('plan-removed')).getByRole('button', { name: 'Forget' }));
    await settle();
    expect(titles()).toEqual(['plan-done']);
    expect(deletes).toEqual(['/api/runs?worktree=%2Ftmp%2Fqa%2Fruns%2Fwt-removed', '/api/runs?worktree=%2Ftmp%2Fqa%2Fruns%2Fwt-removed']);
    expect(runCalls).toBe(1);
  });

  it('Forgetting the last card leaves the empty panel', async () => {
    cards = [PANEL[7]];
    await open('#runs');
    await click(within(cardOf('plan-removed')).getByRole('button', { name: 'Forget' }));
    await settle();
    expect(document.querySelector('.runs-panel')?.textContent).toBe('No runs launched from this repository yet.');
  });

  it('No runs, no badge', async () => {
    cards = [];
    await open('#runs');
    expect(tab('Runs').querySelector('.badge')).toBeNull();
    expect(document.querySelector('.runs-panel')?.textContent).toBe('No runs launched from this repository yet.');
  });

  it('An unreachable bindweed is said on the panel', async () => {
    runsAnswer = [500, { error: 'internal error' }];
    await open('#runs');
    expect(document.querySelector('.runs-panel')?.textContent).toBe('internal error');
  });

  it('Polling stops on another tab and in a hidden browser tab', async () => {
    cards = [PANEL[3]];
    await open('#runs');
    expect(runCalls).toBe(1);
    await advance(5000);
    expect(runCalls).toBe(2);
    await advance(5000);
    expect(runCalls).toBe(3);
    await click(tab('Files'));
    await advance(15000);
    expect(runCalls).toBe(3);
    expect(tab('Runs').querySelector('.badge')?.textContent).toBe('1');
    await click(tab('Runs'));
    await settle();
    expect(runCalls).toBe(4);
    await setVisibility('hidden');
    await advance(15000);
    expect(runCalls).toBe(4);
    await setVisibility('visible');
    expect(runCalls).toBe(5);
    await advance(5000);
    expect(runCalls).toBe(6);
  });

  it('A load on another tab fetches once and never again until the Runs tab opens', async () => {
    await open('');
    expect(runCalls).toBe(1);
    await advance(15000);
    expect(runCalls).toBe(1);
  });

  it('No request starts while the last has not answered', async () => {
    holding = true;
    await open('#runs');
    expect(runCalls).toBe(1);
    await click(tab('Files'));
    await click(tab('Runs'));
    await advance(15000);
    expect(runCalls).toBe(1);
    holding = false;
    await act(async () => { held?.(); });
    await settle();
    expect(titles()).toHaveLength(8);
    await advance(5000);
    expect(runCalls).toBe(2);
  });

  it('Back to #runs keeps the Architecture view for the plan link', async () => {
    cards = [PANEL[3]];
    await open('#at=src');
    await click(tab('Runs'));
    await act(async () => { window.dispatchEvent(new window.PopStateEvent('popstate')); });
    expect(tab('Runs').getAttribute('aria-selected')).toBe('true');
    expect(within(cardOf('Plan Running')).getByRole('link', { name: 'Plan Running' }).getAttribute('href')).toBe('#at=src&plan=plan-running');
  });
});
