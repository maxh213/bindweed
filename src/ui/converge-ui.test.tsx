import { JSDOM } from 'jsdom';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractRule, PlanEdit } from '../domain/plan.ts';

const { execFileSync, spawn, spawnSync } = process.getBuiltinModule('node:child_process');
const { cp, mkdir, mkdtemp, readFile, rm, writeFile } = process.getBuiltinModule('node:fs/promises');
const { tmpdir } = process.getBuiltinModule('node:os');
const { dirname, join } = process.getBuiltinModule('node:path');

vi.mock('@xyflow/react', async () => {
  const { createElement: ce, useEffect } = await import('react');

  type FakeNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> };
  type FakeEdge = { id: string; source: string; target: string; type: string; data?: Record<string, unknown>; markerEnd?: unknown };
  type FakeFlowProps = {
    nodes: FakeNode[];
    edges: FakeEdge[];
    nodeTypes: Record<string, (props: never) => ReactElement | null>;
    edgeTypes: Record<string, (props: never) => ReactElement | null>;
    nodesConnectable?: boolean;
    onNodeClick?: (event: unknown, node: FakeNode) => void;
    onConnect?: (connection: { source: string; target: string }) => void;
  };

  let lastFlow: FakeFlowProps | null = null;

  function fakeNodeView(props: FakeFlowProps, node: FakeNode) {
    const Box = props.nodeTypes[node.type] as (props: { id: string; data: Record<string, unknown> }) => ReactElement | null;
    return ce('div', { key: node.id, className: 'fake-node', 'data-node': node.id, onClick: () => props.onNodeClick?.({ shiftKey: false }, node) }, ce(Box, { id: node.id, data: node.data }));
  }

  function fakeEdgeView(props: FakeFlowProps, edge: FakeEdge) {
    const Arrow = props.edgeTypes[edge.type] as (props: Record<string, unknown>) => ReactElement | null;
    return ce(
      'g',
      { key: edge.id },
      ce(Arrow, { id: edge.id, source: edge.source, target: edge.target, data: edge.data, sourceX: 0, sourceY: 0, targetX: 0, targetY: 140, sourcePosition: 'bottom', targetPosition: 'top', markerEnd: edge.markerEnd }),
    );
  }

  function ReactFlow(props: FakeFlowProps) {
    useEffect(() => {
      lastFlow = props;
    });
    return ce(
      'div',
      { className: 'fake-flow', 'data-connectable': String(props.nodesConnectable) },
      props.nodes.map(node => fakeNodeView(props, node)),
      ce('svg', { className: 'fake-edges' }, ...props.edges.map(edge => fakeEdgeView(props, edge))),
    );
  }

  function baseEdge(props: { id: string; style?: { stroke?: string } }) {
    return ce('path', { className: 'fake-edge-path', 'data-edge': props.id, 'data-stroke': props.style?.stroke ?? '' });
  }

  Object.assign(globalThis, {
    convergeConnect: (source: string, target: string) => {
      lastFlow?.onConnect?.({ source, target });
    },
  });

  return {
    ReactFlow,
    ReactFlowProvider: (props: { children: ReactElement }) => props.children,
    useReactFlow: () => ({ setCenter: () => Promise.resolve(true) }),
    BaseEdge: baseEdge,
    Handle: (props: { type?: string; 'aria-label'?: string; isConnectable?: boolean }) =>
      ce('span', { 'data-handle': props.type ?? '', 'data-connectable': String(props.isConnectable), 'aria-label': props['aria-label'] }),
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
    ConnectionMode: { Loose: 'loose', Strict: 'strict' },
    EdgeLabelRenderer: (props: { children: ReactElement }) => props.children,
    getBezierPath: () => ['M0,0 L0,140', 0, 70],
  };
});

const nativeTimeout = globalThis.setTimeout;
const nativeImmediate = globalThis.setImmediate;
const realSleep = (ms: number) => new Promise(done => nativeTimeout(done, ms));
const ROW_GRAPHS = 9;

function graphRequests(): string[] {
  return requests.filter(request => request.startsWith('GET /api/graph'));
}

function needsRowGraphs(needRows: boolean, seen: number): boolean {
  return needRows && seen < ROW_GRAPHS;
}

