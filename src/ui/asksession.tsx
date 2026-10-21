import { useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import type { GraphNode, GraphView } from '../domain/graph.ts';
import { byStrings, chatLines, decide, parsePlanEdit, rejectOpen, undecided, type ChatTurn, type PlanDoc, type PlanEdit } from '../domain/plan.ts';
import { RunFeedback } from './RunFeedback.tsx';
import {
  askTextOk,
  bumpTicket,
  chatStamp,
  keptDrop,
  latestTurn,
  openEdits,
  reviewIfCurrent,
  withTurn,
  zipRows,
  type ForcedDrop,
  type OpenEdit,
  type OpenRow,
} from './ask.ts';
import { fetchChat, fetchGraph, postCancel, postPropose, postReview, putChat, type ProposeAnswer } from './client.ts';

type ProposalChild = { id: string; planned: GraphView | null; proposed: GraphView | null };

type AskRun =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'failed'; error: string; raw?: string; ran?: string; note?: string }
  | { kind: 'done'; ran: string; note?: string };

type AskPicture = {
  proposal: GraphView | null;
  children: ProposalChild[];
  edits: OpenEdit[];
  hover: number | null;
};

export type AskModel = {
  picture: AskPicture;
  running: boolean;
  onTasks: (running: boolean) => void;
  recheck: () => void;
  column: ReactNode;
};

type AskProps = {
  token: string;
  fetcher: typeof fetch;
  slug: string | null;
  at: string;
  tests: boolean;
  external: boolean;
  nodes: GraphNode[];
  commit: (edit: PlanEdit) => Promise<PlanDoc | { error: string }>;
  onError: (message: string) => void;
  changes: ReactNode;
};

function chatTurns(data: ChatTurn[] | { error: string } | undefined): ChatTurn[] {
  if (data === undefined || 'error' in data) return [];
  return data;
}

function viewOf(data: GraphView | { error: string } | undefined): GraphView | null {
  if (data === undefined || 'error' in data) return null;
  return data;
}

function packageNodes(nodes: GraphNode[]): string[] {
  return nodes.flatMap(node => (node.kind === 'package' ? [node.id] : []));
}

function unionIds(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort(byStrings);
}

function wantProposal(slug: string | null, proposals: string): boolean {
  if (slug === null) return false;
  return proposals !== '';
}

function proposalsParam(edits: PlanEdit[]): string {
  return edits.length === 0 ? '' : JSON.stringify(edits);
}

function childPairs(results: readonly { data?: ProposalChild }[]): ProposalChild[] {
  return results.flatMap(result => (result.data === undefined ? [] : [result.data]));
}

function askBusy(run: AskRun, tasks: boolean): boolean {
  return run.kind === 'running' || tasks;
}

function liveTurn(slug: string | null, current: ChatTurn | null): current is ChatTurn {
  if (slug === null) return false;
  return current !== null;
}

function keptEdit(saved: PlanDoc | { error: string }, edit: PlanEdit): PlanEdit | null {
  if ('error' in saved) return null;
  return edit;
}

function rowText(sentence: string, stale: string | null): string {
  if (stale === null) return sentence;
  return `dropped: ${sentence} \u2014 ${stale}`;
}

