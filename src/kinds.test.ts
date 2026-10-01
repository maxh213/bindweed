import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { graphView, nodeDetail, type GraphNode, type GraphView } from './domain/graph.ts';
import type { ScanResult } from './domain/scan.ts';
import { scanRepo } from './scan.ts';

const made: string[] = [];

const GAPS: Record<string, string> = {
  'bare/class.ts': 'class Bare { n = 1 }\n',
  'bare/anon.ts': 'export default class { n = 1 }\n',
  'bare/fn.ts': 'export default function () { return; }\n',
  'bare/enum.ts': 'export enum E { A }\n',
  'bare/mod.ts': 'module "bag" { export type Id = string }\n',
  'bare/break.ts': 'export const { a } = { a: 1 };\n',
  'bare/expr.ts': '1;\n',
  'bare/empty.ts': '\n',
  'bare/decl.ts': 'declare class Foo {}\n',
  'paren/shape.ts': 'export class Shape { n = 1 }\n',
  'paren/repo.ts': 'import { Shape } from "./shape";\nexport class Repo extends (Shape) { n = 2 }\n',
  'shade/shape.ts': 'export class Shape { n = 1 }\n',
  'shade/repo.ts': 'namespace ns { export class Local { n = 0 } }\nimport * as ns from "./shape";\nexport class Repo implements ns.Shape { n = 1 }\n',
  'loop/self.ts': 'import { self } from "./self";\nexport const self = 1;\n',
  'eq/eq.ts': 'export = 1;\n',
  'eq/repo.ts': 'import type eq = require("./eq");\nexport const n = eq;\n',
  'bad/both.ts': 'export const n = 1;\n',
  'bad/out.ts': 'export { n } from foo;\n',
  'hid/a.ts': 'export const a = 1;\n',
  'hid/a.test.ts': "import { a } from './a';\nimport x from 'vitest';\nexport const t = a;\nvoid x;\n",
  'hid/use.ts': "import { t } from './a.test';\nexport const u = t;\n",
  'ext/repo.ts': "import type { Shape } from 'node:fs';\nexport class Repo implements Shape { n = 1 }\n",
};

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bw-kinds-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, text);
  }
  return root;
}

afterAll(async () => {
  await Promise.all(made.map(dir => rm(dir, { recursive: true, force: true })));
});

function viewAt(scan: ScanResult, at: string): GraphView {
  const found = graphView(scan, at, 'kinds');
  if (found === null) throw new Error(at);
  return found;
}

function nodeIds(view: GraphView | null): string[] {
  if (view === null) throw new Error('view');
  return view.nodes.map(node => node.id);
}

function nodeNames(view: GraphView | null): string[] {
  if (view === null) throw new Error('view');
  return view.nodes.map(node => node.name);
}

function edgeList(view: GraphView | null): GraphView['edges'] {
  if (view === null) throw new Error('view');
  return view.edges;
}

function detailImports(detail: ReturnType<typeof nodeDetail>): NonNullable<ReturnType<typeof nodeDetail>>['imports'] {
  if (detail === null) throw new Error('detail');
  return detail.imports;
}

function abstractFlag(node: GraphNode): true | undefined {
  if (node.kind === 'external') return undefined;
  return node.abstract;
}

function namedAbstract(nodes: GraphNode[], name: string): true | undefined {
  const node = nodes.find(item => item.name === name);
  if (node === undefined) return undefined;
  return abstractFlag(node);
}

function restUnmarked(nodes: GraphNode[], name: string): boolean {
  return nodes.filter(item => item.name !== name).every(item => abstractFlag(item) === undefined);
}

describe('scan gaps', () => {
  it('covers heritage that is not an edge and files that are not abstract', async () => {
    const root = await makeRepo(GAPS);
    const scan = scanRepo(root, Object.keys(GAPS));
    const again = scanRepo(root, Object.keys(GAPS));
    expect(again).toEqual(scan);
    const paren = viewAt(scan, 'paren');
    expect(paren.edges).toEqual([{ from: 'paren/repo.ts', to: 'paren/shape.ts', runtime: 1, type: 0, cycle: false }]);
    const shade = viewAt(scan, 'shade');
    expect(shade.edges).toEqual([{ from: 'shade/repo.ts', to: 'shade/shape.ts', runtime: 1, type: 0, cycle: false }]);
    const bare = viewAt(scan, 'bare');
    expect(namedAbstract(bare.nodes, 'decl.ts')).toBe(true);
    expect(restUnmarked(bare.nodes, 'decl.ts')).toBe(true);
    const eq = viewAt(scan, 'eq');
    expect(eq.edges).toEqual([{ from: 'eq/repo.ts', to: 'eq/eq.ts', runtime: 0, type: 1, cycle: false }]);
    expect(viewAt(scan, 'bad').edges).toEqual([]);
    const ext = viewAt(scan, 'ext');
    expect(ext.edges).toEqual([]);
    const shown = graphView(scan, 'ext', 'kinds', { tests: false, external: true });
    expect(edgeList(shown)).toEqual([{ from: 'ext/repo.ts', to: 'node:fs', runtime: 0, type: 1, heritage: 1, cycle: false }]);
  });

  it('hides a test file and its external until tests are on', () => {
    const scan: ScanResult = {
      files: [
        { path: 'hid/a.ts', test: false },
        { path: 'hid/a.test.ts', test: true },
        { path: 'hid/use.ts', test: false },
      ],
      edges: [
        { from: 'hid/a.test.ts', to: 'hid/a.ts', kind: 'runtime' },
        { from: 'hid/use.ts', to: 'hid/a.test.ts', kind: 'runtime' },
      ],
      externals: [{ from: 'hid/a.test.ts', name: 'vitest', kind: 'runtime', heritage: 1 }],
      workspaces: [],
    };
    const hidden = graphView(scan, 'hid', 'kinds', { tests: false, external: true });
    expect(nodeIds(hidden)).toEqual(['hid/a.ts', 'hid/use.ts']);
    expect(edgeList(hidden)).toEqual([]);
    const quiet = nodeDetail(scan, 'hid/a.ts', 'hid', 'kinds', { tests: false, external: true });
    expect(detailImports(quiet)).toEqual([]);
    expect(quiet?.importedBy).toEqual([]);
    const open = graphView(scan, 'hid', 'kinds', { tests: true, external: true });
    expect(nodeNames(open).sort()).toEqual(['a.test.ts', 'a.ts', 'use.ts', 'vitest']);
    expect(edgeList(open)).toContainEqual({ from: 'hid/a.test.ts', to: 'vitest', runtime: 1, type: 0, heritage: 1, cycle: false });
    expect(nodeDetail(scan, 'hid/a.test.ts', 'hid', 'kinds', { tests: false, external: true })).toBeNull();
    const self: ScanResult = {
      files: [{ path: 'self.ts', test: false, abstract: true }],
      edges: [{ from: 'self.ts', to: 'self.ts', kind: 'runtime', heritage: 1 }],
      externals: [],
      workspaces: [],
    };
    expect(detailImports(nodeDetail(self, 'self.ts', '', 'kinds'))).toEqual([]);
    expect(nodeDetail(self, 'nope', '', 'kinds')).toBeNull();
    expect(nodeDetail(self, 'self.ts', 'missing', 'kinds')).toBeNull();
    expect(graphView(self, 'missing', 'kinds')).toBeNull();
  });
});
