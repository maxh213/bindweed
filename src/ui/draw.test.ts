import { describe, expect, it } from 'vitest';
import {
  ariaSort,
  arrowColor,
  badgeLevel,
  badgeText,
  boxCenter,
  chosenId,
  countLine,
  detailId,
  detailLines,
  detailOn,
  edgeLabel,
  edgeTitle,
  filesLabel,
  headOf,
  hotRow,
  lineOf,
  metricRows,
  nextSort,
  optionHint,
  overlayChoice,
  parentDir,
  sortRows,
  staleShown,
  type MetricBox,
  type MetricsRow,
  type SortState,
} from './draw.ts';

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

  it('enables a detail request only for a chosen id', () => {
    expect(detailId(null)).toBe('');
    expect(detailId('src/infra')).toBe('src/infra');
    expect(detailOn(null)).toBe(false);
    expect(detailOn('src/infra')).toBe(true);
  });
});

describe('health badges and overlays', () => {
  it('formats badge texts and levels across overlays', () => {
    expect(badgeText('none', {})).toBeNull();
    expect(badgeText('crap', { crap: 3 })).toBe('3');
    expect(badgeText('crap', { crap: 4.567 })).toBe('4.57');
    expect(badgeText('crap', { crap: '–' })).toBe('–');
    expect(badgeText('crap', {})).toBe('–');
    expect(badgeText('coverage', { coverage: '0.80' })).toBe('0.80');
    expect(badgeText('coverage', {})).toBe('–');
    expect(badgeText('mutants', { mutants: 2 })).toBe('2');
    expect(badgeText('mutants', {})).toBe('–');

    expect(badgeLevel('none', {}, 4)).toBeNull();
    expect(badgeLevel('crap', { crap: '–' }, 4)).toBeNull();
    expect(badgeLevel('crap', { crap: 3 }, 4)).toBe('green');
    expect(badgeLevel('crap', { crap: 6 }, 4)).toBe('amber');
    expect(badgeLevel('crap', { crap: 42 }, 4)).toBe('red');

    expect(badgeLevel('coverage', {}, 4)).toBeNull();
    expect(badgeLevel('coverage', { coverage: '1.00' }, 4)).toBe('green');
    expect(badgeLevel('coverage', { coverage: '0.85' }, 4)).toBe('amber');
    expect(badgeLevel('coverage', { coverage: '0.50' }, 4)).toBe('red');

    expect(badgeLevel('mutants', {}, 4)).toBeNull();
    expect(badgeLevel('mutants', { mutants: 0 }, 4)).toBe('green');
    expect(badgeLevel('mutants', { mutants: 2 }, 4)).toBe('amber');
    expect(badgeLevel('mutants', { mutants: 3 }, 4)).toBe('red');
  });

  it('checks stale status, option hints and overlay choices', () => {
    expect(staleShown('none', { coverage: 'stale', mutation: 'stale' })).toBe(false);
    expect(staleShown('crap', { coverage: 'stale', mutation: 'on' })).toBe(true);
    expect(staleShown('mutants', { coverage: 'on', mutation: 'stale' })).toBe(true);
    expect(staleShown('mutants', { coverage: 'stale', mutation: 'on' })).toBe(false);

    const offFlags = { coverage: 'off', mutation: 'off' };
    const onFlags = { coverage: 'on', mutation: 'on' };
    expect(optionHint('none', offFlags)).toBeNull();
    expect(optionHint('crap', offFlags)).toBe('no coverage data: run marestail gate');
    expect(optionHint('coverage', offFlags)).toBe('no coverage data: run marestail gate');
    expect(optionHint('mutants', offFlags)).toBe('no mutation report: run marestail gate --tier full');
    expect(optionHint('crap', onFlags)).toBeNull();
    expect(optionHint('mutants', onFlags)).toBeNull();

    expect(overlayChoice('crap', 'none', onFlags)).toBe('crap');
    expect(overlayChoice('crap', 'none', offFlags)).toBe('none');
    expect(overlayChoice('unknown', 'crap', onFlags)).toBe('none');
  });

  it('formats detail lines and hot function rows', () => {
    const lines = detailLines({
      ca: 1,
      ce: 2,
      i: '0.67',
      a: '0.33',
      d: '0.00',
      zone: 'healthy',
      crap: 6,
      coverage: '0.50',
      mutants: 0,
    });
    expect(lines).toContainEqual({ label: 'Ca', value: '1' });
    expect(lines).toContainEqual({ label: 'Zone', value: 'healthy' });
    expect(lines).toContainEqual({ label: 'CRAP', value: '6' });

    const emptyLines = detailLines({});
    expect(emptyLines).toContainEqual({ label: 'Ca', value: '–' });
    expect(emptyLines).toContainEqual({ label: 'Zone', value: '–' });
    expect(emptyLines).toContainEqual({ label: 'Mutants', value: '–' });

    expect(hotRow({ name: 'mid', line: 1, cc: 4, coverage: '0.50', crap: 6 })).toBe('mid · line 1 · cc 4 · coverage 0.50');
  });
});

