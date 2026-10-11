import { describe, expect, it } from 'vitest';
import type { ContractRule, PlanEdit } from './domain/plan.ts';
import { contractRules } from './domain/contract.ts';
import { plannedShape } from './domain/planned.ts';
import type { ScanResult } from './domain/scan.ts';

const LAYERED: ScanResult = {
  files: [
    { path: 'src/app/a.ts', test: false },
    { path: 'src/app/b.ts', test: false },
    { path: 'src/domain/model.ts', test: false },
    { path: 'src/infra/db.ts', test: false },
  ],
  edges: [
    { from: 'src/app/a.ts', to: 'src/app/b.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/app/a.ts', to: 'src/domain/model.ts', kind: 'type' },
    { from: 'src/app/b.ts', to: 'src/app/a.ts', kind: 'runtime' },
    { from: 'src/app/b.ts', to: 'src/infra/db.ts', kind: 'runtime' },
    { from: 'src/infra/db.ts', to: 'src/domain/model.ts', kind: 'runtime' },
  ],
  externals: [],
  workspaces: [],
};

const PACKAGE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const FILE_CUT: PlanEdit = { kind: 'cut-edge', from: 'src/app/a.ts', to: 'src/app/b.ts', files: [['src/app/a.ts', 'src/app/b.ts']] };

