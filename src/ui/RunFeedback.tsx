type Feedback = { raw?: string; ran?: string; note?: string; rawClassName?: string };

function RawOutput(props: Readonly<Pick<Feedback, 'raw' | 'rawClassName'>>) {
  if (props.raw === undefined) return null;
  return (
    <section aria-label="Raw output" className={props.rawClassName}>
      <pre>{props.raw}</pre>
    </section>
  );
}

export function RunFeedback(props: Readonly<Feedback>) {
  return (
    <>
      <RawOutput raw={props.raw} rawClassName={props.rawClassName} />
      {props.ran === undefined ? null : <output aria-label="ran">{props.ran}</output>}
      {props.note === undefined ? null : <output aria-label="note">{props.note}</output>}
    </>
  );
}
