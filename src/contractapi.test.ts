import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PlanEdit } from './domain/plan.ts';
import { prepareBindweed } from './repo.ts';
import { bindApp, listenErrorMessage } from './serve.ts';

const WORKER = process.env.STRYKER_MUTATOR_WORKER;
const PORT_BASE = 22300 + 70 * (WORKER === undefined ? 0 : Number(WORKER) + 1);
const FIXTURES = join(process.cwd(), 'qa', 'fixtures');
const DEPCRUISE = join(process.cwd(), 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
const CRUISER = '.dependency-cruiser.cjs';
const HEADER = '--- a/.dependency-cruiser.cjs\n+++ b/.dependency-cruiser.cjs\n';
const REFUSAL = "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array";

const PACKAGE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const FILE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app/a.ts', to: 'src/app/b.ts', files: [['src/app/a.ts', 'src/app/b.ts']] };
const EMPTY_NAMES = ['bindweed:src-domain-does-not-use-src-app', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:src-infra-does-not-use-src-app', 'bindweed:no-circular'];
const FIVE_NAMES = [
  'bindweed:no-src-app-to-src-domain',
  'bindweed:no-src-app-a-ts-to-src-app-b-ts',
  'bindweed:src-domain-does-not-use-src-infra',
  'bindweed:src-infra-does-not-use-src-app',
  'bindweed:no-circular',
];

const CIRCULAR_TEXT = `    {
      name: 'bindweed:no-circular',
      severity: 'error',
      comment: 'No circular dependencies',
      from: {},
      to: { circular: true }
    }`;

const CANONICAL = `module.exports = {
  forbidden: [
    {
      name: 'bindweed:no-src-app-to-src-domain',
      severity: 'error',
      comment: 'src/app must not import src/domain',
      from: { path: '^src/app/' },
      to: { path: '^src/domain/' }
    },
    {
      name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts',
      severity: 'error',
      comment: 'src/app/a.ts must not import src/app/b.ts',
      from: { path: '^src/app/a\\\\.ts$' },
      to: { path: '^src/app/b\\\\.ts$' }
    },
    {
      name: 'bindweed:src-domain-does-not-use-src-infra',
      severity: 'error',
      comment: 'src/domain does not use src/infra',
      from: { path: '^src/domain/' },
      to: { path: '^src/infra/' }
    },
    {
      name: 'bindweed:src-infra-does-not-use-src-app',
      severity: 'error',
      comment: 'src/infra does not use src/app',
      from: { path: '^src/infra/' },
      to: { path: '^src/app/' }
    },
${CIRCULAR_TEXT}
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' }
  }
};
`;

const WORKSPACE_TEXT = `module.exports = {
  forbidden: [
    {
      name: 'bindweed:packages-core-does-not-use-packages-web',
      severity: 'error',
      comment: 'packages/core does not use packages/web',
      from: { path: '^packages/core/' },
      to: { path: '^packages/web/' }
    },
${CIRCULAR_TEXT}
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true
  }
};
`;

const KEEP_ME = `// kept
module.exports = {
  forbidden: [
    {
      name: 'keep-me',
      severity: 'warn',
      from: {},
      to: { path: '^keep' }
    }
  ],
  options: { doNotFollow: { path: 'node_modules' }, extra: true }
};
`;

const CYCLES_KEPT = `module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies allowed',
      from: {},
      to: { circular: true }
    }
  ]
};
`;

const OLD_RULES = `const note = 'leave me';
module.exports = {
  forbidden: [
    // made by bindweed
    {
      name: 'bindweed:old',
      severity: 'error',
      comment: 'gone',
      from: {},
      to: { circular: true }
    },
    {
      name: 'keep-me',
      severity: 'warn',
      from: {},
      to: { path: '^keep' }
    },
    { name: 'bindweed:older', severity: 'error', comment: 'gone too', from: {}, to: { path: '^x' } }
  ],
  options: { note }
};
`;

type Bound = { server: Server; port: number; token: string };

type Hit = { status: number; body: Buffer };

const ruleSchema = z.object({ name: z.string(), severity: z.string(), comment: z.string(), from: z.record(z.string(), z.unknown()), to: z.record(z.string(), z.unknown()) });
const rulesBody = z.object({ rules: z.array(ruleSchema) });
const mergedBody = z.object({ text: z.string(), diff: z.string() }).strict();
const refusedBody = z.object({ error: z.string(), snippet: z.string() }).strict();
const loose = z.record(z.string(), z.unknown());

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function fixtureRepo(fixture: string): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'bw-contract-')), fixture);
  await cp(join(FIXTURES, fixture), root, { recursive: true });
  git(root, 'init', '-q', '--template=');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', 'commit', '-qm', 'fixture');
  await prepareBindweed(root);
  return root;
}

