const { builtinModules } = require('node:module');

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies allowed',
      from: {},
      to: { circular: true }
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'src/domain holds the tree and text models as pure code; it imports nothing outside domain, Node built-ins and npm packages included',
      from: { path: '^src/domain' },
      to: { pathNot: '^src/domain' }
    },
    {
      name: 'ui-runs-in-the-browser',
      severity: 'error',
      comment: 'src/ui is the browser app; it may use domain and its own files, never server-side code or Node built-ins',
      from: { path: '^src/ui' },
      to: { path: ['^src/(?!ui|domain)', `^(node:)?(${builtinModules.join('|')})$`] }
    },
    {
      name: 'nothing-reaches-into-the-ui',
      severity: 'error',
      comment: 'Only the ui imports ui files',
      from: { pathNot: '^src/ui' },
      to: { path: '^src/ui' }
    },
    {
      name: 'cli-is-the-entry',
      severity: 'error',
      comment: 'src/cli.ts composes everything; nothing imports it',
      from: { pathNot: '^src/cli(\\.test)?\\.ts$' },
      to: { path: '^src/cli\\.ts$' }
    },
    {
      name: 'only-cli-imports-args',
      severity: 'error',
      comment: 'argv parsing is only for the entry; nothing else reaches into args',
      from: { pathNot: '^src/(cli\\.ts|args(\\.test)?\\.ts)$' },
      to: { path: '^src/args\\.ts$' }
    },
    {
      name: 'only-cli-imports-serve',
      severity: 'error',
      comment: 'HTTP serving is a deep module; only the cli composes it among production files',
      from: { pathNot: '^src/(cli\\.ts|serve\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/serve\\.ts$' }
    },
    {
      name: 'only-cli-and-serve-import-repo',
      severity: 'error',
      comment: 'repo is git and workspace IO; only cli and serve reach it among production files',
      from: { pathNot: '^src/(cli\\.ts|serve\\.ts|repo\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/repo\\.ts$' }
    },
    {
      name: 'args-imports-nothing-under-src',
      severity: 'error',
      comment: 'args is a leaf: parse argv only',
      from: { path: '^src/args\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'no-orphans',
      severity: 'error',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', '^src/cli\\.ts$', '^src/ui/main\\.tsx$', '\\.test\\.tsx?$'] },
      to: {}
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js'] }
  }
};
