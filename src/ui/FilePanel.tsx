import { textLines } from '../domain/lines.ts';

export type FilePanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'text'; path: string; text: string }
  | { kind: 'message'; path: string; message: string };

export function panelFromFile(
  path: string,
  body: { path: string; text: string } | { path: string; binary: true } | { error: string },
): FilePanelState {
  if ('error' in body) return { kind: 'message', path, message: body.error };
  if ('binary' in body) return { kind: 'message', path, message: 'binary file, not shown' };
  return { kind: 'text', path: body.path, text: body.text };
}

function IdlePanel() {
  return <div>select a file</div>;
}

type PathMessage = Readonly<{ path: string; message: string }>;

function MessagePanel({ path, message }: PathMessage) {
  return (
    <div>
      <header>{path}</header>
      <div>{message}</div>
    </div>
  );
}

type PathText = Readonly<{ path: string; text: string }>;

function numberedRows(text: string): { n: number; line: string }[] {
  return textLines(text).map((line, index) => ({ n: index + 1, line }));
}

function TextPanel({ path, text }: PathText) {
  return (
    <div>
      <header>{path}</header>
      <pre style={{ fontFamily: 'ui-monospace, monospace' }}>
        {numberedRows(text).map(row => (
          <div key={row.n} data-line={row.n}>
            <span>{row.n}</span> {row.line}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function FilePanel(props: Readonly<{ state: FilePanelState }>) {
  if (props.state.kind === 'idle') return <IdlePanel />;
  if (props.state.kind === 'loading') return <MessagePanel path={props.state.path} message="" />;
  if (props.state.kind === 'message') return <MessagePanel path={props.state.path} message={props.state.message} />;
  return <TextPanel path={props.state.path} text={props.state.text} />;
}
