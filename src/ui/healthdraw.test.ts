import { describe, expect, it } from 'vitest';
import {
  ariaSort,
  badgeLevel,
  badgeText,
  detailLines,
  hotRow,
  metricRows,
  nextSort,
  optionHint,
  overlayChoice,
  sortRows,
  staleShown,
  type MetricBox,
  type MetricsRow,
  type SortState,
} from './healthdraw.ts';

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

    const blanks: MetricBox[] = [
      { id: 'b', name: 'b', kind: 'package', d: '–' },
      { id: 'a', name: 'a', kind: 'package', d: '–' },
    ];
    expect(sortRows(metricRows(blanks), { key: 'd', direction: 'descending' }).map(row => row.name)).toEqual(['a', 'b']);
  });
});
