import { describe, expect, it } from 'vitest';
import { graphView, type GraphView } from './domain/graph.ts';
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
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 4, row: 0, order: 0, cycle: false }],
      edges: [],
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
        { id: 'src/app', kind: 'package', name: 'app', path: 'src/app', files: 2, row: 0, order: 0, cycle: false },
        { id: 'src/infra', kind: 'package', name: 'infra', path: 'src/infra', files: 1, row: 1, order: 0, cycle: false },
        { id: 'src/domain', kind: 'package', name: 'domain', path: 'src/domain', files: 1, row: 2, order: 0, cycle: false },
      ],
      edges: [
        { from: 'src/app', to: 'src/domain', runtime: 0, type: 1, cycle: false },
        { from: 'src/app', to: 'src/infra', runtime: 2, type: 0, cycle: false },
        { from: 'src/infra', to: 'src/domain', runtime: 1, type: 0, cycle: false },
      ],
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
        { id: 'src/app/a.ts', kind: 'file', name: 'a.ts', path: 'src/app/a.ts', row: 0, order: 0, cycle: true },
        { id: 'src/app/b.ts', kind: 'file', name: 'b.ts', path: 'src/app/b.ts', row: 0, order: 1, cycle: true },
      ],
      edges: [
        { from: 'src/app/a.ts', to: 'src/app/b.ts', runtime: 1, type: 0, cycle: true, cycleText: 'a.ts → b.ts → a.ts' },
        { from: 'src/app/b.ts', to: 'src/app/a.ts', runtime: 1, type: 0, cycle: true, cycleText: 'b.ts → a.ts → b.ts' },
      ],
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
      nodes: [{ id: 'src', kind: 'package', name: 'src', path: 'src', files: 1, row: 0, order: 0, cycle: false }],
      edges: [],
    });
  });

  it('shows an empty root view for a repository without scanned files', () => {
    expect(view(scanOf([], []), '')).toEqual({
      at: '',
      crumbs: [{ name: 'repo', at: '' }],
      nodes: [],
      edges: [],
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
        { id: 'main.ts', kind: 'file', name: 'main.ts', path: 'main.ts', row: 0, order: 0, cycle: false },
        { id: 'src', kind: 'package', name: 'src', path: 'src', files: 1, row: 1, order: 0, cycle: false },
      ],
      edges: [{ from: 'main.ts', to: 'src', runtime: 1, type: 0, cycle: false }],
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
      { id: 'x', kind: 'package', name: 'x', path: 'x', files: 2, row: 0, order: 0, cycle: false },
      { id: 'y1', kind: 'package', name: 'y1', path: 'y1', files: 1, row: 1, order: 0, cycle: true },
      { id: 'y2', kind: 'package', name: 'y2', path: 'y2', files: 1, row: 1, order: 1, cycle: true },
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

  it('replaces workspace directories with named boxes at the root', () => {
    expect(graphView(WORKSPACE_SCAN, '', 'workspace')).toEqual({
      at: '',
      crumbs: [{ name: 'workspace', at: '' }],
      nodes: [
        { id: 'packages/web', kind: 'package', name: '@acme/web', path: 'packages/web', files: 1, row: 0, order: 0, cycle: false },
        { id: 'packages/core', kind: 'package', name: '@acme/core', path: 'packages/core', files: 1, row: 1, order: 0, cycle: false },
      ],
      edges: [{ from: 'packages/web', to: 'packages/core', runtime: 1, type: 0, cycle: false }],
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
