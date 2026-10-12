import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { spawn, spawnSync, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ensureUiBuilt } from './ensure-ui.ts';

const BW = process.cwd();
const PORT = 5200;
const PORT2 = 5201;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ORIGIN2 = `http://127.0.0.1:${PORT2}`;
const PACKAGE_CUT = 'bindweed:no-src-app-to-src-domain';
const FILE_CUT = 'bindweed:no-src-app-a-ts-to-src-app-b-ts';
const DOMAIN_INFRA = 'bindweed:src-domain-does-not-use-src-infra';
const INFRA_APP = 'bindweed:src-infra-does-not-use-src-app';
const NO_CIRCULAR = 'bindweed:no-circular';
const FOUR = [PACKAGE_CUT, FILE_CUT, DOMAIN_INFRA, INFRA_APP];
const FIVE = [...FOUR, NO_CIRCULAR];
const ROWS = [
  `src/app must not import src/domain ${PACKAGE_CUT}`,
  `src/app/a.ts must not import src/app/b.ts ${FILE_CUT}`,
  `src/domain does not use src/infra ${DOMAIN_INFRA}`,
  `src/infra does not use src/app ${INFRA_APP}`,
  `No circular dependencies ${NO_CIRCULAR}`,
];
const TWO_CUTS = [
  { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] },
  { kind: 'cut-edge', from: 'src/app/a.ts', to: 'src/app/b.ts', files: [['src/app/a.ts', 'src/app/b.ts']] },
];
const REFUSAL = "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array";

type PlanBody = {
  edits: unknown[];
  redo: unknown[];
  contract?: { rules: { name: string }[] };
};

function exactName(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function waitForLines(child: ChildProcess, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let err = '';
    const onData = (chunk: Buffer) => {
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
      else reject(new Error(`Process exited with code ${code} before emitting ${count} lines: ${buf}${err}`));
    });
  });
}

function stopChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGINT'): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on('exit', (code) => resolve(code));
    child.kill(signal);
  });
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  return env;
}

function requestHttp(urlStr: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout GET ${urlStr}`)));
    req.on('error', reject);
    req.end();
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function commitFixture(dir: string): void {
  execSync(
    'git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture',
    { cwd: dir },
  );
}

function gitStatus(dir: string): string {
  return execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
}

async function startServer(cwd: string, port: number): Promise<{ child: ChildProcess; token: string }> {
  const child = spawn(process.execPath, [path.join(BW, 'src/cli.ts'), '--port', String(port)], {
    cwd,
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = await waitForLines(child, 2);
  const match = new RegExp(`^bindweed: http://127\\.0\\.0\\.1:${port}/\\?token=([0-9a-f]{32})$`).exec(lines[0]);
  expect(match).not.toBeNull();
  expect(lines[1]).toBe(`serving ${cwd}`);
  return { child, token: match?.[1] ?? '' };
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await requestHttp(url, bearer(token));
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as T;
}

function box(page: Page, name: string): Locator {
  return page.locator('.box:not(.ghost)').filter({ has: page.locator('.box-name', { hasText: exactName(name) }) });
}

function arrow(page: Page, from: string, to: string): Locator {
  return page.locator(`g.arrow[data-from="${from}"][data-to="${to}"]`);
}

function sentences(page: Page): Locator {
  return page.locator('aside[aria-label="changes"] .change-sentence');
}

function panel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Contract' });
}

function diff(page: Page): Locator {
  return panel(page).locator('section[aria-label="diff"] pre');
}

function tick(page: Page, name: string): Locator {
  return panel(page).getByRole('checkbox', { name, exact: true });
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

async function cutArrow(page: Page, from: string, to: string): Promise<void> {
  await clickArrow(page, from, to);
  await page.keyboard.press('Delete');
  await expect(arrow(page, from, to)).toHaveCount(0);
}

async function doubleClickBox(page: Page, name: string): Promise<void> {
  const before = page.url();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await box(page, name).locator('.box-name').dblclick();
    try {
      await expect(page).not.toHaveURL(before, { timeout: 1500 });
      return;
    } catch {
      await expect(box(page, name)).toBeVisible();
    }
  }
  throw new Error(`double-click did not leave ${before}`);
}

async function crumb(page: Page, name: string): Promise<void> {
  await page.locator('nav[aria-label="breadcrumb"] button', { hasText: exactName(name) }).click();
}

async function openContract(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Contract', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.contract-rules li')).toHaveText(ROWS);
}

async function expectTicks(page: Page, unticked: string[]): Promise<void> {
  for (const name of FIVE) {
    if (unticked.includes(name)) await expect(tick(page, name)).not.toBeChecked();
    else await expect(tick(page, name)).toBeChecked();
  }
}