function convergeBusy(needRows: boolean, seen: number): boolean {
  return inflight > 0 || needsRowGraphs(needRows, seen);
}

function convergeResting(needRows: boolean, seen: number): boolean {
  return inflight === 0 && !needsRowGraphs(needRows, seen);
}

async function pumpOnce(needRows: boolean): Promise<boolean> {
  await realSleep(5);
  const before = graphRequests().length;
  const step = convergeBusy(needRows, before) ? 1 : 0;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(step);
  });
  return convergeResting(needRows, graphRequests().length);
}

async function pumpConverge(needRows: boolean): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 400 && quiet < 6; round += 1) quiet = (await pumpOnce(needRows)) ? quiet + 1 : 0;
}

async function hideMidRefresh(): Promise<void> {
  let release = (): void => undefined;
  gate = new Promise(done => {
    release = done;
  });
  visibility = 'visible';
  await act(async () => {
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
  visibility = 'hidden';
  await act(async () => {
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
  release();
  await realSleep(50);
}
const sheet = process.getBuiltinModule('node:fs').readFileSync(new URL('./app.css', import.meta.url), 'utf8');
const GREEN = 'rgb(22, 163, 74)';
const GREY = 'rgb(100, 116, 139)';
const RED = 'rgb(220, 38, 38)';
const MOVE: PlanEdit = { kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' };
const CUT: PlanEdit = {
  kind: 'cut-edge',
  from: 'src/app',
  to: 'src/infra',
  files: [
    ['src/app/a.ts', 'src/infra/db.ts'],
    ['src/app/b.ts', 'src/infra/db.ts'],
    ['src/app/c.ts', 'src/infra/db.ts'],
  ],
};
const GATE_EDITS: PlanEdit[] = [MOVE, CUT, { kind: 'create-package', path: 'src/ports' }, { kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }];
const RULES: ContractRule[] = [
  { name: 'bindweed:no-src-app-to-src-infra', severity: 'error', comment: 'src/app must not import src/infra', from: { path: '^src/app/' }, to: { path: '^src/infra/' } },
  { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
];
const DB_IMPORT = "import { query } from '../infra/db';\n";

let outer: string;
let root: string;
let wt: string;
let head: string;
let port: number;
let server: ReturnType<typeof spawn>;
let token: string;
let pids: number[];
let requests: string[];
let inflight: number;
let gate: Promise<void> | null;
let dom: JSDOM;
let reactRoot: Root | null;
let visibility: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function wtPath(path: string): string {
  return join(wt, path);
}

async function wtMove(from: string, to: string): Promise<void> {
  await put(wtPath(to), await readFile(wtPath(from), 'utf8'));
  await rm(wtPath(from));
}

async function plan(edits: PlanEdit[], rules: ContractRule[] | null = RULES): Promise<void> {
  const doc = { version: 1, name: 'Gate', slug: 'gate', createdAt: '2026-10-22T12:00:00.000Z', baseCommit: head, edits, redo: [], ...(rules === null ? {} : { contract: { rules } }) };
  await put(join(root, '.bindweed', 'plans', 'gate.json'), JSON.stringify(doc));
}

function planBytes(): Promise<string> {
  return readFile(join(root, '.bindweed', 'plans', 'gate.json'), 'utf8');
}

async function runs(entries: Record<string, unknown>[]): Promise<void> {
  await put(join(root, '.bindweed', 'runs.json'), JSON.stringify(entries));
}

function runEntry(slug: string, worktree: string, pid: number, startedAt = '2026-10-22T12:00:00.000Z'): Record<string, unknown> {
  return { slug, tool: 'marestail', worktree, branch: `bindweed/${slug}`, pid, startedAt, out: join(outer, 'missing.out'), settings: {} };
}

function livePid(): number {
  const child = spawn('sleep', ['900'], { stdio: 'ignore' });
  pids.push(Number(child.pid));
  return Number(child.pid);
}

const fetcher = (async (path: string | URL | Request, init?: RequestInit) => {
  requests.push(`${init?.method ?? 'GET'} ${String(path)}`);
  inflight += 1;
  try {
    if (String(path).startsWith('/api/graph')) await gate;
    return await fetch(`http://127.0.0.1:${port}${String(path)}`, init);
  } finally {
    inflight -= 1;
  }
}) as typeof fetch;

function installDom(hash: string): void {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: `http://127.0.0.1/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const style = w.document.createElement('style');
  style.textContent = sheet;
  w.document.head.appendChild(style);
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => visibility });
  const globals: Record<string, unknown> = { window: w, document: w.document };
  for (const name of ['HTMLElement', 'Node', 'DocumentFragment', 'MutationObserver', 'MouseEvent', 'KeyboardEvent', 'navigator'] as const) globals[name] = w[name];
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: false, configurable: true });
}

async function show(hash: string): Promise<void> {
  installDom(hash);
  reactRoot = createRoot(document.getElementById('root') as HTMLElement);
  const { App } = await import('./App.tsx');
  await act(async () => {
    reactRoot?.render(createElement(App, { token, location: window.location, historyApi: window.history, fetcher }));
  });
}

async function reopen(hash: string): Promise<void> {
  await act(async () => reactRoot?.unmount());
  reactRoot = null;
  dom.window.close();
  await show(hash);
}

async function until(check: () => void | Promise<void>): Promise<void> {
  await waitFor(check, { timeout: 6000, interval: 25 });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === name);
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

function maybeButton(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === name);
}

function toolbarNames(): string[] {
  return [...document.querySelectorAll('.arch-toolbar button')].map(button => button.getAttribute('aria-label') ?? button.textContent ?? '');
}

function one(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

function header(): string | null {
  return document.querySelector('p.converge-header')?.textContent ?? null;
}

function markOf(mark: HTMLElement): { text: string; color: string; status: string | null } {
  return { text: String(mark.textContent), color: window.getComputedStyle(mark).color, status: String(mark.dataset.status) };
}

function marks(): { text: string; color: string; status: string | null }[] {
  return [...document.querySelectorAll<HTMLElement>('aside[aria-label="changes"] ol li.change span.converge-mark')].map(markOf);
}

function row(index: number): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('aside[aria-label="changes"] ol li.change')][index];
}

function remainOf(element: Element): string[] {
  return [...element.querySelectorAll('ul.converge-remain li')].map(item => item.textContent ?? '');
}

function boxRows(id: string): HTMLElement[] {
  return [...one(`.box[data-id="${id}"]`).querySelectorAll<HTMLElement>('.box-row')];
}

function color(element: Element): string {
  return window.getComputedStyle(element).color;
}

async function chooseShown(label: string): Promise<void> {
  const radio = [...document.querySelectorAll('input[name="shown-graph"]')].find(input => input.parentElement?.textContent === label);
  if (radio === undefined) throw new Error(`no ${label}`);
  await click(radio);
}

beforeEach(async () => {
  pids = [];
  requests = [];
  inflight = 0;
  gate = null;
  reactRoot = null;
  visibility = 'visible';
  outer = await mkdtemp(join(tmpdir(), 'bw-converge-ui-'));
  root = join(outer, 'layered');
  wt = join(outer, 'converge-wt');
  await cp(join(process.cwd(), 'qa', 'fixtures', 'layered'), root, { recursive: true });
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  head = git(root, 'rev-parse', 'HEAD').trim();
  await cp(root, wt, { recursive: true });
  await put(wtPath('src/app/c.ts'), "import { query } from '../infra/db';\nexport const c = query;\n");
  await plan(GATE_EDITS);
  await runs([runEntry('gate', wt, livePid())]);
  await startBindweed();
});

async function startBindweed(): Promise<void> {
  const base = String(30000 + Math.floor(Math.random() * 25000));
  server = spawn(process.execPath, [join(process.cwd(), 'src', 'cli.ts'), root], { env: { ...process.env, BINDWEED_PORT: base }, stdio: ['ignore', 'pipe', 'inherit'] });
  const link = await new Promise<RegExpMatchArray>((done, failed) => {
    let text = '';
    server.stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      const found = /127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]+)/.exec(text);
      if (found !== null) done(found);
    });
    server.once('exit', () => failed(new Error(`bindweed exited: ${text}`)));
  });
  port = Number(link[1]);
  token = link[2];
}

afterEach(async () => {
  if (reactRoot !== null) await act(async () => reactRoot?.unmount());
  dom.window.close();
  globalThis.setImmediate = nativeImmediate;
  vi.useRealTimers();
  server.kill();
  for (const pid of pids) process.kill(pid);
  await rm(outer, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the page shows Converge, then returns to the browsed repository', () => {
  it('The card and the toolbar open the worktree, and Leave restores the browsed view', async () => {
    const before = await planBytes();
    await show('#at=src&plan=gate');
    await until(() => expect(toolbarNames()).toContain('Converge'));
    const names = toolbarNames();
    expect(names.slice(names.indexOf('Tasks'), names.indexOf('Tasks') + 4)).toEqual(['Tasks', 'Launch', 'Settings', 'Converge']);
    expect(header()).toBeNull();
    await until(() => expect(row(1).querySelector('.change-reason')?.textContent).toBe('no such file src/app/c.ts'));
    expect(row(0).querySelector('.change-reason')).toBeNull();
    await click(buttonNamed('Converge'));
    expect(window.location.hash).toBe('#at=src&plan=gate&converge=gate');
    await until(() => expect(header()).toBe('0 of 4 edits done · 0 of 2 rules hold'));
    await until(() => expect(marks()).toEqual(Array.from({ length: 4 }, () => ({ text: '○', color: GREY, status: 'not yet' }))));
    expect(remainOf(row(1))).toEqual(['src/app/a.ts:2', 'src/app/b.ts:2', 'src/app/c.ts:1']);
    expect(document.querySelector('.change-reason')).toBeNull();
    await click(row(2).querySelector('.change-sentence') as Element);
    await until(() => expect(one("[data-id='src/ports']").dataset.selected).toBe('true'));
    const rules = [...document.querySelectorAll('ul.converge-rules > li')];
    expect(rules.map(rule => [rule.firstChild?.textContent, rule.childNodes[1]?.textContent])).toEqual([
      ['○', 'src/app must not import src/infra'],
      ['○', 'No circular dependencies'],
    ]);
    await until(() => expect(boxRows('src/app').map(item => item.dataset.path)).toContain('src/app/model.ts'));
    const cut = one("g.cutmark[data-from='src/app'][data-to='src/infra']");
    expect(cut.dataset.converge).toBeUndefined();
    expect(cut.querySelector<HTMLElement>('.fake-edge-path')?.dataset.stroke).toBe('#94a3b8');
    expect(window.getComputedStyle(cut.querySelector('text.cut-label') as Element).fill).toBe(GREY);
    expect(one("[data-id='src/ports']").textContent).toContain('0 files');
    expect(one("[data-id='src/ports']").dataset.converge).toBeUndefined();
    const model = one("[data-path='src/app/model.ts']");
    expect(model.dataset.converge).toBeUndefined();
    expect(color(model)).not.toBe(GREEN);
    expect(one("[data-path='src/app/b.ts']").dataset.fate).toBe('delete');
    for (const name of ['Undo', 'Redo', 'Plan', 'New plan…', 'Delete plan', 'Contract', 'Tasks', 'Launch']) {
      const control = name === 'Plan' ? one('select[aria-label="Plan"]') : buttonNamed(name);
      expect([name, control.hasAttribute('disabled')]).toEqual([name, true]);
    }
    expect([...document.querySelectorAll('button[aria-label="Remove"]')].every(button => button.hasAttribute('disabled'))).toBe(true);
    expect([maybeButton('Canvas'), maybeButton('Menu')]).toEqual([undefined, undefined]);
    expect(document.querySelector('aside[aria-label="proposals"], aside[aria-label="ask"], [aria-label="Draw dependency"]')).toBeNull();
    await click(one('.fake-node[data-node="src/infra"]'));
    expect(maybeButton('Menu')).toBeUndefined();
    await act(async () => (globalThis as unknown as { convergeConnect: (from: string, to: string) => void }).convergeConnect('src/infra', 'src/app'));
    const aRow = one("[data-path='src/app/a.ts']");
    expect(aRow.getAttribute('draggable')).toBe('false');
    await act(async () => {
      fireEvent.drop(one("[data-id='src/infra']"), { dataTransfer: { getData: () => 'src/app/a.ts' } });
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    await realSleep(100);
    expect(document.querySelectorAll('aside[aria-label="changes"] ol li.change')).toHaveLength(4);
    expect(await planBytes()).toBe(before);
    await click(buttonNamed('Leave'));
    expect(window.location.hash).toBe('#at=src&plan=gate');
    await until(() => expect(one("[data-id='src/app']").textContent).toContain('3 files'));
    expect(header()).toBeNull();
  });

  it('Done marks turn green, a contradicted move turns red, and the plan file stays', async () => {
    const before = await planBytes();
    await rm(wtPath('src/domain/model.ts'));
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(marks()[0]).toEqual({ text: '✗', color: RED, status: 'contradicted' }));
    await until(() => expect(one("[data-path='src/app/model.ts']").dataset.converge).toBe('contradicted'));
    const lost = one("[data-path='src/app/model.ts']");
    expect([lost.dataset.ghost, color(lost), lost.closest('.box')?.getAttribute('data-id')]).toEqual(['true', RED, 'src/app']);
    await put(wtPath('src/app/model.ts'), 'export class Model { id = 0; }\n');
    for (const file of ['src/app/a.ts', 'src/app/b.ts', 'src/app/c.ts']) await writeFile(wtPath(file), (await readFile(wtPath(file), 'utf8')).replace(DB_IMPORT, ''));
    await put(wtPath('src/ports/port.ts'), 'export const port = 1;\n');
    await click(buttonNamed('Rescan'));
    expect(requests).toContain('POST /api/rescan?converge=gate');
    expect(requests).not.toContain('POST /api/rescan');
    await until(() => expect(header()).toBe('3 of 4 edits done · 1 of 2 rules hold'));
    await until(() => expect(one("[data-path='src/app/model.ts']").dataset.converge).toBe('done'));
    expect(color(one("[data-path='src/app/model.ts']"))).toBe(GREEN);
    const cut = one("g.cutmark[data-from='src/app'][data-to='src/infra']");
    expect([cut.dataset.converge, cut.querySelector<HTMLElement>('.fake-edge-path')?.dataset.stroke]).toEqual(['done', '#16a34a']);
    expect(window.getComputedStyle(cut.querySelector('text.cut-label') as Element).fill).toBe(GREEN);
    const ports = one("[data-id='src/ports']");
    expect([ports.dataset.converge, window.getComputedStyle(ports).borderTopColor]).toEqual(['done', GREEN]);
    expect(marks().slice(0, 3)).toEqual(Array.from({ length: 3 }, () => ({ text: '✓', color: GREEN, status: 'done' })));
    expect([...document.querySelectorAll('ul.converge-rules > li')].map(rule => rule.firstChild?.textContent)).toEqual(['✓', '○']);
    expect(await planBytes()).toBe(before);
  });

  it('A done add-edge colours its arrow, and a done rename-package its box', async () => {
    await plan([{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }, { kind: 'rename-package', from: 'src/infra', to: 'src/data' }], null);
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(document.querySelector("g[data-from='src/domain'][data-to='src/app']")).not.toBeNull());
    const planned = one("g[data-from='src/domain'][data-to='src/app']");
    expect([planned.dataset.planned, planned.dataset.converge]).toEqual(['true', undefined]);
    expect(planned.querySelector<HTMLElement>('.fake-edge-path')?.dataset.stroke).not.toBe('#16a34a');
    expect(one("[data-id='src/data']").dataset.converge).toBeUndefined();
    await writeFile(wtPath('src/domain/model.ts'), `import { a } from '../app/a';\n${await readFile(wtPath('src/domain/model.ts'), 'utf8')}`);
    await wtMove('src/infra/db.ts', 'src/data/db.ts');
    await click(buttonNamed('Rescan'));
    await until(() => expect(header()).toBe('2 of 2 edits done · 0 of 0 rules hold'));
    await until(() => expect(one("g[data-from='src/domain'][data-to='src/app']").dataset.converge).toBe('done'));
    expect(one("g[data-from='src/domain'][data-to='src/app'] .fake-edge-path").dataset.stroke).toBe('#16a34a');
    const data = one("[data-id='src/data']");
    expect([data.dataset.converge, window.getComputedStyle(data).borderTopColor]).toEqual(['done', GREEN]);
  });

  it("A stale later move shifts the canvas mark off the verdict's path", async () => {
    await plan([{ kind: 'move-file', file: 'src/domain/model.ts', to: 'src/app' }, { kind: 'move-file', file: 'src/app/model.ts', to: 'src/nowhere' }], null);
    await wtMove('src/domain/model.ts', 'src/app/model.ts');
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(marks()).toEqual([
      { text: '✓', color: GREEN, status: 'done' },
      { text: '○', color: GREY, status: 'not yet' },
    ]));
    expect(header()).toBe('1 of 2 edits done · 0 of 0 rules hold');
    await until(() => expect(one("[data-path='src/app/model.ts']").dataset.converge).toBeUndefined());
    expect(document.querySelector("[data-path='src/nowhere/model.ts']")).toBeNull();
    expect(document.querySelector("[data-id='src/nowhere']")).toBeNull();
  });

  it('A contradicted rename, merge or split draws no red row', async () => {
    await plan([{ kind: 'rename-package', from: 'src/infra', to: 'src/app' }], null);
    await rm(wtPath('src/infra/db.ts'));
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(marks()).toEqual([{ text: '✗', color: RED, status: 'contradicted' }]));
    expect(header()).toBe('0 of 1 edits done · 0 of 0 rules hold');
    await until(() => expect(boxRows('src/app').map(item => item.textContent)).toContain('a.ts'));
    expect(one("[data-id='src/app']").dataset.converge).toBeUndefined();
    expect(document.querySelector("[data-path='src/app/db.ts']")).toBeNull();
    expect(document.querySelector('.box-row[data-converge="contradicted"]')).toBeNull();
    await plan([{ kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/infra' }], null);
    await cp(join(root, 'src/infra/db.ts'), wtPath('src/infra/db.ts'));
    await rm(wtPath('src/app/a.ts'));
    await rm(wtPath('src/app/b.ts'));
    await rm(wtPath('src/domain/model.ts'));
    await reopen('#at=src&plan=gate&converge=gate');
    await until(() => expect(marks()).toEqual([{ text: '✗', color: RED, status: 'contradicted' }]));
    expect(header()).toBe('0 of 1 edits done · 0 of 0 rules hold');
    await until(() => expect(boxRows('src/infra').map(item => item.textContent)).toEqual(['db.ts']));
    expect(one("[data-id='src/infra']").dataset.converge).toBeUndefined();
    expect(document.querySelector("[data-path='src/infra/a.ts']")).toBeNull();
    expect(document.querySelector('.box-row[data-converge="contradicted"]')).toBeNull();
    await plan([{ kind: 'split-package', package: 'src/app', parts: [{ name: 'read', files: ['src/app/a.ts'] }, { name: 'write', files: ['src/app/b.ts'] }] }], null);
    await cp(join(root, 'src/domain/model.ts'), wtPath('src/domain/model.ts'));
    await put(wtPath('src/app/read/other.ts'), 'export const other = 1;\n');
    await reopen('#at=src/app&plan=gate&converge=gate');
    await until(() => expect(marks()).toEqual([{ text: '✗', color: RED, status: 'contradicted' }]));
    expect(header()).toBe('0 of 1 edits done · 0 of 0 rules hold');
    await until(() => expect(boxRows('src/app/read').map(item => item.dataset.path)).toEqual(['src/app/read/other.ts']));
    expect(one("[data-id='src/app/read']").dataset.converge).toBeUndefined();
    expect(document.querySelector("[data-path='src/app/read/a.ts']")).toBeNull();
    expect(document.querySelector('.box-row[data-converge="contradicted"]')).toBeNull();
  }, 60000);

  it('Now, Planned, the rows and the detail all read the worktree', async () => {
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(document.querySelector('.fake-node[data-node="src/infra"]')).not.toBeNull());
    await click(one('.fake-node[data-node="src/infra"]'));
    await until(() => expect(requests.some(request => request.includes('/api/detail?id=src%2Finfra'))).toBe(true));
    const scans = requests.filter(request => request.startsWith('GET /api/graph') || request.startsWith('GET /api/detail'));
    expect(scans.every(request => request.endsWith('converge=gate'))).toBe(true);
    for (const part of ['at=src&plan=gate', 'at=src&tests=1&plan=gate', 'graph?at=src&converge', 'at=src%2Fapp&plan=gate', 'graph?at=src%2Fapp&converge']) expect([part, scans.some(request => request.includes(part))]).toEqual([part, true]);
    await chooseShown('Now');
    await until(() => expect(boxRows('src/app').map(item => [item.textContent, item.dataset.ghost ?? null, item.dataset.converge ?? null])).toEqual([
      ['a.ts', null, null],
      ['b.ts', null, null],
      ['c.ts', null, null],
      ['model.ts', 'true', null],
    ]));
    await until(() => expect(boxRows('src/domain').map(item => item.textContent)).toEqual(['model.ts']));
    await until(() => expect(boxRows('src/infra').map(item => item.textContent)).toEqual(['db.ts']));
    await wtMove('src/domain/model.ts', 'src/app/model.ts');
    await click(buttonNamed('Rescan'));
    await until(() => expect(document.querySelector("[data-id='src/domain']")).toBeNull());
    await until(() => expect(boxRows('src/app').map(item => [item.textContent, item.dataset.ghost ?? null])).toEqual([['a.ts', null], ['b.ts', null], ['c.ts', null], ['model.ts', null]]));
    await rm(wtPath('src/app/b.ts'));
    await click(buttonNamed('Rescan'));
    await until(() => expect(boxRows('src/app').map(item => [item.textContent, item.dataset.ghost ?? null])).toEqual([['a.ts', null], ['c.ts', null], ['model.ts', null]]));
    await chooseShown('Planned');
    await until(() => expect(header()).toBe('1 of 4 edits done · 1 of 2 rules hold'));
    await until(() => expect(boxRows('src/app').map(item => item.dataset.path)).toEqual(['src/app/a.ts', 'src/app/c.ts', 'src/app/model.ts']));
    expect(document.querySelector('.box[data-id="src/app"] [data-ghost="true"]')).toBeNull();
  });

  it('A missing run is the error text, and a card with no worktree has no button', async () => {
    const live = JSON.parse(await readFile(join(root, '.bindweed', 'runs.json'), 'utf8'));
    await runs([...live, runEntry('gone', join(outer, 'converge-gone'), Number(spawnSync('true').pid), '2026-10-22T11:00:00.000Z')]);
    await show('#runs');
    await until(() => expect(document.querySelectorAll('article.run-card')).toHaveLength(2));
    const card = (name: string) => one(`article[aria-label="${name}"]`);
    expect(card('gone').querySelector('button')?.textContent).not.toBe('Converge');
    expect([...card('gone').querySelectorAll('button')].map(button => button.textContent)).not.toContain('Converge');
    expect(card('gone').textContent).toContain('worktree removed');
    await click([...card('Gate').querySelectorAll('button')].find(button => button.textContent === 'Converge') as Element);
    expect(window.location.hash).toBe('#at=&plan=gate&converge=gate');
    await act(async () => reactRoot?.unmount());
    reactRoot = null;
    dom.window.close();
    await show('#at=src&plan=gate&converge=missing');
    await until(() => expect(one('.arch-canvas').textContent).toBe('no such run'));
    expect(toolbarNames()).toContain('Leave');
    expect(header()).toBeNull();
    await click(buttonNamed('Leave'));
    expect(window.location.hash).toBe('#at=src&plan=gate');
    await until(() => expect(one("[data-id='src/app']").textContent).toContain('3 files'));
    await until(() => expect(toolbarNames()).toContain('Converge'));
    await click(buttonNamed('Converge'));
    expect(window.location.hash).toBe('#at=src&plan=gate&converge=gate');
    await click(one('[role="tab"]'));
    await click([...document.querySelectorAll('[role="tab"]')][1]);
    expect(window.location.hash).toBe('#at=src&plan=gate');
    expect(header()).toBeNull();
  });

  it('The view refreshes while the pid is alive and the tab is visible', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const advance = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      await pumpConverge(false);
    };
    const count = (prefix: string): number => requests.filter(request => request.startsWith(prefix)).length;
    await show('#at=src&plan=gate&converge=gate');
    await pumpConverge(true);
    expect(header()).toBe('0 of 4 edits done · 0 of 2 rules hold');
    expect(count('GET /api/converge?slug=gate')).toBe(1);
    const first = graphRequests();
    expect(first.every(request => request.endsWith('converge=gate'))).toBe(true);
    expect(first.toSorted()).toEqual(
      [
        'at=src&converge=gate',
        'at=src&plan=gate&converge=gate',
        'at=src&tests=1&plan=gate&converge=gate',
        'at=src%2Fapp&converge=gate',
        'at=src%2Fapp&plan=gate&converge=gate',
        'at=src%2Finfra&converge=gate',
        'at=src%2Finfra&plan=gate&converge=gate',
        'at=src%2Fports&converge=gate',
        'at=src%2Fports&plan=gate&converge=gate',
      ]
        .map(query => `GET /api/graph?${query}`)
        .toSorted(),
    );
    requests.length = 0;
    await realSleep(20);
    await advance(19999);
    expect(requests).toEqual([]);
    await advance(1);
    expect(count('GET /api/converge?slug=gate')).toBe(1);
    expect(graphRequests().toSorted()).toEqual(first.toSorted());
    requests.length = 0;
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    await advance(25000);
    expect(requests).toEqual([]);
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    await pumpConverge(true);
    expect(count('GET /api/converge?slug=gate')).toBe(1);
    requests.length = 0;
    await click(document.querySelectorAll('[role="tab"]')[0]);
    await advance(25000);
    expect(requests.filter(request => request.includes('converge'))).toEqual([]);
    await act(async () => reactRoot?.unmount());
    reactRoot = null;
    dom.window.close();
    await runs([runEntry('gate', wt, Number(spawnSync('true').pid))]);
    requests.length = 0;
    await show('#at=src&plan=gate&converge=gate');
    await pumpConverge(true);
    expect(count('GET /api/converge?slug=gate')).toBe(1);
    await advance(25000);
    expect(count('GET /api/converge?slug=gate')).toBe(1);
    requests.length = 0;
    await click(buttonNamed('Rescan'));
    await pumpConverge(true);
    expect(requests[0]).toBe('POST /api/rescan?converge=gate');
    expect(requests).toContain('GET /api/converge?slug=gate');
    expect(requests).not.toContain('POST /api/rescan');
  }, 60000);

  it('a refresh that falls due while the tab is hidden does not start, and the toolbar button needs a handler', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Reflect.deleteProperty(globalThis, 'setImmediate');
    let release = (): void => undefined;
    gate = new Promise(done => {
      release = done;
    });
    await show('#at=src&plan=gate&converge=gate');
    await until(() => expect(requests).toContain('GET /api/converge?slug=gate'));
    for (let round = 0; round < 400 && header() === null; round += 1) {
      await realSleep(15);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(header()).toBe('0 of 4 edits done · 0 of 2 rules hold');
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    release();
    await until(() => expect(inflight).toBe(0));
    requests.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25000);
    });
    await realSleep(100);
    expect(requests.filter(request => request.startsWith('GET /api/converge'))).toEqual([]);
    await hideMidRefresh();
    vi.useRealTimers();
    await act(async () => reactRoot?.unmount());
    dom.window.close();
    installDom('#at=src&plan=gate');
    reactRoot = createRoot(document.getElementById('root') as HTMLElement);
    const { ArchView } = await import('./ArchView.tsx');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const client = new QueryClient();
    const card = { slug: 'gate', planName: 'Gate', planExists: true, tool: 'marestail', branch: null, worktree: wt, worktreeExists: true, pid: 1, startedAt: '2026-10-22T12:00:00.000Z', state: 'running' as const, position: '', prs: [], logTail: [] };
    await act(async () => {
      reactRoot?.render(
        createElement(QueryClientProvider, { client }, createElement(ArchView, { token, at: 'src', plan: 'gate', runs: { runs: [card] }, fetcher, onDrill: () => undefined, onOpenFile: () => undefined })),
      );
    });
    await until(() => expect(toolbarNames()).toContain('Converge'));
    await click(buttonNamed('Converge'));
    expect(toolbarNames()).toContain('Converge');
    expect(header()).toBeNull();
  });
});
