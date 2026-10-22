import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ConvergeAnswer } from './client.ts';

type Verdict = ConvergeAnswer | { error: string } | undefined;

const CONVERGE_POLL_MS = 20000;

function pageVisible(): boolean {
  return document.visibilityState === 'visible';
}

function fetchesInFlight(client: QueryClient): boolean {
  return client.isFetching() > 0;
}

type Watch = { live: boolean; busy: boolean | null; timer?: ReturnType<typeof setTimeout>; stop: () => void };

function scheduleRefresh(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  watch.timer = setTimeout(() => {
    watch.busy = null;
    void refresh().then(() => syncWatch(client, watch, refresh));
  }, CONVERGE_POLL_MS);
}

function armWhenIdle(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (!watch.live) return;
  if (fetchesInFlight(client)) return;
  clearTimeout(watch.timer);
  scheduleRefresh(client, watch, refresh);
}

const SETTLE_TURNS = 100;

function afterImmediateTurns(left: number, done: () => void): void {
  if (left > 0) {
    setImmediate(() => afterImmediateTurns(left - 1, done));
    return;
  }
  done();
}

function scheduleAfterSettle(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (typeof setImmediate !== 'function') {
    armWhenIdle(client, watch, refresh);
    return;
  }
  afterImmediateTurns(SETTLE_TURNS, () => armWhenIdle(client, watch, refresh));
}

function stillFetching(watch: Watch, busy: boolean): boolean {
  return busy && watch.busy === true;
}

function syncWatch(client: QueryClient, watch: Watch, refresh: () => Promise<void>): void {
  if (!watch.live) return;
  const busy = fetchesInFlight(client);
  if (stillFetching(watch, busy)) return;
  watch.busy = busy;
  clearTimeout(watch.timer);
  if (busy) return;
  scheduleAfterSettle(client, watch, refresh);
}

function pidAliveOf(verdict: Verdict): boolean {
  return verdict !== undefined && 'pidAlive' in verdict && verdict.pidAlive;
}

function useVisible(hidden: { current: boolean }): boolean {
  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => {
    const update = (): void => {
      const now = pageVisible();
      if (!now) hidden.current = true;
      setVisible(now);
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [hidden]);
  return visible;
}

function beginWatch(client: QueryClient, watch: Watch, hidden: { current: boolean }, refresh: () => Promise<void>): void {
  const wasHidden = hidden.current;
  hidden.current = false;
  if (wasHidden) void refresh().then(() => syncWatch(client, watch, refresh));
  else syncWatch(client, watch, refresh);
}

function startWatch(client: QueryClient, hidden: { current: boolean }, refresh: () => Promise<void>): Watch {
  const watch = { live: true, busy: null } as Watch;
  watch.stop = client.getQueryCache().subscribe(() => syncWatch(client, watch, refresh));
  beginWatch(client, watch, hidden, refresh);
  return watch;
}

export function useConvergeWatch(verdict: Verdict, refresh: () => Promise<void>): void {
  const active = pidAliveOf(verdict);
  const client = useQueryClient();
  const hidden = useRef(false);
  const visible = useVisible(hidden);
  const refreshNow = useEffectEvent(refresh);
  useEffect(() => {
    if (!visible) return undefined;
    if (!active) {
      hidden.current = false;
      return undefined;
    }
    const watch = startWatch(client, hidden, () => refreshNow());
    return () => {
      watch.live = false;
      watch.stop();
      clearTimeout(watch.timer);
    };
  }, [active, visible, client]);
}
