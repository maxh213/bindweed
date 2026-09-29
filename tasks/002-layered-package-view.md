# 002 — the Architecture tab: a layered, drill-down view of a TypeScript repo's dependencies

After this task a developer running bindweed in a TypeScript repository can open an **Architecture** tab and see the repository the way Uncle Bob's architecture viewer shows a system: one box per top-level package (folder), arrows for imports, laid out in layers with high-level code at the top and leaves at the bottom, cycles in red. Double-clicking a package drills into it; a breadcrumb climbs back out; double-clicking a file opens it in the Files tab from 001.

## Scanner

Uses the TypeScript compiler API (the `typescript` runtime dependency, 6.x).

- Files: every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` in the 001 tree listing (so git-ignored files are already out), excluding any path with a segment `node_modules`, `dist`, `build`, `out`, `coverage`, `.bindweed` or `.marestail`, and excluding `*.d.ts`.
- Imports per file, from the AST (no type checker needed): `import` declarations, `export ... from`, `import x = require(...)`, `require('...')` calls with a string literal, and `import('...')` with a string literal. An import is **type-only** when it is `import type`/`export type`, or every named specifier is marked `type` and there is no default or namespace binding. Everything else is **runtime**.
- Resolution: `ts.resolveModuleName` with the compiler options of the nearest `tsconfig.json` above the file (honouring `extends`, `baseUrl`, `paths`, and `references`: each referenced project's files use that project's own tsconfig). No tsconfig anywhere: `allowJs: true`, `moduleResolution: bundler`. A specifier that resolves to a file inside the repo (and not under `node_modules`) is an **internal** edge to that file. Anything else is **external**, named by its package root (`react`, `@xyflow/react`, `node:fs`; a bare builtin like `fs` is named `node:fs`).
- Workspaces: when the root `package.json` has `workspaces` (array or `{ packages }`) or a `pnpm-workspace.yaml` lists `packages`, each workspace package directory is a top-level box labelled with its `package.json` `name`. An import of a workspace package's name resolves into that package's files (via its `exports`/`module`/`main`/`types` to the source file when it exists in the repo; otherwise the edge points at the package's directory box).
- A file is a **test** when its name matches `*.test.*` or `*.spec.*`, or any path segment is `__tests__`, `test`, `tests` or `e2e`. Tests and external packages are scanned and kept in the graph but not shown in this task (the toggles come in 003).
- Cache: `.bindweed/cache/scan.json` keeps each file's parsed imports keyed by path with `mtimeMs` and `size`; a rescan re-parses only files whose stamp changed and re-resolves everything.

## The view model (pure, in `src/domain`)

- A **view** is a directory (repo-relative, `""` for the root). Its nodes are the view directory's direct children that contain at least one scanned file: a child directory is a **package** node (with its scanned file count), a file directly in the view directory is a **file** node. At the root, workspace packages replace their directories.
- Edges between nodes in a view are file edges aggregated by the nodes containing each end, counted (`runtime` count and `type` count). Edges whose ends fall in the same node disappear. Edges to files outside the view directory are not drawn in this task.
- **Layers**: condense the view's node graph into strongly connected components; a component's height is 0 when it imports nothing else in the view, else 1 + the largest height among what it imports. Nodes are drawn in rows by height, largest at the top. Within a row, order by the barycentre of each node's neighbours in the row above, two downward sweeps, ties broken by name; the first row is ordered by name.
- An edge is a **cycle edge** when both ends are in the same strongly connected component (of more than one node). Cycle edges and the boxes in a cycle are drawn red; the edge tooltip names the cycle as `a → b → c → a` (the shortest cycle through that edge, names as shown in the view).

## API and page

- `GET /api/graph?at=<dir>` → `{ "at", "crumbs": [{ "name", "at" }], "nodes": [{ "id", "kind": "package" | "file", "name", "path", "files"?, "row", "order", "cycle": bool }], "edges": [{ "from", "to", "runtime", "type", "cycle", "cycleText"? }] }`. An unknown `at` → `404`.
- `POST /api/rescan` rescans and returns `{ "files": <count>, "ms": <duration> }`.
- The page gets a tab bar: **Files** (the 001 view) and **Architecture**. The Architecture tab draws the view with `@xyflow/react`: boxes placed by `row`/`order` on a grid, package boxes with a folder look and a file count, file boxes plain, arrows from importer to imported with the count as a label when it is above 1. Pan and zoom work; boxes cannot be dragged yet.
- Double-click a package → that package's view; the breadcrumb (`repo / src / domain`) goes back to any level; the browser Back button goes back one level (the view is in the hash as `#at=<dir>`).
- Double-click a file → Files tab with that file selected.
- A **Rescan** button re-runs the scanner and redraws.

## Performance

- Cold scan (no cache) of a generated repository of 5,000 TypeScript files averaging 5 internal imports each: under 10 seconds on this machine. Warm scan with nothing changed: under 2 seconds. Both measured by benches under `perf/`.

## QA

Fixture repositories under `qa/fixtures/`:
- `layered`: `src/app` imports `src/domain` and `src/infra`; `src/infra` imports `src/domain`; `src/domain` imports nothing; `src/app/a.ts` and `src/app/b.ts` import each other; one import goes through a `tsconfig` `paths` alias `@domain/*`; one `import type` only.
- `workspace`: npm workspaces `packages/core` and `packages/web` (`@acme/core`, `@acme/web`), web importing `@acme/core`.

Check in the browser: the root of `layered` shows `src` only; drilling into `src` shows `app` on the top row, `infra` in the middle, `domain` at the bottom, with arrows app→infra, app→domain, infra→domain; drilling into `app` shows `a.ts` and `b.ts` in red with a red cycle edge whose tooltip reads `a.ts → b.ts → a.ts`; the alias import counts as an edge; the breadcrumb and Back return to `src`; double-clicking `domain`'s file opens it in Files. The `workspace` root shows `@acme/web` above `@acme/core`. After adding a file with a new import to a fixture and pressing Rescan, the new arrow appears.

## Must not change

- The Files tab, the token and host checks, and every 001 route.