async function copied(page: Page): Promise<string> {
  await panel(page).getByRole('button', { name: 'Copy', exact: true }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function allowClipboard(context: BrowserContext, origin: string): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function expectInOrder(text: string, names: string[]): void {
  const at = names.map((name) => text.indexOf(`name: '${name}'`));
  expect(at.every((index) => index >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
}

test('qa: a plan becomes a dependency contract', async ({ page, context }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  ensureUiBuilt(BW);

  const QA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-')));
  const COPY = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-qa-copy-')));
  const layered = path.join(QA, 'layered');
  const copyLayered = path.join(COPY, 'layered');
  const cruiser = path.join(copyLayered, '.dependency-cruiser.cjs');
  fs.cpSync(path.join(BW, 'qa/fixtures/layered'), layered, { recursive: true });
  commitFixture(layered);
  await allowClipboard(context, ORIGIN);
  await allowClipboard(context, ORIGIN2);

  let active: ChildProcess | null = null;
  let text = '';
  let token2 = '';

  try {
    const first = await startServer(layered, PORT);
    active = first.child;
    const token = first.token;
    const planUrl = `${ORIGIN}/api/plans/gate`;

    await test.step('step 2: plans, graph, pairs and a clean tree', async () => {
      expect(await getJson(`${ORIGIN}/api/plans`, token)).toEqual({ plans: [] });
      const graph = await getJson<{ nodes: { id: string; files?: number }[] }>(`${ORIGIN}/api/graph?at=src`, token);
      expect(graph).not.toHaveProperty('contract');
      const files = Object.fromEntries(graph.nodes.map((node) => [node.id, node.files]));
      expect(files['src/app']).toBe(2);
      expect(files['src/infra']).toBe(1);
      expect(files['src/domain']).toBe(1);
      expect(await getJson(`${ORIGIN}/api/pairs?from=src/app&to=src/domain&at=src`, token)).toEqual({
        pairs: [['src/app/a.ts', 'src/domain/model.ts']],
      });
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('step 3: create Gate', async () => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(`${ORIGIN}/?token=${token}#at=src`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src`);
      await expect(box(page, 'app')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Contract', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'New plan…' }).click();
      const dialog = page.getByRole('dialog', { name: 'New plan' });
      await dialog.getByRole('textbox', { name: 'Name' }).fill('Gate');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
      await expect(page.getByRole('radiogroup', { name: 'Shown graph' }).getByLabel('Planned')).toBeChecked();
      await expect(page.getByRole('button', { name: 'Contract', exact: true })).toBeVisible();
      await expect(box(page, 'app').locator('.box-count')).toHaveText('2 files');
      await expect(box(page, 'infra').locator('.box-count')).toHaveText('1 file');
      await expect(box(page, 'domain').locator('.box-count')).toHaveText('1 file');
    });

    await test.step('step 4: cut app → domain and a.ts → b.ts', async () => {
      await cutArrow(page, 'src/app', 'src/domain');
      await doubleClickBox(page, 'app');
      await expect(page).toHaveURL(`${ORIGIN}/#at=src/app&plan=gate`);
      await cutArrow(page, 'src/app/a.ts', 'src/app/b.ts');
      await crumb(page, 'src');
      await expect(sentences(page)).toHaveText([
        'src/app must not import src/domain (1 import)',
        'src/app/a.ts must not import src/app/b.ts (1 import)',
      ]);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
    });

    await test.step('step 5: the panel lists five rules and the diff adds them', async () => {
      await openContract(page);
      await expectTicks(page, []);
      await expect(panel(page).getByRole('checkbox', { name: 'bindweed:src-domain-does-not-use-src-app' })).toHaveCount(0);
      await expect(diff(page)).toContainText(`name: '${NO_CIRCULAR}'`);
      const plus = (await diff(page).innerText()).split('\n').filter((line) => line.startsWith('+')).join('\n');
      for (const name of FIVE) expect(plus).toContain(`name: '${name}'`);
      expect(plus).toContain("tsConfig: { fileName: 'tsconfig.json' }");
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
    });

    await test.step('step 6: unticking no-circular drops it from the diff only', async () => {
      await tick(page, NO_CIRCULAR).uncheck();
      await expect(diff(page)).not.toContainText(NO_CIRCULAR);
      await expect(diff(page)).toContainText(PACKAGE_CUT);
      expect(await getJson<PlanBody>(planUrl, token)).not.toHaveProperty('contract');
      expect(fs.existsSync(path.join(layered, '.dependency-cruiser.cjs'))).toBe(false);
    });

    await test.step('step 7: Save to plan stores four rules', async () => {
      await panel(page).getByRole('button', { name: 'Save to plan', exact: true }).click();
      await expect(panel(page)).toHaveCount(0);
      await expect
        .poll(async () => (await getJson<PlanBody>(planUrl, token)).contract?.rules.map((rule) => rule.name))
        .toEqual(FOUR);
      expect((await getJson<PlanBody>(planUrl, token)).edits).toEqual(TWO_CUTS);
    });

    await test.step('step 8: a cut and Undo keep the saved contract', async () => {
      await cutArrow(page, 'src/infra', 'src/domain');
      await expect(sentences(page)).toHaveCount(3);
      await page.locator('aside[aria-label="changes"]').getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(sentences(page)).toHaveCount(2);
      await expect.poll(async () => (await getJson<PlanBody>(planUrl, token)).redo).toEqual([
        { kind: 'cut-edge', from: 'src/infra', to: 'src/domain', files: [['src/infra/db.ts', 'src/domain/model.ts']] },
      ]);
      const plan = await getJson<PlanBody>(planUrl, token);
      expect(plan.edits).toEqual(TWO_CUTS);
      expect(plan.contract?.rules.map((rule) => rule.name)).toEqual(FOUR);
      await openContract(page);
      await expectTicks(page, [NO_CIRCULAR]);
    });

    await test.step('step 9: tick no-circular, Copy, and Save', async () => {
      await tick(page, NO_CIRCULAR).check();
      await expect(diff(page)).toContainText(NO_CIRCULAR);
      text = await copied(page);
      await panel(page).getByRole('button', { name: 'Save to plan', exact: true }).click();
      await expect(panel(page)).toHaveCount(0);
      expectInOrder(text, FIVE);
      expect(count(text, "severity: 'error'")).toBe(5);
      for (const option of ['doNotFollow', 'tsPreCompilationDeps', 'tsConfig']) expect(text).toContain(option);
      expect(text.endsWith('\n};\n')).toBe(true);
      await expect
        .poll(async () => (await getJson<PlanBody>(planUrl, token)).contract?.rules.map((rule) => rule.name))
        .toEqual(FIVE);
      expect((await getJson<PlanBody>(planUrl, token)).edits).toEqual(TWO_CUTS);
      expect(gitStatus(layered)).toBe('');
    });

    await test.step('step 10: reload keeps the ticks; Close and Escape close', async () => {
      await page.goto(`${ORIGIN}/?token=${token}#at=src&plan=gate`);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
      await expect(box(page, 'app')).toBeVisible();
      await openContract(page);
      await expectTicks(page, []);
      await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
      await expect(panel(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
      await openContract(page);
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${ORIGIN}/#at=src&plan=gate`);
    });

    await test.step('step 11: depcruise fails the imports the plan cuts', async () => {
      fs.cpSync(layered, copyLayered, { recursive: true });
      fs.writeFileSync(cruiser, text);
      const run = spawnSync('npx', ['--prefix', BW, 'depcruise', '--config', '.dependency-cruiser.cjs', 'src'], {
        cwd: copyLayered,
        encoding: 'utf8',
        env: cleanEnv(),
      });
      expect(run.status).toBe(3);
      const stdout = run.stdout.replace(/\u001b\[[0-9;]*m/g, '');
      expect(stdout).toContain(`error ${PACKAGE_CUT}: src/app/a.ts → src/domain/model.ts`);
      expect(stdout).toContain(`error ${FILE_CUT}: src/app/a.ts → src/app/b.ts`);
      expect(stdout).toContain(`error ${NO_CIRCULAR}:`);
      expect(stdout).toContain('x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised.');
      expect(stdout).not.toContain('db.ts');
      expect(stdout).not.toContain('does-not-use');
    });

    await test.step('step 12: merging the merged file again gives the same file', async () => {
      await stopChild(first.child, 'SIGINT');
      active = null;
      const second = await startServer(copyLayered, PORT2);
      active = second.child;
      token2 = second.token;
      await page.goto(`${ORIGIN2}/?token=${token2}#at=src&plan=gate`);
      await expect(box(page, 'app')).toBeVisible();
      await openContract(page);
      await expectTicks(page, []);
      await expect(diff(page)).toHaveText('--- a/.dependency-cruiser.cjs\n+++ b/.dependency-cruiser.cjs');
      expect(await copied(page)).toBe(text);
    });

    await test.step('step 13: a spread forbidden is refused with a snippet', async () => {
      await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
      const spread = 'const base = [];\nmodule.exports = { forbidden: [...base] };\n';
      fs.writeFileSync(cruiser, spread);
      await page.goto(`${ORIGIN2}/?token=${token2}#at=src&plan=gate`);
      await expect(box(page, 'app')).toBeVisible();
      await openContract(page);
      await expect(panel(page).getByText(REFUSAL, { exact: true })).toBeVisible();
      const snippet = panel(page).locator('section[aria-label="snippet"] pre');
      await expect(snippet).toBeVisible();
      await expect(panel(page).locator('section[aria-label="diff"]')).toHaveCount(0);
      const copiedSnippet = await copied(page);
      expect(copiedSnippet.split('\n').slice(0, 2)).toEqual(['    {', `      name: '${PACKAGE_CUT}',`]);
      expect(count(copiedSnippet, "name: 'bindweed:")).toBe(5);
      expect(fs.readFileSync(cruiser, 'utf8')).toBe(spread);
    });

    await test.step('step 14: finish and clean up', async () => {
      await stopChild(active!, 'SIGINT');
      active = null;
      expect(fs.existsSync(path.join(layered, '.dependency-cruiser.cjs'))).toBe(false);
      expect(gitStatus(layered)).toBe('');
    });
  } finally {
    if (active !== null) await stopChild(active, 'SIGKILL');
    fs.rmSync(QA, { recursive: true, force: true });
    fs.rmSync(COPY, { recursive: true, force: true });
  }
});
