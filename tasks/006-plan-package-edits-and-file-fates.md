# 006 — plan package-level reshaping: create, rename, merge and split packages; rename, delete or fold files

After this task a plan can say more than "move this file": the developer can create a new package to move files into, rename a package or a file, merge two packages into one, split a package into several, and mark a file to be deleted or folded into another file. The planned view and the change list show all of it, and warnings say when a plan leaves something dangling.

## New edits

Same rules as 005: applied in order, each naming paths as they are after the edits before it, each undoable and removable, stale when it no longer applies.

- `create-package` `{ "path" }`: **New package** in the canvas menu asks for a name, creating `<view>/<name>`. It shows as an empty package box until files move in. Names follow `^[A-Za-z0-9._-]+$`; an existing name is refused.
- `rename-package` `{ "from", "to" }` and `rename-file` `{ "from", "to" }`: **Rename** in the box menu; only the last path segment changes (moving is `move-file`). A file rename keeps the extension unless the new name gives one.
- `merge-packages` `{ "packages": [a, b, ...], "into" }`: select two or more package boxes (Shift-click) and choose **Merge**; asks for the merged name, which may be one of theirs. All their files move into `into`, keeping their sub-paths.
- `split-package` `{ "package", "parts": [{ "name", "files": [...] }] }`: **Split** in a package's menu opens a dialog listing its files (recursively) with a target part per file; at least two parts; every file assigned. Parts become sibling packages of the original, which disappears from the planned graph once empty.
- `fate` `{ "file", "fate": "delete" }` or `{ "file", "fate": "fold", "into": <file> }`: **Delete** or **Fold into…** in a file's menu (fold picks the target by clicking another file box). A deleted file is drawn struck through; a folded file's imports and importers are re-pointed at `into` in the planned graph.

## Warnings

Shown in the change list under the edit that causes them, and as a count badge on the panel header:

- `N files still import src/x.ts, which this plan deletes` (listing them on expand);
- `src/new is empty` for a created or split-off package that ends up with no files;
- a planned graph with a cycle that the current graph did not have: `this plan adds a cycle: a → b → a`.

## Change list sentences

`Create package src/ports`, `Rename src/util to src/text`, `Rename src/app/x.ts to y.ts`, `Merge src/io and src/net into src/infra`, `Split src/app into src/app/read (4 files) and src/app/write (3 files)`, `Delete src/legacy.ts`, `Fold src/helpers.ts into src/text/format.ts`.

## QA

Use the `layered` fixture. Check in the browser: create `src/ports` and move `src/domain/shape.ts` into it; rename `infra` to `adapters` (the moved and renamed paths chain correctly in later edits and the list); split `app` into `read` and `write`; merge `read` and `write` back into `app`; delete a file that others import and see the warning with the right count; fold one file into another and see its arrows move; undo each step back to an empty plan, redo all of them, reload, and see the same planned view. `git status --porcelain` in the fixture stays empty.

## Must not change

- The 005 edits, their JSON, and their sentences. Plans written by 005 load unchanged.
