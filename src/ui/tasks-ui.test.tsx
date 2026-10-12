import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphView, type GraphView } from '../domain/graph.ts';
import { parsePlan, type PlanDoc, type PlanEdit, type PlanTask } from '../domain/plan.ts';
import { applyPlan } from '../domain/planned.ts';
import { generateAskFrom, planAfter, turnFor, type Reply } from '../domain/prompt.ts';
import { numberedTasks } from '../domain/tasks.ts';
import { usePlanSession } from './plansession.tsx';

const HEAD = 'a'.repeat(40);
const ROOT = '/tmp/qa/layered';
const DIR = `${ROOT}/.bindweed/plans/gate`;
const RAN = 'command: fake';
const COMMAND = `sc --repo ${ROOT} --safety on -m "$(cat ${ROOT}/.bindweed/plans/gate/brief.md)"`;

const LAYERED = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/domain/model.ts', test: false },
    { path: 'src/infra/db.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' as const },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' as const },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' as const },
  ],
  externals: [],
  workspaces: [],
};

const PACKAGE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const NOTE_X: PlanEdit = { kind: 'note', target: { node: 'src/domain' }, text: 'X' };

const QUESTIONS: Reply = {
  questions: [
    { id: 'q1', text: 'Must a.ts keep exporting a?', why: 'Other code may import it.' },
    { id: 'q2', text: 'Should b.ts move before the cut?', why: 'The order decides which slice breaks the build.' },
  ],
};

const SLICES: Reply = {
  slices: [
    { title: 'Add the core package', slug: 'add-core', body: 'Create src/core.\n' },
    { title: 'Move b into infra', slug: 'move-b', body: 'Move src/app/b.ts to src/infra.\n' },
    { title: 'Cut app from domain', slug: 'cut-app-domain', body: '# Cut\nNo behaviour changes.\n' },
  ],
  brief: '# Reshape layered\n\nMove b, then cut app from domain.\n',
};

const THREE: PlanTask[] = numberedTasks('slices' in SLICES ? SLICES.slices : [], 5);
const BRIEF = '# Reshape layered\n\nMove b, then cut app from domain.\n';

function viewAt(at: string, edits: PlanEdit[]): GraphView {
  const view = graphView(applyPlan(LAYERED, edits), at, 'layered');
  if (view === null) throw new Error(at);
  return view;
}

const SRC_VIEW = viewAt('src', []);

type Hit = { status: number; body: unknown };

type Outcome = { reply: Reply } | { body: Hit } | 'hang';

type World = {
  doc: PlanDoc | null;
  config: unknown;
  outcomes: Outcome[];
  generated: unknown[];
  files: PlanDoc[];
  puts: number;
  refusePut: boolean;
  configDown: boolean;
  filesDown: boolean;
  repoDown: boolean;
  release: ((hit: Hit) => void) | null;
};

const world: World = { doc: null, config: null, outcomes: [], generated: [], files: [], puts: 0, refusePut: false, configDown: false, filesDown: false, repoDown: false, release: null };