const EMPTY_NAMES = ['bindweed:src-domain-does-not-use-src-app', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:src-infra-does-not-use-src-app', 'bindweed:no-circular'];

function withFile(scan: ScanResult, path: string, imports: string[], test = false): ScanResult {
  return {
    ...scan,
    files: [...scan.files, { path, test }],
    edges: [...scan.edges, ...imports.map(to => ({ from: path, to, kind: 'runtime' as const }))],
  };
}

function rulesFor(scan: ScanResult, edits: PlanEdit[], cycles: boolean): ContractRule[] {
  return contractRules(plannedShape(scan, edits), cycles);
}

function namesOf(rules: ContractRule[]): string[] {
  return rules.map(rule => rule.name);
}

function textsOf(rule: ContractRule): string[] {
  return [rule.name, rule.comment, JSON.stringify(rule.from), JSON.stringify(rule.to)];
}

function ruleNamed(rules: ContractRule[], name: string): ContractRule {
  const rule = rules.find(item => item.name === name);
  if (rule === undefined) throw new Error(name);
  return rule;
}

describe('contractRules', () => {
  it('An empty plan freezes the three one-way pairs and cycles', () => {
    expect(rulesFor(LAYERED, [], true)).toEqual([
      { name: 'bindweed:src-domain-does-not-use-src-app', severity: 'error', comment: 'src/domain does not use src/app', from: { path: '^src/domain/' }, to: { path: '^src/app/' } },
      { name: 'bindweed:src-domain-does-not-use-src-infra', severity: 'error', comment: 'src/domain does not use src/infra', from: { path: '^src/domain/' }, to: { path: '^src/infra/' } },
      { name: 'bindweed:src-infra-does-not-use-src-app', severity: 'error', comment: 'src/infra does not use src/app', from: { path: '^src/infra/' }, to: { path: '^src/app/' } },
      { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
    ]);
  });

  it('leaves the cycle rule out when the cruiser file already forbids cycles', () => {
    expect(namesOf(rulesFor(LAYERED, [], false))).toEqual(EMPTY_NAMES.slice(0, 3));
  });

  it('Two cuts give a package rule, a file rule, the remaining direction rules and cycles', () => {
    const rules = rulesFor(LAYERED, [PACKAGE_CUT, FILE_CUT], true);
    expect(namesOf(rules)).toEqual([
      'bindweed:no-src-app-to-src-domain',
      'bindweed:no-src-app-a-ts-to-src-app-b-ts',
      'bindweed:src-domain-does-not-use-src-infra',
      'bindweed:src-infra-does-not-use-src-app',
      'bindweed:no-circular',
    ]);
    expect(rules[0]).toEqual({ name: 'bindweed:no-src-app-to-src-domain', severity: 'error', comment: 'src/app must not import src/domain', from: { path: '^src/app/' }, to: { path: '^src/domain/' } });
    expect(rules[1]).toEqual({
      name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts',
      severity: 'error',
      comment: 'src/app/a.ts must not import src/app/b.ts',
      from: { path: '^src/app/a\\.ts$' },
      to: { path: '^src/app/b\\.ts$' },
    });
  });

  it('A later rename uses the planned paths', () => {
    const rules = rulesFor(
      LAYERED,
      [PACKAGE_CUT, { kind: 'rename-package', from: 'src/domain', to: 'src/core' }, FILE_CUT, { kind: 'rename-file', from: 'src/app/b.ts', to: 'c.ts' }],
      true,
    );
    expect(namesOf(rules)).toEqual([
      'bindweed:no-src-app-to-src-core',
      'bindweed:no-src-app-a-ts-to-src-app-c-ts',
      'bindweed:src-core-does-not-use-src-infra',
      'bindweed:src-infra-does-not-use-src-app',
      'bindweed:no-circular',
    ]);
    expect(ruleNamed(rules, 'bindweed:no-src-app-to-src-core')).toMatchObject({ comment: 'src/app must not import src/core', from: { path: '^src/app/' }, to: { path: '^src/core/' } });
    expect(ruleNamed(rules, 'bindweed:no-src-app-a-ts-to-src-app-c-ts')).toMatchObject({
      comment: 'src/app/a.ts must not import src/app/c.ts',
      from: { path: '^src/app/a\\.ts$' },
      to: { path: '^src/app/c\\.ts$' },
    });
    expect(ruleNamed(rules, 'bindweed:src-core-does-not-use-src-infra')).toMatchObject({ from: { path: '^src/core/' }, to: { path: '^src/infra/' } });
    for (const text of rules.flatMap(textsOf)) {
      expect(text).not.toContain('src/domain');
      expect(text).not.toContain('b.ts');
      expect(text).not.toContain('b\\.ts');
    }
  });

  it.each([
    {
      later: { kind: 'move-file', file: 'src/app/b.ts', to: 'src/infra' } satisfies PlanEdit,
      names: ['bindweed:no-src-app-a-ts-to-src-infra-b-ts', 'bindweed:src-domain-does-not-use-src-app', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:no-circular'],
      from: '^src/app/a\\.ts$',
      to: '^src/infra/b\\.ts$',
    },
    {
      later: {
        kind: 'split-package',
        package: 'src/app',
        parts: [
          { name: 'x', files: ['src/app/a.ts'] },
          { name: 'y', files: ['src/app/b.ts'] },
        ],
      } satisfies PlanEdit,
      names: [
        'bindweed:no-src-app-x-a-ts-to-src-app-y-b-ts',
        'bindweed:src-app-x-does-not-use-src-app-y',
        'bindweed:src-domain-does-not-use-src-app',
        'bindweed:src-domain-does-not-use-src-infra',
        'bindweed:src-infra-does-not-use-src-app',
        'bindweed:no-circular',
      ],
      from: '^src/app/x/a\\.ts$',
      to: '^src/app/y/b\\.ts$',
    },
    {
      later: { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/infra/db.ts' } satisfies PlanEdit,
      names: ['bindweed:no-src-app-a-ts-to-src-infra-db-ts', 'bindweed:src-domain-does-not-use-src-app', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:no-circular'],
      from: '^src/app/a\\.ts$',
      to: '^src/infra/db\\.ts$',
    },
  ])("A later move, split or fold carries the file cut's ends", ({ later, names, from, to }) => {
    const rules = rulesFor(LAYERED, [FILE_CUT, later], true);
    expect(namesOf(rules)).toEqual(names);
    expect(rules[0]).toMatchObject({ from: { path: from }, to: { path: to } });
    for (const rule of rules.filter(item => item.comment.includes(' does not use '))) {
      const [used, user] = rule.comment.split(' does not use ');
      expect(rule).toMatchObject({ from: { path: `^${used}/` }, to: { path: `^${user}/` } });
    }
  });

  it('A cut from a file to a package matches the file exactly and the package by prefix', () => {
    const scan = withFile(LAYERED, 'src/main.ts', ['src/app/a.ts']);
    const rules = rulesFor(scan, [{ kind: 'cut-edge', from: 'src/main.ts', to: 'src/app', files: [['src/main.ts', 'src/app/a.ts']] }], true);
    expect(rules[0]).toEqual({ name: 'bindweed:no-src-main-ts-to-src-app', severity: 'error', comment: 'src/main.ts must not import src/app', from: { path: '^src/main\\.ts$' }, to: { path: '^src/app/' } });
    expect(namesOf(rules.slice(1))).toEqual(EMPTY_NAMES);
  });

  it('A plus in a path is escaped in the pattern and kept in the name', () => {
    const scan = withFile(LAYERED, 'src/c++/plus.ts', ['src/app/a.ts']);
    const rules = rulesFor(scan, [{ kind: 'cut-edge', from: 'src/c++/plus.ts', to: 'src/app/a.ts', files: [['src/c++/plus.ts', 'src/app/a.ts']] }], true);
    expect(rules[0]).toEqual({
      name: 'bindweed:no-src-c++-plus-ts-to-src-app-a-ts',
      severity: 'error',
      comment: 'src/c++/plus.ts must not import src/app/a.ts',
      from: { path: '^src/c\\+\\+/plus\\.ts$' },
      to: { path: '^src/app/a\\.ts$' },
    });
    expect(namesOf(rules.slice(1))).toEqual(EMPTY_NAMES);
  });

  it('escapes every listed regex character and nothing else', () => {
    const odd = 'src/w^$.*+?()[]{}|\\-x';
    const scan = withFile(LAYERED, `${odd}/f.ts`, ['src/app/a.ts']);
    const rules = rulesFor(scan, [], true);
    expect(ruleNamed(rules, `bindweed:src-app-does-not-use-src-w^$-*+?()[]{}|\\-x`)).toMatchObject({
      from: { path: '^src/app/' },
      to: { path: '^src/w\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\\\-x/' },
    });
  });

  it('An edge both ways drops the pair, and a stale, redone or merged-away cut adds no rule', () => {
    expect(namesOf(rulesFor(LAYERED, [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }], true))).toEqual([
      'bindweed:src-domain-does-not-use-src-infra',
      'bindweed:src-infra-does-not-use-src-app',
      'bindweed:no-circular',
    ]);
    const stale: PlanEdit = { kind: 'cut-edge', from: 'src/missing', to: 'src/domain', files: [['src/missing/a.ts', 'src/domain/model.ts']] };
    expect(namesOf(rulesFor(LAYERED, [stale], true))).toEqual(EMPTY_NAMES);
    expect(namesOf(rulesFor(LAYERED, [], true))).toEqual(EMPTY_NAMES);
    expect(namesOf(rulesFor(LAYERED, [PACKAGE_CUT, { kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/core' }], true))).toEqual(['bindweed:no-circular']);
  });

  it('does not repeat a rule two cuts give', () => {
    const second: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/b.ts', 'src/infra/db.ts']] };
    const third: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/infra', files: [['src/app/a.ts', 'src/infra/db.ts']] };
    expect(namesOf(rulesFor(LAYERED, [second, third], true)).filter(name => name === 'bindweed:no-src-app-to-src-infra')).toHaveLength(1);
  });

  it('Test files count both ways, so the gate does not fail on them', () => {
    const scan = withFile(withFile(LAYERED, 'src/infra/db.test.ts', ['src/app/a.ts'], true), 'src/extra/t.test.ts', ['src/infra/db.ts'], true);
    const rules = rulesFor(scan, [PACKAGE_CUT, FILE_CUT], true);
    expect(namesOf(rules)).toEqual(['bindweed:no-src-app-to-src-domain', 'bindweed:no-src-app-a-ts-to-src-app-b-ts', 'bindweed:src-domain-does-not-use-src-infra', 'bindweed:no-circular']);
    expect(JSON.stringify(rules)).not.toContain('extra');
  });

  it('Workspace siblings give one rule, at their own parent only', () => {
    const scan: ScanResult = {
      files: [
        { path: 'packages/core/src/index.ts', test: false },
        { path: 'packages/web/src/index.ts', test: false },
      ],
      edges: [{ from: 'packages/web/src/index.ts', to: 'packages/core/src/index.ts', kind: 'runtime' }],
      externals: [],
      workspaces: [
        { dir: 'packages/core', name: '@acme/core' },
        { dir: 'packages/web', name: '@acme/web' },
      ],
    };
    expect(rulesFor(scan, [], true)).toEqual([
      { name: 'bindweed:packages-core-does-not-use-packages-web', severity: 'error', comment: 'packages/core does not use packages/web', from: { path: '^packages/core/' }, to: { path: '^packages/web/' } },
      { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } },
    ]);
  });

  it('counts a declared package that holds nothing yet, and an added edge on its planned ends', () => {
    const rules = rulesFor(LAYERED, [{ kind: 'create-package', path: 'src/ports' }, { kind: 'add-edge', from: 'src/app', to: 'src/ports' }], true);
    expect(namesOf(rules)).toContain('bindweed:src-ports-does-not-use-src-app');
  });

  it('draws no direction rule from an added edge between a package and one inside it', () => {
    const sub: PlanEdit = { kind: 'create-package', path: 'src/app/sub' };
    const down: PlanEdit = { kind: 'add-edge', from: 'src/app', to: 'src/app/sub' };
    const up: PlanEdit = { kind: 'add-edge', from: 'src/app/sub', to: 'src/app' };
    expect(namesOf(rulesFor(LAYERED, [sub, down], true))).toEqual(EMPTY_NAMES);
    expect(namesOf(rulesFor(LAYERED, [sub, up], true))).toEqual(EMPTY_NAMES);
  });

  it('ignores a cut whose ends meet after a merge, and a cut between nested ends', () => {
    const nested: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/app/b.ts', files: [['src/app/a.ts', 'src/app/b.ts']] };
    expect(namesOf(rulesFor(LAYERED, [nested], true))).toEqual(EMPTY_NAMES);
  });
});
