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

function MessagePanel(props: { path: string; message: string }) {
  return (
    <div>
      <header>{props.path}</header>
      <div>{props.message}</div>
    </div>
  );
}

function TextPanel(props: { path: string; text: string }) {
  const lines = textLines(props.text);
  return (
    <div>
      <header>{props.path}</header>
      <pre style={{ fontFamily: 'ui-monospace, monospace' }}>
        {lines.map((line, i) => (
          <div key={i}>
            <span>{i + 1}</span> {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function FilePanel(props: { state: FilePanelState }) {
  if (props.state.kind === 'idle') return <IdlePanel />;
  if (props.state.kind === 'loading') return <MessagePanel path={props.state.path} message="" />;
  if (props.state.kind === 'message') return <MessagePanel path={props.state.path} message={props.state.message} />;
  return <TextPanel path={props.state.path} text={props.state.text} />;
}
