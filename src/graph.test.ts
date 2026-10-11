import { describe, expect, it } from 'vitest';
import { cycleTexts, edgePairs, graphView, nodeDetail, type GraphFlags, type GraphView, type NodeDetail } from './domain/graph.ts';
import { emptyHealth, type Health } from './domain/health.ts';
import { applyPlan } from './domain/planned.ts';
import { isTestPath, type ScanResult, type WorkspacePackage } from './domain/scan.ts';

type RawSpec = [from: string, to: string, kind?: 'runtime' | 'type'];

function scanOf(files: string[], edges: RawSpec[], workspaces: WorkspacePackage[] = []): ScanResult {
  return {
    files: files.map(path => ({ path, test: isTestPath(path) })),
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind ?? 'runtime' })),
    externals: [],
    workspaces,
  };
}

const LAYERED = scanOf(
  ['src/app/a.ts', 'src/app/b.ts', 'src/domain/model.ts', 'src/infra/db.ts'],
  [
    ['src/app/a.ts', 'src/app/b.ts'],
    ['src/app/a.ts', 'src/infra/db.ts'],
    ['src/app/a.ts', 'src/domain/model.ts', 'type'],
    ['src/app/b.ts', 'src/app/a.ts'],
    ['src/app/b.ts', 'src/infra/db.ts'],
    ['src/infra/db.ts', 'src/domain/model.ts'],
  ],
);

function view(scan: ScanResult, at: string, rootName = 'repo'): GraphView {
  const found = graphView(scan, at, rootName);
  if (found === null) throw new Error(`no view at ${at}`);
  return found;
}

function viewWith(scan: ScanResult, at: string, flags: GraphFlags): GraphView {
  const found = graphView(scan, at, 'repo', flags);
  if (found === null) throw new Error(`no view at ${at}`);
  return found;
}

function detailOf(scan: ScanResult, id: string, at: string): NodeDetail {
  const found = nodeDetail(scan, id, at, 'repo');
  if (found === null) throw new Error(`no detail for ${id}`);
  return found;
}

describe('isTestPath', () => {
  it('spots test names and test directories', () => {
    expect(isTestPath('src/app/a.test.ts')).toBe(true);
    expect(isTestPath('src/app/a.spec.tsx')).toBe(true);
    expect(isTestPath('src/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/test/a.ts')).toBe(true);
    expect(isTestPath('src/tests/a.ts')).toBe(true);
    expect(isTestPath('src/e2e/a.ts')).toBe(true);
    expect(isTestPath('test/a.ts')).toBe(true);
    expect(isTestPath('tests')).toBe(true);
    expect(isTestPath('src/app/a.ts')).toBe(false);
    expect(isTestPath('src/testing/a.ts')).toBe(false);
    expect(isTestPath('src/app/a.tests.ts')).toBe(false);
  });
});

describe('graph flags, order and detail', () => {
  it('hides tests and externals until the flags say otherwise', () => {
    const scan: ScanResult = {
      files: [
        { path: 'a.ts', test: false },
        { path: 'a.test.ts', test: true },
        { path: 'pkg/a.ts', test: false },
        { path: 'pkg/a.test.ts', test: true },
      ],
      edges: [],
      externals: [
        { from: 'a.ts', name: 'react', kind: 'runtime' },
        { from: 'pkg/a.test.ts', name: 'vitest', kind: 'runtime' },
      ],
      workspaces: [],
    };
    expect(view(scan, '').nodes.map(node => node.id)).toEqual(['a.ts', 'pkg']);
    expect(view(scan, '').edges).toEqual([]);
    const open = viewWith(scan, '', { tests: false, external: true });
    expect(open.nodes.map(node => node.id)).toEqual(['a.ts', 'pkg', 'react']);
    expect(open.edges.map(edge => edge.to)).toEqual(['react']);
  });

  it('orders external nodes by name', () => {
    const src: ScanResult = {
      files: [
        { path: 'a.ts', test: false },
        { path: 'b.ts', test: false },
      ],
      edges: [],
      externals: [
        { from: 'a.ts', name: 'zod', kind: 'runtime' },
        { from: 'b.ts', name: 'react', kind: 'runtime' },
      ],
      workspaces: [],
    };
    const shown = viewWith(src, '', { tests: false, external: true });
    expect(shown.nodes.slice(-2).map(node => node.id)).toEqual(['react', 'zod']);
    expect(shown.nodes.slice(-2).map(node => node.order)).toEqual([0, 1]);
    expect(shown.nodes.slice(-2).every(node => node.row === 1)).toBe(true);
  });

  it('orders detail importedBy entries without files property', () => {
    const detail = detailOf(
      scanOf(
        ['p/b.ts', 'p/a.ts', 'q/c.ts'],
        [
          ['p/b.ts', 'q/c.ts'],
          ['p/a.ts', 'q/c.ts'],
        ],
      ),
      'q/c.ts',
      'q',
    );
    expect(detail.importedBy.map(entry => entry.id)).toEqual(['p/a.ts', 'p/b.ts']);
    expect(detail).not.toHaveProperty('files');
  });

  it('returns missing detail for null id without files property', () => {
    const detail = nodeDetail(LAYERED, null, '', 'repo');
    expect(detail).toEqual({
      id: 'missing',
      name: 'missing',
      path: 'missing',
      kind: 'file',
      imports: [],
      importedBy: [],
    });
    expect(detail).not.toHaveProperty('files');
    expect(detail).not.toHaveProperty('hot');
  });

  it('lists hot functions only for a scanned file', () => {
    const file = detailOf(LAYERED, 'src/domain/model.ts', 'src/domain');
    expect(file.hot).toEqual([]);
    expect(nodeDetail(LAYERED, null, '', 'repo')).not.toHaveProperty('hot');
  });

  it('reads a trailing slash as the directory itself', () => {
    expect(view(LAYERED, 'src/').nodes.map(node => node.id)).toEqual(view(LAYERED, 'src').nodes.map(node => node.id));
  });
});

