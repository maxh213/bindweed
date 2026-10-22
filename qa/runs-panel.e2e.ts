import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const HUMAN = 'coder got the same problems back 3 times in a row; the worker is not making progress, stopping for a human';
const RUNNING = ['starting', '== coder (07-coder) attempt 2', '== hardener (07-hardener) attempt 1'];
const COMPLETE = ['== qa (09-qa) attempt 1', 'pipeline complete', ''];
const PROPOSALS = ['## Config changes the agents asked for and were refused', 'Decide whether to make any of these yourself.'];
const SC_POSITION = 'running · 4 agents · 7 open · 3 done · 2 PRs';
const POSITION = 'task 002-step · hardener · attempt 1 · 1 of 3 tasks';
const PRS = ['https://example.test/pull/41', 'https://example.test/pull/42'];
const FAKE_SC = [
  '#!/bin/sh',
  'if [ "$#" != 4 ] || [ "$1" != status ] || [ "$2" != --repo ] || [ "$4" != --json ]; then echo "usage: sc status --repo <dir> --json" >&2; exit 2; fi',
  'd="$3"',
  'if [ -e "$d/sc-status.slow" ]; then sleep 15; fi',
  'if [ -e "$d/sc-status.err" ]; then cat "$d/sc-status.err" >&2; exit 1; fi',
  'cat "$d/sc-status.json"',
  '',
].join('\n');

type Expected = { id: string; title: string; state: string; position: string; pill: string; background: string; tail: string[]; minute: string };
const CARDS: Expected[] = [
  { id: 'sc-err', title: 'plan-sc-err', state: 'dead', position: 'sc status failed: no slop-cannon state here · pid gone', pill: 'dead', background: '107, 114, 128', tail: [], minute: '12' },
  { id: 'sc', title: 'Plan SC', state: 'running', position: SC_POSITION, pill: 'running', background: '37, 99, 235', tail: Array.from({ length: 20 }, (_, i) => `[sc] line ${i + 6}`), minute: '09' },
  { id: 'dead', title: 'plan-dead', state: 'dead', position: 'task 001-task · 0 of 1 tasks', pill: 'dead', background: '107, 114, 128', tail: ['starting'], minute: '05' },
  { id: 'running', title: 'Plan Running', state: 'running', position: POSITION, pill: 'running', background: '37, 99, 235', tail: RUNNING, minute: '04' },
  { id: 'failed', title: 'plan-failed', state: 'failed', position: 'task 001-f · coder · attempt 1 · 0 of 1 tasks', pill: 'failed', background: '220, 38, 38', tail: ['== coder (03-coder) attempt 1', 'npm ERR! boom', 'pipeline stopped at coder', ''], minute: '03' },
  { id: 'stopped', title: 'plan-stopped', state: 'stopped for a human', position: 'task 002-x · coder · attempt 2 · 1 of 2 tasks', pill: 'stopped', background: '217, 119, 6', tail: ['== coder (03-coder) attempt 2', 'gate failed', HUMAN, 'pipeline stopped at coder', ''], minute: '02' },
  { id: 'done', title: 'plan-done', state: 'done', position: 'all tasks complete · 2 of 2 tasks', pill: 'done', background: '22, 163, 74', tail: COMPLETE, minute: '01' },
  { id: 'removed', title: 'plan-removed', state: 'worktree removed', position: 'worktree removed', pill: 'removed', background: '156, 163, 175', tail: [], minute: '00' },
];

function write(file: string, text: string, minute?: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (minute !== undefined) {
    const date = new Date(`2026-10-21T12:${minute}:00Z`);
    fs.utimesSync(file, date, date);
  }
}

function worktree(qa: string, id: string): string {
  return path.join(qa, 'runs', `wt-${id}`);
}

function logFile(qa: string, id: string, task: string): string {
  return path.join(worktree(qa, id), '.marestail/runs', task, 'pipeline.log');
}

function log(qa: string, id: string, task: string, lines: string[], minute: string): void {
  write(logFile(qa, id, task), `${lines.join('\n')}\n`, minute);
  write(path.join(worktree(qa, id), 'tasks', `${task}.md`), '');
}