function freshDoc(edits: PlanEdit[], extra: Partial<PlanDoc> = {}): PlanDoc {
  return { version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-01T00:00:00.000Z', baseCommit: HEAD, edits, redo: [], ...extra };
}

function storedDoc(): PlanDoc {
  if (world.doc === null) throw new Error('no plan');
  return world.doc;
}

const NO_PLAN: Hit = { status: 404, body: { error: 'no such plan' } };

function putBody(raw: unknown): Hit {
  world.puts += 1;
  const doc = parsePlan(raw);
  if (world.refusePut || doc === undefined) return { status: 400, body: { error: 'bad plan' } };
  world.doc = doc;
  return { status: 200, body: doc };
}

function repliedRun(raw: unknown, reply: Reply): Hit {
  const ask = generateAskFrom(raw);
  const turn = ask === undefined ? undefined : turnFor(ask, storedDoc().interview);
  if (turn === undefined) return { status: 400, body: { error: 'bad generate' } };
  const plan = planAfter(storedDoc(), turn, reply, 5);
  if ('error' in plan) return { status: 200, body: { ...plan, ran: RAN } };
  world.doc = plan;
  return { status: 200, body: { plan, ran: RAN } };
}

function settledRun(raw: unknown, outcome: Outcome): Hit | Promise<Hit> {
  if (outcome === 'hang') return new Promise<Hit>(release => (world.release = release));
  return 'body' in outcome ? outcome.body : repliedRun(raw, outcome.reply);
}

function generateBody(raw: unknown): Hit | Promise<Hit> {
  world.generated.push(raw);
  const outcome = world.outcomes.shift();
  if (outcome === undefined) throw new Error('no outcome scripted');
  return settledRun(raw, outcome);
}

function cancelBody(): Hit {
  const release = world.release;
  world.release = null;
  release?.({ status: 200, body: { error: 'cancelled', ran: RAN } });
  return { status: 200, body: { cancelled: release !== null } };
}

function filesBody(): Hit {
  if (world.filesDown) return NO_PLAN;
  world.files.push(storedDoc());
  return { status: 200, body: { dir: DIR } };
}

function configPut(raw: unknown): Hit {
  world.config = raw;
  return world.configDown ? { status: 400, body: { error: 'bad config' } } : { status: 200, body: raw };
}

const ROUTES: Record<string, (url: URL, raw: unknown) => Hit | Promise<Hit>> = {
  'GET /api/plans': () => ({ status: 200, body: { plans: [{ name: 'Gate', slug: 'gate', editCount: storedDoc().edits.length, createdAt: storedDoc().createdAt }] } }),
  'GET /api/graph': url => ({ status: 200, body: viewAt(url.searchParams.get('at') ?? '', url.searchParams.has('plan') ? storedDoc().edits : []) }),
  'GET /api/plans/gate': () => (world.doc === null ? NO_PLAN : { status: 200, body: world.doc }),
  'PUT /api/plans/gate': (_url, raw) => putBody(raw),
  'POST /api/plans/gate/generate': (_url, raw) => generateBody(raw),
  'POST /api/plans/gate/cancel': () => cancelBody(),
  'POST /api/plans/gate/files': () => filesBody(),
  'GET /api/repo': () => (world.repoDown ? NO_PLAN : { status: 200, body: { root: ROOT } }),
  'GET /api/config': () => (world.configDown ? NO_PLAN : { status: 200, body: world.config }),
  'PUT /api/config': (_url, raw) => configPut(raw),
};

function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const where = new URL(String(url), 'http://127.0.0.1');
  const hit = await (ROUTES[`${init?.method ?? 'GET'} ${where.pathname}`] ?? (() => NO_PLAN))(where, bodyOf(init));
  return { ok: hit.status < 300, status: hit.status, json: async () => hit.body } as Response;
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
    deletable: null,
    onShown: () => undefined,
    onPlanChange: () => undefined,
    onDrill: () => undefined,
    onOpenFile: () => undefined,
    onPickNode: () => undefined,
    onPickArrow: () => undefined,
  });
  const noteOnDomain = createElement('button', { type: 'button', onClick: () => view.planning?.onAddNote({ node: 'src/domain' }) }, 'Add note on domain');
  return createElement('div', null, view.toolbar, view.notice, view.changes, view.dialogs, noteOnDomain);
}