describe('graphView heritage', () => {
  it('drops a zero heritage count and keeps a positive one', () => {
    const files = [
      { path: 'a.ts', test: false },
      { path: 'b.ts', test: false },
    ];
    const zero = graphView(
      { files, edges: [{ from: 'a.ts', to: 'b.ts', kind: 'runtime', heritage: 0 }], externals: [], workspaces: [] },
      '',
      'repo',
    );
    expect(zero?.edges).toEqual([{ from: 'a.ts', to: 'b.ts', runtime: 1, type: 0, cycle: false }]);
    expect(zero?.edges[0]).not.toHaveProperty('heritage');
    const kept = graphView(
      { files, edges: [{ from: 'a.ts', to: 'b.ts', kind: 'type', heritage: 1 }], externals: [], workspaces: [] },
      '',
      'repo',
    );
    expect(kept?.edges).toEqual([{ from: 'a.ts', to: 'b.ts', runtime: 0, type: 1, heritage: 1, cycle: false }]);
  });
});

describe('graphView over the layered fixture shape', () => {
  it('lays out the root as one package box', () => {
    expect(graphView(LAYERED, '', 'layered')).toEqual({
      at: '',
      crumbs: [{ name: 'layered', at: '' }],
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 4, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' }],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('lays out src in three layers with counted edges', () => {
    expect(graphView(LAYERED, 'src', 'layered')).toEqual({
      at: 'src',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
      ],
      nodes: [
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false, ca: 0, ce: 2, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false, ca: 2, ce: 1, i: '0.33', a: '0.00', d: '0.67', zone: 'pain' },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 2, order: 0, cycle: false, ca: 2, ce: 0, i: '0.00', a: '0.00', d: '1.00', zone: 'pain' },
      ],
      edges: [
        { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
        { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
        { from: 'src/infra', to: 'src/domain', runtime: 1, type: 0, cycle: false },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('marks the app cycle in red with the cycle text on each edge', () => {
    expect(graphView(LAYERED, 'src/app', 'layered')).toEqual({
      at: 'src/app',
      crumbs: [
        { name: 'layered', at: '' },
        { name: 'src', at: 'src' },
        { name: 'app', at: 'src/app' },
      ],
      nodes: [
        { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true, ca: 1, ce: 3, i: '0.75', a: '0.00', d: '0.25' },
        { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true, ca: 1, ce: 2, i: '0.67', a: '0.00', d: '0.33' },
      ],
      edges: [
        { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
        { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
      ],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('accepts a trailing slash on at', () => {
    expect(graphView(LAYERED, 'src/', 'layered')).toEqual(graphView(LAYERED, 'src', 'layered'));
  });

  it('treats a path of slashes as the root view', () => {
    expect(graphView(LAYERED, '///', 'layered')).toEqual(graphView(LAYERED, '', 'layered'));
  });

  it('drops a self edge', () => {
    const scan = scanOf(['src/a.ts'], [['src/a.ts', 'src/a.ts']]);
    expect(view(scan, '').edges).toEqual([]);
  });

  it('drops an edge whose source lies outside the view', () => {
    const scan = scanOf(['main.ts', 'src/app/a.ts'], [['main.ts', 'src/app/a.ts']]);
    const found = view(scan, 'src');
    expect(found.nodes.map(node => node.id)).toEqual(['src/app']);
    expect(found.edges).toEqual([]);
  });

  it('rejects directories without scanned files, files, and escaping paths', () => {
    expect(graphView(LAYERED, 'notes', 'layered')).toBeNull();
    expect(graphView(LAYERED, 'tsconfig.json', 'layered')).toBeNull();
    expect(graphView(LAYERED, 'src/app/a.ts', 'layered')).toBeNull();
    expect(graphView(LAYERED, '..', 'layered')).toBeNull();
    expect(graphView(LAYERED, '/tmp/layered/src', 'layered')).toBeNull();
    expect(graphView(LAYERED, 'src//app', 'layered')).toBeNull();
    expect(graphView(LAYERED, 'src/./app', 'layered')).toBeNull();
  });

  it('keeps test files and their edges out of every view', () => {
    const withTest = scanOf(
      [...LAYERED.files.map(file => file.path), 'src/app/a.test.ts', 'vendor/x.ts'],
      [
        ...LAYERED.edges.map(edge => [edge.from, edge.to, edge.kind] as RawSpec),
        ['src/app/a.test.ts', 'src/app/a.ts'],
        ['src/app/a.ts', 'src/app/a.test.ts'],
        ['src/app/a.test.ts', 'vendor/x.ts'],
        ['vendor/x.ts', 'src/app/a.test.ts'],
      ],
    );
    expect(graphView(withTest, 'src/app', 'layered')).toEqual(graphView(LAYERED, 'src/app', 'layered'));
    expect(view(withTest, '').nodes.map(node => node.id)).toEqual(['src', 'vendor']);
    expect(view(withTest, '').edges).toEqual([]);
    expect(withTest.files).toHaveLength(6);
  });

  it('drops edges to targets no shown node contains', () => {
    const scan = scanOf(
      ['src/a.ts'],
      [
        ['src/a.ts', 'vendor/x.ts'],
        ['src/a.ts', 'gone/y.ts'],
      ],
    );
    expect(view(scan, '')).toEqual({
      at: '',
      crumbs: [{ name: 'repo', at: '' }],
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 1, row: 0, order: 0, cycle: false, ca: 0, ce: 0, i: '–', a: '0.00', d: '–' }],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('shows an empty root view for a repository without scanned files', () => {
    expect(view(scanOf([], []), '')).toEqual({
      at: '',
      crumbs: [{ name: 'repo', at: '' }],
      nodes: [],
      edges: [],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });
});

describe('graphView layers and ordering', () => {
  it('sorts the top row by name regardless of file order', () => {
    const scan = scanOf(['v/z.ts', 'v/a.ts'], []);
    expect(view(scan, 'v').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual(['a.ts@0:0', 'z.ts@0:1']);
  });

  it('averages every neighbour order when placing a row', () => {
    const scan = scanOf(
      ['v/b.ts', 'v/a.ts', 'v/i0.ts', 'v/i1.ts', 'v/i2.ts'],
      [
        ['v/i0.ts', 'v/a.ts'],
        ['v/i1.ts', 'v/a.ts'],
        ['v/i2.ts', 'v/a.ts'],
        ['v/i1.ts', 'v/b.ts'],
        ['v/i2.ts', 'v/b.ts'],
      ],
    );
    expect(view(scan, 'v').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'i0.ts@0:0',
      'i1.ts@0:1',
      'i2.ts@0:2',
      'a.ts@1:0',
      'b.ts@1:1',
    ]);
  });

  it('keeps every link between a row and the row above it', () => {
    const scan = scanOf(
      ['v/b.ts', 'v/z.ts', 'v/i0.ts', 'v/i1.ts'],
      [
        ['v/i0.ts', 'v/z.ts'],
        ['v/i1.ts', 'v/z.ts'],
        ['v/i1.ts', 'v/b.ts'],
      ],
    );
    expect(view(scan, 'v').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'i0.ts@0:0',
      'i1.ts@0:1',
      'z.ts@1:0',
      'b.ts@1:1',
    ]);
  });

  it('ties two files with the same neighbour average by name', () => {
    const scan = scanOf(
      ['v/z.ts', 'v/a.ts', 'v/i0.ts', 'v/i1.ts', 'v/i2.ts'],
      [
        ['v/i0.ts', 'v/z.ts'],
        ['v/i2.ts', 'v/z.ts'],
        ['v/i1.ts', 'v/a.ts'],
      ],
    );
    expect(view(scan, 'v').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'i0.ts@0:0',
      'i1.ts@0:1',
      'i2.ts@0:2',
      'a.ts@1:0',
      'z.ts@1:1',
    ]);
  });

  it('sinks a file with no neighbours above it below the connected files', () => {
    const scan = scanOf(['v/a.ts', 'v/z.ts', 'v/m.ts'], [['v/m.ts', 'v/z.ts']]);
    expect(view(scan, 'v').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'm.ts@0:0',
      'z.ts@1:0',
      'a.ts@1:1',
    ]);
  });

  it('keeps a file cycle in the same row as the file it imports', () => {
    const scan = scanOf(
      ['x/a.ts', 'x/b.ts', 'x/e.ts', 'x/f.ts'],
      [
        ['x/a.ts', 'x/b.ts'],
        ['x/b.ts', 'x/a.ts'],
        ['x/e.ts', 'x/f.ts'],
      ],
    );
    expect(view(scan, 'x').nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'e.ts@0:0',
      'f.ts@1:0',
      'a.ts@1:1',
      'b.ts@1:2',
    ]);
  });

  it('keeps an edge that leaves a file cycle unmarked', () => {
    const scan = scanOf(
      ['x/a.ts', 'x/b.ts', 'x/c.ts'],
      [
        ['x/a.ts', 'x/b.ts'],
        ['x/b.ts', 'x/a.ts'],
        ['x/a.ts', 'x/c.ts'],
      ],
    );
    const found = view(scan, 'x');
    expect(found.nodes.map(node => `${node.name}@${node.row}:${node.order}:${node.cycle}`)).toEqual(['a.ts@0:0:true', 'b.ts@0:1:true', 'c.ts@1:0:false']);
    expect(found.edges).toEqual([
      { from: 'x/a.ts', to: 'x/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
      { from: 'x/a.ts', to: 'x/c.ts', runtime: 1, type: 0, cycle: false },
      { from: 'x/b.ts', to: 'x/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
    ]);
  });

  it('puts a root file above the package it imports', () => {
    const scan = scanOf(['main.ts', 'src/app/a.ts'], [['main.ts', 'src/app/a.ts']]);
    expect(view(scan, '')).toEqual({
      at: '',
      crumbs: [{ name: 'repo', at: '' }],
      nodes: [
        { id: 'main.ts', kind: 'file', name: 'main.ts', path: 'main.ts', row: 0, order: 0, cycle: false, ca: 0, ce: 1, i: '1.00', a: '0.00', d: '0.00' },
        { id: 'src', kind: 'package', name: 'src', path: 'src', files: 1, row: 1, order: 0, cycle: false, ca: 1, ce: 0, i: '0.00', a: '0.00', d: '1.00', zone: 'pain' },
      ],
      edges: [{ from: 'main.ts', to: 'src', runtime: 1, type: 0, cycle: false }],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('orders a row by the barycentre of the row above, not by name', () => {
    const scan = scanOf(
      ['v/a.ts', 'v/b.ts', 'v/x.ts', 'v/y.ts'],
      [
        ['v/a.ts', 'v/y.ts'],
        ['v/b.ts', 'v/x.ts'],
      ],
    );
    const nodes = view(scan, 'v').nodes;
    expect(nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual(['a.ts@0:0', 'b.ts@0:1', 'y.ts@1:0', 'x.ts@1:1']);
  });

  it('breaks barycentre ties by name and sinks unconnected nodes last by name', () => {
    const scan = scanOf(
      ['v/m.ts', 'v/c.ts', 'v/b.ts', 'v/a.ts', 'v/z.ts'],
      [
        ['v/m.ts', 'v/b.ts'],
        ['v/m.ts', 'v/a.ts'],
      ],
    );
    const nodes = view(scan, 'v').nodes;
    expect(nodes.map(node => `${node.name}@${node.row}:${node.order}`)).toEqual([
      'm.ts@0:0',
      'a.ts@1:0',
      'b.ts@1:1',
      'c.ts@1:2',
      'z.ts@1:3',
    ]);
  });

  it('names the shortest cycle through each edge', () => {
    const scan = scanOf(
      ['x/a.ts', 'x/b.ts', 'x/c.ts'],
      [
        ['x/a.ts', 'x/b.ts'],
        ['x/b.ts', 'x/c.ts'],
        ['x/c.ts', 'x/a.ts'],
        ['x/a.ts', 'x/c.ts'],
      ],
    );
    const found = view(scan, 'x');
    expect(found.nodes.map(node => node.cycle)).toEqual([true, true, true]);
    expect(found.edges.map(edge => `${edge.from}->${edge.to}: ${edge.cycleText}`)).toEqual([
      'x/a.ts->x/b.ts: a.ts → b.ts → c.ts → a.ts',
      'x/a.ts->x/c.ts: a.ts → c.ts → a.ts',
      'x/b.ts->x/c.ts: b.ts → c.ts → a.ts → b.ts',
      'x/c.ts->x/a.ts: c.ts → a.ts → c.ts',
    ]);
  });

  it('keeps cross-package cycles red while a collapsed cycle stays hidden', () => {
    const scan = scanOf(
      ['x/a.ts', 'x/b.ts', 'y1/c.ts', 'y2/d.ts'],
      [
        ['x/a.ts', 'x/b.ts'],
        ['x/b.ts', 'x/a.ts'],
        ['y1/c.ts', 'y2/d.ts'],
        ['y2/d.ts', 'y1/c.ts'],
        ['x/a.ts', 'y1/c.ts'],
        ['x/a.ts', 'y2/d.ts'],
      ],
    );
    const found = view(scan, '');
    expect(found.nodes).toEqual([
      { id: 'x', kind: 'package', name: 'x', path: 'x', files: 2, row: 0, order: 0, cycle: false, ca: 0, ce: 1, i: '1.00', a: '0.00', d: '0.00', zone: 'healthy' },
      { id: 'y1', kind: 'package', name: 'y1', path: 'y1', files: 1, row: 1, order: 0, cycle: true, ca: 2, ce: 1, i: '0.33', a: '0.00', d: '0.67', zone: 'pain' },
      { id: 'y2', kind: 'package', name: 'y2', path: 'y2', files: 1, row: 1, order: 1, cycle: true, ca: 2, ce: 1, i: '0.33', a: '0.00', d: '0.67', zone: 'pain' },
    ]);
    expect(found.edges).toEqual([
      { from: 'x', to: 'y1', runtime: 1, type: 0, cycle: false },
      { from: 'x', to: 'y2', runtime: 1, type: 0, cycle: false },
      { from: 'y1', to: 'y2', runtime: 1, type: 0, cycle: true, cycleText: 'y1 → y2 → y1' },
      { from: 'y2', to: 'y1', runtime: 1, type: 0, cycle: true, cycleText: 'y2 → y1 → y2' },
    ]);
  });

  it('aggregates two type imports into a type count of two', () => {
    const scan = scanOf(
      ['p/a.ts', 'p/b.ts', 'q/c.ts'],
      [
        ['p/a.ts', 'q/c.ts', 'type'],
        ['p/b.ts', 'q/c.ts', 'type'],
      ],
    );
    expect(view(scan, '').edges).toEqual([{ from: 'p', to: 'q', runtime: 0, type: 2, cycle: false }]);
  });
});

describe('graphView workspaces', () => {
  const WORKSPACES: WorkspacePackage[] = [
    { dir: 'packages/core', name: '@acme/core' },
    { dir: 'packages/web', name: '@acme/web' },
  ];
  const WORKSPACE_SCAN = scanOf(
    ['packages/core/src/index.ts', 'packages/web/src/index.ts'],
    [['packages/web/src/index.ts', 'packages/core/src/index.ts']],
    WORKSPACES,
  );

  it('keeps the workspace package name on a detail row', () => {
    const detail = nodeDetail(WORKSPACE_SCAN, 'packages/core', '', 'workspace');
    expect(detail?.name).toBe('@acme/core');
    expect(detail?.kind).toBe('package');
    expect(detail).not.toHaveProperty('test');
    const web = nodeDetail(WORKSPACE_SCAN, 'packages/web', '', 'workspace');
    expect(web?.imports).toEqual([{ id: 'packages/core', name: '@acme/core', kind: 'package', runtime: 1, type: 0, heritage: 0 }]);
  });

  it('replaces workspace directories with named boxes at the root', () => {
    expect(graphView(WORKSPACE_SCAN, '', 'workspace')).toEqual({
      at: '',
      crumbs: [{ name: 'workspace', at: '' }],
      nodes: [
        {
          id: 'packages/web',
          kind: 'package',
          name: '@acme/web',
          path: 'packages/web',
          files: 1,
          row: 0,
          order: 0,
          cycle: false,
          ca: 0,
          ce: 1,
          i: '1.00',
          a: '0.00',
          d: '0.00',
          zone: 'healthy',
        },
        {
          id: 'packages/core',
          kind: 'package',
          name: '@acme/core',
          path: 'packages/core',
          files: 1,
          row: 1,
          order: 0,
          cycle: false,
          ca: 1,
          ce: 0,
          i: '0.00',
          a: '0.00',
          d: '1.00',
          zone: 'pain',
        },
      ],
      edges: [{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }],
      crapMax: 4,
      coverage: 'off',
      mutation: 'off',
    });
  });

  it('names a breadcrumb step after the workspace package', () => {
    expect(view(WORKSPACE_SCAN, 'packages/core', 'workspace').crumbs).toEqual([
      { name: 'workspace', at: '' },
      { name: 'packages', at: 'packages' },
      { name: '@acme/core', at: 'packages/core' },
    ]);
  });

  it('keeps files outside any workspace on their own boxes', () => {
    const scan = scanOf(
      ['packages/core/src/index.ts', 'packages/web/src/index.ts', 'root.ts'],
      [['packages/web/src/index.ts', 'packages/core/src/index.ts']],
      WORKSPACES,
    );
    expect(view(scan, '').nodes.map(node => node.id)).toEqual(['packages/web', 'packages/core', 'root.ts']);
  });

  it('matches the longest workspace directory for nested packages', () => {
    const nested = scanOf(
      ['packages/a/nested/x.ts'],
      [],
      [
        { dir: 'packages/a', name: 'a' },
        { dir: 'packages/a/nested', name: 'nested' },
      ],
    );
    expect(view(nested, '').nodes.map(node => node.name)).toEqual(['nested']);
    const reversed = scanOf(
      ['packages/a/nested/x.ts'],
      [],
      [
        { dir: 'packages/a/nested', name: 'nested' },
        { dir: 'packages/a', name: 'a' },
      ],
    );
    expect(view(reversed, '').nodes.map(node => node.name)).toEqual(['nested']);
  });

  it('routes a directory target edge to its workspace box', () => {
    const scan = scanOf(
      ['packages/core/src/index.ts', 'packages/web/src/index.ts'],
      [['packages/web/src/index.ts', 'packages/core']],
      WORKSPACES,
    );
    expect(view(scan, '').edges).toEqual([{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }]);
  });
});

describe('health membership', () => {
  it('scores a file on its own path and not on a longer path that starts with it', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/a.ts', test: false },
        { path: 'src/a.ts/extra.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const health: Health = { ...emptyHealth(), mutation: 'on', mutantCounts: new Map([['src/a.ts', 1], ['src/a.ts/extra.ts', 5]]) };
    const found = graphView(scan, 'src', 'repo', { tests: false, external: false }, health);
    const node = found?.nodes.find(item => item.id === 'src/a.ts');
    expect(node?.kind).toBe('file');
    expect(node?.mutants).toBe(1);
  });

  it('rolls a file up to the package that contains it', () => {
    const packaged: ScanResult = {
      files: [{ path: 'src/app/a.ts', test: false }],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const rolled = graphView(packaged, '', 'repo', { tests: false, external: false }, {
      ...emptyHealth(),
      mutation: 'on',
      mutantCounts: new Map([['src/app/a.ts', 4]]),
    });
    const folder = rolled?.nodes.find(item => item.id === 'src');
    expect(folder?.kind).toBe('package');
    expect(folder?.mutants).toBe(4);
  });

  it('does not list hot functions on a package whose path is also a file', () => {
    const scan: ScanResult = {
      files: [
        { path: 'pkg/child.ts', test: false },
        { path: 'pkg', test: false, functions: [{ name: 'hot', line: 1, endLine: 2, cc: 9 }] },
      ],
      edges: [],
      externals: [],
      workspaces: [],
    };
    const detail = nodeDetail(scan, 'pkg', '', 'repo');
    expect(detail?.kind).toBe('package');
    expect(detail?.hot).toBeUndefined();
  });
});

describe('planned edges in the view', () => {
  const withPlan: ScanResult = { ...LAYERED, planned: [{ from: 'src/infra', to: 'src/app' }] };

  it('draws the added arrow as planned, runs cycle detection on it, and keeps Martin numbers', () => {
    const planned = view(withPlan, 'src');
    const added = planned.edges.find(edge => edge.from === 'src/infra' && edge.to === 'src/app');
    expect(added).toMatchObject({ runtime: 0, type: 0, planned: true, cycle: true, cycleText: 'infra → app → infra' });
    const back = planned.edges.find(edge => edge.from === 'src/app' && edge.to === 'src/infra');
    expect(back).toMatchObject({ runtime: 2, type: 0, cycle: true, cycleText: 'app → infra → app' });
    expect(back?.planned).toBeUndefined();
    expect(planned.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual([
      'src/app->src/domain',
      'src/app->src/infra',
      'src/infra->src/app',
      'src/infra->src/domain',
    ]);
    const app = planned.nodes.find(node => node.id === 'src/app');
    const infra = planned.nodes.find(node => node.id === 'src/infra');
    expect(app).toMatchObject({ cycle: true });
    expect(infra).toMatchObject({ cycle: true });
    const plain = view(LAYERED, 'src');
    expect(planned.nodes.map(node => ({ id: node.id, ca: node.ca, ce: node.ce, i: node.i, a: node.a, d: node.d }))).toEqual(
      plain.nodes.map(node => ({ id: node.id, ca: node.ca, ce: node.ce, i: node.i, a: node.a, d: node.d })),
    );
  });

  it('collapses the planned arrow to self at the root and drops it when drilled', () => {
    expect(view(withPlan, '').edges).toEqual([]);
    expect(view(withPlan, 'src/infra').edges).toEqual([]);
  });

  it('shows the planned arrow between file boxes in a drilled view', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/app/b.ts', test: false },
      ],
      edges: [],
      externals: [],
      workspaces: [],
      planned: [{ from: 'src/app/b.ts', to: 'src/app/a.ts' }],
    };
    const drilled = view(scan, 'src/app');
    expect(drilled.edges).toEqual([{ from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 0, type: 0, planned: true, cycle: false }]);
    expect(view(scan, 'src').edges).toEqual([]);
    const plain = view(LAYERED, 'src');
    expect(plain.edges.every(edge => edge.planned === undefined)).toBe(true);
  });
});

describe('edgePairs', () => {
  it('lists the file pairs behind an arrow, sorted by importer then imported', () => {
    expect(edgePairs(LAYERED, 'src', 'src/app', 'src/domain')).toEqual([['src/app/a.ts', 'src/domain/model.ts']]);
    expect(edgePairs(LAYERED, 'src', 'src/app', 'src/infra')).toEqual([
      ['src/app/a.ts', 'src/infra/db.ts'],
      ['src/app/b.ts', 'src/infra/db.ts'],
    ]);
  });

  it('dedupes a pair that carries both kinds', () => {
    const scan = scanOf(
      ['src/a.ts', 'src/b.ts'],
      [
        ['src/a.ts', 'src/b.ts'],
        ['src/a.ts', 'src/b.ts', 'type'],
      ],
    );
    expect(edgePairs(scan, 'src', 'src/a.ts', 'src/b.ts')).toEqual([['src/a.ts', 'src/b.ts']]);
    expect(edgePairs(scan, '', 'src', 'src')).toEqual([['src/a.ts', 'src/b.ts']]);
  });

  it('follows the tests and external flags', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/app/a.test.ts', test: true },
        { path: 'src/lib/x.ts', test: false },
      ],
      edges: [
        { from: 'src/app/a.test.ts', to: 'src/lib/x.ts', kind: 'runtime' },
        { from: 'src/app/a.ts', to: 'src/lib/x.ts', kind: 'runtime' },
      ],
      externals: [{ from: 'src/app/a.ts', name: 'react', kind: 'runtime' }],
      workspaces: [],
    };
    expect(edgePairs(scan, 'src', 'src/app', 'src/lib')).toEqual([['src/app/a.ts', 'src/lib/x.ts']]);
    expect(edgePairs(scan, 'src', 'src/app', 'src/lib', { tests: true, external: false })).toEqual([
      ['src/app/a.test.ts', 'src/lib/x.ts'],
      ['src/app/a.ts', 'src/lib/x.ts'],
    ]);
    expect(edgePairs(scan, 'src', 'src/app', 'react')).toEqual([]);
    expect(edgePairs(scan, 'src', 'src/app', 'react', { tests: false, external: true })).toEqual([['src/app/a.ts', 'react']]);
    expect(edgePairs(scan, 'src', 'src/lib', 'react', { tests: false, external: true })).toEqual([]);
  });

  it('sorts the pairs by importer then imported', () => {
    const scan: ScanResult = {
      files: [
        { path: 'src/app/a.ts', test: false },
        { path: 'src/app/b.ts', test: false },
        { path: 'src/infra/db.ts', test: false },
        { path: 'src/infra/repo.ts', test: false },
      ],
      edges: [
        { from: 'src/app/b.ts', to: 'src/infra/repo.ts', kind: 'runtime' },
        { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' },
        { from: 'src/app/a.ts', to: 'src/infra/repo.ts', kind: 'runtime' },
      ],
      externals: [],
      workspaces: [],
    };
    expect(edgePairs(scan, 'src', 'src/app', 'src/infra')).toEqual([
      ['src/app/a.ts', 'src/infra/repo.ts'],
      ['src/app/b.ts', 'src/infra/db.ts'],
      ['src/app/b.ts', 'src/infra/repo.ts'],
    ]);
  });

  it('finds no pairs behind a planned arrow', () => {
    const withPlan: ScanResult = { ...LAYERED, planned: [{ from: 'src/infra', to: 'src/app' }] };
    expect(edgePairs(withPlan, 'src', 'src/infra', 'src/app')).toEqual([]);
  });

  it('matches a file arrow in a drilled view', () => {
    expect(edgePairs(LAYERED, 'src/app', 'src/app/a.ts', 'src/app/b.ts')).toEqual([['src/app/a.ts', 'src/app/b.ts']]);
  });
});

describe('graphView over a planned scan', () => {
  it('draws an empty declared package at the root, where a file in it would be grouped', () => {
    const scan: ScanResult = { ...scanOf(['src/a.ts'], []), declared: ['top'] };
    const drawn = view(scan, '');
    expect(drawn.nodes.map(node => node.id).sort()).toEqual(['src', 'top']);
    expect(drawn.nodes.find(node => node.id === 'top')).toMatchObject({ kind: 'package', files: 0 });
  });

  it('draws an empty declared package nested under a declared package that holds a file', () => {
    const scan: ScanResult = { ...scanOf(['src/ports/shape.ts'], []), declared: ['src/ports', 'src/ports/deep'] };
    const drawn = view(scan, 'src/ports');
    expect(drawn.nodes.find(node => node.id === 'src/ports/deep')).toMatchObject({ kind: 'package', files: 0 });
    expect(drawn.nodes.map(node => node.id)).toContain('src/ports/shape.ts');
  });

  it('draws an empty declared package where a file in it would be grouped, and not in its own view', () => {
    const scan: ScanResult = { ...LAYERED, declared: ['src/ports', 'src/app'] };
    expect(view(scan, 'src').nodes.find(node => node.id === 'src/ports')).toMatchObject({ kind: 'package', files: 0, row: 2, order: 1, cycle: false });
    expect(view(scan, 'src').nodes.find(node => node.id === 'src/app')).toMatchObject({ files: 2 });
    expect(view(scan, '').nodes.map(node => node.id)).toEqual(['src']);
    expect(graphView(scan, 'src/ports', 'repo')).toBeNull();
    expect(view(scan, 'src/app').nodes.map(node => node.id)).toEqual(['src/app/a.ts', 'src/app/b.ts']);
  });

  it('keeps the file count of a box an empty declared package groups into', () => {
    const scan: ScanResult = { ...LAYERED, declared: ['src/app/write'] };
    expect(view(scan, 'src').nodes.find(node => node.id === 'src/app')).toMatchObject({ kind: 'package', files: 2 });
    expect(view(scan, 'src/app').nodes.find(node => node.id === 'src/app/write')).toMatchObject({ kind: 'package', files: 0 });
  });

  it('stands the children of a hidden package in its place, at every depth', () => {
    const scan: ScanResult = {
      ...scanOf(['src/app/read/a.ts', 'src/app/write/deep/b.ts', 'src/infra/db.ts'], [['src/app/read/a.ts', 'src/app/write/deep/b.ts']]),
      hidden: ['src/app', 'src/app/write'],
    };
    expect(view(scan, 'src').nodes.map(node => node.id).sort()).toEqual(['src/app/read', 'src/app/write/deep', 'src/infra']);
    expect(view(scan, 'src').edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['src/app/read>src/app/write/deep']);
    expect(view(scan, 'src/app').nodes.map(node => node.id)).toEqual(['src/app/read', 'src/app/write/deep']);
    expect(view(scan, '').nodes.map(node => node.id)).toEqual(['src']);
    expect(edgePairs(scan, 'src', 'src/app/read', 'src/app/write/deep')).toEqual([['src/app/read/a.ts', 'src/app/write/deep/b.ts']]);
  });

  it('marks a deleted file box with its fate', () => {
    const scan: ScanResult = { ...LAYERED, deleted: ['src/domain/model.ts'] };
    expect(view(scan, 'src/domain').nodes[0]).toMatchObject({ id: 'src/domain/model.ts', fate: 'delete' });
    expect(view(LAYERED, 'src/domain').nodes[0]).not.toHaveProperty('fate');
  });

  it('does not mark a parent package or the root when a file inside is deleted', () => {
    const scan: ScanResult = { ...scanOf(['src/domain/model.ts', 'src/domain/shape.ts'], []), deleted: ['src/domain/model.ts'] };
    expect(view(scan, 'src/domain').nodes.find(node => node.id === 'src/domain/model.ts')).toMatchObject({ fate: 'delete' });
    expect(view(scan, 'src').nodes.find(node => node.id === 'src/domain')).not.toHaveProperty('fate');
    expect(view(scan, '').nodes.find(node => node.id === 'src')).not.toHaveProperty('fate');
  });

  it('draws a deleted file and the edges that leave it', () => {
    const scan = applyPlan(
      scanOf(
        ['src/app/a.ts', 'src/app/b.ts', 'src/infra/db.ts'],
        [
          ['src/app/b.ts', 'src/app/a.ts'],
          ['src/app/b.ts', 'src/infra/db.ts'],
        ],
      ),
      [{ kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }],
    );
    expect(view(scan, 'src/app').edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['src/app/b.ts>src/app/a.ts']);
    expect(edgePairs(scan, 'src', 'src/app', 'src/infra')).toEqual([['src/app/b.ts', 'src/infra/db.ts']]);
  });

  it('keeps edges into and out of a deleted file in detail and pairs', () => {
    const scan = applyPlan(
      scanOf(
        ['src/app/a.ts', 'src/app/b.ts'],
        [
          ['src/app/a.ts', 'src/app/b.ts'],
          ['src/app/b.ts', 'src/app/a.ts'],
        ],
      ),
      [{ kind: 'fate', file: 'src/app/b.ts', fate: 'delete' }],
    );
    expect(detailOf(scan, 'src/app/b.ts', 'src/app').imports.map(entry => entry.id)).toEqual(['src/app/a.ts']);
    expect(detailOf(scan, 'src/app/a.ts', 'src/app').imports.map(entry => entry.id)).toEqual(['src/app/b.ts']);
    expect(edgePairs(scan, 'src/app', 'src/app/a.ts', 'src/app/b.ts')).toEqual([['src/app/a.ts', 'src/app/b.ts']]);
  });

  it('draws an external through every hidden package above its file', () => {
    const base: ScanResult = {
      ...scanOf(
        ['src/app/a.ts', 'src/app/sub/b.ts', 'src/app/sub/deep/c.ts', 'src/domain/model.ts'],
        [
          ['src/app/sub/deep/c.ts', 'src/domain/model.ts'],
          ['src/domain/model.ts', 'src/app/sub/deep/c.ts'],
        ],
      ),
      externals: [{ from: 'src/app/sub/deep/c.ts', name: 'react', kind: 'runtime' }],
    };
    const scan = applyPlan(base, [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' },
    ]);
    expect(scan.hidden).toEqual(['src/app', 'src/app/sub']);
    const drawn = viewWith(scan, 'src', { tests: false, external: true });
    expect(drawn.edges.find(edge => edge.to === 'react')).toMatchObject({ from: 'src/app/sub/deep', to: 'react', runtime: 1 });
    const deep = nodeDetail(scan, 'src/app/sub/deep', 'src', 'repo', { tests: false, external: true });
    expect(deep?.imports.map(entry => entry.id)).toEqual(['react', 'src/domain']);
    expect(deep?.importedBy.map(entry => entry.id)).toEqual(['src/domain']);
    expect(edgePairs(scan, 'src', 'src/app/sub/deep', 'react', { tests: false, external: true })).toEqual([['src/app/sub/deep/c.ts', 'react']]);
  });

  it('draws an external through three hidden packages above its file', () => {
    const base: ScanResult = {
      ...scanOf(
        ['src/app/a.ts', 'src/app/sub/b.ts', 'src/app/sub/deep/c.ts', 'src/app/sub/deep/nest/d.ts', 'src/domain/model.ts'],
        [
          ['src/app/sub/deep/nest/d.ts', 'src/domain/model.ts'],
          ['src/domain/model.ts', 'src/app/sub/deep/nest/d.ts'],
        ],
      ),
      externals: [{ from: 'src/app/sub/deep/nest/d.ts', name: 'react', kind: 'runtime' }],
    };
    const scan = applyPlan(base, [
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/deep/c.ts', to: 'src/domain' },
    ]);
    expect(scan.hidden).toEqual(['src/app', 'src/app/sub', 'src/app/sub/deep']);
    const drawn = viewWith(scan, 'src', { tests: false, external: true });
    expect(drawn.nodes.map(node => node.id).sort()).toEqual(['react', 'src/app/sub/deep/nest', 'src/domain']);
    expect(drawn.nodes.find(node => node.id === 'src/app/sub/deep/nest')).toMatchObject({ kind: 'package', files: 1 });
    expect(drawn.edges.filter(edge => edge.to !== 'react').map(edge => `${edge.from}>${edge.to}`).sort()).toEqual([
      'src/app/sub/deep/nest>src/domain',
      'src/domain>src/app/sub/deep/nest',
    ]);
    expect(drawn.edges.find(edge => edge.to === 'react')).toMatchObject({ from: 'src/app/sub/deep/nest', to: 'react', runtime: 1 });
    const nest = nodeDetail(scan, 'src/app/sub/deep/nest', 'src', 'repo', { tests: false, external: true });
    expect(nest?.imports.map(entry => entry.id)).toEqual(['react', 'src/domain']);
    expect(nest?.importedBy.map(entry => entry.id)).toEqual(['src/domain']);
    expect(edgePairs(scan, 'src', 'src/app/sub/deep/nest', 'react', { tests: false, external: true })).toEqual([
      ['src/app/sub/deep/nest/d.ts', 'react'],
    ]);
  });

  it('regroups a planned edge through every hidden package above its file', () => {
    const files = ['src/app/a.ts', 'src/app/sub/b.ts', 'src/app/sub/deep/c.ts', 'src/domain/model.ts'];
    const scan = applyPlan(scanOf(files, []), [
      { kind: 'add-edge', from: 'src/app/sub/deep/c.ts', to: 'src/domain/model.ts' },
      { kind: 'move-file', file: 'src/app/a.ts', to: 'src/domain' },
      { kind: 'move-file', file: 'src/app/sub/b.ts', to: 'src/domain' },
    ]);
    expect(scan.hidden).toEqual(['src/app', 'src/app/sub']);
    expect(scan.planned).toEqual([{ from: 'src/app/sub/deep/c.ts', to: 'src/domain/model.ts' }]);
    const drawn = view(scan, 'src').edges.filter(edge => edge.planned === true);
    expect(drawn.map(edge => `${edge.from}>${edge.to}`)).toEqual(['src/app/sub/deep>src/domain']);
  });

  it('regroups a planned edge after a split hides its package', () => {
    const split = applyPlan(
      {
        ...scanOf(['src/app/a.ts', 'src/app/b.ts'], []),
        planned: [{ from: 'src/app/a.ts', to: 'src/app/b.ts' }],
      },
      [{
        kind: 'split-package',
        package: 'src/app',
        parts: [
          { name: 'read', files: ['src/app/a.ts'] },
          { name: 'write', files: ['src/app/b.ts'] },
        ],
      }],
    );
    const drawn = view(split, 'src');
    expect(drawn.edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['src/app/read>src/app/write']);
    expect(drawn.edges[0]).toMatchObject({ planned: true });
  });

  it('regroups hidden packages in detail and pairs, externals included', () => {
    const scan: ScanResult = {
      ...scanOf(
        ['src/app/read/a.ts', 'src/app/write/b.ts', 'src/infra/db.ts'],
        [
          ['src/app/read/a.ts', 'src/app/write/b.ts'],
          ['src/app/write/b.ts', 'src/app/read/a.ts'],
        ],
      ),
      externals: [{ from: 'src/app/write/b.ts', name: 'react', kind: 'runtime' }],
      hidden: ['src/app'],
    };
    const read = detailOf(scan, 'src/app/read', 'src');
    expect(read.imports.map(entry => entry.id)).toEqual(['src/app/write']);
    expect(read.importedBy.map(entry => entry.id)).toEqual(['src/app/write']);
    const write = nodeDetail(scan, 'src/app/write', 'src', 'repo', { tests: false, external: true });
    expect(write?.imports.map(entry => entry.id)).toEqual(['react', 'src/app/read']);
    expect(edgePairs(scan, 'src', 'src/app/read', 'src/app/write')).toEqual([['src/app/read/a.ts', 'src/app/write/b.ts']]);
    expect(edgePairs(scan, 'src', 'src/app/write', 'react', { tests: false, external: true })).toEqual([['src/app/write/b.ts', 'react']]);
  });
});

describe('cycleTexts', () => {
  it('collects the smaller text of each cycle pair from the root and every directory, once', () => {
    expect(cycleTexts(LAYERED)).toEqual(['a.ts → b.ts → a.ts']);
    const planned: ScanResult = { ...LAYERED, planned: [{ from: 'src/infra', to: 'src/app' }] };
    expect(cycleTexts(planned).sort()).toEqual(['a.ts → b.ts → a.ts', 'app → infra → app']);
    const twice: ScanResult = scanOf(['x/a/p.ts', 'x/a/q.ts', 'y/a/p.ts', 'y/a/q.ts'], [['x/a/p.ts', 'x/a/q.ts'], ['x/a/q.ts', 'x/a/p.ts'], ['y/a/p.ts', 'y/a/q.ts'], ['y/a/q.ts', 'y/a/p.ts']]);
    expect(cycleTexts(twice)).toEqual(['p.ts → q.ts → p.ts']);
    expect(cycleTexts(scanOf(['a.ts'], []))).toEqual([]);
  });

  it('finds a cycle drawn only in a deep directory', () => {
    expect(cycleTexts(scanOf(['w/x/y/z/p.ts', 'w/x/y/z/q.ts'], [['w/x/y/z/p.ts', 'w/x/y/z/q.ts'], ['w/x/y/z/q.ts', 'w/x/y/z/p.ts']]))).toEqual(['p.ts → q.ts → p.ts']);
  });

  it('finds a cycle drawn only at the root', () => {
    expect(cycleTexts(scanOf(['a/p.ts', 'b/q.ts'], [['a/p.ts', 'b/q.ts'], ['b/q.ts', 'a/p.ts']]))).toEqual(['a → b → a']);
  });

  it('finds a cycle drawn only at an intermediate directory', () => {
    expect(cycleTexts(scanOf(['w/x/y/a.ts', 'w/x/z/b.ts'], [['w/x/y/a.ts', 'w/x/z/b.ts'], ['w/x/z/b.ts', 'w/x/y/a.ts']]))).toEqual(['y → z → y']);
  });

  it('leaves out test files', () => {
    expect(cycleTexts(scanOf(['src/a.ts', 'src/a.test.ts'], [['src/a.ts', 'src/a.test.ts'], ['src/a.test.ts', 'src/a.ts']]))).toEqual([]);
  });
});
