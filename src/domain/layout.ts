export type Pin = { x: number; y: number };

type Overlay = 'none' | 'crap' | 'coverage' | 'mutants';

export type LayoutSettings = { tests: boolean; external: boolean; overlay?: Overlay };

export type LayoutDoc = {
  version: 1;
  views: Record<string, Record<string, Pin>>;
  settings: LayoutSettings;
};

export type LayerNode = { id: string; row: number; order: number };

export type PlacedBox = { id: string; x: number; y: number };

const COL = 260;
const ROW = 140;

export function emptySettings(): LayoutSettings {
  return { tests: false, external: false };
}

export function emptyLayout(): LayoutDoc {
  return { version: 1, views: {}, settings: emptySettings() };
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function pinNumbers(rec: Record<string, unknown>): Pin | undefined {
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number') return undefined;
  if (Object.keys(rec).length !== 2) return undefined;
  return { x: rec.x, y: rec.y };
}

function pinFrom(value: unknown): Pin | undefined {
  const rec = recordOf(value);
  if (rec === undefined) return undefined;
  return pinNumbers(rec);
}

function boolField(rec: Record<string, unknown>, key: string): boolean | undefined {
  const value = rec[key];
  if (typeof value !== 'boolean') return undefined;
  return value;
}

const SETTING_KEYS = ['tests', 'external', 'overlay'];

const OVERLAYS: Record<string, Overlay | undefined> = { none: 'none', crap: 'crap', coverage: 'coverage', mutants: 'mutants' };

function knownKeys(rec: Record<string, unknown>): boolean {
  for (const key of Object.keys(rec)) {
    if (!SETTING_KEYS.includes(key)) return false;
  }
  return true;
}

function overlayField(value: unknown): Overlay | undefined {
  if (typeof value !== 'string') return undefined;
  return OVERLAYS[value];
}

function withOverlay(rec: Record<string, unknown>, settings: LayoutSettings): LayoutSettings | undefined {
  if (!('overlay' in rec)) return settings;
  const overlay = overlayField(rec.overlay);
  if (overlay === undefined) return undefined;
  return { ...settings, overlay };
}

function settingsFields(rec: Record<string, unknown>): LayoutSettings | undefined {
  if (!knownKeys(rec)) return undefined;
  const tests = boolField(rec, 'tests');
  const external = boolField(rec, 'external');
  if (tests === undefined || external === undefined) return undefined;
  return withOverlay(rec, { tests, external });
}

function settingsFrom(value: unknown): LayoutSettings | undefined {
  const rec = recordOf(value);
  if (rec === undefined) return undefined;
  return settingsFields(rec);
}

function viewFrom(value: unknown): Record<string, Pin> | undefined {
  const rec = recordOf(value);
  if (rec === undefined) return undefined;
  const pins: Record<string, Pin> = {};
  for (const [id, pin] of Object.entries(rec)) {
    const parsed = pinFrom(pin);
    if (parsed === undefined) return undefined;
    pins[id] = parsed;
  }
  return pins;
}

function viewsFrom(value: unknown): LayoutDoc['views'] | undefined {
  const rec = recordOf(value);
  if (rec === undefined) return undefined;
  const views: LayoutDoc['views'] = {};
  for (const [at, view] of Object.entries(rec)) {
    const parsed = viewFrom(view);
    if (parsed === undefined) return undefined;
    views[at] = parsed;
  }
  return views;
}

function docFrom(views: LayoutDoc['views'] | undefined, settings: LayoutSettings | undefined): LayoutDoc | undefined {
  if (views === undefined || settings === undefined) return undefined;
  return { version: 1, views, settings };
}

function layoutParts(rec: Record<string, unknown>): LayoutDoc | undefined {
  if (rec.version !== 1 || Object.keys(rec).length !== 3) return undefined;
  return docFrom(viewsFrom(rec.views), settingsFrom(rec.settings));
}

export function parseLayout(raw: unknown): LayoutDoc | undefined {
  const rec = recordOf(raw);
  if (rec === undefined) return undefined;
  return layoutParts(rec);
}

export function withPin(doc: LayoutDoc, at: string, id: string, pin: Pin): LayoutDoc {
  const view = { ...doc.views[at], [id]: pin };
  return { ...doc, views: { ...doc.views, [at]: view } };
}

function omitView(views: LayoutDoc['views'], at: string): LayoutDoc['views'] {
  const next: LayoutDoc['views'] = {};
  for (const [key, pins] of Object.entries(views)) {
    if (key !== at) next[key] = pins;
  }
  return next;
}

export function withoutView(doc: LayoutDoc, at: string): LayoutDoc {
  return { ...doc, views: omitView(doc.views, at) };
}

export function withSettings(doc: LayoutDoc, settings: LayoutSettings): LayoutDoc {
  return { version: doc.version, views: doc.views, settings };
}

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / COL)},${Math.floor(y / ROW)}`;
}

function pinCells(pins: Record<string, Pin>, ids: Set<string>): Set<string> {
  const cells = new Set<string>();
  for (const [id, pin] of Object.entries(pins)) {
    if (ids.has(id)) cells.add(cellKey(pin.x, pin.y));
  }
  return cells;
}

function clearOf(x: number, y: number, taken: Set<string>): Pin {
  if (!taken.has(cellKey(x, y))) return { x, y };
  return clearOf(x + COL, y, taken);
}

function spotFor(node: LayerNode, pins: Record<string, Pin>, taken: Set<string>): PlacedBox {
  const pin = pins[node.id];
  if (pin !== undefined) return { id: node.id, x: pin.x, y: pin.y };
  const free = clearOf(node.order * COL, node.row * ROW, taken);
  return { id: node.id, x: free.x, y: free.y };
}

export function arrange(nodes: LayerNode[], pins: Record<string, Pin>): PlacedBox[] {
  const ids = new Set(nodes.map(node => node.id));
  return nodes.map(node => spotFor(node, pins, pinCells(pins, ids)));
}

export function pointsUp(fromY: number, toY: number, height: number): boolean {
  return fromY - toY > height / 2;
}