function useTicker(running: boolean): [number, () => void] {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds(current => current + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return [seconds, () => setSeconds(0)];
}

function proposedPackages(view: GraphView | null): string[] {
  if (view === null) return [];
  return packageNodes(view.nodes);
}

function childQueries(props: AskProps, proposals: string, proposal: GraphView | null) {
  const { token, fetcher, tests, external, slug, nodes } = props;
  if (!wantProposal(slug, proposals)) return [];
  return unionIds(packageNodes(nodes), proposedPackages(proposal)).map(id => ({
    queryKey: ['graph', 'proposal-child', token, id, tests, external, slug, proposals] as const,
    queryFn: async (): Promise<ProposalChild> => {
      const [planned, proposed] = await Promise.all([
        fetchGraph(token, id, fetcher, { tests, external, plan: slug }),
        fetchGraph(token, id, fetcher, { tests, external, plan: slug, proposals }),
      ]);
      return { id, planned: viewOf(planned), proposed: viewOf(proposed) };
    },
  }));
}

function ProposalButtons(props: Readonly<{ sentence: string; stale: string | null; onAccept: () => void; onReject: () => void }>) {
  return (
    <>
      {props.stale === null ? (
        <button type="button" onClick={props.onAccept}>{`Accept ${props.sentence}`}</button>
      ) : null}
      <button type="button" onClick={props.onReject}>{`Reject ${props.sentence}`}</button>
    </>
  );
}

function ProposalItem(props: Readonly<{ row: OpenRow; onHover: (index: number | null) => void; onAccept: (index: number) => void; onReject: (index: number) => void }>) {
  return (
    <li onMouseEnter={() => props.onHover(props.row.index)} onMouseLeave={() => props.onHover(null)}>
      <span>{rowText(props.row.sentence, props.row.stale)}</span>
      <ProposalButtons sentence={props.row.sentence} stale={props.row.stale} onAccept={() => props.onAccept(props.row.index)} onReject={() => props.onReject(props.row.index)} />
    </li>
  );
}

function Proposals(props: Readonly<{ summary: string; rows: OpenRow[]; onHover: (index: number | null) => void; onAccept: (index: number) => void; onReject: (index: number) => void; onAcceptAll: () => void; onRejectAll: () => void }>) {
  if (props.rows.length === 0) return null;
  return (
    <aside aria-label="proposals">
      <p>{props.summary}</p>
      <ol>
        {props.rows.map(row => (
          <ProposalItem key={row.index} row={row} onHover={props.onHover} onAccept={props.onAccept} onReject={props.onReject} />
        ))}
      </ol>
      <button type="button" onClick={props.onAcceptAll}>
        Accept all
      </button>
      <button type="button" onClick={props.onRejectAll}>
        Reject all
      </button>
    </aside>
  );
}

function keyedLines(lines: string[]): { key: string; text: string }[] {
  const occurrences = new Map<string, number>();
  return lines.map(text => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return { key: JSON.stringify([text, occurrence]), text };
  });
}

function ConversationLines(props: Readonly<{ lines: string[] }>) {
  return (
    <div aria-label="conversation">
      {keyedLines(props.lines).map(line => (
        <p key={line.key} className="chat-line">
          {line.text}
        </p>
      ))}
    </div>
  );
}

function Conversation(props: Readonly<{ lines: string[]; open: boolean; onToggle: () => void }>) {
  if (props.lines.length === 0) return null;
  return (
    <div>
      <button type="button" aria-expanded={props.open} onClick={props.onToggle}>
        Conversation
      </button>
      {props.open ? <ConversationLines lines={props.lines} /> : null}
    </div>
  );
}

function AskRun(props: Readonly<{ run: AskRun; seconds: number; onCancel: () => void }>) {
  const run = props.run;
  if (run.kind === 'running') {
    return (
      <p>
        running for {props.seconds} s{' '}
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </p>
    );
  }
  if (run.kind === 'failed') {
    return (
      <>
        <p className="plan-dialog-error">{run.error}</p>
        <RunFeedback {...run} />
      </>
    );
  }
  if (run.kind === 'done') return <RunFeedback {...run} />;
  return null;
}

function AskBox(props: Readonly<{ text: string; running: boolean; hint: string | null; run: AskRun; seconds: number; onText: (text: string) => void; onPropose: () => void; onCancel: () => void }>) {
  return (
    <aside aria-label="ask">
      <label>
        Ask{' '}
        <textarea aria-label="Ask" value={props.text} onChange={event => props.onText(event.currentTarget.value)} />
      </label>
      <button type="button" disabled={props.running} onClick={props.onPropose}>
        Propose
      </button>
      {props.hint === null ? null : <p className="plan-dialog-error">{props.hint}</p>}
      <AskRun run={props.run} seconds={props.seconds} onCancel={props.onCancel} />
    </aside>
  );
}

