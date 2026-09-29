# 001 — `bindweed` serves a repo's file tree on localhost

After this task a developer can `cd` into any git repository, type `bindweed`, open the printed link, and browse the repository's files in the browser: a folder tree on the left, the selected file's text with line numbers on the right. Nothing in the repository changes except bindweed's own ignored folder.

The repo already holds the gate configuration (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`, `stryker.config.json`, `knip.json`, `playwright.config.ts`) and a seed `src/cli.ts` that only prints its arguments. Replace the seed's behaviour; keep the file as the entry point.

## Shape

- The server is plain `node:http`, run by Node's type stripping (`node src/cli.ts`, Node ≥ 22.18). No web framework.
- The browser app is React, built by Vite from `src/ui` (entry `src/ui/main.tsx`, page `src/ui/index.html`) into `dist/ui`. `npm run build` builds it. The server serves `dist/ui`, found relative to bindweed's own install directory, never the target repo's.
- `.dependency-cruiser.cjs` already fixes the big directions: `src/domain` is pure, `src/ui` is browser-only and may use `src/domain`, nothing imports `src/cli.ts` or the ui. Everything else under `src/` is the architect's to shape.

## Command

- `bindweed [path]`. `path` defaults to the current directory. The served root is the git top level of `path` (`git rev-parse --show-toplevel`).
- Not inside a git repository: print `bindweed: <path> is not inside a git repository` to stderr, exit 2.
- `dist/ui/index.html` missing: print `bindweed: the ui is not built; run npm run build in <bindweed dir>` to stderr, exit 1.
- On start it creates `<root>/.bindweed/` and appends the line `.bindweed/` to `<root>/.git/info/exclude` unless a line with exactly that text is already there (creating the file if needed). For a worktree, `.git` is a file; use `git rev-parse --git-common-dir` to find `info/exclude`. Run twice, the line appears once.
- Port: `--port N`, else env `BINDWEED_PORT`, else 4477. When the port is taken, try the next one, up to 4497 inclusive; after that print `bindweed: no free port between 4477 and 4497` and exit 1. An explicit `--port` that is taken is an error at once: `bindweed: port N is in use`, exit 1.
- It binds to `127.0.0.1` only.
- It prints exactly two lines to stdout and nothing else while serving:
  - `bindweed: http://127.0.0.1:<port>/?token=<token>`
  - `serving <root>`
- `token` is 32 lowercase hex characters from `crypto.randomBytes(16)`, new on every start.
- SIGINT or SIGTERM closes the server and exits 0.

## Security

- Every `/api/*` request needs the token as `Authorization: Bearer <token>` or as `?token=<token>`. Missing or wrong: `401` with body `{"error":"missing or wrong token"}`. Compare in constant time.
- `GET /` returns the page only with a valid `?token=`; without it, `401` with a short plain-text page saying to use the link bindweed printed.
- Static assets under `/assets/` are served without a token; they carry no repository data.
- Any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` gets `403` `{"error":"bad host"}` (DNS rebinding).
- The page reads the token from its URL, keeps it in `sessionStorage`, removes it from the address bar with `history.replaceState`, and sends it as a bearer header on every API call.

## API

- `GET /api/tree` → `{ "root": "<repo dir name>", "entries": [ { "name", "path", "kind": "dir" | "file", "children"?: [...] } ] }`. Files are `git ls-files --cached --others --exclude-standard` (tracked plus untracked-but-not-ignored), deleted-but-tracked files left out. Directories first, then files, each sorted by name (locale-independent, case-sensitive byte order).
- `GET /api/file?path=<repo-relative path>` → `{ "path", "text" }`. A path not in the tree listing (including any `..` or absolute path) → `404` `{"error":"no such file"}`. Larger than 1 MiB → `413` `{"error":"file too large to show"}`. A NUL byte in the first 8 KiB → `{ "path", "binary": true }`.
- List every route in the README's `## Routes` table with its status.

## Page

- Title `bindweed — <repo dir name>`.
- Left: the tree. Folders start collapsed except the root; clicking a folder toggles it; clicking a file selects it.
- Right: the selected file's path as a header and its text in a monospaced block with line numbers. A binary file shows `binary file, not shown`; too large shows `file too large to show`.
- Deep link: `#file=<path>` in the URL selects that file on load and expands its folders; selecting a file updates the hash.

## QA

QA keeps small plain-file fixture repositories under `qa/fixtures/` and, per test, copies one to a temp directory and runs `git init` plus a commit there. Build the ui once before the suite (`npm run build`). Check, against the real `node src/cli.ts`:

- the two stdout lines, with a 32-hex token and port 4477 (or the next free one);
- `401` from `/api/tree` without the token and with a wrong one; `403` with `Host: evil.example:4477`;
- the tree in the browser shows `src/` collapsed; expanding it and clicking `src/a.ts` shows its text with line numbers; `#file=src/a.ts` opens it directly;
- a `.gitignore`d file is absent from the tree; an untracked, unignored file is present;
- `.git/info/exclude` holds `.bindweed/` exactly once after two starts; `git status --porcelain` in the fixture is empty after both;
- outside a repository: exit 2 and the message; `--port` taken: exit 1 and the message; default port taken: the next port is used.

## Must not change

- Bindweed never writes inside the target repository except `.bindweed/` and the one exclude line.
