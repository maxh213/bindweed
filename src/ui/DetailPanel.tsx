import type { NodeDetail } from '../domain/graph.ts';
import { countLine, filesLabel } from './draw.ts';
import { detailLines, hotRow } from './healthdraw.ts';

type Entry = NodeDetail['imports'][number];

function EntryButton(props: Readonly<{ entry: Entry; onPick: (id: string) => void }>) {
  return (
    <li>
      <button type="button" onClick={() => props.onPick(props.entry.id)}>
        {props.entry.name} {countLine(props.entry.runtime, props.entry.type, props.entry.heritage)}
      </button>
    </li>
  );
}

function EntryList(props: Readonly<{ title: string; entries: Entry[]; onPick: (id: string) => void }>) {
  return (
    <section>
      <h3>{props.title}</h3>
      <ul>
        {props.entries.map(entry => (
          <EntryButton key={entry.id} entry={entry} onPick={props.onPick} />
        ))}
      </ul>
    </section>
  );
}

function FileCount(props: Readonly<{ files: number | undefined }>) {
  if (props.files === undefined) return null;
  return <p>{filesLabel(props.files)}</p>;
}

function AbstractWord(props: Readonly<{ abstract: true | undefined }>) {
  if (props.abstract !== true) return null;
  return <p>abstract</p>;
}

function MetricLines(props: Readonly<{ detail: NodeDetail }>) {
  return (
    <>
      {detailLines(props.detail).map(line => (
        <div key={line.label}>
          {line.label} {line.value}
        </div>
      ))}
    </>
  );
}

function HotList(props: Readonly<{ hot: NodeDetail['hot'] }>) {
  if (props.hot === undefined) return null;
  return (
    <section>
      <h3>Hot functions</h3>
      <ul>
        {props.hot.map(fn => (
          <li key={`${fn.name}@${fn.line}`}>{hotRow(fn)}</li>
        ))}
      </ul>
    </section>
  );
}

function DetailPanel(props: Readonly<{ detail: NodeDetail; onPick: (id: string) => void }>) {
  return (
    <aside aria-label="details">
      <h2>{props.detail.name}</h2>
      <p>{props.detail.path}</p>
      <p>{props.detail.kind}</p>
      <FileCount files={props.detail.files} />
      <AbstractWord abstract={props.detail.abstract} />
      <MetricLines detail={props.detail} />
      <HotList hot={props.detail.hot} />
      <EntryList title="Imports" entries={props.detail.imports} onPick={props.onPick} />
      <EntryList title="Imported by" entries={props.detail.importedBy} onPick={props.onPick} />
    </aside>
  );
}

export function DetailSlot(props: Readonly<{ data: NodeDetail | { error: string } | undefined; onPick: (id: string) => void }>) {
  if (props.data === undefined || 'error' in props.data) return null;
  return <DetailPanel detail={props.data} onPick={props.onPick} />;
}
