import { describe, expect, it } from 'vitest';
import { arrowColor, boxCenter, chosenId, countLine, edgeLabel, edgeTitle, filesLabel, headOf, lineOf, parentDir } from './draw.ts';

describe('edge drawing', () => {
  it('picks the line, the head, the label and the colour from the counts', () => {
    expect(lineOf(2)).toBe('solid');
    expect(lineOf(0)).toBe('dashed');
    expect(headOf(1)).toBe('hollow');
    expect(headOf(0)).toBe('filled');
    expect(edgeLabel(2, 1)).toBe('3');
    expect(edgeLabel(1, 0)).toBeNull();
    expect(edgeLabel(0, 1)).toBeNull();
    expect(countLine(2, 1, 0)).toBe('2 runtime · 1 type-only · 0 extends/implements');
    expect(arrowColor(true)).toBe('#dc2626');
    expect(arrowColor(false)).toBe('#64748b');
  });

  it('lets an upward arrow replace the cycle tooltip', () => {
    const cycle = 'a.ts → b.ts → a.ts';
    expect(edgeTitle(true, 'b.ts', 'a.ts', cycle, 1, 0, 0)).toBe('points up: b.ts is drawn below a.ts');
    expect(edgeTitle(false, 'a.ts', 'b.ts', cycle, 1, 0, 0)).toBe(cycle);
    expect(edgeTitle(false, 'app', 'domain', undefined, 0, 1, 0)).toBe('0 runtime · 1 type-only · 0 extends/implements');
  });
});

describe('boxes and selection', () => {
  it('names files, centres a box, and climbs to the parent directory', () => {
    expect(filesLabel(1)).toBe('1 file');
    expect(filesLabel(2)).toBe('2 files');
    expect(boxCenter(0, 140, 120, 40)).toEqual({ x: 60, y: 160 });
    expect(parentDir('src/infra/db.ts')).toBe('src/infra');
    expect(parentDir('react')).toBe('');
  });

  it('keeps the picked id, otherwise the armed id, when it is on the canvas', () => {
    const ids = new Set(['src/domain', 'src/infra/db.ts']);
    expect(chosenId('src/domain', null, ids)).toBe('src/domain');
    expect(chosenId('src/app/a.test.ts', null, ids)).toBeNull();
    expect(chosenId(null, 'src/infra/db.ts', ids)).toBe('src/infra/db.ts');
    expect(chosenId(null, 'react', ids)).toBeNull();
    expect(chosenId(null, null, ids)).toBeNull();
  });
});