function AskColumn(props: Readonly<{ slug: string | null; summary: string; rows: OpenRow[]; lines: string[]; open: boolean; text: string; running: boolean; hint: string | null; run: AskRun; seconds: number; changes: ReactNode; onHover: (index: number | null) => void; onAccept: (index: number) => void; onReject: (index: number) => void; onAcceptAll: () => void; onRejectAll: () => void; onToggle: () => void; onText: (text: string) => void; onPropose: () => void; onCancel: () => void }>) {
  if (props.slug === null) return props.changes;
  return (
    <>
      <Proposals summary={props.summary} rows={props.rows} onHover={props.onHover} onAccept={props.onAccept} onReject={props.onReject} onAcceptAll={props.onAcceptAll} onRejectAll={props.onRejectAll} />
      {props.changes}
      <Conversation lines={props.lines} open={props.open} onToggle={props.onToggle} />
      <AskBox text={props.text} running={props.running} hint={props.hint} run={props.run} seconds={props.seconds} onText={props.onText} onPropose={props.onPropose} onCancel={props.onCancel} />
    </>
  );
}

export function useAsk(props: AskProps): AskModel {
  const queryClient = useQueryClient();
  const slug = props.slug;
  const chatKey = ['chat', props.token, slug] as const;
  const chatQuery = useQuery({
    queryKey: chatKey,
    queryFn: () => fetchChat(props.token, String(slug), props.fetcher),
    enabled: slug !== null,
  });
  const turns = chatTurns(chatQuery.data);
  const turn = latestTurn(turns);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [run, setRun] = useState<AskRun>({ kind: 'idle' });
  const [hover, setHover] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ stamp: string; forced: ForcedDrop } | null>(null);
  const [stale, setStale] = useState<(string | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [tasksRunning, setTasksRunning] = useState(false);
  const stamp = chatStamp(turns);
  const forced = keptDrop(drop, stamp);
  const [seconds, restartTicker] = useTicker(run.kind === 'running');
  const rows = zipRows(turn, stale, forced);
  const edits = openEdits(rows);
  const proposals = proposalsParam(edits.map(item => item.edit));
  const proposalQuery = useQuery({
    queryKey: ['graph', 'proposal', props.token, props.at, props.tests, props.external, slug, proposals] as const,
    queryFn: () => fetchGraph(props.token, props.at, props.fetcher, { tests: props.tests, external: props.external, plan: slug, proposals }),
    enabled: wantProposal(slug, proposals),
  });
  const proposal = viewOf(proposalQuery.data);
  const childResults = useQueries({
    queries: childQueries(props, proposals, proposal),
  });
  const picture: AskPicture = { proposal, children: childPairs(childResults), edits, hover };
  const replace = async (next: ChatTurn[]): Promise<ChatTurn[] | { error: string }> => {
    const saved = await putChat(props.token, String(slug), next, props.fetcher);
    if ('error' in saved) return saved;
    queryClient.setQueryData(chatKey, saved);
    return saved;
  };
  const store = (next: ChatTurn[]): void => {
    queryClient.setQueryData(chatKey, next);
  };
  const tickets = useRef(0);
  const recheck = async (current: ChatTurn | null): Promise<void> => {
    if (!liveTurn(slug, current)) return;
    const raws = undecided(current).map(index => current.edits[index]);
    const ticket = bumpTicket(tickets);
    if (raws.length === 0) return;
    reviewIfCurrent(ticket, tickets.current, await postReview(props.token, String(slug), raws, props.fetcher), setStale);
  };
  const oneReason = async (raw: unknown): Promise<string | null | undefined> => {
    const result = await postReview(props.token, String(slug), [raw], props.fetcher);
    if ('error' in result) return undefined;
    return result.stale[0] ?? null;
  };
  const remember = async (next: ChatTurn): Promise<void> => {
    const wrote = await replace(withTurn(turns, next));
    if ('error' in wrote) {
      props.onError(wrote.error);
      return;
    }
    setDrop(null);
    await recheck(next);
  };
  const takeEdit = async (index: number, edit: PlanEdit, current: ChatTurn): Promise<void> => {
    const saved = await props.commit(edit);
    if ('error' in saved) return;
    await remember(decide(current, index, 'accepted'));
  };
  const accept = async (index: number, current: ChatTurn): Promise<void> => {
    const raw = current.edits[index];
    const reason = await oneReason(raw);
    if (reason === undefined) {
      props.onError('cannot reach bindweed');
      return;
    }
    if (reason !== null) {
      setDrop({ stamp, forced: { index, reason } });
      return;
    }
    await takeEdit(index, parsePlanEdit(raw) as PlanEdit, current);
  };
  const commitOpen = async (raw: unknown): Promise<PlanEdit | null> => {
    const edit = parsePlanEdit(raw);
    if (edit === undefined) return null;
    if ((await oneReason(raw)) !== null) return null;
    return keptEdit(await props.commit(edit), edit);
  };
  const acceptStep = async (held: ChatTurn[], current: ChatTurn, index: number): Promise<{ turns: ChatTurn[]; turn: ChatTurn }> => {
    const edit = await commitOpen(current.edits[index]);
    if (edit === null) return { turns: held, turn: current };
    const next = decide(current, index, 'accepted');
    const wrote = await replace(withTurn(held, next));
    return 'error' in wrote ? { turns: held, turn: current } : { turns: wrote, turn: next };
  };
  const acceptAll = async (start: ChatTurn): Promise<void> => {
    let held = turns;
    let current = start;
    for (const index of undecided(start)) {
      const step = await acceptStep(held, current, index);
      held = step.turns;
      current = step.turn;
    }
    setDrop(null);
    await recheck(current);
  };
  const refresh = useEffectEvent(() => {
    void recheck(latestTurn(turns));
  });
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [slug, stamp]);
  const landed = (answer: ProposeAnswer): void => {
    if ('error' in answer) {
      setRun({ kind: 'failed', error: answer.error, raw: answer.raw, ran: answer.ran, note: answer.note });
      return;
    }
    setText('');
    setStale(answer.stale);
    setDrop(null);
    store(answer.chat);
    setRun({ kind: 'done', ran: answer.ran, note: answer.note });
  };
  const propose = async (): Promise<void> => {
    if (!askTextOk(text)) {
      setHint('write what you dislike');
      return;
    }
    setHint(null);
    restartTicker();
    setRun({ kind: 'running' });
    landed(await postPropose(props.token, String(slug), { text, at: props.at }, props.fetcher));
  };
  const summary = turn === null ? '' : turn.summary;
  return {
    picture,
    running: run.kind === 'running',
    onTasks: setTasksRunning,
    recheck: () => {
      void recheck(latestTurn(turns));
    },
    column: (
      <AskColumn
        slug={slug}
        summary={summary}
        rows={rows}
        lines={chatLines(turns)}
        open={open}
        text={text}
        running={askBusy(run, tasksRunning)}
        hint={hint}
        run={run}
        seconds={seconds}
        changes={props.changes}
        onHover={setHover}
        onAccept={index => void accept(index, turn as ChatTurn)}
        onReject={index => void remember(decide(turn as ChatTurn, index, 'rejected'))}
        onAcceptAll={() => void acceptAll(turn as ChatTurn)}
        onRejectAll={() => void remember(rejectOpen(turn as ChatTurn))}
        onToggle={() => setOpen(current => !current)}
        onText={setText}
        onPropose={() => void propose()}
        onCancel={() => {
          void postCancel(props.token, String(slug), props.fetcher);
        }}
      />
    ),
  };
}
