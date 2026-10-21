import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRuns, forgetRun, type RunCard } from './client.ts';
import { atHash } from './view.ts';

type Runs = { cards: RunCard[]; now: number; note: string | null };

const POLL_MS = 5000;
const EMPTY = 'No runs launched from this repository yet.';
const PILLS: Record<RunCard['state'], string> = {
  running: 'pill-running',
  'stopped for a human': 'pill-stopped',
  failed: 'pill-failed',
  done: 'pill-done',
  dead: 'pill-dead',
  'worktree removed': 'pill-removed',
};

function isVisible(): boolean {
  return document.visibilityState === 'visible';
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(isVisible);
  useEffect(() => {
    const update = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function repeat(read: () => Promise<void>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    await read();
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function answered(answer: { runs: RunCard[] } | { error: string }): Runs {
  if ('error' in answer) return { cards: [], now: Date.now(), note: answer.error };
  return { cards: answer.runs, now: Date.now(), note: null };
}

export function useRuns(token: string, fetcher: typeof fetch, watching: boolean) {
  const [runs, setRuns] = useState<Runs>({ cards: [], now: 0, note: 'Loading runs…' });
  const inflight = useRef<Promise<void> | null>(null);
  const loaded = useRef(false);
  const polling = useVisible() && watching;
  const read = useCallback(() => {
    inflight.current ??= fetchRuns(token, fetcher).then(answer => {
      inflight.current = null;
      setRuns(answered(answer));
    });
    return inflight.current;
  }, [token, fetcher]);
  useEffect(() => {
    const first = !loaded.current;
    loaded.current = true;
    if (polling) return repeat(read);
    if (first) void read();
    return undefined;
  }, [polling, read]);
  const drop = useCallback((worktree: string) => setRuns(current => ({ ...current, cards: current.cards.filter(card => card.worktree !== worktree) })), []);
  return { runs, drop, running: runs.cards.filter(card => card.state === 'running').length };
}

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

type PanelProps = Readonly<{ runs: Runs; at: string; token: string; fetcher: typeof fetch; onOpenPlan: (slug: string) => void; onGone: (worktree: string) => void }>;

export function RunsPanel(props: PanelProps) {
  const { runs, ...rest } = props;
  if (runs.note !== null) return <main className="runs-panel">{runs.note}</main>;
  if (runs.cards.length === 0) return <main className="runs-panel">{EMPTY}</main>;
  return (
    <main className="runs-panel">
      {runs.cards.map(card => (
        <Card key={`${card.worktree}\n${card.startedAt}`} card={card} now={runs.now} {...rest} />
      ))}
    </main>
  );
}
