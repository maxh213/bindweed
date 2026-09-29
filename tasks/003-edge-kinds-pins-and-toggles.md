# 003 — arrows say what kind of dependency they are; boxes stay where you drag them

After this task the Architecture tab reads like a BlueJ class diagram crossed with Uncle Bob's viewer: solid arrows for runtime imports, dashed for type-only, hollow-headed for `extends`/`implements`; abstract modules in green; arrows that point upward in red. The developer can drag boxes into the arrangement that makes sense to them and it is still there tomorrow, show or hide tests and external packages, and click any box to see what it imports and what imports it.

## Arrow kinds

- **Heritage edges**: for each `class ... extends X`, `class ... implements X, Y` and `interface ... extends X`, find the import in the same file that binds `X` (named, default, or namespace member `ns.X`) and record a heritage edge to the file that import resolves to. A heritage on a name declared in the same file makes no edge. Heritage edges are kept as their own count, in addition to the import edge they come through.
- Drawing: an aggregated edge is **solid** when it has any runtime import, **dashed** when all its imports are type-only; its head is a **hollow triangle** when it carries any heritage edge, else a filled arrowhead. Hovering an edge shows `3 runtime · 1 type-only · 1 extends/implements`.
- **Abstract file**: every top-level statement is an interface, a type alias, an `abstract class`, a `declare` declaration, an `export type`/`import type`, or a re-export of only types; and the file has at least one such declaration. A package is abstract when all its scanned files are abstract. Abstract boxes are green.

## Upward arrows

- An edge is **upward** when the imported box is drawn with its top edge lower on the canvas than the importing box's top edge by more than half a box height (so the dependency points up). With automatic layering this cannot happen; it happens once someone pins boxes.
- Upward edges are red, like cycle edges; their tooltip says `points up: <from> is drawn below <to>`.

## Pinning

- Boxes can be dragged. Dropping a box pins it: its position is saved in `.bindweed/layout.json` as `{ "version": 1, "views": { "<view dir>": { "<node id>": { "x", "y" } } }, "settings": { ... } }` via `PUT /api/layout`.
- Pinned boxes keep their position across reloads, rescans and bindweed restarts. Unpinned boxes are placed by the 002 layering; a newly appeared box that would overlap a pinned one moves right until it does not.
- **Reset layout** clears the pins of the current view only.
- A pin for a node that no longer exists is kept in the file but ignored.

## Toggles

- **Tests** and **External packages** checkboxes above the canvas, both off by default, remembered in `layout.json` `settings`.
- Tests on: test files appear as boxes (with a small `test` tag) and their edges are drawn.
- External packages on: each external package imported from inside the view becomes a box in its own bottom row with a dashed border (`react`, `node:fs`, ...), with edges from the importing nodes. They never join cycles or layering.

## Details panel

- Single-clicking a box opens a side panel: name, path, kind, file count for a package, `abstract` when it is, and two lists, **Imports** and **Imported by**, of the files and packages at the far end of each edge (with counts and kinds). Clicking an entry selects and centres that box when it is in the view, or drills to the view that contains it.
- Hovering a box highlights its edges and dims the rest.

## QA

Extend the `layered` fixture: a `src/domain/shape.ts` holding only an interface; `src/infra/repo.ts` with `class Repo implements Shape`; an `import type` only edge from `app` to `infra`; a `src/app/a.test.ts`; an import of `node:fs` in `infra`.

Check in the browser: `domain` is green; `infra → domain` has a hollow head; `app → infra` is solid (it has both runtime and type-only imports) and its tooltip lists both; a dashed edge appears where all imports are type-only; dragging `domain` above `app` turns the `app → domain` edge red with the `points up` tooltip; reload keeps the position; Reset layout restores the layers; the Tests toggle shows `a.test.ts`, the External toggle shows a `node:fs` box under `infra`; clicking `infra` lists `domain` under Imports and `app` under Imported by, and clicking `domain` in the panel selects it.

## Must not change

- The 002 layering for unpinned boxes, the API shapes (fields may be added), the Files tab.
