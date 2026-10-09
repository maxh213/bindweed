import { JSDOM } from 'jsdom';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSummary } from '../domain/plan.ts';
import { ChangeList, DeletePlanDialog, NewPlanDialog, NoteDialog, Notice, PlanSelect, ShownSwitch } from './PlanBar.tsx';

const PLANS: PlanSummary[] = [
  { name: 'Split app', slug: 'split-app', editCount: 0, createdAt: '2026-10-01T00:00:00.000Z' },
  { name: 'Split app', slug: 'split-app-2', editCount: 1, createdAt: '2026-10-02T00:00:00.000Z' },
];

const LABELS = new Map([
  ['split-app', 'Split app'],
  ['split-app-2', 'Split app (split-app-2)'],
]);

const ENTRIES = [
  { sentence: 'Move src/app/save.ts to src/infra', stale: null },
  { sentence: 'src/app must not import src/domain (1 import)', stale: 'no such file src/app/a.ts' },
];

function rowAt(rows: Element[], index: number): Element {
  const found = rows[index];
  if (found === undefined) throw new Error(`missing row ${index}`);
  return found;
}

function rowAttr(rows: Element[], index: number, name: string): string | null {
  return rowAt(rows, index).getAttribute(name);
}

function rowText(rows: Element[], index: number, selector: string): string | null {
  const found = rowAt(rows, index).querySelector(selector);
  if (found === null) return null;
  return found.textContent;
}

