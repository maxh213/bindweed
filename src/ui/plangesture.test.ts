import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import { fieldTarget, keyActionOf, planDropTarget } from './plangesture.ts';

describe('keyActionOf and fieldTarget', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'MouseEvent', { value: dom.window.MouseEvent, configurable: true });
  });

  it('maps keystrokes to undo, redo and delete, skipping form fields', () => {
    expect(keyActionOf('Delete', false, false, false)).toBe('delete');
    expect(keyActionOf('z', true, false, false)).toBe('undo');
    expect(keyActionOf('Z', true, false, false)).toBe('undo');
    expect(keyActionOf('z', true, true, false)).toBe('redo');
    expect(keyActionOf('z', false, false, false)).toBeNull();
    expect(keyActionOf('x', true, false, false)).toBeNull();
    expect(keyActionOf('Delete', false, false, true)).toBeNull();
  });

  it('spots a form field as the event target', () => {
    expect(fieldTarget(document.createElement('input'))).toBe(true);
    expect(fieldTarget(document.createElement('textarea'))).toBe(true);
    expect(fieldTarget(document.createElement('select'))).toBe(true);
    expect(fieldTarget(document.createElement('div'))).toBe(false);
    expect(fieldTarget(null)).toBe(false);
    expect(fieldTarget(document.createElementNS('http://www.w3.org/2000/svg', 'g'))).toBe(false);
  });
});

describe('planDropTarget', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'MouseEvent', { value: dom.window.MouseEvent, configurable: true });
  });

  function atPoint(elements: Element[]): MouseEvent {
    document.elementsFromPoint = () => elements;
    return new window.MouseEvent('mouseup', { clientX: 5, clientY: 6 });
  }

  it('reads the crumb, then the package, under the drop point', () => {
    const crumb = document.createElement('button');
    crumb.dataset.crumb = 'src';
    const box = document.createElement('div');
    box.className = 'box package';
    box.dataset.id = 'src/infra';
    const plain = document.createElement('div');
    const ghost = document.createElement('div');
    ghost.className = 'box package';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(planDropTarget(atPoint([svg, plain, crumb, box]))).toBe('src');
    expect(planDropTarget(atPoint([svg, plain, ghost, box]))).toBe('src/infra');
    expect(planDropTarget(atPoint([svg, plain]))).toBeNull();
    expect(planDropTarget(atPoint([]))).toBeNull();
    expect(planDropTarget({})).toBeNull();
    expect(planDropTarget(null)).toBeNull();
  });
});