async function boundOn(repoRoot: string, port: number): Promise<Bound> {
  const result = await bindApp({ repoRoot, uiDir: '/nowhere' }, { mode: 'fixed', port });
  if ('error' in result) throw new Error(listenErrorMessage(result.error));
  return result;
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, 'close');
}

function hit(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(8000, () => req.destroy(new Error(`no response to ${method} ${path}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function directionText(user: string, used: string): string {
  return `    {\n      name: 'bindweed:src-${user}-does-not-use-src-${used}',\n      severity: 'error',\n      comment: 'src/${user} does not use src/${used}',\n      from: { path: '^src/${user}/' },\n      to: { path: '^src/${used}/' }\n    }`;
}

function json(res: Hit): unknown {
  return JSON.parse(res.body.toString());
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

type Server5 = {
  root: string;
  app: Bound;
  bearer: Record<string, string>;
  read(path: string): Promise<Hit>;
  call(method: string, path: string, body: unknown): Promise<Hit>;
  plan(edits: PlanEdit[], extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
  rules(): Promise<z.infer<typeof ruleSchema>[]>;
  names(): Promise<string[]>;
  merge(names: string[]): Promise<unknown>;
};

function serverFor(fixture: string, port: number): () => Server5 {
  const world: { root: string; app?: Bound; base: Record<string, unknown> } = { root: '', base: {} };
  beforeAll(async () => {
    world.root = await fixtureRepo(fixture);
    world.app = await boundOn(world.root, port);
  });
  afterAll(async () => {
    if (world.app !== undefined) await closeServer(world.app.server);
    await rm(dirname(world.root), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return () => {
    const app = world.app;
    if (app === undefined) throw new Error('not bound');
    const bearer = { Authorization: `Bearer ${app.token}` };
    const view: Server5 = {
      root: world.root,
      app,
      bearer,
      read: path => hit(app.port, 'GET', path, bearer),
      call: (method, path, body) => hit(app.port, method, path, { ...bearer, 'Content-Type': 'application/json' }, JSON.stringify(body)),
      async plan(edits, extra = {}) {
        if (!(await exists(join(world.root, '.bindweed', 'plans', 'gate.json')))) {
          world.base = loose.parse(json(await view.call('POST', '/api/plans', { name: 'Gate' })));
        }
        const doc = { ...world.base, edits, redo: [], ...extra };
        const put = await view.call('PUT', '/api/plans/gate', doc);
        expect(put.status).toBe(200);
        return doc;
      },
      async rules() {
        const res = await view.read('/api/plans/gate/contract');
        expect(res.status).toBe(200);
        return rulesBody.parse(json(res)).rules;
      },
      async names() {
        return (await view.rules()).map(rule => rule.name);
      },
      async merge(names) {
        const res = await view.call('POST', '/api/plans/gate/contract', { names });
        expect(res.status).toBe(200);
        return json(res);
      },
    };
    return view;
  };
}

function mergedText(body: unknown): string {
  return mergedBody.parse(body).text;
}

function cruise(dir: string): { status: number | null; stdout: string } {
  const run = spawnSync(process.execPath, [DEPCRUISE, '--config', CRUISER, 'src'], { cwd: dir, encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout };
}

async function cruiseCopy(root: string, text: string): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'bw-cruise-')), 'cruise');
  await mkdir(dir, { recursive: true });
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  await cp(join(root, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  await writeFile(join(dir, CRUISER), text);
  return dir;
}

describe('the contract route over the layered fixture', () => {
  const world = serverFor('layered', PORT_BASE);

  beforeEach(async () => {
    await rm(join(world().root, CRUISER), { force: true });
  });

  it('An empty plan freezes the three one-way pairs and cycles', async () => {
    await world().plan([]);
    expect(await world().rules()).toEqual([
      { name: 'bindweed:src-domain-does-not-use-src-app', severity: 'error', comment: 'src/domain does not use src/app', from: { path: '^src/domain/' }, to: { path: '^src/app/' } },
      { name: 'bindweed:src-domain-does-not-use-src-infra', severity: 'error', comment: 'src/domain does not use src/infra', from: { path: '^src/domain/' }, to: { path: '^src/infra/' } },
      { name: 'bindweed:src-infra-does-not-use-src-app', severity: 'error', comment: 'src/infra does not use src/app', from: { path: '^src/infra/' }, to: { path: '^src/app/' } },
      { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
    ]);
  });

  it('A later rename uses the planned paths', async () => {
    await world().plan([PACKAGE_CUT, { kind: 'rename-package', from: 'src/domain', to: 'src/core' }, FILE_CUT, { kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }]);
    expect(await world().names()).toEqual([
      'bindweed:no-src-app-to-src-core',
      'bindweed:no-src-app-a-ts-to-src-app-c-ts',
      'bindweed:src-core-does-not-use-src-infra',
      'bindweed:src-infra-does-not-use-src-app',
      'bindweed:no-circular',
    ]);
  });

  it("A later move, split or fold carries the file cut's ends", async () => {
    await world().plan([FILE_CUT, { kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' }]);
    expect((await world().rules())[0]).toMatchObject({ name: 'bindweed:no-src-app-a-ts-to-src-infra-b-ts', from: { path: '^src/app/a\\.ts$' }, to: { path: '^src/infra/b\\.ts$' } });
  });

  it('An edge both ways drops the pair, and a stale, redone or merged-away cut adds no rule', async () => {
    await world().plan([{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }]);
    expect(await world().names()).toEqual(['bindweed:src-domain-does-not-use-src-infra', 'bindweed:src-infra-does-not-use-src-app', 'bindweed:no-circular']);
    await world().plan([{ kind: 'cut-edge', from: 'src/missing', to: 'src/domain', files: [['src/missing/a.ts', 'src/domain/model.ts']] }]);
    expect(await world().names()).toEqual(EMPTY_NAMES);
    await world().plan([], { redo: [PACKAGE_CUT] });
    expect(await world().names()).toEqual(EMPTY_NAMES);
    await world().plan([PACKAGE_CUT, { kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/core' }]);
    expect(await world().names()).toEqual(['bindweed:no-circular']);
  });

  it('Two cuts preview the canonical file and do not touch the repo', async () => {
    await world().plan([PACKAGE_CUT, FILE_CUT]);
    expect(await world().names()).toEqual(FIVE_NAMES);
    const first = await world().merge(FIVE_NAMES.toReversed());
    expect(mergedText(first)).toBe(CANONICAL);
    const diff = mergedBody.parse(first).diff;
    expect(diff.startsWith(HEADER)).toBe(true);
    expect(diff).toContain("+      name: 'bindweed:no-src-app-to-src-domain',");
    expect(await exists(join(world().root, CRUISER))).toBe(false);
    expect(git(world().root, 'status', '--porcelain')).toBe('');
    expect(await world().merge(FIVE_NAMES.toReversed())).toEqual(first);
  });

  it('ignores names it did not generate and accepts an empty list', async () => {
    await world().plan([]);
    expect(mergedText(await world().merge(['bindweed:no-circular', 'nope']))).toContain('bindweed:no-circular');
    expect(mergedText(await world().merge([]))).toContain('  forbidden: [],\n');
  });

  it('A kept rule and its options stay byte for byte', async () => {
    await world().plan([]);
    await writeFile(join(world().root, CRUISER), KEEP_ME);
    const merged = mergedText(await world().merge(['bindweed:no-circular']));
    expect(merged).toBe(KEEP_ME.replace("      to: { path: '^keep' }\n    }\n", `      to: { path: '^keep' }\n    },\n${CIRCULAR_TEXT}\n`));
    expect(await readFile(join(world().root, CRUISER), 'utf8')).toBe(KEEP_ME);
    await writeFile(join(world().root, CRUISER), merged);
    expect(await world().merge(['bindweed:no-circular'])).toEqual({ text: merged, diff: HEADER });
  });

  it('An existing circular rule leaves bindweed:no-circular out', async () => {
    await world().plan([]);
    await writeFile(join(world().root, CRUISER), CYCLES_KEPT);
    expect(await world().names()).toEqual(EMPTY_NAMES.slice(0, 3));
    const merged = mergedText(await world().merge([...EMPTY_NAMES.slice(0, 3), 'bindweed:no-circular']));
    expect(merged).toBe(CYCLES_KEPT.replace('    }\n  ]', `    },\n${[directionText('domain', 'app'), directionText('domain', 'infra'), directionText('infra', 'app')].join(',\n')}\n  ]`));
  });

  it('Old bindweed rules are removed with what sits in front of them, and do not leave cycles out', async () => {
    await world().plan([]);
    await writeFile(join(world().root, CRUISER), OLD_RULES);
    expect(await world().names()).toContain('bindweed:no-circular');
    const merged = mergedText(await world().merge(['bindweed:no-circular']));
    expect(merged).not.toContain('bindweed:old');
    expect(merged).not.toContain('made by bindweed');
    await writeFile(join(world().root, CRUISER), merged);
    expect(mergedText(await world().merge(['bindweed:no-circular']))).toBe(merged);
  });

  it('An empty forbidden array and an export default keep the other bytes', async () => {
    await world().plan([]);
    await writeFile(join(world().root, CRUISER), 'module.exports = {\n  forbidden: [],\n  options: { extra: 1 }\n};\n');
    expect(mergedText(await world().merge(['bindweed:no-circular']))).toBe(`module.exports = {\n  forbidden: [\n${CIRCULAR_TEXT}\n  ],\n  options: { extra: 1 }\n};\n`);
  });

  it.each([
    'const base = [];\nmodule.exports = { forbidden: [...base] };\n',
    'const base = [];\nmodule.exports = { forbidden: base };\n',
    'function make() { return []; }\nmodule.exports = { forbidden: make() };\n',
    'const rule = {};\nmodule.exports = { forbidden: [rule] };\n',
    'module.exports = { options: {} };\n',
    'module.exports = {\n',
  ])('A forbidden list we cannot read is refused, and the file stays', async source => {
    await world().plan([]);
    await writeFile(join(world().root, CRUISER), source);
    expect(refusedBody.parse(await world().merge(['bindweed:no-circular']))).toEqual({ error: REFUSAL, snippet: `${CIRCULAR_TEXT}\n` });
    expect(await readFile(join(world().root, CRUISER), 'utf8')).toBe(source);
    expect(await world().merge([])).toEqual({ error: REFUSAL, snippet: '' });
  });

  it('A cut from a file to a package matches the file exactly and the package by prefix', async () => {
    await writeFile(join(world().root, 'src', 'main.ts'), "import { a } from './app/a';\nexport const main = a;\n");
    try {
      expect((await world().call('POST', '/api/rescan', {})).status).toBe(200);
      await world().plan([{ kind: 'cut-edge', from: 'src/main.ts', to: 'src/app', files: [['src/main.ts', 'src/app/a.ts']] }]);
      const rules = await world().rules();
      expect(rules[0]).toEqual({ name: 'bindweed:no-src-main-ts-to-src-app', severity: 'error', comment: 'src/main.ts must not import src/app', from: { path: '^src/main\\.ts$' }, to: { path: '^src/app/' } });
      expect(rules.slice(1).map(rule => rule.name)).toEqual(EMPTY_NAMES);
    } finally {
      await rm(join(world().root, 'src', 'main.ts'));
      await world().call('POST', '/api/rescan', {});
    }
  });

  it('A plus in a path is escaped in the pattern and kept in the name', async () => {
    await mkdir(join(world().root, 'src', 'c++'), { recursive: true });
    await writeFile(join(world().root, 'src', 'c++', 'plus.ts'), "import { a } from '../app/a';\nexport const plus = a;\n");
    try {
      await world().call('POST', '/api/rescan', {});
      await world().plan([{ kind: 'cut-edge', from: 'src/c++/plus.ts', to: 'src/app/a.ts', files: [['src/c++/plus.ts', 'src/app/a.ts']] }]);
      const rules = await world().rules();
      expect(rules[0]).toEqual({
        name: 'bindweed:no-src-c++-plus-ts-to-src-app-a-ts',
        severity: 'error',
        comment: 'src/c++/plus.ts must not import src/app/a.ts',
        from: { path: '^src/c\\+\\+/plus\\.ts$' },
        to: { path: '^src/app/a\\.ts$' },
      });
      expect(rules.slice(1).map(rule => rule.name)).toEqual(EMPTY_NAMES);
    } finally {
      await rm(join(world().root, 'src', 'c++'), { recursive: true });
      await world().call('POST', '/api/rescan', {});
    }
  });

  it('A 005 or 006 plan file loads with no contract, and a bad contract is refused', async () => {
    const plans = join(world().root, '.bindweed', 'plans');
    const raw = JSON.stringify({
      version: 1,
      name: 'Split app',
      slug: 'split-app',
      createdAt: '2026-10-01T00:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      edits: [
        { kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' },
        { kind: 'rename-package', from: 'src/domain', to: 'src/core' },
      ],
      redo: [],
    });
    await writeFile(join(plans, 'split-app.json'), raw);
    try {
      const doc = loose.parse(json(await world().read('/api/plans/split-app')));
      expect(doc).toEqual(JSON.parse(raw));
      expect(Object.keys(doc)).not.toContain('contract');
      const graph = await world().read('/api/graph?at=src&plan=split-app');
      expect(graph.status).toBe(200);
      expect(loose.parse(json(graph))).toMatchObject({ stale: [null, null] });
      expect(graph.body.toString()).not.toContain('contract');
      const list = await world().read('/api/plans');
      expect(list.body.toString()).not.toContain('contract');
      expect(list.body.toString()).toContain('"slug":"split-app","editCount":2');
      const badRule = { name: 'no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };
      expect(await world().call('PUT', '/api/plans/split-app', { ...doc, contract: { rules: [badRule] } })).toMatchObject({ status: 400 });
      expect(await readFile(join(plans, 'split-app.json'), 'utf8')).toBe(raw);
      const extra = await world().call('PUT', '/api/plans/split-app', { ...doc, extra: 1 });
      expect([extra.status, json(extra)]).toEqual([400, { error: 'bad plan' }]);
    } finally {
      await rm(join(plans, 'split-app.json'));
    }
  });

  it('Save stores the chosen rules and an empty list is not absence', async () => {
    await world().plan([PACKAGE_CUT, FILE_CUT]);
    const rules = await world().rules();
    await world().plan([PACKAGE_CUT, FILE_CUT], { contract: { rules } });
    expect(loose.parse(json(await world().read('/api/plans/gate'))).contract).toEqual({ rules });
    expect((await world().read('/api/plans')).body.toString()).toContain('"slug":"gate","editCount":2');
    await world().plan([PACKAGE_CUT, FILE_CUT], { contract: { rules: [] } });
    const doc = loose.parse(json(await world().read('/api/plans/gate')));
    expect(doc.contract).toEqual({ rules: [] });
    expect(doc.edits).toEqual([PACKAGE_CUT, FILE_CUT]);
    expect(await exists(join(world().root, CRUISER))).toBe(false);
  });

  it('The old routes still answer on this tree', async () => {
    await world().plan([]);
    const tree = z.object({ entries: z.array(z.object({ name: z.string() })) }).parse(json(await world().read('/api/tree')));
    expect(tree.entries.map(entry => entry.name)).toEqual(['notes', 'src', 'tsconfig.json']);
    const model = await readFile(join(world().root, 'src/domain/model.ts'), 'utf8');
    expect((await world().read('/api/file?path=src/domain/model.ts')).body.toString()).toBe(JSON.stringify({ path: 'src/domain/model.ts', text: model }));
    const body = loose.parse(json(await world().read('/api/graph?at=src')));
    expect(Object.keys(body)).not.toContain('contract');
    expect(Object.keys(body)).not.toContain('stale');
    expect(Object.keys(body)).not.toContain('warnings');
    const view = z.object({ nodes: z.array(z.object({ id: z.string(), files: z.number().optional() })), edges: z.array(z.object({ from: z.string(), to: z.string() })) }).parse(body);
    expect(view.nodes.map(node => [node.id, node.files])).toEqual(expect.arrayContaining([['src/app', 2], ['src/infra', 1], ['src/domain', 1]]));
    expect(view.edges.map(edge => `${edge.from}>${edge.to}`).sort()).toEqual(['src/app>src/domain', 'src/app>src/infra', 'src/infra>src/domain']);
    const top = z.object({ nodes: z.array(z.object({ id: z.string(), files: z.number().optional() })) }).parse(json(await world().read('/api/graph')));
    expect(top.nodes.map(node => [node.id, node.files])).toEqual([['src', 4]]);
    expect((await world().read('/api/detail?id=src/domain&at=src')).status).toBe(200);
    expect(json(await world().read('/api/pairs?from=src/app&to=src/domain&at=src'))).toEqual({ pairs: [['src/app/a.ts', 'src/domain/model.ts']] });
    expect(json(await world().read('/api/layout'))).toEqual({ version: 1, views: {}, settings: { tests: false, external: false } });
    expect(loose.parse(json(await world().call('POST', '/api/rescan', {})))).toMatchObject({ files: 4 });
    expect(git(world().root, 'status', '--porcelain')).toBe('');
  });

  it.each<{ method: string; path: string; headers: Record<string, string>; body: string | undefined; status: number; answer: unknown; token?: boolean }>([
    { method: 'GET', path: '/api/plans/gate/contract', headers: {}, body: undefined, status: 401, answer: { error: 'missing or wrong token' } },
    { method: 'POST', path: '/api/plans/gate/contract', headers: {}, body: undefined, status: 401, answer: { error: 'missing or wrong token' } },
    { method: 'GET', path: '/api/plans/gate/contract', headers: { Host: 'evil.example:5000' }, body: undefined, status: 403, answer: { error: 'bad host' }, token: true },
    { method: 'POST', path: '/api/plans/gate/contract', headers: {}, body: '{"names":"no"}', status: 400, answer: { error: 'bad contract' }, token: true },
    { method: 'POST', path: '/api/plans/gate/contract', headers: {}, body: '{"names":[],"extra":1}', status: 400, answer: { error: 'bad contract' }, token: true },
    { method: 'POST', path: '/api/plans/gate/contract', headers: {}, body: 'not json', status: 400, answer: { error: 'bad contract' }, token: true },
    { method: 'POST', path: '/api/plans/nope/contract', headers: {}, body: '{"names":"no"}', status: 404, answer: { error: 'no such plan' }, token: true },
    { method: 'GET', path: '/api/plans/Gate/contract', headers: {}, body: undefined, status: 404, answer: { error: 'no such plan' }, token: true },
    { method: 'PUT', path: '/api/plans/gate/contract', headers: {}, body: '{"names":[]}', status: 404, answer: { error: 'not found' }, token: true },
    { method: 'GET', path: '/api/plans/gate/contract/extra', headers: {}, body: undefined, status: 404, answer: { error: 'not found' }, token: true },
    { method: 'GET', path: '/api/plans/x/api/plans/gate/contract', headers: {}, body: undefined, status: 404, answer: { error: 'not found' }, token: true },
    { method: 'GET', path: '/api/plans/gate/nope', headers: {}, body: undefined, status: 404, answer: { error: 'not found' }, token: true },
    { method: 'GET', path: '/api/graph?at=src', headers: {}, body: undefined, status: 401, answer: { error: 'missing or wrong token' } },
  ])('The new route refuses what it cannot answer, and the guards still hold', async row => {
    await world().plan([]);
    const auth = row.token === true ? world().bearer : {};
    const res = await hit(world().app.port, row.method, row.path, { ...auth, ...row.headers }, row.body);
    expect([res.status, json(res)]).toEqual([row.status, row.answer]);
  });

  it('The canonical text fails the imports the plan cuts', async () => {
    const dir = await cruiseCopy(world().root, CANONICAL);
    try {
      const run = cruise(dir);
      expect(run.status).toBe(3);
      expect(run.stdout).toContain('  error bindweed:no-src-app-to-src-domain: src/app/a.ts → src/domain/model.ts');
      expect(run.stdout).toContain('  error bindweed:no-src-app-a-ts-to-src-app-b-ts: src/app/a.ts → src/app/b.ts');
      expect(run.stdout).toContain('error bindweed:no-circular:');
      expect(run.stdout).toContain('x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised.');
      expect(run.stdout).not.toContain('db.ts');
      expect(run.stdout).not.toContain('does-not-use');
    } finally {
      await rm(dirname(dir), { recursive: true, force: true });
    }
  });

  it('Test files count both ways, so the gate does not fail on them', async () => {
    const root = world().root;
    await writeFile(join(root, 'src', 'infra', 'db.test.ts'), "import { a } from '../app/a';\nexport const t = a;\n");
    await mkdir(join(root, 'src', 'extra'), { recursive: true });
    await writeFile(join(root, 'src', 'extra', 't.test.ts'), "import { query } from '../infra/db';\nexport const t = query;\n");
    try {
      await world().call('POST', '/api/rescan', {});
      await world().plan([PACKAGE_CUT, FILE_CUT]);
      const names = await world().names();
      expect(names).toEqual(['bindweed:no-src-app-to-src-domain', 'bindweed:no-src-app-a-ts-to-src-app-b-ts', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:no-circular']);
      expect(names.join(' ')).not.toContain('extra');
      const dir = await cruiseCopy(root, mergedText(await world().merge(names)));
      try {
        const run = cruise(dir);
        expect(run.status).toBe(3);
        expect(run.stdout).toContain('x 3 dependency violations (3 errors, 0 warnings). 6 modules, 8 dependencies cruised.');
        expect(run.stdout).not.toContain('db.test.ts');
        expect(run.stdout).not.toContain('t.test.ts');
      } finally {
        await rm(dirname(dir), { recursive: true, force: true });
      }
    } finally {
      await rm(join(root, 'src', 'infra', 'db.test.ts'));
      await rm(join(root, 'src', 'extra'), { recursive: true });
      await world().call('POST', '/api/rescan', {});
    }
  });
});

describe('the contract route over the workspace fixture', () => {
  const world = serverFor('workspace', PORT_BASE + 1);

  it('Workspace siblings give one rule, and a repo with no tsconfig omits tsConfig', async () => {
    await world().plan([]);
    expect(await world().rules()).toEqual([
      { name: 'bindweed:packages-core-does-not-use-packages-web', severity: 'error', comment: 'packages/core does not use packages/web', from: { path: '^packages/core/' }, to: { path: '^packages/web/' } },
      { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
    ]);
    expect(mergedText(await world().merge(['bindweed:packages-core-does-not-use-packages-web', 'bindweed:no-circular']))).toBe(WORKSPACE_TEXT);
    const empty = WORKSPACE_TEXT.slice(0, WORKSPACE_TEXT.indexOf('  forbidden: [')) + '  forbidden: [],\n' + WORKSPACE_TEXT.slice(WORKSPACE_TEXT.indexOf('  ],\n') + 5);
    expect(mergedText(await world().merge([]))).toBe(empty);
  });
});
