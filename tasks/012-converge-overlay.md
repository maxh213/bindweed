# 012 — watch a run converge on the plan

After this task, while a run works in its worktree, the developer can switch the Architecture canvas to **Converge** for that run: bindweed scans the worktree's current code, compares it with the plan, and ticks each edit off as it lands — the file really moved, the import really gone, the new package really exists — so they can see the refactor approaching the shape they drew, and what is still missing when the run stops. Bob looks at the architecture after a story or two; this makes that look a glance.

## Checking edits against a scan (pure, in `src/domain`)

Given the plan and the scanned graph of the worktree, each edit is **done**, **not yet**, or **contradicted**:

- `move-file`: done when the file exists at its planned path and not at its old one; not yet when it is still at the old path; contradicted when neither exists and no `fate` covers it.
- `cut-edge`: done when none of its file pairs (in planned paths) still has an import; not yet otherwise, listing the imports that remain with file and line.
- `add-edge`: done when at least one import exists from the `from` node to the `to` node.
- `create-package`: done when the directory holds at least one scanned file.
- `rename-*`, `merge-packages`, `split-package`: done when every file the edit covers sits at its planned path.
- `fate` delete: done when the file is gone and nothing imports its old or planned path; fold: done when the file is gone and its former importers import `into`.
- `note`: never checked; shown as a note.
- Contract rules: satisfied when no import in the scan breaks them (same matching as dependency-cruiser's `path` regexes on `from` and `to`, plus cycle detection for `no-circular`); the list shows the breaking imports.

## Page

- In the Runs cards (011) and the plan toolbar: **Converge** for a run whose worktree exists. It opens the Architecture tab on that worktree's scan (a separate scan and cache under `<root>/.bindweed/cache/<slug>/`, never the worktree's own `.bindweed/`), with the plan open.
- The change list shows a tick, an empty circle or a red cross per edit, with the remaining imports under a not-yet cut; a header reads `7 of 10 edits done · 3 of 4 rules hold`.
- On the canvas, done edits' markers turn green, not-yet stay as in 005/006, contradicted turn red.
- The scan refreshes every 20 seconds while Converge is visible and the run is running, plus a **Rescan** button. The warm-scan bench from 002 keeps this cheap.
- Leaving Converge returns to the browsed repository's own view.

## QA

Build a worktree by hand from the `layered` fixture and a plan with a move, a package cut, a new package and a delete, then change the worktree step by step: before any change the header reads `0 of 4 edits done`; after moving the file, `1 of 4` and its marker is green; after removing two of three cut imports, the cut is still not done and lists the remaining import with its line; after removing the last, done; creating the package with one file ticks it; deleting a file that something still imports keeps the delete not done and names the importer; the contract line counts rules that hold. Refresh happens without a reload within 25 seconds of a change while the fake run's pid is alive.

## Must not change

- The browsed repository's own scan, cache and view. Everything from 001–011.
