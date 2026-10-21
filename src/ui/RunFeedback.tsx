type Feedback = { raw?: string; ran?: string; note?: string; rawClassName?: string };

export type LlmRun =
  | { kind: 'idle' }
  | { kind: 'running' }
  | ({ kind: 'failed'; error: string } & Feedback)
  | ({ kind: 'done'; ran: string } & Feedback);

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

function assertNever(value: never): never {
  throw new Error(`unexpected run ${JSON.stringify(value)}`);
}

function SettledRun(props: Readonly<{ run: Extract<LlmRun, { kind: 'failed' | 'done' }> }>) {
  const run = props.run;
  switch (run.kind) {
    case 'failed':
      return (
        <>
          <p className="plan-dialog-error">{run.error}</p>
          <RunFeedback {...run} />
        </>
      );
    case 'done':
      return <RunFeedback {...run} />;
    default:
      return assertNever(run);
  }
}

export function RunStatus(props: Readonly<{ run: LlmRun; seconds: number; onCancel: () => void }>) {
  const run = props.run;
  switch (run.kind) {
    case 'idle':
      return null;
    case 'running':
      return (
        <p>
          running for {props.seconds} s{' '}
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </p>
      );
    default:
      return <SettledRun run={run} />;
  }
}
