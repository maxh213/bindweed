export const FILE_DRAG_MIME = 'text/x-bindweed-file';

export function fieldTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function eventPoint(event: unknown): { x: number; y: number } | null {
  if (!(event instanceof MouseEvent)) return null;
  return { x: event.clientX, y: event.clientY };
}

function crumbAtPoint(elements: Element[]): string | null {
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const at = el.dataset.crumb;
    if (at !== undefined) return at;
  }
  return null;
}

function packageIdOf(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (!el.classList.contains('package')) return null;
  return el.dataset.id ?? null;
}

function packageAtPoint(elements: Element[]): string | null {
  for (const el of elements) {
    const id = packageIdOf(el);
    if (id !== null) return id;
  }
  return null;
}

export function planDropTarget(event: unknown): string | null {
  const point = eventPoint(event);
  if (point === null) return null;
  const elements = document.elementsFromPoint(point.x, point.y);
  return crumbAtPoint(elements) ?? packageAtPoint(elements);
}

type KeyAction = 'undo' | 'redo' | 'delete';

function undoKey(key: string, ctrl: boolean): boolean {
  return ctrl && (key === 'z' || key === 'Z');
}

function undoRedoOf(key: string, ctrl: boolean, shift: boolean): KeyAction | null {
  if (!undoKey(key, ctrl)) return null;
  return shift ? 'redo' : 'undo';
}

export function keyActionOf(key: string, ctrl: boolean, shift: boolean, inField: boolean): KeyAction | null {
  if (inField) return null;
  if (key === 'Delete') return 'delete';
  return undoRedoOf(key, ctrl, shift);
}
