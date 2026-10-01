import { describe, expect, it } from 'vitest';
import {
  COLUMN_LABELS,
  COLUMNS,
  OVERLAY_OPTIONS,
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
    expect(badgeLevel('crap', { crap: 4 }, 4)).toBe('green');
    expect(badgeLevel('crap', { crap: 8 }, 4)).toBe('amber');
    expect(badgeLevel('crap', { crap: 8.01 }, 4)).toBe('red');

    expect(badgeLevel('coverage', {}, 4)).toBeNull();
    expect(badgeLevel('coverage', { coverage: '1.00' }, 4)).toBe('green');
    expect(badgeLevel('coverage', { coverage: '0.80' }, 4)).toBe('amber');
    expect(badgeLevel('coverage', { coverage: '0.79' }, 4)).toBe('red');

    expect(badgeLevel('mutants', {}, 4)).toBeNull();
    expect(badgeLevel('mutants', { mutants: 0 }, 4)).toBe('green');
    expect(badgeLevel('mutants', { mutants: 1 }, 4)).toBe('amber');
    expect(badgeLevel('mutants', { mutants: 2 }, 4)).toBe('amber');
    expect(badgeLevel('mutants', { mutants: 3 }, 4)).toBe('red');

    expect(OVERLAY_OPTIONS.map(option => option.label)).toEqual(['None', 'CRAP', 'Coverage', 'Surviving mutants']);
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
    expect(detailLines({
      ca: 1,
      ce: 2,
      i: '0.67',
      a: '0.33',
      d: '0.00',
      zone: 'healthy',
      crap: 6,
      coverage: '0.50',
      mutants: 0,
    })).toEqual([
      { label: 'Ca', value: '1' },
      { label: 'Ce', value: '2' },
      { label: 'I', value: '0.67' },
      { label: 'A', value: '0.33' },
      { label: 'D', value: '0.00' },
      { label: 'Zone', value: 'healthy' },
      { label: 'CRAP', value: '6' },
      { label: 'Coverage', value: '0.50' },
      { label: 'Mutants', value: '0' },
    ]);

    expect(detailLines({})).toEqual([
      { label: 'Ca', value: '–' },
      { label: 'Ce', value: '–' },
      { label: 'I', value: '–' },
      { label: 'A', value: '–' },
      { label: 'D', value: '–' },
      { label: 'Zone', value: '–' },
      { label: 'CRAP', value: '–' },
      { label: 'Coverage', value: '–' },
      { label: 'Mutants', value: '–' },
    ]);

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
    expect(rows[0].values.d).toBe(0);
    expect(COLUMNS).toEqual(['name', 'files', 'ca', 'ce', 'i', 'a', 'd', 'zone', 'crap', 'coverage', 'mutants']);
    expect(COLUMN_LABELS).toEqual({
      name: 'Name',
      files: 'Files',
      ca: 'Ca',
      ce: 'Ce',
      i: 'I',
      a: 'A',
      d: 'D',
      zone: 'Zone',
      crap: 'CRAP',
      coverage: 'Coverage',
      mutants: 'Mutants',
    });
    const counted = metricRows([{ id: 'z', name: 'z', kind: 'package', files: 0, ca: 0, ce: 0, mutants: 0, crap: 10, i: '–', d: '–', coverage: '–' }]);
    expect(counted[0].values.files).toBe(0);
    expect(counted[0].values.mutants).toBe(0);
    expect(counted[0].values.crap).toBe(10);
    expect(counted[0].values.i).toBeNull();
    expect(counted[0].values.coverage).toBeNull();
    expect(metricRows([{ id: 'c', name: 'c', kind: 'package', crap: '–' }])[0].values.crap).toBeNull();
    expect(metricRows([{ id: 'bare', name: 'bare', kind: 'package' }])[0].values.i).toBeNull();
    expect(metricRows(boxes, ['name'])).toBeUndefined();
    expect(metricRows(boxes, COLUMNS)?.[0].cells.name).toBe('app');
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
      { id: 'p3', name: 'aaa', kind: 'package', d: '–' },
      { id: 'p1', name: 'p1', kind: 'package', d: '0.50' },
      { id: 'p2', name: 'p2', kind: 'package', d: '1.00' },
      { id: 'p0', name: 'p0', kind: 'package', d: '1.00' },
    ];
    const rows = metricRows(boxes);

    const desc = sortRows(rows, { key: 'd', direction: 'descending' });
    expect(desc.map(r => r.name)).toEqual(['p0', 'p2', 'p1', 'aaa']);

    const asc = sortRows(rows, { key: 'd', direction: 'ascending' });
    expect(asc.map(r => r.name)).toEqual(['p1', 'p0', 'p2', 'aaa']);

    const byName = sortRows(rows, { key: 'name', direction: 'descending' });
    expect(byName.map(r => r.name)).toEqual(['p2', 'p1', 'p0', 'aaa']);

    const byNameAsc = sortRows(rows, { key: 'name', direction: 'ascending' });
    expect(byNameAsc.map(r => r.name)).toEqual(['aaa', 'p0', 'p1', 'p2']);

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

    const bySize = metricRows([
      { id: 'two', name: 'a', kind: 'package', files: 2 },
      { id: 'ten', name: 'b', kind: 'package', files: 10 },
    ]);
    expect(sortRows(bySize, { key: 'files', direction: 'descending' }).map(row => row.name)).toEqual(['b', 'a']);

    const tied: MetricBox[] = [
      { id: 'b', name: 'b', kind: 'package', zone: 'healthy' },
      { id: 'a', name: 'a', kind: 'package', zone: 'healthy' },
    ];
    expect(sortRows(metricRows(tied), { key: 'zone', direction: 'ascending' }).map(row => row.name)).toEqual(['a', 'b']);

    const zones: MetricBox[] = [
      { id: 'u', name: 'a', kind: 'package', zone: 'useless' },
      { id: 'p', name: 'm', kind: 'package', zone: 'pain' },
      { id: 'h', name: 'z', kind: 'package', zone: 'healthy' },
    ];
    expect(sortRows(metricRows(zones), { key: 'zone', direction: 'ascending' }).map(row => row.name)).toEqual(['z', 'm', 'a']);

    const nullFirst: MetricBox[] = [
      { id: 'a', name: 'a', kind: 'package', d: '–' },
      { id: 'b', name: 'b', kind: 'package', d: '0.50' },
    ];
    expect(sortRows(metricRows(nullFirst), { key: 'd', direction: 'descending' }).map(row => row.name)).toEqual(['b', 'a']);

    const numberThenText: MetricsRow[] = [
      { id: 'two', name: 'a', cells: bySize[0].cells, values: { ...bySize[0].values, files: 2 } },
      { id: 'ten', name: 'b', cells: bySize[1].cells, values: { ...bySize[1].values, files: '10' } },
    ];
    const textThenNumber: MetricsRow[] = [
      { id: 'ten', name: 'b', cells: bySize[1].cells, values: { ...bySize[1].values, files: '10' } },
      { id: 'two', name: 'a', cells: bySize[0].cells, values: { ...bySize[0].values, files: 2 } },
    ];
    expect(sortRows(numberThenText, { key: 'files', direction: 'descending' }).map(row => row.name)).toEqual(['b', 'a']);
    expect(sortRows(textThenNumber, { key: 'files', direction: 'descending' }).map(row => row.name)).toEqual(['b', 'a']);
  });
});