function rowPart(rows: Element[], index: number, selector: string): Element {
  const found = rowAt(rows, index).querySelector(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

function changeList(calls: string[]): ReactElement {
  return createElement(ChangeList, {
    entries: ENTRIES,
    canUndo: true,
    canRedo: false,
    onUndo: () => calls.push('undo'),
    onRedo: () => calls.push('redo'),
    onPick: (entry: { sentence: string }) => calls.push(`pick:${entry.sentence}`),
    onRemove: (index: number) => calls.push(`remove:${index}`),
  });
}

describe('the plan bar components', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:4700/' });
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const el = document.getElementById('root');
    if (el === null) throw new Error('missing root');
    root = createRoot(el);
  });

  afterEach(() => {
    root.unmount();
    dom.window.close();
  });

  async function show(element: ReactElement): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      root.render(element);
    });
  }

  async function change(el: Element, value: string): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    const { act } = await import('react');
    await act(async () => {
      fireEvent.change(el, { target: { value } });
    });
  }

  async function typeText(el: Element, value: string): Promise<void> {
    const { act } = await import('react');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(el, value);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  async function click(el: Element): Promise<void> {
    const { fireEvent } = await import('@testing-library/dom');
    const { act } = await import('react');
    await act(async () => {
      fireEvent.click(el);
    });
  }

  function button(text: string): HTMLElement {
    const found = Array.from(document.querySelectorAll('button')).find(el => el.textContent === text);
    if (found === undefined) throw new Error(`missing button ${text}`);
    return found;
  }

  function textOf(selector: string): string | null {
    const found = document.querySelector(selector);
    if (found === null) return null;
    return found.textContent;
  }

  function input(label: string): HTMLElement {
    const found = document.querySelector(`input[aria-label="${label}"]`);
    if (found === null) throw new Error(`missing input ${label}`);
    return found as HTMLElement;
  }

  it('lists No plan and the plans, reporting the chosen slug', async () => {
    const chosen: (string | null)[] = [];
    await show(createElement(PlanSelect, { value: 'split-app-2', plans: PLANS, labels: LABELS, onChoose: slug => chosen.push(slug) }));
    const select = document.querySelector('select[aria-label="Plan"]') as HTMLSelectElement;
    expect(select.value).toBe('split-app-2');
    expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No plan', 'Split app', 'Split app (split-app-2)']);
    expect(select.closest('label')?.textContent).toBe('Plan No planSplit appSplit app (split-app-2)');
    await change(select, '');
    await change(select, 'split-app');
    expect(chosen).toEqual([null, 'split-app']);
  });

  it('falls back to the plan name when the labels lack the slug', async () => {
    await show(createElement(PlanSelect, { value: '', plans: PLANS, labels: new Map(), onChoose: () => undefined }));
    const select = document.querySelector('select[aria-label="Plan"]') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No plan', 'Split app', 'Split app']);
  });

  it('creates a trimmed plan name and refuses an empty one', async () => {
    const created: string[] = [];
    const cancelled: string[] = [];
    await show(createElement(NewPlanDialog, { error: null, onCreate: name => created.push(name), onCancel: () => cancelled.push('x') }));
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('New plan');
    expect(textOf('.plan-dialog label')).toBe('Name ');
    await click(button('Create'));
    expect(textOf('.plan-dialog-error')).toBe('write a name');
    expect(created).toEqual([]);
    await typeText(input('Name'), '   ');
    await click(button('Create'));
    expect(textOf('.plan-dialog-error')).toBe('write a name');
    expect(created).toEqual([]);
    await typeText(input('Name'), '  Split app  ');
    await click(button('Create'));
    expect(created).toEqual(['Split app']);
    expect(textOf('.plan-dialog-error')).toBeNull();
    await click(button('Cancel'));
    expect(cancelled).toEqual(['x']);
  });

  it('shows the server error when no local error is set', async () => {
    await show(createElement(NewPlanDialog, { error: 'bad name', onCreate: () => undefined, onCancel: () => undefined }));
    expect(document.querySelector('.plan-dialog-error')?.textContent).toBe('bad name');
  });

  it('confirms the plan deletion by name', async () => {
    const calls: string[] = [];
    await show(createElement(DeletePlanDialog, { name: 'Split app', onDelete: () => calls.push('delete'), onCancel: () => calls.push('cancel') }));
    expect(document.querySelector('dialog')?.textContent).toContain('Delete Split app?');
    await click(button('Delete'));
    await click(button('Cancel'));
    expect(calls).toEqual(['delete', 'cancel']);
  });

  it('adds a trimmed note and refuses an empty one', async () => {
    const added: string[] = [];
    const cancelled: string[] = [];
    await show(createElement(NoteDialog, { error: null, onAdd: text => added.push(text), onCancel: () => cancelled.push('x') }));
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('Add note');
    await click(button('Add'));
    expect(document.querySelector('.plan-dialog-error')?.textContent).toBe('write a note');
    expect(added).toEqual([]);
    await typeText(input('Note'), '  keep this  ');
    await click(button('Add'));
    expect(added).toEqual(['keep this']);
    await click(button('Cancel'));
    expect(cancelled).toEqual(['x']);
  });

  it('switches the shown graph between Now and Planned', async () => {
    const chosen: string[] = [];
    await show(createElement(ShownSwitch, { shown: 'planned', onChoose: shown => chosen.push(shown) }));
    const group = document.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Shown graph');
    const radios = Array.from(document.querySelectorAll('input[name="shown-graph"]')) as HTMLInputElement[];
    expect(radios.map(radio => radio.checked)).toEqual([false, true]);
    await click(radios[0] as Element);
    await show(createElement(ShownSwitch, { shown: 'now', onChoose: shown => chosen.push(shown) }));
    const second = Array.from(document.querySelectorAll('input[name="shown-graph"]')) as HTMLInputElement[];
    expect(second.map(radio => radio.checked)).toEqual([true, false]);
    await click(second[1] as Element);
    expect(chosen).toEqual(['now', 'planned']);
  });

  it('shows the notice text or nothing', async () => {
    await show(createElement(Notice, { text: 'no such arrow src/app → src/domain' }));
    expect(document.querySelector('output[aria-label="notice"]')?.textContent).toBe('no such arrow src/app → src/domain');
    await show(createElement(Notice, { text: null }));
    expect(document.querySelector('output[aria-label="notice"]')?.textContent).toBe('');
  });

  it('lists the changes with stale marks, undo, redo, pick and remove', async () => {
    const calls: string[] = [];
    await show(changeList(calls));
    expect(document.querySelector('aside[aria-label="changes"]')).not.toBeNull();
    const rows = Array.from(document.querySelectorAll('li.change'));
    expect(rowAttr(rows, 0, 'data-stale')).toBeNull();
    expect(rowAttr(rows, 1, 'data-stale')).toBe('true');
    expect(rowText(rows, 1, '.change-reason')).toBe('no such file src/app/a.ts');
    expect(rowText(rows, 0, '.change-reason')).toBeNull();
    expect((button('Undo') as HTMLButtonElement).disabled).toBe(false);
    expect((button('Redo') as HTMLButtonElement).disabled).toBe(true);
    await click(button('Undo'));
    await click(rowPart(rows, 1, '.change-sentence'));
    await click(rowPart(rows, 0, '[aria-label="Remove"]'));
    expect(calls).toEqual(['undo', 'pick:src/app must not import src/domain (1 import)', 'remove:0']);
  });

  it('disables undo and redo on empty stacks', async () => {
    await show(createElement(ChangeList, { entries: [], canUndo: false, canRedo: false, onUndo: () => undefined, onRedo: () => undefined, onPick: () => undefined, onRemove: () => undefined }));
    expect((button('Undo') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelectorAll('li.change')).toHaveLength(0);
  });

  it('keys repeated sentences without duplicate-key warnings', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const entries = [
      { sentence: 'Move a.ts to b', stale: null },
      { sentence: 'Move a.ts to b', stale: null },
      { sentence: 'Move a.ts to b', stale: 'gone' },
    ];
    await show(createElement(ChangeList, { entries, canUndo: true, canRedo: false, onUndo: () => undefined, onRedo: () => undefined, onPick: () => undefined, onRemove: () => undefined }));
    expect(document.querySelectorAll('li.change')).toHaveLength(3);
    const keyWarnings = spy.mock.calls.filter(args => String(args[0]).includes('same key'));
    expect(keyWarnings).toEqual([]);
    spy.mockRestore();
  });
});
