# 005 — plan a refactor on the canvas: move files, cut and draw dependencies, leave notes

After this task the developer can start a named **plan**, then reshape the architecture by hand: drag a file into another package, cut an arrow ("this must not depend on that"), draw a new arrow ("this should use that"), and pin a note to any box or arrow. Every change lands in an ordered change list they can undo, redo or remove, the canvas shows the planned shape, and the plan is still there after a restart. The repository's code is never touched; a plan is intent for an agent to carry out later.

## Plans

- A plan is `.bindweed/plans/<slug>.json`: `{ "version": 1, "name", "slug", "createdAt", "baseCommit", "edits": [ ... ], "redo": [ ... ] }`. `slug` is the name lowercased, runs of anything but `a-z0-9` turned into single `-`, trimmed of `-`, cut to 40 characters; a clash gets `-2`, `-3`, ... `baseCommit` is `git rev-parse HEAD` when the plan is created.
- API: `GET /api/plans` (name, slug, edit count, createdAt), `POST /api/plans` `{ "name" }`, `GET /api/plans/<slug>`, `PUT /api/plans/<slug>` (whole plan), `DELETE /api/plans/<slug>`.
- Page: a plan selector in the Architecture toolbar: **New plan…** (asks for a name), switch between plans, **Delete plan** (confirms). With no plan open the canvas behaves exactly as in 004. The open plan's slug is in the hash (`#at=src&plan=<slug>`).

## Edits in this task

Each edit is a JSON object with a `kind`; they apply in order, and each names paths as they are after the edits before it.

- `move-file` `{ "file", "to" }`: drag a file box and drop it onto a package box in the view, or onto a breadcrumb entry. `to` is the target directory. Dropping onto its own directory is not an edit.
- `cut-edge` `{ "from", "to", "files": [[importer, imported], ...] }`: select an arrow and press Delete or choose **Cut** from its menu. `from`/`to` are the node paths as shown; `files` lists every underlying file edge at the moment of cutting.
- `add-edge` `{ "from", "to" }`: drag from a box's handle onto another box. Refused, with a message, when the two already have an edge in the planned graph or are the same box.
- `note` `{ "target": { "node": <path> } | { "edge": [from, to] }, "text" }`: **Add note** in the box or arrow menu. A note shows as a small marker; hovering shows the text.

## Planned graph (pure, in `src/domain`)

- `applyPlan(graph, edits)` returns the planned graph: moved files live in their new directory, keep their imports and importers; cut file edges are gone; added edges exist as `planned` edges between the two nodes (no underlying files yet).
- With a plan open, the canvas draws the **planned** graph, with the 002/003 layering, colours and cycle detection run on it. A moved file also leaves a faint dashed ghost at its old place. A cut edge is drawn as a thin dashed grey line with a ✂ marker; an added edge as a dashed blue arrow. A **Now / Planned** switch shows the current graph instead, with the plan's markers still visible.
- 004's metrics and the Metrics table follow the switch.

## Change list

- A side panel lists the edits in order as sentences: `Move src/app/save.ts to src/infra`, `src/ui must not import src/scan (3 imports)`, `src/app should use src/ports`, `Note on src/domain: "pull an interface out here"`.
- Clicking an entry selects and centres what it refers to, drilling to its view if needed.
- Undo (Ctrl+Z or button) moves the last edit to `redo`; Redo (Ctrl+Shift+Z) moves it back; a new edit clears `redo`. Each entry has a remove (×) button; removing an edit that later edits depend on (a note on a moved file, say) removes it only; later edits that no longer apply are marked **stale** (yellow) with the reason, never silently dropped.
- Every change saves the plan at once.
- After a rescan, an edit naming a path that no longer exists is marked stale the same way.

## QA

Use the `layered` fixture. Check in the browser: create plan "Split app", drag `src/app/save.ts` onto `infra` (the change list says so, the file shows under `infra` with a ghost in `app`); cut `app → domain` (the edge shows ✂, the list says `must not import ... (N imports)` with the right N); draw `infra → app`, which creates a cycle drawn red in the planned view; Undo removes it and the red goes; Redo brings it back; add a note to `domain` and see it on hover; reload the page and restart bindweed, and all of it is still there; Now/Planned switches views; delete the plan. After all of it `git status --porcelain` in the fixture is empty.

## Must not change

- The view with no plan open behaves exactly as in 004. No file in the target repository changes.
