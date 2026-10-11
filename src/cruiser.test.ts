import { describe, expect, it } from 'vitest';
import { readCruiser } from './cruiser.ts';
import type { ContractRule } from './domain/plan.ts';

const REFUSAL = "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array";
const HEADER = '--- a/.dependency-cruiser.cjs\n+++ b/.dependency-cruiser.cjs\n';

const CIRCULAR: ContractRule = { name: 'bindweed:no-circular', severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };

const FIVE: ContractRule[] = [
  { name: 'bindweed:no-src-app-to-src-domain', severity: 'error', comment: 'src/app must not import src/domain', from: { path: '^src/app/' }, to: { path: '^src/domain/' } },
  {
    name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts',
    severity: 'error',
    comment: 'src/app/a.ts must not import src/app/b.ts',
    from: { path: '^src/app/a\\.ts$' },
    to: { path: '^src/app/b\\.ts$' },
  },
  { name: 'bindweed:src-domain-does-not-use-src-infra', severity: 'error', comment: 'src/domain does not use src/infra', from: { path: '^src/domain/' }, to: { path: '^src/infra/' } },
  { name: 'bindweed:src-infra-does-not-use-src-app', severity: 'error', comment: 'src/infra does not use src/app', from: { path: '^src/infra/' }, to: { path: '^src/app/' } },
  CIRCULAR,
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

function textOf(source: string | null, rules: ContractRule[], tsconfig = true): string {
  const preview = readCruiser(source).preview(rules, tsconfig);
  if (!('text' in preview)) throw new Error(preview.error);
  return preview.text;
}

function diffOf(source: string | null, rules: ContractRule[]): string {
  const preview = readCruiser(source).preview(rules, true);
  if (!('diff' in preview)) throw new Error(preview.error);
  return preview.diff;
}

describe('readCruiser().preview with no file', () => {
  it('Two cuts preview the canonical file', () => {
    expect(textOf(null, FIVE)).toBe(CANONICAL);
    expect(diffOf(null, FIVE).startsWith(`${HEADER}@@ -0,0 +1,44 @@\n+module.exports = {\n`)).toBe(true);
    expect(diffOf(null, FIVE)).toContain("+      name: 'bindweed:no-src-app-to-src-domain',\n");
    expect(textOf(null, FIVE)).toBe(textOf(null, FIVE));
  });

  it('drops tsConfig without a tsconfig.json and writes an empty list as []', () => {
    expect(textOf(null, [], false)).toBe("module.exports = {\n  forbidden: [],\n  options: {\n    doNotFollow: { path: 'node_modules' },\n    tsPreCompilationDeps: true\n  }\n};\n");
  });

  it('puts a backslash in front of a quote or backslash inside a string', () => {
    const odd: ContractRule = { name: "bindweed:it's", severity: 'error', comment: 'a \\ b', from: {}, to: { path: '^x' } };
    expect(textOf(null, [odd])).toContain("      name: 'bindweed:it\\'s',\n      severity: 'error',\n      comment: 'a \\\\ b',\n      from: {},\n      to: { path: '^x' }\n");
  });
});

describe('readCruiser().preview over an existing file', () => {
  it('A kept rule and its options stay byte for byte', () => {
    const merged = textOf(KEEP_ME, [CIRCULAR]);
    expect(merged).toBe(KEEP_ME.replace("      to: { path: '^keep' }\n    }\n", `      to: { path: '^keep' }\n    },\n${CIRCULAR_TEXT}\n`));
    expect(textOf(merged, [CIRCULAR])).toBe(merged);
    expect(diffOf(merged, [CIRCULAR])).toBe(HEADER);
    expect(diffOf(KEEP_ME, [CIRCULAR])).toBe(
      `${HEADER}@@ -6,6 +6,13 @@\n       severity: 'warn',\n       from: {},\n       to: { path: '^keep' }\n+    },\n${CIRCULAR_TEXT.split('\n')
        .map(line => `+${line}\n`)
        .slice(0, -1)
        .join('')}     }\n   ],\n   options: { doNotFollow: { path: 'node_modules' }, extra: true }\n`,
    );
  });

  it('An existing circular rule leaves bindweed:no-circular out', () => {
    expect(readCruiser(CYCLES_KEPT).keepsCycleRule).toBe(true);
    const three = FIVE.slice(2, 4);
    const merged = textOf(CYCLES_KEPT, three);
    expect(merged.startsWith(CYCLES_KEPT.slice(0, CYCLES_KEPT.indexOf('    }\n  ]') + 5))).toBe(true);
    expect(merged).not.toContain('bindweed:no-circular');
    expect(merged).toContain("      name: 'bindweed:src-infra-does-not-use-src-app',");
  });

  it('Old bindweed rules are removed with what sits in front of them, and do not leave cycles out', () => {
    expect(readCruiser(OLD_RULES).keepsCycleRule).toBe(false);
    const merged = textOf(OLD_RULES, [CIRCULAR]);
    expect(merged).toBe(`const note = 'leave me';
module.exports = {
  forbidden: [
    {
      name: 'keep-me',
      severity: 'warn',
      from: {},
      to: { path: '^keep' }
    },
${CIRCULAR_TEXT}
  ],
  options: { note }
};
`);
    expect(textOf(merged, [CIRCULAR])).toBe(merged);
  });

  it('removes runs of bindweed rules before and after a kept rule', () => {
    const source = "module.exports = { forbidden: [ { name: 'bindweed:a' }, { name: 'bindweed:b' }, { name: 'k' }, { name: 'bindweed:c' }, { name: 'bindweed:d' }, ] };\n";
    expect(textOf(source, [])).toBe("module.exports = { forbidden: [ { name: 'k' }, ] };\n");
  });

  it('An empty forbidden array and an export default keep the other bytes', () => {
    expect(textOf('module.exports = {\n  forbidden: [],\n  options: { extra: 1 }\n};\n', [CIRCULAR])).toBe(
      `module.exports = {\n  forbidden: [\n${CIRCULAR_TEXT}\n  ],\n  options: { extra: 1 }\n};\n`,
    );
    expect(textOf("export default {\n  forbidden: [\n    { name: 'keep-me', severity: 'warn', from: {}, to: { path: '^keep' } }\n  ]\n};\n", [CIRCULAR])).toBe(
      `export default {\n  forbidden: [\n    { name: 'keep-me', severity: 'warn', from: {}, to: { path: '^keep' } },\n${CIRCULAR_TEXT}\n  ]\n};\n`,
    );
  });

  it('replaces a list of only bindweed rules, and reads a quoted forbidden key', () => {
    const source = "module.exports = {\n  'forbidden': [\n    { name: 'bindweed:old' }\n  ]\n};\n";
    expect(textOf(source, [CIRCULAR])).toBe(`module.exports = {\n  'forbidden': [\n${CIRCULAR_TEXT}\n  ]\n};\n`);
    expect(textOf(source, [])).toBe("module.exports = {\n  'forbidden': []\n};\n");
  });

  it('prefers module.exports to export default and ignores other statements', () => {
    const source = "const x = 1;\nx;\nexports.y = 2;\nmodule.exports.z = 3;\nexport default { forbidden: 3 };\nmodule.exports = { [x]: 1, forbidden: [] };\n";
    expect(textOf(source, [])).toBe(source);
  });

  it.each([
    'const base = [];\nmodule.exports = { forbidden: [...base] };\n',
    'const base = [];\nmodule.exports = { forbidden: base };\n',
    'function make() { return []; }\nmodule.exports = { forbidden: make() };\n',
    'const rule = {};\nmodule.exports = { forbidden: [rule] };\n',
    'module.exports = { options: {} };\n',
    'module.exports = {\n',
    'module.exports = make();\n',
    'module.exports += { forbidden: [] };\n',
    'const nothing = 1;\n',
  ])('A forbidden list we cannot read is refused: %j', source => {
    expect(readCruiser(source).preview([CIRCULAR], true)).toEqual({ error: REFUSAL, snippet: `${CIRCULAR_TEXT}\n` });
    expect(readCruiser(source).preview([], true)).toEqual({ error: REFUSAL, snippet: '' });
    expect(readCruiser(source).keepsCycleRule).toBe(false);
  });

  it('joins snippet rules with a comma', () => {
    const preview = readCruiser('module.exports = 1;\n').preview(FIVE.slice(0, 2), true);
    expect(preview).toEqual({ error: REFUSAL, snippet: expect.stringContaining("    },\n    {\n      name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts',") });
  });
});

describe('readCruiser().keepsCycleRule', () => {
  it('is false with no file, for a bindweed cycle rule, and for a to without circular', () => {
    expect(readCruiser(null).keepsCycleRule).toBe(false);
    expect(readCruiser("module.exports = { forbidden: [{ name: 'x', to: { path: '^a' } }, { name: 'y', to: 'z' }, { name: 'w' }] };\n").keepsCycleRule).toBe(false);
    expect(readCruiser("module.exports = { forbidden: [{ name: 'x', to: { circular: false } }] };\n").keepsCycleRule).toBe(false);
    expect(readCruiser("module.exports = { forbidden: [{ name: 'bindweed:x', to: { circular: true } }] };\n").keepsCycleRule).toBe(false);
  });
});
