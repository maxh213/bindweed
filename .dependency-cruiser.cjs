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
    },
    {
      name: 'scan-record-is-a-leaf',
      severity: 'error',
      comment: 'src/domain/scan.ts is the scan record and the test-path rule; it depends on nothing else under src',
      from: { path: '^src/domain/scan\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'scanner-does-not-import-the-view',
      severity: 'error',
      comment: 'The scanner produces a scan record; it does not know how a view is laid out',
      from: { path: '^src/(scan\\.ts|scanning/)' },
      to: { path: '^src/domain/(graph|place)\\.ts$' }
    },
    {
      name: 'only-serve-imports-the-scanner',
      severity: 'error',
      comment: 'Scanning a repository is server IO; only serve composes it among production files',
      from: { pathNot: '^src/(serve\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/scan\\.ts$' }
    },
    {
      name: 'scanning-internals-are-private',
      severity: 'error',
      comment: 'Import parsing, workspace discovery, resolution and path rules stay inside the scanner',
      from: { pathNot: '^src/(scan\\.ts|scanning/)' },
      to: { path: '^src/scanning/' }
    },
    {
      name: 'parse-is-a-leaf',
      severity: 'error',
      comment: 'Import syntax parsing depends only on the TypeScript compiler API',
      from: { path: '^src/scanning/parse\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'workspaces-are-a-leaf',
      severity: 'error',
      comment: 'Workspace discovery reads manifests and entry files; it does not parse or resolve imports',
      from: { path: '^src/scanning/workspaces\\.ts$' },
      to: { path: '^src/', pathNot: '^src/scanning/paths\\.ts$' }
    },
    {
      name: 'scan-paths-import-only-the-record',
      severity: 'error',
      comment: 'Which paths are code is decided from the scan record alone',
      from: { path: '^src/scanning/paths\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/scan\\.ts$' }
    },
    {
      name: 'resolve-imports-workspaces-paths-and-the-record',
      severity: 'error',
      comment: 'Resolution may use workspace entry points, path rules and the scan record, nothing else under src',
      from: { path: '^src/scanning/resolve\\.ts$' },
      to: { path: '^src/', pathNot: '^src/(scanning/(workspaces|paths)\\.ts|domain/scan\\.ts)$' }
    },
    {
      name: 'placement-is-private',
      severity: 'error',
      comment: 'Layer, order and cycle placement stay inside the view',
      from: { pathNot: '^src/domain/graph\\.ts$' },
      to: { path: '^src/domain/place\\.ts$' }
    },
    {
      name: 'placement-is-a-leaf',
      severity: 'error',
      comment: 'Placement is a pure algorithm; it does not import the rest of the view',
      from: { path: '^src/domain/place\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'view-does-not-import-the-client',
      severity: 'error',
      comment: 'src/ui/view.ts is page state and the hash; it does not fetch',
      from: { path: '^src/ui/view\\.ts$' },
      to: { path: '^src/ui/client\\.ts$' }
    },
    {
      name: 'client-does-not-import-the-view',
      severity: 'error',
      comment: 'src/ui/client.ts is the HTTP client; page state does not flow back into it',
      from: { path: '^src/ui/client\\.ts$' },
      to: { path: '^src/ui/view\\.ts$' }
    },
    {
      name: 'ui-does-not-import-the-scan-record',
      severity: 'error',
      comment: 'The browser draws a view; the scan record stays on the server side of the API',
      from: { path: '^src/ui/' },
      to: { path: '^src/domain/scan\\.ts$' }
    },
    {
      name: 'only-the-view-imports-the-canvas',
      severity: 'error',
      comment: 'The architecture canvas is the view drawing module; nothing but the view reaches it',
      from: { pathNot: '^src/ui/(ArchView\\.tsx|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/ArchCanvas\\.tsx$' }
    },
    {
      name: 'canvas-only-draws',
      severity: 'error',
      comment: 'The canvas is handed a view and draws it; it does not fetch, own page state or open panels',
      from: { path: '^src/ui/ArchCanvas\\.tsx$' },
      to: { path: ['^src/ui/(client|view|App|DetailPanel)\\.tsx?$', '^src/domain/(tree|scan)\\.ts$', 'node_modules/@tanstack'] }
    },
    {
      name: 'arch-view-does-not-import-xyflow',
      severity: 'error',
      comment: 'All xyflow knowledge lives in the canvas module',
      from: { path: '^src/ui/ArchView\\.tsx$' },
      to: { path: 'node_modules/@xyflow' }
    },
    {
      name: 'the-client-parses-the-json',
      severity: 'error',
      comment: 'The API client owns the response schemas; components work with parsed values',
      from: { path: '^src/ui/', pathNot: '^src/ui/(client\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: 'node_modules/zod' }
    },
    {
      name: 'drawing-helpers-are-a-leaf',
      severity: 'error',
      comment: 'The drawing helpers turn graph facts into strings; they import nothing under src',
      from: { path: '^src/ui/draw\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'layout-is-a-leaf',
      severity: 'error',
      comment: 'The layout document and its box placement depend on nothing else under src',
      from: { path: '^src/domain/layout\\.ts$' },
      to: { path: '^src/' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js'] }
  }
};