describe('the Tasks and Settings dialogs', () => {
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

  async function remount(): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      root.unmount();
    });
    await mount();
  }

  async function settled(check: () => void, timeout = 4000): Promise<void> {
    const { waitFor } = await import('@testing-library/dom');
    await waitFor(check, { timeout });
  }

  async function fire(action: () => void): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      action();
    });
  }

  async function click(el: Element): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    await fire(() => fireEvent.click(el));
  }

  async function type(el: Element, value: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    if (el instanceof window.HTMLSelectElement) {
      await fire(() => fireEvent.change(el, { target: { value } }));
      return;
    }
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    await fire(() => {
      setter?.call(el, value);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  async function typeAndLeave(el: Element, value: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    await type(el, value);
    await fire(() => fireEvent.focusOut(el));
  }

  function maybe(selector: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(selector);
  }

  function the(selector: string): HTMLElement {
    const found = maybe(selector);
    if (found === null) throw new Error(`missing ${selector}`);
    return found;
  }

  function named(label: string): HTMLElement {
    return the(`[aria-label="${label}"]`);
  }

  function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    const found = named(label);
    if (found instanceof window.HTMLInputElement || found instanceof window.HTMLTextAreaElement || found instanceof window.HTMLSelectElement) return found;
    throw new Error(`not a field ${label}`);
  }

  function maybeButton(text: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll('button')).find(el => el.textContent === text);
  }

  function button(text: string): HTMLButtonElement {
    const found = maybeButton(text);
    if (found === undefined) throw new Error(`missing button ${text}`);
    return found;
  }

  function slices(): string[] {
    return Array.from(document.querySelectorAll('.tasks-file')).map(el => el.textContent);
  }

  function changes(): number {
    return document.querySelectorAll('aside[aria-label="changes"] li.change').length;
  }

  function panelText(): string {
    return the('dialog[aria-label="Tasks"]').textContent;
  }

  async function openTasks(): Promise<void> {
    await settled(() => expect(maybeButton('Tasks')).toBeDefined());
    await click(button('Tasks'));
    await settled(() => expect(maybe('dialog[aria-label="Tasks"]')).not.toBeNull());
  }

  beforeEach(() => {
    Object.assign(world, {
      doc: freshDoc([PACKAGE_CUT]),
      config: { llm: { backend: 'command', command: 'node fake.mjs log' } },
      outcomes: [],
      generated: [],
      files: [],
      puts: 0,
      refusePut: false,
      configDown: false,
      filesDown: false,
      repoDown: false,
      release: null,
    });
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

  it('Interview, edit and save from the page', async () => {
    world.outcomes = [{ reply: QUESTIONS }, { reply: SLICES }];
    await mount();
    await openTasks();
    expect(maybeButton('Continue')).toBeUndefined();
    await click(button('Generate'));
    await settled(() => expect(panelText()).toContain('Must a.ts keep exporting a?'));
    for (const words of ['Other code may import it.', 'Should b.ts move before the cut?', 'The order decides which slice breaks the build.']) expect(panelText()).toContain(words);
    await type(field('Must a.ts keep exporting a?'), 'Yes, keep it.');
    await click(button('Continue'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']));
    expect(world.generated).toEqual([{ step: 'ask' }, { step: 'answer', answers: ['Yes, keep it.', ''] }]);
    expect(named('ran').textContent).toBe(RAN);
    expect(panelText()).toContain('Must a.ts keep exporting a? — Yes, keep it.');
    await click(named('Move 007-cut-app-domain.md up'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-cut-app-domain.md', '007-move-b.md']));
    expect(field('Body of 006-cut-app-domain.md').value.startsWith('# 006 — Cut app from domain')).toBe(true);
    await click(named('Merge 005-add-core.md with next'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-move-b.md']));
    expect(field('Body of 005-add-core.md').value).toBe('# 005 — Add the core package\n\nCreate src/core.\n\nNo behaviour changes.\n');
    await click(named('Delete 006-move-b.md'));
    await click(button('Save as files'));
    expect(slices()).toEqual(['005-add-core.md']);
    await settled(() => expect(panelText()).toContain(`saved to ${DIR}/tasks/`));
    expect(world.files.map(doc => doc.tasks?.map(task => task.file))).toEqual([['005-add-core.md']]);
    expect(field('Brief').value).toBe(BRIEF);
    await settled(() => expect(panelText()).toContain(COMMAND));
    await click(button('Copy command'));
    expect(copied).toEqual([COMMAND]);
    await remount();
    await openTasks();
    expect(slices()).toEqual(['005-add-core.md']);
    expect(field('Brief').value).toBe(BRIEF);
  });

  it('Just write it with questions pending sends the typed answers', async () => {
    world.outcomes = [{ reply: QUESTIONS }, { reply: SLICES }];
    await mount();
    await openTasks();
    await click(button('Generate'));
    await settled(() => expect(maybeButton('Continue')).toBeDefined());
    await type(field('Must a.ts keep exporting a?'), 'a');
    await click(button('Just write it'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']));
    expect(maybeButton('Continue')).toBeUndefined();
    expect(world.generated[1]).toEqual({ step: 'write', answers: ['a', ''] });
    expect(storedDoc().interview?.map(round => [round.round, round.answers])).toEqual([[1, ['a', 'your call']]]);
  });

  it('Canvas edits, Undo and Redo after Generate keep the slices without a reload', async () => {
    world.outcomes = [{ reply: SLICES }];
    await mount();
    await openTasks();
    await click(button('Just write it'));
    await settled(() => expect(slices()).toHaveLength(3));
    expect(world.generated).toEqual([{ step: 'write', answers: [] }]);
    await click(button('Close'));
    await click(button('Add note on domain'));
    await type(field('Note'), 'X');
    await click(button('Add'));
    await settled(() => expect(changes()).toBe(2));
    expect(storedDoc().edits).toEqual([PACKAGE_CUT, NOTE_X]);
    expect([storedDoc().interview, storedDoc().tasks, storedDoc().brief]).toEqual([[], THREE, BRIEF]);
    await click(button('Undo'));
    await settled(() => expect(changes()).toBe(1));
    expect(storedDoc().redo).toEqual([NOTE_X]);
    expect([storedDoc().edits, storedDoc().interview, storedDoc().tasks, storedDoc().brief]).toEqual([[PACKAGE_CUT], [], THREE, BRIEF]);
    await click(button('Redo'));
    await settled(() => expect(changes()).toBe(2));
    expect(storedDoc().edits).toEqual([PACKAGE_CUT, NOTE_X]);
    expect([storedDoc().interview, storedDoc().tasks, storedDoc().brief]).toEqual([[], THREE, BRIEF]);
    await click(button('Tasks'));
    expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']);
  });

  it('Cancel from the page', async () => {
    world.outcomes = ['hang'];
    await mount();
    await openTasks();
    await click(button('Just write it'));
    await settled(() => expect(panelText()).toContain('running for 0 s'));
    expect(button('Generate').closest('fieldset')?.disabled).toBe(true);
    await settled(() => expect(panelText()).toContain('running for 1 s'), 3000);
    await click(button('Cancel'));
    await settled(() => expect(panelText()).toContain('cancelled'));
    expect(panelText()).not.toContain('running for');
    expect(named('ran').textContent).toBe(RAN);
    expect(storedDoc().interview).toBeUndefined();
  });

  it('Settings opens with the saved config and refuses a blank command', async () => {
    await mount(null);
    await settled(() => expect(maybeButton('New plan…')).toBeDefined());
    expect(maybeButton('Tasks')).toBeUndefined();
    await click(named('Settings'));
    await settled(() => expect(maybe('select[aria-label="Backend"]')).not.toBeNull());
    expect([field('Backend').value, field('Command').value]).toEqual(['command', 'node fake.mjs log']);
    await type(field('Backend'), 'claude');
    await type(field('Command'), '');
    await click(button('Save'));
    await settled(() => expect(maybe('dialog[aria-label="Settings"]')).toBeNull());
    expect(world.config).toEqual({ llm: { backend: 'claude' } });
    await click(named('Settings'));
    await settled(() => expect(maybe('select[aria-label="Backend"]')).not.toBeNull());
    expect([field('Backend').value, field('Command').value]).toEqual(['claude', '']);
    await type(field('Backend'), 'command');
    await click(button('Save'));
    expect(the('dialog[aria-label="Settings"]').textContent).toContain('write a command');
    expect(world.config).toEqual({ llm: { backend: 'claude' } });
    await type(field('Command'), 'echo hi');
    await click(button('Save'));
    await settled(() => expect(maybe('dialog[aria-label="Settings"]')).toBeNull());
    expect(world.config).toEqual({ llm: { backend: 'command', command: 'echo hi' } });
  });

  it('Settings falls back to route, shows a refused save and cancels', async () => {
    world.configDown = true;
    await mount(null);
    await click(named('Settings'));
    await settled(() => expect(maybe('select[aria-label="Backend"]')).not.toBeNull());
    expect([field('Backend').value, field('Command').value]).toEqual(['route', '']);
    await type(field('Backend'), 'nonsense');
    await click(button('Save'));
    await settled(() => expect(the('dialog[aria-label="Settings"]').textContent).toContain('bad config'));
    expect(world.config).toEqual({ llm: { backend: 'route' } });
    await click(button('Cancel'));
    expect(maybe('dialog[aria-label="Settings"]')).toBeNull();
  });

  it('Rename, split, move down, preview and copy from the page', async () => {
    world.doc = freshDoc([PACKAGE_CUT], { tasks: THREE, brief: BRIEF });
    await mount();
    await openTasks();
    await typeAndLeave(field('Title of 005-add-core.md'), 'Add src/core');
    await settled(() => expect(field('Body of 005-add-core.md').value.startsWith('# 005 — Add src/core\n\nCreate src/core.')).toBe(true));
    expect(slices()[0]).toBe('005-add-core.md');
    await click(named('Split 005-add-core.md'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-add-core.md', '007-move-b.md', '008-cut-app-domain.md']));
    expect(field('Body of 006-add-core.md').value).toBe('# 006 — Add src/core\n\nCreate src/core.\n');
    await click(named('Move 006-add-core.md down'));
    await settled(() => expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-add-core.md', '008-cut-app-domain.md']));
    await click(named('Preview 005-add-core.md'));
    expect(maybe('[aria-label="Body of 005-add-core.md"]')).toBeNull();
    expect(the('.tasks-preview h1').textContent).toBe('005 — Add src/core');
    expect(the('.tasks-preview p').textContent).toBe('Create src/core.');
    expect(named('Preview 005-add-core.md').getAttribute('aria-pressed')).toBe('true');
    await click(named('Preview 005-add-core.md'));
    expect(maybe('[aria-label="Body of 005-add-core.md"]')).not.toBeNull();
    expect(named('Preview 005-add-core.md').getAttribute('aria-pressed')).toBe('false');
    await click(named('Copy 008-cut-app-domain.md'));
    expect(copied).toEqual(['# 008 — Cut app from domain\n\nNo behaviour changes.\n']);
    await settled(() => expect(storedDoc().tasks?.map(task => task.file)).toEqual(['005-add-core.md', '006-move-b.md', '007-add-core.md', '008-cut-app-domain.md']));
    await settled(() => expect(panelText()).toContain(COMMAND));
    await typeAndLeave(field('Brief'), 'Just cut it.');
    await settled(() => expect(storedDoc().brief).toBe('Just cut it.'));
    expect(panelText()).toContain(COMMAND);
    await click(button('Save as files'));
    await settled(() => expect(world.files.map(doc => doc.brief)).toEqual(['Just cut it.']));
  });

  it('edits a body on leaving it and leaves unchanged fields alone', async () => {
    world.doc = freshDoc([PACKAGE_CUT], { tasks: THREE, brief: BRIEF });
    await mount();
    await openTasks();
    await typeAndLeave(field('Title of 005-add-core.md'), 'Add the core package');
    await typeAndLeave(field('Body of 005-add-core.md'), THREE[0].body);
    await typeAndLeave(field('Brief'), BRIEF);
    expect(world.puts).toBe(0);
    await typeAndLeave(field('Body of 006-move-b.md'), '# 006 — Move b into infra\n\nMove it.\n');
    await settled(() => expect(storedDoc().tasks?.[1].body).toBe('# 006 — Move b into infra\n\nMove it.\n'));
    expect((named('Move 005-add-core.md up') as HTMLButtonElement).disabled).toBe(true);
    expect((named('Move 007-cut-app-domain.md down') as HTMLButtonElement).disabled).toBe(true);
    expect((named('Merge 007-cut-app-domain.md with next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Split at 999 and starts the brief empty', async () => {
    world.doc = freshDoc([PACKAGE_CUT], { tasks: [{ file: '999-last.md', title: 'Last', body: '# 999 — Last\n\n' }] });
    world.repoDown = true;
    await mount();
    await openTasks();
    expect((named('Split 999-last.md') as HTMLButtonElement).disabled).toBe(true);
    expect(field('Brief').value).toBe('');
    expect(panelText()).not.toContain('sc --repo');
  });

  it('An unusable reply shows the error and the raw output on the page', async () => {
    world.doc = freshDoc([PACKAGE_CUT], { tasks: THREE, brief: BRIEF });
    world.outcomes = [{ body: { status: 200, body: { error: "the LLM's reply was not usable: it is not valid JSON", raw: 'nope\n', ran: 'command: echo nope' } } }];
    await mount();
    await openTasks();
    await click(button('Generate'));
    await settled(() => expect(panelText()).toContain("the LLM's reply was not usable: "));
    expect(named('Raw output').textContent).toBe('nope\n');
    expect(named('ran').textContent).toBe('command: echo nope');
    expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']);
  });

  it('shows a route note, an error with no raw output, and a refused save', async () => {
    world.outcomes = [
      { body: { status: 200, body: { error: 'claude is not on PATH', ran: 'claude: claude-opus-5-5, effort high', note: 'route picked grok' } } },
      { body: { status: 409, body: { error: 'already running' } } },
    ];
    world.filesDown = true;
    await mount();
    await openTasks();
    await click(button('Generate'));
    await settled(() => expect(panelText()).toContain('claude is not on PATH'));
    expect(named('note').textContent).toBe('route picked grok');
    expect(maybe('[aria-label="Raw output"]')).toBeNull();
    await click(button('Generate'));
    await settled(() => expect(panelText()).toContain('already running'));
    expect(maybe('[aria-label="ran"]')).toBeNull();
    await click(button('Save as files'));
    await settled(() => expect(panelText()).toContain('no such plan'));
  });

  it('puts the slices back and says why when a save is refused', async () => {
    world.doc = freshDoc([PACKAGE_CUT], { tasks: THREE, brief: BRIEF });
    world.refusePut = true;
    await mount();
    await openTasks();
    await click(named('Delete 005-add-core.md'));
    await settled(() => expect(document.body.textContent).toContain('bad plan'));
    await settled(() => expect(slices()).toHaveLength(3));
    expect(slices()).toEqual(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']);
  });
});
