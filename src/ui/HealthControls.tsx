import { useState } from 'react';
import {
  ariaSort,
  COLUMN_LABELS,
  COLUMNS,
  DEFAULT_SORT,
  metricRows,
  nextSort,
  optionHint,
  OVERLAY_OPTIONS,
  overlayChoice,
  sortRows,
  staleShown,
  type MetricBox,
  type MetricsRow,
  type OverlayName,
  type ReportFacts,
  type SortKey,
  type SortState,
} from './healthdraw.ts';

function OverlayOption(props: Readonly<{ value: OverlayName; label: string; flags: ReportFacts }>) {
  const hint = optionHint(props.value, props.flags);
  if (hint === null) return <option value={props.value}>{props.label}</option>;
  return (
    <option value={props.value} disabled title={hint}>
      {props.label}
    </option>
  );
}

export function OverlayBox(props: Readonly<{ overlay: OverlayName; flags: ReportFacts; onChoose: (next: OverlayName) => void }>) {
  return (
    <span className="overlay-box">
      <label>
        Overlay{' '}
        <select
          aria-label="Overlay"
          value={props.overlay}
          onChange={event => props.onChoose(overlayChoice(event.currentTarget.value, props.overlay, props.flags))}
        >
          {OVERLAY_OPTIONS.map(option => (
            <OverlayOption key={option.value} value={option.value} label={option.label} flags={props.flags} />
          ))}
        </select>
      </label>
      {staleShown(props.overlay, props.flags) ? <span aria-label="stale">stale</span> : null}
    </span>
  );
}

function MetricsHead(props: Readonly<{ sort: SortState; onSort: (key: SortKey) => void }>) {
  return (
    <thead>
      <tr>
        {COLUMNS.map(column => (
          <th key={column} aria-sort={ariaSort(props.sort, column)} onClick={() => props.onSort(column)}>
            {COLUMN_LABELS[column]}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function MetricsBody(props: Readonly<{ rows: MetricsRow[]; onPick: (id: string) => void }>) {
  return (
    <tbody>
      {props.rows.map(row => (
        <tr key={row.id} onClick={() => props.onPick(row.id)}>
          {COLUMNS.map(column => (
            <td key={column}>{row.cells[column]}</td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function MetricsDrawer(props: Readonly<{ open: boolean; boxes: MetricBox[]; onPick: (id: string) => void }>) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  if (!props.open) return null;
  const rows = sortRows(metricRows(props.boxes), sort);
  return (
    <aside aria-label="metrics" data-boxes={props.boxes.length}>
      <table>
        <MetricsHead sort={sort} onSort={key => setSort(current => nextSort(current, key))} />
        <MetricsBody rows={rows} onPick={props.onPick} />
      </table>
    </aside>
  );
}