function fixtures(qa: string, live: ChildProcess[], dead: number): string {
  const root = path.join(qa, 'layered');
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), root, { recursive: true });
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root });
  }
  log(qa, 'done', '001-a', COMPLETE, '10');
  log(qa, 'done', '002-b', COMPLETE, '20');
  log(qa, 'stopped', '001-w', ['pipeline complete', ''], '10');
  log(qa, 'stopped', '002-x', CARDS[5].tail, '20');
  log(qa, 'failed', '001-f', CARDS[4].tail, '10');
  log(qa, 'running', '000-old', ['pipeline complete'], '25');
  log(qa, 'running', '001-init', ['pipeline complete', ''], '10');
  log(qa, 'running', '002-step', RUNNING, '20');
  log(qa, 'dead', '001-task', ['starting'], '10');
  write(path.join(worktree(qa, 'running'), 'tasks/003-later.md'), '');
  for (const id of ['running', 'dead']) write(path.join(worktree(qa, id), 'tasks/README.md'), '');
  write(path.join(worktree(qa, 'running'), '.marestail/runs/direct-001-20261021T1226.log'), 'x\n', '26');
  for (const [id, summary] of [['done', '001-a ok\n002-b ok\nall tasks complete 2026-10-21 12:30:00\n'], ['stopped', 'stopped: tasks/002-x.md exited 1\n'], ['failed', 'stopped: tasks/001-f.md exited 2\n']]) {
    write(path.join(worktree(qa, id), '.marestail/runs/overnight-20261021T1230.md'), summary, '30');
  }
  write(path.join(worktree(qa, 'done'), '.marestail/runs/overnight-20261021T1230.log'), 'marestail output\n', '31');
  write(path.join(worktree(qa, 'sc'), 'sc-status.json'), JSON.stringify({ state: { phase: 'running' }, agents: [true, true, true, true, false].map(alive => ({ alive })), beads: { open: 7, done: 3 }, prs: PRS.map(url => ({ url })) }));
  write(path.join(worktree(qa, 'sc-err'), 'sc-status.err'), 'no slop-cannon state here\nsecond line\n');
  write(path.join(root, '.bindweed/runs/plan-sc.out'), `${Array.from({ length: 25 }, (_, i) => `[sc] line ${i + 1}`).join('\n')}\n`);
  write(path.join(qa, 'fakes/bin/sc'), FAKE_SC);
  fs.chmodSync(path.join(qa, 'fakes/bin/sc'), 0o755);
  const tasks: Record<string, string[]> = { removed: [], done: ['001-a', '002-b'], stopped: ['001-w', '002-x'], failed: ['001-f'], running: ['001-init', '002-step', '003-later'], sc: [], 'sc-err': [] };
  const entries = [...CARDS].reverse().map(card => ({
    slug: `plan-${card.id}`, tool: card.id.startsWith('sc') ? 'slop-cannon' : 'marestail', worktree: worktree(qa, card.id), branch: `bindweed/plan-${card.id}`,
    pid: ({ running: live[0].pid, sc: live[1].pid } as Record<string, number | undefined>)[card.id] ?? dead,
    startedAt: `2026-10-21T12:${card.minute}:00.000Z`, out: path.join(root, '.bindweed/runs', `plan-${card.id}.out`), settings: {},
    ...(card.id === 'dead' ? {} : { tasks: tasks[card.id].map(id => `tasks/${id}.md`) }),
  }));
  const order = ['removed', 'done', 'stopped', 'failed', 'running', 'dead', 'sc-err', 'sc'];
  entries.sort((a, b) => order.indexOf(a.slug.slice(5)) - order.indexOf(b.slug.slice(5)));
  write(path.join(root, '.bindweed/runs.json'), JSON.stringify(entries));
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const [slug, name] of [['plan-running', 'Plan Running'], ['plan-sc', 'Plan SC']]) {
    write(path.join(root, '.bindweed/plans', `${slug}.json`), JSON.stringify({ version: 1, slug, name, createdAt: '2026-10-21T12:00:00.000Z', baseCommit, edits: [], redo: [] }));
  }
  write(path.join(root, '.bindweed/plans/plan-dead.json'), '{"name":"Bad"}');
  return root;
}

