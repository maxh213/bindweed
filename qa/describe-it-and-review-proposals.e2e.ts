import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5400;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const LLM = { timeout: 20_000 };
const PURPLE = 'rgb(124, 58, 237)';
const DASH = '—';
const SUMMARY = 'Pull scanning out of the ui so app has one job.';
const KEEP_SUMMARY = 'Leave scanning in app.';
const JOBS_SUMMARY = 'Give each job its own package.';
const CUT = 'src/app must not import src/domain (1 import)';
const PACKAGE = 'Create package src/ports';
const MOVE = 'Move src/app/b.ts to src/ports';
const MISSING = 'Move src/no-such.ts to src/ports';
const MISSING_LINE = `dropped: ${MISSING} ${DASH} no such file src/no-such.ts`;
const MOVE_EARLY = `dropped: ${MOVE} ${DASH} no such directory src/ports`;
const KEEP = 'src/domain should use src/app';
const SPLIT = 'Split src/app into src/app/scan (1 file) and src/app/jobs (1 file)';
const JOB_MOVE = 'Move src/app/scan/a.ts to src/infra';
const DELETE = 'Delete src/infra/db.ts';
const NOTE = 'Note on src/app: "three jobs"';
const FIRST_TURN = [
  'They said: the ui knows about the scanner',
  `Summary: ${SUMMARY}`,
  `0 accepted: ${CUT}`,
  `1 rejected: ${PACKAGE}`,
  `2 rejected: ${MOVE}`,
  `3 rejected: ${MISSING}`,
];
const TALK = [...FIRST_TURN, 'They said: keep scan where it is', `Summary: ${KEEP_SUMMARY}`, `0 open: ${KEEP}`];
const KEPT = '/tmp/bindweed-009-qa-fail';

type Rect = { x: number; y: number; width: number; height: number };

function waitForLines(child: ChildProcess, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let err = '';
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      if (lines.length > count) {
        child.stdout?.off('data', onData);
        resolve(lines.slice(0, count));
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const lines = buf.split('\n').filter(Boolean);
      if (lines.length >= count) resolve(lines.slice(0, count));
      else reject(new Error(`server exited ${code} before ${count} lines: ${buf}${err}`));
    });
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGINT');
  });
}

function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  return env;
}

function gitStatus(dir: string): string {
  return execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function promptAt(log: string, n: number): string {
  return fs.readFileSync(path.join(log, `${n}.prompt`), 'utf8');
}

function linesHolding(text: string, needle: string): string[] {
  return text.split('\n').filter((line) => line.includes(needle));
}

function after(text: string, heading: string, count: number): string[] {
  const lines = text.split('\n');
  const at = lines.indexOf(heading);
  return at === -1 ? [] : lines.slice(at, at + 1 + count);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killSleep(log: string): void {
  const file = path.join(log, 'sleep.pids');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const pid = Number(line);
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        continue;
      }
    }
  }
}

function realBox(page: Page, id: string): Locator {
  return page.locator(`.box:not(.ghost):not(.proposal)[data-id="${id}"]`);
}

function proposalBox(page: Page, id: string): Locator {
  return page.locator(`.box.proposal[data-id="${id}"]`);
}

function realArrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function scissors(page: Page): Locator {
  return page.locator('g.proposal-cut[data-from="src/app"][data-to="src/domain"]');
}

function proposalArrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g[data-proposal="true"]:not(.proposal-cut)[data-from="${from}"][data-to="${to}"]`);
}

function proposalsOf(page: Page): Locator {
  return page.locator('aside[aria-label="proposals"]');
}

function proposalRows(page: Page): Locator {
  return proposalsOf(page).locator('li > span');
}

function proposalItem(page: Page, text: string): Locator {
  return proposalsOf(page).locator('li').filter({ has: page.locator('span', { hasText: new RegExp(`^${escape(text)}$`) }) });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function changes(page: Page): Locator {
  return page.locator('aside[aria-label="changes"] .change-sentence');
}

function askOf(page: Page): Locator {
  return page.locator('aside[aria-label="ask"]');
}

function askBox(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Ask', exact: true });
}

function conversationButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Conversation', exact: true });
}

function lit(page: Page): Locator {
  return page.locator('[data-highlight="true"]');
}

function marks(page: Page): Locator {
  return page.locator('[data-proposal="true"]:not([data-from=""])');
}

async function columnOrder(page: Page): Promise<string[]> {
  return page.locator('.arch-body').evaluate((body) =>
    Array.from(body.children).flatMap((el) => {
      const label = el.getAttribute('aria-label');
      if (label === 'proposals' || label === 'changes' || label === 'ask') return [label];
      if (el.querySelector('button')?.textContent === 'Conversation') return ['conversation'];
      return [];
    }),
  );
}

async function rectOf(locator: Locator): Promise<Rect> {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error('not laid out');
  return rect;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function spot(box: Locator): Promise<string> {
  return `${await box.getAttribute('data-x')},${await box.getAttribute('data-y')}`;
}

async function styleOf(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);
}

async function expectDashedPurple(locator: Locator): Promise<void> {
  expect(await styleOf(locator, 'border-top-style')).toBe('dashed');
  expect(await styleOf(locator, 'border-top-color')).toBe(PURPLE);
}

async function expectStruckPurple(locator: Locator): Promise<void> {
  await expect(locator).toHaveAttribute('data-strike', 'true');
  expect(await styleOf(locator, 'text-decoration-line')).toBe('line-through');
  expect(await styleOf(locator, 'text-decoration-color')).toBe(PURPLE);
}

async function expectNotStruck(locator: Locator): Promise<void> {
  expect(await locator.getAttribute('data-strike')).toBeNull();
  expect(await styleOf(locator, 'text-decoration-line')).toBe('none');
}

async function litPaths(page: Page): Promise<string[]> {
  return lit(page).evaluateAll((els) =>
    els
      .map((el) => {
        if (el.classList.contains('box')) return `box ${el.getAttribute('data-id')}`;
        if (el.classList.contains('box-name')) return `name ${el.closest('.box')?.getAttribute('data-id')}`;
        if (el.hasAttribute('data-path')) return `row ${el.getAttribute('data-path')} in ${el.closest('.box')?.getAttribute('data-id')}`;
        return `mark ${el.getAttribute('data-from')}->${el.getAttribute('data-to')}`;
      })
      .sort(),
  );
}

async function propose(page: Page, text: string): Promise<void> {
  await askBox(page).fill(text);
  await askOf(page).getByRole('button', { name: 'Propose', exact: true }).click();
}

async function reopen(page: Page, tokenText: string): Promise<void> {
  await page.goto(`${ORIGIN}/?token=${tokenText}#at=src&plan=gate`);
  await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
  await expect(askBox(page)).toBeVisible();
}

async function setCommand(page: Page, command: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('textbox', { name: 'Command' }).fill(command);
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).toHaveCount(0);
}

async function createGate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New plan…' }).click();
  const created = page.getByRole('dialog', { name: 'New plan' });
  await created.getByRole('textbox', { name: 'Name' }).fill('Gate');
  await created.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
}

