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
      comment: 'The canvas is handed a view and draws it; it does not fetch, own page state, edit a plan or open panels',
      from: { path: '^src/ui/ArchCanvas\\.tsx$' },
      to: { path: ['^src/ui/(client|view|App|DetailPanel|HealthControls|plansession|PlanBar|planroster|ContractPanel)\\.tsx?$', '^src/domain/(tree|scan|plan|planned)\\.ts$', '^src/plans\\.ts$', 'node_modules/@tanstack'] }
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
      comment: 'The drawing helpers turn edge and selection facts into strings; they import nothing',
      from: { path: '^src/ui/draw\\.ts$' },
      to: { path: '.' }
    },
    {
      name: 'layout-is-a-leaf',
      severity: 'error',
      comment: 'The layout document and its box placement depend on nothing else under src',
      from: { path: '^src/domain/layout\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'health-depends-only-on-the-scan-record',
      severity: 'error',
      comment: 'CRAP, coverage and mutants are pure; the only src dependency is the function shape on the scan record',
      from: { path: '^src/domain/health\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/scan\\.ts$' }
    },
    {
      name: 'coupling-depends-only-on-the-scan-record',
      severity: 'error',
      comment: 'Martin Ca, Ce, I, A, D and zone are pure; the only src dependency is the scan record',
      from: { path: '^src/domain/coupling\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/scan\\.ts$' }
    },
    {
      name: 'only-the-view-and-reports-import-health',
      severity: 'error',
      comment: 'The view applies CRAP, coverage and mutants; only reports build that value. The server passes the value through and does not import the module',
      from: { pathNot: '^src/(domain/graph\\.ts|domain/health\\.ts|reports\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/domain/health\\.ts$' }
    },
    {
      name: 'only-the-view-imports-coupling',
      severity: 'error',
      comment: 'The view applies Martin package metrics; nothing else reaches into the formulas',
      from: { pathNot: '^src/(domain/graph\\.ts|domain/coupling\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/domain/coupling\\.ts$' }
    },
    {
      name: 'reports-read-health-only',
      severity: 'error',
      comment: 'Report IO maps files into the health value; it does not know the view or the coupling formulas',
      from: { path: '^src/reports\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/health\\.ts$' }
    },
    {
      name: 'only-serve-imports-reports',
      severity: 'error',
      comment: 'Reading coverage and mutation reports is server IO; only serve composes it among production files',
      from: { pathNot: '^src/(serve\\.ts|reports\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/reports\\.ts$' }
    },
    {
      name: 'health-presentation-imports-nothing',
      severity: 'error',
      comment: 'Badges, overlay rules and the metrics table are pure string rules; they import nothing',
      from: { path: '^src/ui/healthdraw\\.ts$' },
      to: { path: '.' }
    },
    {
      name: 'only-the-picture-imports-health-presentation',
      severity: 'error',
      comment: 'Only the architecture page, its canvas, its detail panel and its health controls read the health presentation rules',
      from: { pathNot: '^src/ui/(ArchView\\.tsx|ArchCanvas\\.tsx|DetailPanel\\.tsx|HealthControls\\.tsx|healthdraw\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/healthdraw\\.ts$' }
    },
    {
      name: 'only-the-page-imports-health-controls',
      severity: 'error',
      comment: 'The overlay selector and the metrics drawer belong to the architecture page',
      from: { pathNot: '^src/ui/(ArchView\\.tsx|HealthControls\\.tsx|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/HealthControls\\.tsx$' }
    },
    {
      name: 'health-controls-do-not-fetch',
      severity: 'error',
      comment: 'The overlay selector and metrics drawer render numbers they are handed; they do not fetch, own the page, or draw the canvas',
      from: { path: '^src/ui/HealthControls\\.tsx$' },
      to: { path: ['^src/ui/(client|view|ArchCanvas|App|draw|boot|main|TreeView|FilePanel)\\.tsx?$', '^src/domain/', 'node_modules/(@tanstack|@xyflow|zod)'] }
    },
    {
      name: 'plan-document-is-a-leaf',
      severity: 'error',
      comment: 'The plan document is pure data and its algebra; it imports nothing under src',
      from: { path: '^src/domain/plan\\.ts$' },
      to: { path: '^src/' }
    },
    {
      name: 'planned-graph-imports-only-the-document-and-the-scan',
      severity: 'error',
      comment: 'Applying a plan is a pure function of the scan and the document',
      from: { path: '^src/domain/planned\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/(plan|scan)\\.ts$' }
    },
    {
      name: 'only-serve-applies-a-plan',
      severity: 'error',
      comment: 'The server applies the plan before building a view; the page, the store and the view do not',
      from: { pathNot: '^src/(serve\\.ts|domain/planned\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/domain/planned\\.ts$' }
    },
    {
      name: 'contract-rules-read-the-planned-scan-only',
      severity: 'error',
      comment: 'Writing dependency-cruiser rules for a planned shape is pure. It reads the rule type and the scan record; it does not walk the plan itself',
      from: { path: '^src/domain/contract\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/(plan|scan)\\.ts$' }
    },
    {
      name: 'only-serve-writes-contract-rules',
      severity: 'error',
      comment: 'The server hands the planned shape to the rule writer. The planned graph, the view and the page do not',
      from: { pathNot: '^src/(serve\\.ts|domain/contract\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/domain/contract\\.ts$' }
    },
    {
      name: 'only-serve-imports-the-cruiser',
      severity: 'error',
      comment: 'Reading and merging a .dependency-cruiser.cjs needs the compiler API; only serve composes it among production files',
      from: { pathNot: '^src/(serve\\.ts|cruiser\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/cruiser\\.ts$' }
    },
    {
      name: 'the-cruiser-reads-the-rule-type-and-diffs',
      severity: 'error',
      comment: 'The cruiser merges rules it is handed into file text; it does not apply a plan, write rules, read files or know the view',
      from: { path: '^src/cruiser\\.ts$' },
      to: { path: ['^src/', '^(node:)?(fs|fs/promises|path|http|child_process)$'], pathNot: '^src/(domain/plan|linediff)\\.ts$' }
    },
    {
      name: 'only-the-cruiser-diffs-lines',
      severity: 'error',
      comment: 'The line diff is how the cruiser shows its change; nothing else reaches into it',
      from: { pathNot: '^src/(cruiser\\.ts|linediff\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/linediff\\.ts$' }
    },
    {
      name: 'line-diff-imports-nothing',
      severity: 'error',
      comment: 'A unified diff of two texts is pure string work; it imports nothing',
      from: { path: '^src/linediff\\.ts$' },
      to: { path: '.' }
    },
    {
      name: 'only-the-session-opens-the-contract-panel',
      severity: 'error',
      comment: 'The session opens the Contract panel and stores what it saves. Nothing else mounts it',
      from: { pathNot: '^src/ui/(plansession\\.tsx|ContractPanel\\.tsx|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/ContractPanel\\.tsx$' }
    },
    {
      name: 'the-contract-panel-asks-the-server',
      severity: 'error',
      comment: 'The panel fetches rules and previews through the client and hands the ticked rules back. It does not write rules, edit the plan, draw the canvas or parse JSON',
      from: { path: '^src/ui/ContractPanel\\.tsx$' },
      to: { path: ['^src/', 'node_modules/(@xyflow|zod)'], pathNot: '^src/(domain/plan|ui/client)\\.ts$' }
    },
    {
      name: 'only-serve-imports-the-plan-store',
      severity: 'error',
      comment: 'Plan files are server IO; only serve reads them among production files',
      from: { pathNot: '^src/(serve\\.ts|plans\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/plans\\.ts$' }
    },
    {
      name: 'plan-store-reads-the-document-only',
      severity: 'error',
      comment: 'The store parses and writes plan documents; it does not apply them or know the view',
      from: { path: '^src/plans\\.ts$' },
      to: { path: '^src/', pathNot: '^src/domain/plan\\.ts$' }
    },
    {
      name: 'the-view-does-not-apply-a-plan',
      severity: 'error',
      comment: 'A view is built from a scan the server has already planned',
      from: { path: '^src/domain/graph\\.ts$' },
      to: { path: '^src/domain/(plan|planned|contract)\\.ts$' }
    },
    {
      name: 'the-scanner-does-not-know-plans',
      severity: 'error',
      comment: 'Scanning a repository does not read or apply a plan',
      from: { path: '^src/(scan\\.ts|scanning/)' },
      to: { path: '^src/(domain/(plan|planned|contract)|plans|cruiser|linediff)\\.ts$' }
    },
    {
      name: 'plan-picture-imports-the-view-and-the-document',
      severity: 'error',
      comment: 'The picture is a pure function of the plan document, the graph view and layout placement',
      from: { path: '^src/ui/planpicture\\.ts$' },
      to: { path: '^src/', pathNot: '^src/(domain/(plan|graph|layout)|ui/draw)\\.ts$' }
    },
    {
      name: 'plan-picture-is-framework-free',
      severity: 'error',
      comment: 'The picture does not fetch, draw or depend on a UI framework',
      from: { path: '^src/ui/planpicture\\.ts$' },
      to: { path: 'node_modules' }
    },
    {
      name: 'plan-roster-reads-the-document-only',
      severity: 'error',
      comment: 'The roster is how a plan list and one document read as a selector. It is pure',
      from: { path: '^src/ui/planroster\\.ts$' },
      to: { path: ['^src/', 'node_modules'], pathNot: '^src/domain/plan\\.ts$' }
    },
    {
      name: 'plan-gestures-import-nothing',
      severity: 'error',
      comment: 'A plan gesture is a reading of a browser event; it imports nothing',
      from: { path: '^src/ui/plangesture\\.ts$' },
      to: { path: '.' }
    },
    {
      name: 'only-the-session-and-the-canvas-read-the-plan-picture',
      severity: 'error',
      comment: 'The session builds the picture and the canvas draws it. Callers do not reach into its pieces',
      from: { pathNot: '^src/ui/(plansession\\.tsx|ArchCanvas\\.tsx|planpicture\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/planpicture\\.ts$' }
    },
    {
      name: 'only-the-session-reads-the-plan-roster',
      severity: 'error',
      comment: 'The session is the only production reader of the plan roster',
      from: { pathNot: '^src/ui/(plansession\\.tsx|planroster\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/planroster\\.ts$' }
    },
    {
      name: 'only-the-session-and-the-canvas-read-plan-gestures',
      severity: 'error',
      comment: 'The session interprets keys and drops. The canvas writes the drag payload. Nothing else reaches in',
      from: { pathNot: '^src/ui/(plansession\\.tsx|ArchCanvas\\.tsx|plangesture\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/plangesture\\.ts$' }
    },
    {
      name: 'reshape-rules-read-the-document-only',
      severity: 'error',
      comment: 'Turning a create, rename, merge or split answer into an edit or a refusal is pure. It reads the plan document and nothing else',
      from: { path: '^src/ui/reshape\\.ts$' },
      to: { path: ['^src/', 'node_modules'], pathNot: '^src/domain/plan\\.ts$' }
    },
    {
      name: 'only-the-session-reads-the-reshape-rules',
      severity: 'error',
      comment: 'The session hands a dialog answer to the reshape rules and stores what comes back. Nothing else decides what an answer means',
      from: { pathNot: '^src/ui/(plansession\\.tsx|reshape\\.ts|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/reshape\\.ts$' }
    },
    {
      name: 'only-the-session-imports-the-plan-chrome',
      severity: 'error',
      comment: 'The selector, dialogs, notice and change list are the session chrome',
      from: { pathNot: '^src/ui/(plansession\\.tsx|PlanBar\\.tsx|.+\\.test\\.tsx?)$' },
      to: { path: '^src/ui/PlanBar\\.tsx$' }
    },
    {
      name: 'plan-chrome-is-presentational',
      severity: 'error',
      comment: 'Dialogs, the selector and the change list render what they are handed. They do not fetch, edit a document or know the scan',
      from: { path: '^src/ui/PlanBar\\.tsx$' },
      to: { path: ['^src/', 'node_modules/(@tanstack|@xyflow|zod)'], pathNot: '^src/domain/plan\\.ts$' }
    },
    {
      name: 'the-page-mounts-the-plan-session',
      severity: 'error',
      comment: 'The architecture page mounts the session. It does not reach into edits, the picture, the gestures, the roster or the chrome',
      from: { path: '^src/ui/ArchView\\.tsx$' },
      to: { path: ['^src/domain/(plan|contract)\\.ts$', '^src/ui/(PlanBar|planpicture|plangesture|planroster|ContractPanel)\\.tsx?$'] }
    },
    {
      name: 'the-session-does-not-draw-or-apply',
      severity: 'error',
      comment: 'The session edits a plan and builds its picture. The canvas draws. The server applies the scan and reads plan files',
      from: { path: '^src/ui/plansession\\.tsx$' },
      to: { path: ['^src/ui/(ArchCanvas|ArchView|view)\\.tsx?$', '^src/domain/(planned|contract|layout|scan)\\.ts$', '^src/plans\\.ts$', '^src/serve\\.ts$', 'node_modules/@xyflow'] }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js'] }
  }
};
