import { useState, type ReactElement } from 'react';
import { forgetRun, type RunCard } from './client.ts';
import { atHash, runsStateOf, type RunsView } from './view.ts';

const EMPTY = 'No runs launched from this repository yet.';
const LOADING = 'Loading runs…';
const PILLS: Record<RunCard['state'], string> = {
  running: 'pill-running',
  'stopped for a human': 'pill-stopped',
  failed: 'pill-failed',
  done: 'pill-done',
  dead: 'pill-dead',
  'worktree removed': 'pill-removed',
};

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

type CardProps = Readonly<{ card: RunCard; now: number; at: string; token: string; fetcher: typeof fetch; onOpenPlan: (slug: string) => void; onGone: (worktree: string) => void }>;

function Title(props: CardProps) {
  const { card } = props;
  if (!card.planExists) return <h3 className="run-title">{card.planName}</h3>;
  const open = (event: { preventDefault(): void }) => {
    event.preventDefault();
    props.onOpenPlan(card.slug);
  };
  return (
    <h3 className="run-title">
      <a href={atHash(props.at, card.slug)} onClick={open}>
        {card.planName}
      </a>
    </h3>
  );
}

function Forget(props: CardProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const forget = async () => {
    const answer = await forgetRun(props.token, props.card.worktree, props.fetcher);
    if ('error' in answer) setFailure(`Forget failed: ${answer.error}`);
    else props.onGone(props.card.worktree);
  };
  return (
    <div className="run-forget">
      <button type="button" onClick={() => void forget()}>
        Forget
      </button>
      {failure !== null && <p role="alert">{failure}</p>}
    </div>
  );
}

function Card(props: CardProps) {
  const { card } = props;
  return (
    <article className="run-card" aria-label={card.planName}>
      <header>
        <Title {...props} />
        <span className={`pill ${PILLS[card.state]}`}>{card.state}</span>
      </header>
      <div>{[card.tool, card.branch].filter(part => part !== null).join(' · ')}</div>
      <div>
        <code>{card.worktree}</code>
        <button type="button" onClick={() => void navigator.clipboard.writeText(card.worktree)}>
          Copy worktree
        </button>
      </div>
      <div>{`started ${card.startedAt} · ${elapsed(props.now - Date.parse(card.startedAt))}`}</div>
      <div className="run-position">{card.position}</div>
      <div className="run-prs">
        {card.prs.map(url => (
          <a key={url} href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        ))}
      </div>
      <details>
        <summary>Log tail</summary>
        <pre>{card.logTail.join('\n')}</pre>
      </details>
      {card.state === 'worktree removed' && <Forget {...props} />}
    </article>
  );
}

type PanelProps = Readonly<{
  state: RunsView<RunCard>;
  at: string;
  token: string;
  fetcher: typeof fetch;
  onOpenPlan: (slug: string) => void;
  onGone: (worktree: string) => void;
}>;

function RunsNote(props: Readonly<{ text: string }>) {
  return <main className="runs-panel">{props.text}</main>;
}

function runningCard(card: RunCard): boolean {
  return card.state === 'running';
}

function runningCount(state: RunsView<RunCard>): number {
  if (state.kind !== 'ready') return 0;
  return state.cards.filter(runningCard).length;
}

type ReadyProps = Omit<PanelProps, 'state'> & { state: Extract<RunsView<RunCard>, { kind: 'ready' }> };

function RunsList(props: ReadyProps) {
  const { state, ...rest } = props;
  if (state.cards.length === 0) return <RunsNote text={EMPTY} />;
  return (
    <main className="runs-panel">
      {state.cards.map(card => (
        <Card key={`${card.worktree}\n${card.startedAt}`} card={card} now={state.now} {...rest} />
      ))}
    </main>
  );
}

function RunsPanel(props: PanelProps): ReactElement {
  switch (props.state.kind) {
    case 'loading':
      return <RunsNote text={LOADING} />;
    case 'message':
      return <RunsNote text={props.state.message} />;
    case 'ready':
      return <RunsList {...props} state={props.state} />;
  }
}

type PaneProps = Readonly<{
  data: { runs: RunCard[] } | { error: string } | undefined;
  pending: boolean;
  now: number;
  at: string;
  token: string;
  fetcher: typeof fetch;
  onOpenPlan: (slug: string) => void;
  onGone: (worktree: string) => void;
}>;

export function useRunsPane(props: PaneProps) {
  const state = runsStateOf(props.data, props.pending, props.now);
  const pane = <RunsPanel state={state} at={props.at} token={props.token} fetcher={props.fetcher} onOpenPlan={props.onOpenPlan} onGone={props.onGone} />;
  return { running: runningCount(state), pane };
}
