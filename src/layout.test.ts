import { describe, expect, it } from 'vitest';
import {
  arrange,
  emptyLayout,
  parseLayout,
  pointsUp,
  withPin,
  withSettings,
  withoutView,
  type LayoutDoc,
  type LayoutSettings,
} from './domain/layout.ts';

const SETTINGS: LayoutSettings = { tests: false, external: false };

function doc(views: LayoutDoc['views'], settings: LayoutSettings = SETTINGS): LayoutDoc {
  return { version: 1, views, settings };
}

describe('parseLayout', () => {
  it('reads a document and rejects anything else', () => {
    const saved = doc({ src: { 'src/domain': { x: 0, y: -400 }, 'src/gone': { x: 1, y: 2 } } }, { tests: true, external: false });
    expect(parseLayout(saved)).toEqual(saved);
    expect(parseLayout(emptyLayout())).toEqual(emptyLayout());
    const withOverlays = doc({}, { tests: false, external: false, overlay: 'crap' });
    expect(parseLayout(withOverlays)).toEqual(withOverlays);
    const withNone = doc({}, { tests: false, external: false, overlay: 'none' });
    expect(parseLayout(withNone)).toEqual(withNone);

    const refused = [
      null,
      [],
      'not json',
      { version: 2, views: {}, settings: SETTINGS },
      { version: 1, settings: SETTINGS },
      { version: 1, views: {}, settings: { tests: false } },
      { version: 1, views: { src: { 'src/app': { x: 'no', y: 0 } } }, settings: SETTINGS },
      { version: 1, views: { src: { 'src/app': { x: 0, y: 'no' } } }, settings: SETTINGS },
      { version: 1, views: {}, settings: { tests: false, extra: true } },
      undefined,
      { version: 1, views: {}, settings: SETTINGS, extra: 1 },
      { version: 1, views: [], settings: SETTINGS },
      { version: 1, views: { src: [] }, settings: SETTINGS },
      { version: 1, views: { src: { 'src/app': null } }, settings: SETTINGS },
      { version: 1, views: { src: { 'src/app': { x: 1, y: 2, z: 3 } } }, settings: SETTINGS },
      { version: 1, views: {}, settings: { tests: false, external: false, extra: true } },
      { version: 1, views: {}, settings: { tests: 1, external: false } },
      { version: 1, views: {}, settings: null },
      { version: 1, views: {}, settings: { tests: false, external: false, overlay: 'bad' } },
      { version: 1, views: {}, settings: { tests: false, external: false, overlay: 123 } },
    ];
    for (const raw of refused) expect(parseLayout(raw)).toBeUndefined();
  });
});

describe('layout edits', () => {
  it('pins one box, drops one view, and replaces settings', () => {
    const start = doc({ 'src/app': { 'src/app/a.ts': { x: 40, y: 10 } } }, { tests: true, external: false });
    const pinned = withPin(start, 'src', 'src/domain', { x: 3, y: 4 });
    expect(pinned.views.src).toEqual({ 'src/domain': { x: 3, y: 4 } });
    expect(pinned.views['src/app']).toEqual(start.views['src/app']);
    const again = withPin(pinned, 'src', 'src/domain', { x: 5, y: 6 });
    expect(again.views.src).toEqual({ 'src/domain': { x: 5, y: 6 } });
    const cleared = withoutView(again, 'src');
    expect(cleared.views).toEqual({ 'src/app': { 'src/app/a.ts': { x: 40, y: 10 } } });
    expect(cleared.settings).toEqual({ tests: true, external: false });
    expect(withSettings(cleared, { tests: false, external: true }).settings).toEqual({ tests: false, external: true });
    expect(withoutView(doc({}), 'src').views).toEqual({});
  });
});

describe('arrange', () => {
  it('keeps pins and steps a new box right off a taken cell', () => {
    const nodes = [
      { id: 'src/main.ts', row: 0, order: 0 },
      { id: 'src/app', row: 1, order: 0 },
      { id: 'src/infra', row: 2, order: 0 },
      { id: 'src/domain', row: 3, order: 0 },
    ];
    const pins = { 'src/app': { x: 200, y: 100 }, 'src/domain': { x: 260, y: 0 }, 'src/gone': { x: 0, y: 280 } };
    expect(arrange(nodes, pins)).toEqual([
      { id: 'src/main.ts', x: 520, y: 0 },
      { id: 'src/app', x: 200, y: 100 },
      { id: 'src/infra', x: 0, y: 280 },
      { id: 'src/domain', x: 260, y: 0 },
    ]);
  });

  it('ignores a pin whose cell is the row above under floor division', () => {
    const nodes = [
      { id: 'src/main.ts', row: 0, order: 0 },
      { id: 'src/app', row: 1, order: 0 },
    ];
    expect(arrange(nodes, { 'src/app': { x: 0, y: -8 } })).toEqual([
      { id: 'src/main.ts', x: 0, y: 0 },
      { id: 'src/app', x: 0, y: -8 },
    ]);
  });

  it('steps an external off a pin on the same cell and leaves the pin', () => {
    const nodes = [
      { id: 'src/app', row: 0, order: 0 },
      { id: 'src/infra', row: 1, order: 0 },
      { id: 'node:fs', row: 3, order: 0 },
      { id: 'react', row: 3, order: 1 },
      { id: 'src/domain', row: 2, order: 0 },
    ];
    const pins = { 'src/domain': { x: 260, y: 420 } };
    expect(arrange(nodes, pins)).toEqual([
      { id: 'src/app', x: 0, y: 0 },
      { id: 'src/infra', x: 0, y: 140 },
      { id: 'node:fs', x: 0, y: 420 },
      { id: 'react', x: 520, y: 420 },
      { id: 'src/domain', x: 260, y: 420 },
    ]);
  });
});

describe('pointsUp', () => {
  it('is true only past half the box height', () => {
    expect(pointsUp(0, -8, 40)).toBe(false);
    expect(pointsUp(0, -20, 40)).toBe(false);
    expect(pointsUp(0, -21, 40)).toBe(true);
    expect(pointsUp(0, -400, 40)).toBe(true);
    expect(pointsUp(140, 280, 40)).toBe(false);
  });
});
