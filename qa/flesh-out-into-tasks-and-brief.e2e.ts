import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5300;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const LLM = { timeout: 20_000 };
const Q1 = 'Must a.ts keep exporting a?';
const Q2 = 'Should b.ts move before the cut?';
const WHY1 = 'Other code may import it.';
const WHY2 = 'The order decides which slice breaks the build.';
const BRIEF = '# Reshape layered\n\nMove b, then cut app from domain.\n';
const MERGED = '# 005 — Add the core package\n\nCreate src/core.\n\nNo behaviour changes.\n';
const RENAMED = '# 005 — Add src/core\n\nCreate src/core.\n';
const CUT = '# 008 — Cut app from domain\n\nNo behaviour changes.\n';
const FOUR = ['005-add-core.md', '006-move-b.md', '007-add-core.md', '008-cut-app-domain.md'];
const KEPT = '/tmp/bindweed-008-qa-fail';

function exactName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

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
  env.CLAUDECODE = '1';
  env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  return env;
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function writeFixture(dir: string): void {
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks/004-x.md'), '# 004 — x\n');
  fs.writeFileSync(path.join(dir, 'tasks/README.md'), '# Our guide\n\nOne slice per step.\n');
}

function gitStatus(dir: string): string {
  return execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
}

function box(page: Page, name: string): Locator {
  return page.locator('.box:not(.ghost)').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function tasksOf(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Tasks' });
}

function sliceFiles(dialog: Locator): Locator {
  return dialog.locator('.tasks-file');
}

function bodyOf(dialog: Locator, file: string): Locator {
  return dialog.getByRole('textbox', { name: `Body of ${file}` });
}

function promptAt(log: string, n: number): string {
  return fs.readFileSync(path.join(log, `${n}.prompt`), 'utf8');
}

function linesMatching(text: string, pattern: RegExp): string[] {
  return text.split('\n').filter((line) => pattern.test(line));
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

async function clickArrow(page: Page, from: string, to: string): Promise<void> {
  await expect(arrow(page, from, to)).toHaveCount(1);
  await page.evaluate(
    ({ fromStr, toStr }) => {
      const arrowG = document.querySelector(`g.arrow[data-from="${fromStr}"][data-to="${toStr}"]`);
      const target = arrowG?.querySelector('path.react-flow__edge-interaction') ?? arrowG?.querySelector('path') ?? arrowG;
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    { fromStr: from, toStr: to },
  );
  await expect(arrow(page, from, to)).toHaveAttribute('data-selected', 'true');
}

async function chooseMenu(page: Page, name: string, item: string): Promise<void> {
  await box(page, name).locator('.box-name').click();
  const menu = box(page, name).locator('.box-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Menu', exact: true }).click();
  const button = menu.getByRole('button', { name: item, exact: true });
  await expect(button).toBeVisible();
  await button.evaluate((el: HTMLElement) => el.click());
}

async function addNote(page: Page, text: string): Promise<void> {
  await chooseMenu(page, 'domain', 'Add note');
  const dialog = page.getByRole('dialog', { name: 'Add note' });
  await dialog.getByRole('textbox', { name: 'Note', exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.change-sentence', { hasText: `Note on src/domain: "${text}"` })).toBeVisible();
  await expect(box(page, 'domain').locator(`[aria-label="note"][title="${text}"]`)).toBeVisible();
}

async function openTasks(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const dialog = tasksOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function reopen(page: Page, tokenText: string): Promise<void> {
  await page.goto(`${ORIGIN}/?token=${tokenText}#at=src&plan=gate`);
  await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
  await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
}

async function replaceField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

function answerUnder(text: string, question: string): string {
  const lines = text.split('\n');
  return lines[lines.indexOf(`Q: ${question}`) + 1] ?? '';
}

test('qa: a plan becomes task files and a slop-cannon brief', async ({ page, context }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  ensureUiBuilt(BW);

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const layered = path.join(QA, 'layered');
  const log = path.join(QA, 'log');
  const configPath = path.join(layered, '.bindweed/config.json');
  const planDir = path.join(layered, '.bindweed/plans/gate');
  const tasksOut = path.join(planDir, 'tasks');
  const briefPath = path.join(planDir, 'brief.md');
  const fakeCommand = `node ${path.join(BW, 'qa/fixtures/fake-llm.mjs')} ${log}`;
  const sc = `sc --repo ${layered} --safety on -m "$(cat ${layered}/.bindweed/plans/gate/brief.md)"`;
  writeFixture(layered);
  fs.mkdirSync(log);
  commitFixture(layered);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });

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
    expect(lines[1]).toBe(`serving ${layered}`);

    await test.step('1. the layered packages, with Settings and no Tasks', async () => {
      await page.setViewportSize({ width: 1800, height: 1000 });
      await page.goto(`${ORIGIN}/?token=${tokenText}#at=src`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(box(page, 'app').locator('.box-count')).toHaveText('2 files');
      await expect(box(page, 'infra')).toBeVisible();
      await expect(box(page, 'domain')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toHaveCount(0);
    });

    await test.step('2. Settings refuses a blank command, then saves the fake', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings.getByRole('combobox', { name: 'Backend' })).toHaveValue('route');
      await expect(settings.getByRole('textbox', { name: 'Command' })).toHaveValue('');
      await settings.getByRole('combobox', { name: 'Backend' }).selectOption('command');
      await settings.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(settings.locator('.plan-dialog-error')).toHaveText('write a command');
      await expect(settings).toBeVisible();
      expect(fs.existsSync(configPath)).toBe(false);
      await settings.getByRole('textbox', { name: 'Command' }).fill(fakeCommand);
      await settings.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(settings).toHaveCount(0);
      expect(fs.readFileSync(configPath, 'utf8')).toBe(JSON.stringify({ llm: { backend: 'command', command: fakeCommand } }));
    });

    await test.step('3. Generate asks two questions', async () => {
      await page.getByRole('button', { name: 'New plan…' }).click();
      const created = page.getByRole('dialog', { name: 'New plan' });
      await created.getByRole('textbox', { name: 'Name' }).fill('Gate');
      await created.getByRole('button', { name: 'Create' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
      await clickArrow(page, 'src/app', 'src/domain');
      await page.keyboard.press('Delete');
      await expect(arrow(page, 'src/app', 'src/domain')).toHaveCount(0);
      await expect(page.locator('.change-sentence')).toHaveText(['src/app must not import src/domain (1 import)']);
      const dialog = await openTasks(page);
      await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(dialog.locator('output[aria-label="ran"]')).toHaveText(`command: ${fakeCommand}`, LLM);
      await expect(dialog.getByRole('textbox', { name: Q1 })).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: Q2 })).toBeVisible();
      await expect(dialog.locator('.tasks-why')).toHaveText([WHY1, WHY2]);
    });

    await test.step('4. the first prompt carries the plan, the guide and the reply shape', async () => {
      const prompt = promptAt(log, 1);
      expect(linesMatching(prompt, /src\/app must not import src\/domain \(1 import\)/).length).toBeGreaterThanOrEqual(1);
      expect(prompt).toContain('# Our guide');
      expect(linesMatching(prompt, /004-x\.md/).length).toBeGreaterThanOrEqual(1);
      expect(prompt).toContain('src/app/a.ts imports src/app/b.ts, src/domain/model.ts, src/infra/db.ts');
      expect(prompt).toContain('A slice that changes no behaviour says so in its first line and freezes everything else.');
      expect(prompt).toContain('Write one thin slice per logical step.');
      expect(linesMatching(prompt, /^Reply with exactly one JSON object, in a fenced json block\.$/)).toHaveLength(1);
      expect(linesMatching(prompt, /^To ask, reply \{"questions":/).length).toBeGreaterThanOrEqual(1);
      expect(linesMatching(prompt, /^To write, reply \{"slices":/).length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(fs.readFileSync(path.join(log, '1.env.json'), 'utf8'))).toEqual({
        cwd: layered,
        root: layered,
        claudecode: null,
        entrypoint: null,
      });
    });

    await test.step('5. one answer and one blank become three slices', async () => {
      const dialog = tasksOf(page);
      await dialog.getByRole('textbox', { name: Q1 }).fill('Yes, keep it.');
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md'], LLM);
      await expect(bodyOf(dialog, '007-cut-app-domain.md')).toHaveValue('# 007 — Cut app from domain\n\nNo behaviour changes.\n');
      await expect(dialog.getByRole('textbox', { name: 'Brief' })).toHaveValue(BRIEF);
      const prompt = promptAt(log, 2);
      expect(answerUnder(prompt, Q1)).toBe('A: Yes, keep it.');
      expect(answerUnder(prompt, Q2)).toBe('A: your call');
    });

    await test.step('6. moving the last slice up renumbers files and headings', async () => {
      const dialog = tasksOf(page);
      await dialog.getByRole('button', { name: 'Move 007-cut-app-domain.md up' }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-cut-app-domain.md', '007-move-b.md']);
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveValue(/^# 005 — Add the core package\n/);
      await expect(bodyOf(dialog, '006-cut-app-domain.md')).toHaveValue(/^# 006 — Cut app from domain\n/);
      await expect(bodyOf(dialog, '007-move-b.md')).toHaveValue(/^# 007 — Move b into infra\n/);
    });

    await test.step('7. merge joins the bodies, then delete leaves one slice', async () => {
      const dialog = tasksOf(page);
      await dialog.getByRole('button', { name: 'Merge 005-add-core.md with next' }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-move-b.md']);
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveValue(MERGED);
      await dialog.getByRole('button', { name: 'Delete 006-move-b.md' }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md']);
    });

    await test.step('8. Save as files writes the slice and the brief, and Copy command copies the sc line', async () => {
      const dialog = tasksOf(page);
      await dialog.getByRole('button', { name: 'Save as files', exact: true }).click();
      await expect(dialog.locator('output[aria-label="saved"]')).toHaveText(`saved to ${layered}/.bindweed/plans/gate/tasks/`);
      expect(fs.readdirSync(tasksOut).sort()).toEqual(['005-add-core.md']);
      expect(fs.readFileSync(path.join(tasksOut, '005-add-core.md'), 'utf8')).toBe(MERGED);
      expect(fs.readFileSync(briefPath, 'utf8')).toBe(BRIEF);
      await dialog.getByRole('button', { name: 'Copy command', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(sc);
    });

    await test.step('9. a reload keeps the slice and the brief', async () => {
      await reopen(page, tokenText);
      const dialog = await openTasks(page);
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md']);
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveValue(MERGED);
      await expect(dialog.getByRole('textbox', { name: 'Brief' })).toHaveValue(BRIEF);
    });

    await test.step('10. Just write it with a question pending sends the typed answers', async () => {
      await tasksOf(page).getByRole('button', { name: 'Close', exact: true }).click();
      await addNote(page, 'ASK-AGAIN');
      const dialog = await openTasks(page);
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(dialog.getByRole('textbox', { name: Q1 })).toBeVisible(LLM);
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
      await dialog.getByRole('textbox', { name: Q1 }).fill('a');
      await dialog.getByRole('button', { name: 'Just write it', exact: true }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md'], LLM);
      await expect(dialog.locator('.plan-dialog-error')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
      const prompt = promptAt(log, 4);
      expect(answerUnder(prompt, Q1)).toBe('A: a');
      expect(answerUnder(prompt, Q2)).toBe('A: your call');
      expect(linesMatching(prompt, /Reply with slices now\./)).toHaveLength(1);
      const stored = fs.readFileSync(path.join(layered, '.bindweed/plans/gate.json'), 'utf8');
      expect(stored.match(/"answers":\[[^\]]*\]/g)).toEqual(['"answers":["a","your call"]']);
    });

    await test.step('11. a bad reply is retried once, then the slices come back', async () => {
      await tasksOf(page).getByRole('button', { name: 'Close', exact: true }).click();
      await addNote(page, 'BAD-ONCE');
      const dialog = await openTasks(page);
      await dialog.getByRole('button', { name: 'Just write it', exact: true }).click();
      await expect.poll(() => fs.existsSync(path.join(log, '6.prompt')), LLM).toBe(true);
      await expect(dialog.getByText(/running for/)).toHaveCount(0, LLM);
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-move-b.md', '007-cut-app-domain.md']);
      await expect(dialog.locator('.plan-dialog-error')).toHaveCount(0);
      const names = fs.readdirSync(log);
      expect(names).toContain('bad.done');
      for (let n = 1; n <= 6; n += 1) expect(names).toContain(`${n}.prompt`);
      expect(linesMatching(promptAt(log, 6), /Your last reply was not usable: /)).toHaveLength(1);
      expect(linesMatching(promptAt(log, 5), /^A: a$/)).toHaveLength(1);
      expect(linesMatching(promptAt(log, 5), /^To ask, reply/)).toHaveLength(0);
    });

    await test.step('12. rename, split, move down, preview, copy and edit the brief', async () => {
      const dialog = tasksOf(page);
      await replaceField(dialog.getByRole('textbox', { name: 'Title of 005-add-core.md' }), 'Add src/core');
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveValue(RENAMED);
      await expect(sliceFiles(dialog).first()).toHaveText('005-add-core.md');
      await dialog.getByRole('button', { name: 'Split 005-add-core.md' }).click();
      await expect(sliceFiles(dialog)).toHaveText(['005-add-core.md', '006-add-core.md', '007-move-b.md', '008-cut-app-domain.md']);
      await expect(bodyOf(dialog, '006-add-core.md')).toHaveValue('# 006 — Add src/core\n\nCreate src/core.\n');
      await dialog.getByRole('button', { name: 'Move 006-add-core.md down' }).click();
      await expect(sliceFiles(dialog)).toHaveText(FOUR);
      await dialog.getByRole('button', { name: 'Preview 005-add-core.md' }).click();
      const preview = dialog.locator('.tasks-preview');
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveCount(0);
      await expect(preview.locator('h1')).toHaveText('005 — Add src/core');
      await expect(preview.locator('p')).toHaveText('Create src/core.');
      const larger = await preview.locator('h1').evaluate((el) => {
        const para = el.parentElement?.querySelector('p');
        return para !== null && para !== undefined && parseFloat(getComputedStyle(el).fontSize) > parseFloat(getComputedStyle(para).fontSize);
      });
      expect(larger).toBe(true);
      await dialog.getByRole('button', { name: 'Preview 005-add-core.md' }).click();
      await expect(bodyOf(dialog, '005-add-core.md')).toBeVisible();
      await expect(preview).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Copy 008-cut-app-domain.md' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(CUT);
      fs.writeFileSync(path.join(QA, 'copied'), await page.evaluate(() => navigator.clipboard.readText()));
      expect(fs.readFileSync(path.join(QA, 'copied'), 'utf8')).toBe(CUT);
      const command = await dialog.locator('.tasks-command code').innerText();
      expect(command).toBe(sc);
      await replaceField(dialog.getByRole('textbox', { name: 'Brief' }), 'Just cut it.');
      await dialog.getByRole('button', { name: 'Save as files', exact: true }).click();
      await expect(dialog.locator('output[aria-label="saved"]')).toHaveText(`saved to ${layered}/.bindweed/plans/gate/tasks/`);
      expect(fs.readFileSync(briefPath, 'utf8')).toBe('Just cut it.');
      expect(fs.readdirSync(tasksOut).sort()).toEqual(FOUR);
      await expect(dialog.locator('.tasks-command code')).toHaveText(sc);
    });

    await test.step('13. Cancel kills the sleeping fake, and a reload keeps the slices', async () => {
      await tasksOf(page).getByRole('button', { name: 'Close', exact: true }).click();
      await addNote(page, 'SLEEP-NOW');
      const dialog = await openTasks(page);
      await dialog.getByRole('button', { name: 'Just write it', exact: true }).click();
      await expect(dialog.getByText('running for 0 s')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Just write it', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
      await expect(dialog.getByText(/running for [1-9]/)).toBeVisible({ timeout: 6_000 });
      await expect.poll(() => fs.existsSync(path.join(log, 'sleep.pids')), { timeout: 15_000 }).toBe(true);
      const pids = fs
        .readFileSync(path.join(log, 'sleep.pids'), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map(Number);
      expect(pids).toHaveLength(2);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(() => pids.filter(alive), { timeout: 2_000 }).toEqual([]);
      await expect(dialog.locator('.plan-dialog-error')).toHaveText('cancelled', LLM);
      await expect(sliceFiles(dialog)).toHaveText(FOUR);
      await expect(bodyOf(dialog, '005-add-core.md')).toHaveValue(RENAMED);
      await expect(dialog.getByRole('textbox', { name: 'Brief' })).toHaveValue('Just cut it.');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.change-sentence', { hasText: 'SLEEP-NOW' })).toHaveCount(0);
      await expect(box(page, 'domain').locator('[aria-label="note"][title="SLEEP-NOW"]')).toHaveCount(0);
      await reopen(page, tokenText);
      const again = await openTasks(page);
      await expect(sliceFiles(again)).toHaveText(FOUR);
      await expect(bodyOf(again, '005-add-core.md')).toHaveValue(RENAMED);
      await expect(again.getByRole('textbox', { name: 'Brief' })).toHaveValue('Just cut it.');
    });

    await test.step('14. an unusable reply shows the error and the raw output', async () => {
      await tasksOf(page).getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('textbox', { name: 'Command' }).fill('echo nope');
      await settings.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(settings).toHaveCount(0);
      const dialog = await openTasks(page);
      await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(dialog.locator('output[aria-label="ran"]')).toHaveText('command: echo nope', LLM);
      await expect(dialog.locator('.plan-dialog-error')).toHaveText(/^the LLM's reply was not usable: /);
      await expect(dialog.getByRole('region', { name: 'Raw output' })).toContainText('nope');
      await expect(sliceFiles(dialog)).toHaveText(FOUR);
    });

    await test.step('15. stopping bindweed leaves the fixture tree clean', async () => {
      await stopChild(server);
      server = null;
      expect(gitStatus(layered)).toBe('');
      expect(fs.readdirSync(path.join(layered, 'tasks')).sort()).toEqual(['004-x.md', 'README.md']);
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