function start(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`bindweed did not start: ${output}${errors}`)), 15_000);
    child.stderr?.on('data', chunk => { errors += chunk; });
    child.stdout?.on('data', chunk => {
      output += chunk;
      const match = /bindweed: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{32})\nserving .+\n/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`bindweed exited ${code}: ${output}${errors}`)); });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

function card(page: Page, name: string): Locator {
  return page.getByRole('article', { name, exact: true });
}

function runsRequest(url: string): boolean {
  return new URL(url).pathname === '/api/runs';
}

async function colours(page: Page): Promise<string[]> {
  return page.locator('.pill').evaluateAll(pills => pills.map(pill => `${pill.className} ${getComputedStyle(pill).backgroundColor} ${getComputedStyle(pill).color}`));
}

async function visibility(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('qa: a Runs panel shows where every launched run stands', async ({ page, context }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  ensureUiBuilt(BW);
  const qa = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-runs-')));
  const live = [spawn('sleep', ['900'], { stdio: 'ignore' }), spawn('sleep', ['900'], { stdio: 'ignore' })];
  let server: ChildProcess | undefined;
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  try {
    await Promise.all(live.map(child => once(child, 'spawn')));
    const dead = spawnSync('true').pid;
    const root = fixtures(qa, live, dead);
    const ledger = path.join(root, '.bindweed/runs.json');
    const originalLedger = fs.readFileSync(ledger, 'utf8');
    const env = { ...process.env, PATH: `${path.join(qa, 'fakes/bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`, BINDWEED_PORT: '5600' };
    delete env.FORCE_COLOR;
    server = spawn(process.execPath, [path.join(BW, 'src/cli.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const address = await start(server);
    const origin = new URL(address).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    let requests = 0;
    const pending = new Set<Request>();
    page.on('request', request => {
      if (runsRequest(request.url()) && request.method() === 'GET') { requests++; pending.add(request); }
    });
    page.on('requestfinished', request => pending.delete(request));
    page.on('requestfailed', request => pending.delete(request));
    await page.setViewportSize({ width: 1400, height: 1000 });

    await test.step('1. badge loads once while Architecture is shown', async () => {
      await page.goto(`${address}#at=src`);
      await expect(page.getByRole('tab')).toHaveText(['Files', 'Architecture', 'Runs2']);
      await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(requests).toBe(1);
      await page.waitForTimeout(5_500);
      expect(requests).toBe(1);
    });

    await test.step('2. eight ordered read-only cards with state, position, metadata and links', async () => {
      await page.getByRole('tab', { name: /^Runs/ }).click();
      await expect(page).toHaveURL(`${origin}/#runs`);
      await expect(page.locator('.run-title')).toHaveText(CARDS.map(item => item.title));
      await expect.poll(() => requests).toBe(2);
      await expect(page.locator('.badge')).toHaveText('2');
      await expect(page.locator('.badge.pill')).toHaveCount(0);
      for (const expected of CARDS) {
        const item = card(page, expected.title);
        await expect(item.locator('.pill')).toHaveText(expected.state);
        await expect(item.locator('.run-position')).toHaveText(expected.position);
        await expect(item.locator('code')).toHaveText(worktree(qa, expected.id));
        await expect(item).toContainText(`${expected.id.startsWith('sc') ? 'slop-cannon' : 'marestail'} · bindweed/plan-${expected.id}`);
        await expect(item).toContainText(new RegExp(`started 2026-10-21T12:${expected.minute}:00\\.000Z · (\\d+s|\\d+m|\\d+h \\d+m|\\d+d \\d+h)`));
        await expect(item.locator('details')).not.toHaveAttribute('open');
        await expect(item.getByRole('button', { name: 'Forget', exact: true })).toHaveCount(expected.id === 'removed' ? 1 : 0);
      }
      await expect(page.locator('.run-title a')).toHaveText(['Plan SC', 'Plan Running']);
      await expect(card(page, 'Plan Running').getByRole('link', { name: 'Plan Running', exact: true })).toHaveAttribute('href', '#at=src&plan=plan-running');
      await expect(card(page, 'Plan SC').locator('.run-prs a')).toHaveText(PRS);
      for (const url of PRS) await expect(card(page, 'Plan SC').getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
    });

    await test.step('3. rendered pill colours detect a later CSS override', async () => {
      const expected = CARDS.map(item => `pill pill-${item.pill} rgb(${item.background}) rgb(255, 255, 255)`);
      expect(await colours(page)).toEqual(expected);
      const override = await page.addStyleTag({ content: '.pill { color: #000000; } .pill-running { background: #000000; }' });
      expect(await colours(page)).not.toEqual(expected);
      await expect(card(page, 'Plan Running').locator('.pill')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      for (const item of CARDS) await expect(card(page, item.title).locator('.pill')).toHaveCSS('color', 'rgb(0, 0, 0)');
      await override.evaluate(element => element.remove());
      expect(await colours(page)).toEqual(expected);
    });

    await test.step('4. every exact log tail, including blank trailers and the last 20 sc lines', async () => {
      for (const expected of CARDS) {
        const item = card(page, expected.title);
        await item.getByText('Log tail', { exact: true }).click();
        await expect(item.locator('details')).toHaveAttribute('open', '');
        expect(await item.locator('pre').textContent()).toBe(expected.tail.join('\n'));
      }
    });

    await test.step('5. real log edits refresh to finished before trailers, then restore hardener', async () => {
      const file = logFile(qa, 'running', '002-step');
      write(file, `${COMPLETE.join('\n')}\n`);
      await expect(card(page, 'Plan Running').locator('.run-position')).toHaveText('task 002-step · finished · 2 of 3 tasks', { timeout: 7_000 });
      expect(await card(page, 'Plan Running').locator('pre').textContent()).toBe(COMPLETE.join('\n'));
      fs.appendFileSync(file, `${PROPOSALS.join('\n')}\n`);
      await expect.poll(() => card(page, 'Plan Running').locator('pre').textContent(), { timeout: 7_000 }).toBe([...COMPLETE, ...PROPOSALS].join('\n'));
      await expect(card(page, 'Plan Running').locator('.run-position')).toHaveText('task 002-step · finished · 2 of 3 tasks');
      await expect(card(page, 'Plan Running').locator('.pill')).toHaveText('running');
      write(file, `${RUNNING.join('\n')}\n`);
      await expect(card(page, 'Plan Running').locator('.run-position')).toHaveText(POSITION, { timeout: 7_000 });
    });

    await test.step('6. Copy worktree writes the exact path to the browser clipboard', async () => {
      await card(page, 'Plan Running').getByRole('button', { name: 'Copy worktree' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(worktree(qa, 'running'));
    });

    await test.step('7. the plan link opens the selected plan and stops polling for 15 seconds', async () => {
      await card(page, 'Plan Running').getByRole('link', { name: 'Plan Running', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/#at=src&plan=plan-running`);
      await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('combobox', { name: 'Plan', exact: true })).toHaveValue('plan-running');
      await expect(page.getByRole('combobox', { name: 'Plan', exact: true }).locator('option:checked')).toHaveText('Plan Running');
      const before = requests;
      await page.waitForTimeout(15_000);
      expect(requests).toBe(before);
    });

    await test.step('8. headless visibility events stop requests for 15 seconds and resume at once', async () => {
      const before = requests;
      await page.getByRole('tab', { name: /^Runs/ }).click();
      await expect.poll(() => requests).toBe(before + 1);
      await expect(card(page, 'Plan SC').locator('.run-position')).toHaveText(SC_POSITION);
      await visibility(page, 'hidden');
      const hidden = requests;
      await page.waitForTimeout(15_000);
      expect(requests).toBe(hidden);
      await visibility(page, 'visible');
      await expect.poll(() => requests).toBe(hidden + 1);
      await expect.poll(() => requests, { timeout: 7_000 }).toBe(hidden + 2);
    });

    await test.step('9–10. refused Forget retains the card; successful Forget changes only that entry', async () => {
      expect(fs.readFileSync(ledger, 'utf8')).toBe(originalLedger);
      await visibility(page, 'hidden');
      await expect.poll(() => pending.size).toBe(0);
      fs.mkdirSync(worktree(qa, 'removed'));
      await card(page, 'plan-removed').getByRole('button', { name: 'Forget', exact: true }).click();
      await expect(card(page, 'plan-removed').getByRole('alert')).toHaveText('Forget failed: worktree still exists');
      expect(fs.readFileSync(ledger, 'utf8')).toBe(originalLedger);
      fs.rmdirSync(worktree(qa, 'removed'));
      const deleted = page.waitForResponse(response => runsRequest(response.url()) && response.request().method() === 'DELETE');
      await card(page, 'plan-removed').getByRole('button', { name: 'Forget', exact: true }).click();
      expect((await deleted).status()).toBe(200);
      await expect(card(page, 'plan-removed')).toHaveCount(0);
      expect(JSON.parse(fs.readFileSync(ledger, 'utf8'))).toEqual(JSON.parse(originalLedger).filter((item: { slug: string }) => item.slug !== 'plan-removed'));
      await visibility(page, 'visible');
    });

    await test.step('11. a nine-second sc succeeds, a silent sc times out, then normal counts recover', async () => {
      await visibility(page, 'hidden');
      await expect.poll(() => pending.size).toBe(0);
      const fake = path.join(qa, 'fakes/bin/sc');
      write(fake, FAKE_SC.replace('#!/bin/sh\n', '#!/bin/sh\nsleep 9\n'));
      let began = Date.now();
      const delayedStart = requests;
      const started = page.waitForRequest(request => runsRequest(request.url()) && request.method() === 'GET');
      const delayed = page.waitForResponse(response => runsRequest(response.url()) && response.request().method() === 'GET');
      await visibility(page, 'visible');
      await started;
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('tab', { name: /^Runs/ }).click();
      await visibility(page, 'hidden');
      await visibility(page, 'visible');
      const answer = await delayed;
      expect(answer.status()).toBe(200);
      const payload = await answer.json();
      expect(payload.runs.find((item: { slug: string }) => item.slug === 'plan-sc').position).toBe(SC_POSITION);
      expect(Date.now() - began).toBeGreaterThanOrEqual(8_900);
      expect(requests).toBe(delayedStart + 1);
      await expect(card(page, 'Plan SC').locator('.run-position')).toHaveText(SC_POSITION);
      await visibility(page, 'hidden');
      await expect.poll(() => pending.size).toBe(0);
      write(fake, FAKE_SC);
      write(path.join(worktree(qa, 'sc'), 'sc-status.slow'), '');
      began = Date.now();
      const timeoutStart = requests;
      const timedOut = page.waitForResponse(response => runsRequest(response.url()) && response.request().method() === 'GET');
      await visibility(page, 'visible');
      const timeoutAnswer = await timedOut;
      expect(timeoutAnswer.status()).toBe(200);
      expect(Date.now() - began).toBeGreaterThanOrEqual(9_900);
      expect(Date.now() - began).toBeLessThan(12_000);
      expect(requests).toBe(timeoutStart + 1);
      await expect(card(page, 'Plan SC').locator('.run-position')).toHaveText('sc status failed: timed out after 10s · pid alive');
      await expect(card(page, 'Plan SC').locator('.pill')).toHaveText('running');
      fs.unlinkSync(path.join(worktree(qa, 'sc'), 'sc-status.slow'));
      await expect(card(page, 'Plan SC').locator('.run-position')).toHaveText(SC_POSITION, { timeout: 7_000 });
      await expect(card(page, 'Plan SC').locator('.run-prs a')).toHaveText(PRS);
    });

    await test.step('12–13. process exit removes the badge; an empty ledger shows the empty panel', async () => {
      await Promise.all(live.map(stop));
      for (const name of ['Plan Running', 'Plan SC']) await expect(card(page, name).locator('.pill')).toHaveText('dead', { timeout: 7_000 });
      await expect(page.locator('.badge')).toHaveCount(0);
      write(ledger, '[]');
      await expect(page.locator('main')).toHaveText('No runs launched from this repository yet.', { timeout: 7_000 });
      await expect(page.locator('.run-card')).toHaveCount(0);
      expect(failures).toEqual([]);
    });
  } finally {
    if (server !== undefined) await stop(server);
    await Promise.all(live.map(stop));
    fs.rmSync(qa, { recursive: true, force: true });
    expect(fs.existsSync(qa)).toBe(false);
  }
});