describe('metrics drawer tables and sorting', () => {
  it('converts package boxes to metric rows and ignores files', () => {
    const boxes: MetricBox[] = [
      { id: 'src/app', name: 'app', kind: 'package', files: 2, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy', crap: 6, coverage: '0.50', mutants: 0 },
      { id: 'src/file.ts', name: 'file.ts', kind: 'file' },
    ];
    const rows = metricRows(boxes);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('src/app');
    expect(rows[0].cells.d).toBe('0.00');
  });

  it('cycles sort state and computes aria-sort', () => {
    const dSort: SortState = { key: 'd', direction: 'descending' };
    expect(nextSort(dSort, 'd')).toEqual({ key: 'd', direction: 'ascending' });
    expect(nextSort({ key: 'd', direction: 'ascending' }, 'd')).toEqual({ key: 'd', direction: 'descending' });
    expect(nextSort(dSort, 'name')).toEqual({ key: 'name', direction: 'descending' });

    expect(ariaSort(dSort, 'd')).toBe('descending');
    expect(ariaSort(dSort, 'name')).toBe('none');
  });

  it('sorts rows with numbers, strings, nulls, and name tie-breaking', () => {
    const boxes: MetricBox[] = [
      { id: 'p3', name: 'p3', kind: 'package', d: '–' },
      { id: 'p1', name: 'p1', kind: 'package', d: '0.50' },
      { id: 'p2', name: 'p2', kind: 'package', d: '1.00' },
      { id: 'p0', name: 'p0', kind: 'package', d: '1.00' },
    ];
    const rows = metricRows(boxes);

    const desc = sortRows(rows, { key: 'd', direction: 'descending' });
    expect(desc.map(r => r.name)).toEqual(['p0', 'p2', 'p1', 'p3']);

    const asc = sortRows(rows, { key: 'd', direction: 'ascending' });
    expect(asc.map(r => r.name)).toEqual(['p1', 'p0', 'p2', 'p3']);

    const byName = sortRows(rows, { key: 'name', direction: 'descending' });
    expect(byName.map(r => r.name)).toEqual(['p3', 'p2', 'p1', 'p0']);

    const byNameAsc = sortRows(rows, { key: 'name', direction: 'ascending' });
    expect(byNameAsc.map(r => r.name)).toEqual(['p0', 'p1', 'p2', 'p3']);

    const withZones: MetricBox[] = [
      { id: 'p1', name: 'p1', kind: 'package', zone: 'healthy' },
      { id: 'p2', name: 'p2', kind: 'package', zone: 'healthy' },
    ];
    const zoneRows = metricRows(withZones);
    const sortedZones = sortRows(zoneRows, { key: 'zone', direction: 'ascending' });
    expect(sortedZones.map(r => r.name)).toEqual(['p1', 'p2']);

    const sameNames: MetricsRow[] = [
      { id: 'p1', name: 'same', cells: zoneRows[0].cells, values: zoneRows[0].values },
      { id: 'p2', name: 'same', cells: zoneRows[1].cells, values: zoneRows[1].values },
    ];
    expect(sortRows(sameNames, { key: 'name', direction: 'ascending' })).toHaveLength(2);
  });
});