test('qa: say what you dislike and review the proposals on the canvas', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  ensureUiBuilt(BW);

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  const log = path.join(QA, 'log');
  const plans = path.join(layered, '.bindweed/plans');
  const planPath = path.join(plans, 'gate.json');
  const chatPath = path.join(plans, 'gate.chat.json');
  const fakeCommand = `node ${path.join(BW, 'qa/fixtures/fake-llm.mjs')} ${log}`;
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), layered, { recursive: true });
  fs.mkdirSync(log);
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: layered },
  );
  fs.mkdirSync(path.join(layered, '.bindweed'), { recursive: true });
  fs.writeFileSync(path.join(layered, '.bindweed/config.json'), JSON.stringify({ llm: { backend: 'command', command: fakeCommand } }));

  const plan = (): { edits: unknown[]; redo: unknown[] } => readJson(planPath) as { edits: unknown[]; redo: unknown[] };
  const chat = (): { text: string; decisions: Record<string, string> }[] =>
    readJson(chatPath) as { text: string; decisions: Record<string, string> }[];

  let server: ChildProcess | null = null;
  let failed = false;
  try {
    server = spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(PORT)], {
      cwd: layered,
      env: serverEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = await waitForLines(server, 2);
    const token = new RegExp(`^bindweed: http://127\\.0\\.0\\.1:${PORT}/\\?token=([0-9a-f]{32})$`).exec(lines[0]);
    const tokenText = token?.[1] ?? '';
    expect(token).not.toBeNull();

    await test.step('1. the layered packages, with no Ask and no Proposals', async () => {
      await page.setViewportSize({ width: 1800, height: 1000 });
      await page.goto(`${ORIGIN}/?token=${tokenText}#at=src`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(realBox(page, 'src/app').locator('.box-count')).toHaveText('2 files');
      const app = await rectOf(realBox(page, 'src/app'));
      const infra = await rectOf(realBox(page, 'src/infra'));
      const domain = await rectOf(realBox(page, 'src/domain'));
      expect(app.y).toBeLessThan(infra.y);
      expect(infra.y).toBeLessThan(domain.y);
      await expect(realArrow(page, 'src/app', 'src/domain')).toHaveCount(1);
      await expect(askBox(page)).toHaveCount(0);
      await expect(proposalsOf(page)).toHaveCount(0);
    });

    await test.step('2. a plan shows Ask under Changes; blank Propose and Enter send nothing', async () => {
      await createGate(page);
      await expect(askBox(page)).toBeVisible();
      await expect(askOf(page).getByRole('button', { name: 'Propose', exact: true })).toBeVisible();
      expect(await columnOrder(page)).toEqual(['changes', 'ask']);
      await expect(conversationButton(page)).toHaveCount(0);
      await askOf(page).getByRole('button', { name: 'Propose', exact: true }).click();
      await expect(askOf(page).locator('.plan-dialog-error')).toHaveText('write what you dislike');
      await askBox(page).fill('the ui knows about the scanner');
      await askBox(page).press('Enter');
      await expect(askBox(page)).toHaveValue('the ui knows about the scanner\n');
      await page.waitForTimeout(500);
      expect(fs.readdirSync(log)).toEqual([]);
    });

    await test.step('3. Propose lists three proposals and a dropped line, drawn purple', async () => {
      await propose(page, 'the ui knows about the scanner');
      await expect(askOf(page).locator('output[aria-label="ran"]')).toHaveText(`command: ${fakeCommand}`, LLM);
      await expect(askBox(page)).toHaveValue('');
      await expect(proposalsOf(page).locator('p')).toHaveText(SUMMARY);
      await expect(proposalRows(page)).toHaveText([CUT, PACKAGE, MOVE, MISSING_LINE]);
      for (const sentence of [CUT, PACKAGE, MOVE]) {
        await expect(proposalItem(page, sentence).getByRole('button')).toHaveText([`Accept ${sentence}`, `Reject ${sentence}`]);
      }
      await expect(proposalItem(page, MISSING_LINE).getByRole('button')).toHaveText([`Reject ${MISSING}`]);
      await expect(proposalsOf(page).getByRole('button', { name: 'Accept all', exact: true })).toBeVisible();
      await expect(proposalsOf(page).getByRole('button', { name: 'Reject all', exact: true })).toBeVisible();
      await expect(changes(page)).toHaveCount(0);
      expect(await columnOrder(page)).toEqual(['proposals', 'changes', 'conversation', 'ask']);
      await expect(conversationButton(page)).toHaveAttribute('aria-expanded', 'false');

      for (const id of ['src/app', 'src/infra', 'src/domain']) await expect(realBox(page, id)).toHaveAttribute('data-x', '0');
      await expect(realBox(page, 'src/app').locator('.box-row')).toHaveText(['a.ts', 'b.ts']);
      await expect(page.locator('[data-strike="true"]')).toHaveCount(0);
      await expect(realArrow(page, 'src/app', 'src/domain')).toHaveCount(1);
      await expect(scissors(page)).toHaveAttribute('data-proposal', 'true');
      await expect(scissors(page).locator('.proposal-cut-label')).toHaveText('✂');
      expect(await styleOf(scissors(page).locator('.proposal-cut-label'), 'fill')).toBe(PURPLE);

      const ports = proposalBox(page, 'src/ports');
      await expect(ports.locator('.box-name')).toHaveText('ports');
      expect(await spot(ports)).toBe('260,0');
      expect(await spot(realBox(page, 'src/app'))).toBe('0,0');
      await expectDashedPurple(ports);
      const portsRow = ports.locator('.box-row[data-path="src/ports/b.ts"]');
      await expect(portsRow).toHaveText('b.ts');
      await expect(portsRow).toHaveAttribute('data-proposal', 'true');
      await expectDashedPurple(portsRow);
      const portsRect = await rectOf(ports);
      const appRect = await rectOf(realBox(page, 'src/app'));
      expect(portsRect.x).toBeGreaterThan(appRect.x + appRect.width);
      expect(Math.abs(portsRect.y - appRect.y)).toBeLessThan(appRect.height);
      for (const id of ['src/app', 'src/infra', 'src/domain']) expect(overlaps(portsRect, await rectOf(realBox(page, id)))).toBe(false);
      await expect(page.locator('[data-path="src/no-such.ts"], [data-path="src/ports/no-such.ts"]')).toHaveCount(0);
    });

    await test.step('4. the first prompt carries the dislike, the graph, the cycle and the schema', async () => {
      const prompt = promptAt(log, 1);
      expect(after(prompt, '## What they dislike', 1)).toEqual(['## What they dislike', 'the ui knows about the scanner']);
      expect(linesHolding(prompt, 'edge src/app -> src/domain runtime 0 type 1')).toHaveLength(1);
      expect(linesHolding(prompt, 'node src/app/a.ts file a.ts')).toHaveLength(1);
      expect(linesHolding(prompt, 'cycles a.ts → b.ts → a.ts')).toHaveLength(1);
      expect(linesHolding(prompt, '{"kind":"move-file","file":"<path>","to":"<dir>"}')).toHaveLength(1);
      expect(linesHolding(prompt, 'Reply with slices now.')).toHaveLength(0);
    });

    await test.step('5. hover lights the cut; accepting the move first writes nothing', async () => {
      await proposalItem(page, CUT).hover();
      await expect(scissors(page)).toHaveAttribute('data-highlight', 'true');
      expect(await proposalBox(page, 'src/ports').getAttribute('data-highlight')).toBeNull();
      expect(await litPaths(page)).toEqual(['mark src/app->src/domain']);
      await proposalItem(page, MOVE).getByRole('button', { name: `Accept ${MOVE}`, exact: true }).click();
      await expect(proposalRows(page)).toHaveText([CUT, PACKAGE, MOVE_EARLY, MISSING_LINE]);
      await expect(proposalItem(page, MOVE_EARLY).getByRole('button')).toHaveText([`Reject ${MOVE}`]);
      await expect(proposalBox(page, 'src/ports')).toHaveCount(1);
      await expect(page.locator('[data-path="src/ports/b.ts"]')).toHaveCount(0);
      expect(plan().edits).toHaveLength(0);
      expect(chat()[0]?.decisions).toEqual({});
    });

    await test.step('6. accepting the cut brings the move back; Undo and Redo do not restore the proposal', async () => {
      await proposalItem(page, CUT).getByRole('button', { name: `Accept ${CUT}`, exact: true }).click();
      await expect(changes(page)).toHaveText([CUT]);
      await expect(proposalRows(page)).toHaveText([PACKAGE, MOVE, MISSING_LINE]);
      await expect(proposalItem(page, MOVE).getByRole('button')).toHaveText([`Accept ${MOVE}`, `Reject ${MOVE}`]);
      await expect(proposalBox(page, 'src/ports').locator('.box-row[data-path="src/ports/b.ts"]')).toHaveText('b.ts');
      const undo = page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Undo', exact: true });
      const redo = page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Redo', exact: true });
      await undo.click();
      await expect(changes(page)).toHaveCount(0);
      await expect(proposalRows(page)).toHaveText([PACKAGE, MOVE, MISSING_LINE]);
      await redo.click();
      await expect(changes(page)).toHaveText([CUT]);
      await undo.click();
      await expect(changes(page)).toHaveCount(0);
      await expect(proposalRows(page)).toHaveText([PACKAGE, MOVE, MISSING_LINE]);
    });

    await test.step('7. Reject all clears the rest and leaves the plan unchanged', async () => {
      await proposalsOf(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(proposalsOf(page)).toHaveCount(0);
      await expect(changes(page)).toHaveCount(0);
      await expect.poll(() => JSON.stringify(chat()[0]?.decisions)).toBe('{"0":"accepted","1":"rejected","2":"rejected","3":"rejected"}');
      expect(chat()).toHaveLength(1);
      expect([plan().edits.length, plan().redo.length]).toEqual([0, 1]);
    });

    await test.step('8. a second message replaces the proposals and quotes the first turn', async () => {
      await propose(page, 'keep scan where it is');
      await expect(proposalRows(page)).toHaveText([KEEP], LLM);
      await expect(proposalItem(page, KEEP).getByRole('button')).toHaveText([`Accept ${KEEP}`, `Reject ${KEEP}`]);
      await expect(scissors(page)).toHaveCount(0);
      await expect(proposalBox(page, 'src/ports')).toHaveCount(0);
      await expect(page.locator('[data-path="src/ports/b.ts"]')).toHaveCount(0);
      const keep = proposalArrow(page, 'src/domain', 'src/app');
      await expect(keep).toHaveCount(1);
      const line = keep.locator('path.react-flow__edge-path');
      expect(await styleOf(line, 'stroke')).toBe(PURPLE);
      expect(await styleOf(line, 'stroke-dasharray')).toBe('6px, 4px');
      const prompt = promptAt(log, 2);
      expect(after(prompt, "## The plan's edits so far", 1)).toEqual(["## The plan's edits so far", 'none']);
      expect(after(prompt, '## Conversation so far', 6)).toEqual(['## Conversation so far', ...FIRST_TURN]);
    });

    await test.step('9. a reload keeps the conversation, collapsed, and the open proposal', async () => {
      await reopen(page, tokenText);
      await expect(conversationButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.chat-line')).toHaveCount(0);
      await expect(proposalArrow(page, 'src/domain', 'src/app')).toHaveCount(1);
      await conversationButton(page).click();
      await expect(page.locator('.chat-line')).toHaveText(TALK);
    });

    await test.step('10. Generate still interviews and leaves the conversation', async () => {
      await page.getByRole('button', { name: 'Tasks', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Tasks' });
      await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(dialog.getByRole('textbox', { name: 'Must a.ts keep exporting a?' })).toBeVisible(LLM);
      await expect(dialog.getByRole('textbox', { name: 'Should b.ts move before the cut?' })).toBeVisible();
      await expect(dialog.locator('.tasks-why')).toHaveText(['Other code may import it.', 'The order decides which slice breaks the build.']);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.chat-line')).toHaveText(TALK);
      await expect(proposalArrow(page, 'src/domain', 'src/app')).toHaveCount(1);
    });

    await test.step('11. an unusable reply shows the error and raw output and keeps the text and proposals', async () => {
      await setCommand(page, 'echo nope');
      await propose(page, 'hello');
      await expect(askOf(page).locator('.plan-dialog-error')).toHaveText("the LLM's reply was not usable: it is not valid JSON", LLM);
      await expect(askOf(page).getByRole('region', { name: 'Raw output' })).toContainText('nope');
      await expect(askBox(page)).toHaveValue('hello');
      await expect(proposalRows(page)).toHaveText([KEEP]);
    });

    await test.step('12. Cancel kills the sleeping fake and keeps the proposals', async () => {
      await setCommand(page, fakeCommand);
      await propose(page, 'SLEEP-NOW');
      await expect(askOf(page).getByText(/running for/)).toBeVisible();
      await expect(askOf(page).getByRole('button', { name: 'Propose', exact: true })).toBeDisabled();
      await expect(askOf(page).getByText(/running for [1-9]/)).toBeVisible({ timeout: 6_000 });
      await expect.poll(() => fs.existsSync(path.join(log, 'sleep.pids')), { timeout: 15_000 }).toBe(true);
      const pids = fs
        .readFileSync(path.join(log, 'sleep.pids'), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map(Number);
      expect(pids).toHaveLength(2);
      await askOf(page).getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(askOf(page).locator('.plan-dialog-error')).toHaveText('cancelled', LLM);
      await expect.poll(() => pids.filter(alive), { timeout: 2_000 }).toEqual([]);
      await expect(proposalRows(page)).toHaveText([KEEP]);
    });

    await test.step('13. a split, a move, a deletion and a note are drawn and lit by hover', async () => {
      await propose(page, 'app is doing three jobs');
      await expect(proposalsOf(page).locator('p')).toHaveText(JOBS_SUMMARY, LLM);
      await expect(proposalRows(page)).toHaveText([SPLIT, JOB_MOVE, DELETE, NOTE]);
      for (const sentence of [SPLIT, JOB_MOVE, DELETE, NOTE]) {
        await expect(proposalItem(page, sentence).getByRole('button')).toHaveText([`Accept ${sentence}`, `Reject ${sentence}`]);
      }
      await expect(proposalArrow(page, 'src/domain', 'src/app')).toHaveCount(0);
      const jobs = proposalBox(page, 'src/app/jobs');
      const scan = proposalBox(page, 'src/app/scan');
      await expect(jobs.locator('.box-name')).toHaveText('jobs');
      await expect(scan.locator('.box-name')).toHaveText('scan');
      expect(await spot(jobs)).toBe('260,0');
      expect(await spot(scan)).toBe('260,140');
      await expectDashedPurple(jobs);
      await expectDashedPurple(scan);
      await expect(jobs.locator('.box-row')).toHaveText(['b.ts']);
      await expect(jobs.locator('.box-row')).toHaveAttribute('data-path', 'src/app/jobs/b.ts');
      await expect(scan.locator('.box-row')).toHaveCount(0);
      const infraRows = realBox(page, 'src/infra').locator('.box-row');
      await expect(infraRows).toHaveCount(2);
      await expect(infraRows.nth(0)).toHaveAttribute('data-path', 'src/infra/db.ts');
      await expect(infraRows.nth(1)).toHaveAttribute('data-path', 'src/infra/a.ts');
      await expectStruckPurple(infraRows.nth(0));
      await expectDashedPurple(infraRows.nth(1));
      await expectStruckPurple(realBox(page, 'src/app').locator('.box-name'));
      for (const row of await realBox(page, 'src/app').locator('.box-row').all()) await expectNotStruck(row);
      const jobsRect = await rectOf(jobs);
      const scanRect = await rectOf(scan);
      const appRect = await rectOf(realBox(page, 'src/app'));
      const infraRect = await rectOf(realBox(page, 'src/infra'));
      expect(jobsRect.x).toBeGreaterThan(appRect.x + appRect.width);
      expect(scanRect.x).toBeGreaterThan(infraRect.x + infraRect.width);
      expect(scanRect.y).toBeGreaterThan(jobsRect.y);
      await expect(marks(page).filter({ hasText: 'three jobs' })).toHaveCount(0);
      await expect(page.locator('.react-flow').getByText('three jobs')).toHaveCount(0);

      await proposalItem(page, SPLIT).hover();
      await expect
        .poll(() => litPaths(page))
        .toEqual(['box src/app/jobs', 'box src/app/scan', 'name src/app', 'row src/app/jobs/b.ts in src/app/jobs']);
      await proposalItem(page, JOB_MOVE).hover();
      await expect.poll(() => litPaths(page)).toEqual(['row src/infra/a.ts in src/infra']);
      await proposalItem(page, NOTE).hover();
      await expect(lit(page)).toHaveCount(0);
      await proposalsOf(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(proposalsOf(page)).toHaveCount(0);
      await expect(marks(page)).toHaveCount(0);
      await expect(changes(page)).toHaveCount(0);
    });

    await test.step('14. deleting the plan deletes its chat, and a new Gate starts clean', async () => {
      await page.getByRole('button', { name: 'Delete plan', exact: true }).click();
      await page.getByRole('dialog', { name: 'Delete plan' }).getByRole('button', { name: 'Delete', exact: true }).click();
      await expect.poll(() => fs.readdirSync(plans)).toEqual([]);
      await createGate(page);
      await expect(askBox(page)).toBeVisible();
      await expect(conversationButton(page)).toHaveCount(0);
      await expect(proposalsOf(page)).toHaveCount(0);
    });

    await test.step('15. a chat file that is not a chat reads as empty and is replaced', async () => {
      fs.writeFileSync(chatPath, '{not json');
      await reopen(page, tokenText);
      await expect(conversationButton(page)).toHaveCount(0);
      await expect(proposalsOf(page)).toHaveCount(0);
      await expect(page.locator('.plan-dialog-error')).toHaveCount(0);
      await propose(page, 'keep scan where it is');
      await expect(proposalRows(page)).toHaveText([KEEP], LLM);
      expect(chat().map((turn) => turn.text)).toEqual(['keep scan where it is']);
    });

    await test.step('16. stopping bindweed leaves the fixture tree clean', async () => {
      await stopChild(server);
      server = null;
      expect(gitStatus(layered)).toBe('');
    });
  } catch (error) {
    failed = true;
    fs.rmSync(KEPT, { recursive: true, force: true });
    fs.cpSync(QA, KEPT, { recursive: true });
    throw error;
  } finally {
    if (server !== null) await stopChild(server);
    killSleep(log);
    if (!failed) fs.rmSync(QA, { recursive: true, force: true });
  }
});
