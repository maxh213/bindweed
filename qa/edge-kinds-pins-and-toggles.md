# QA: arrows show the kind of dependency, and dragged boxes stay put

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 4800, clear of every port in `qa/serve-the-file-tree.md` and of 4700 in `qa/layered-package-view.md`.

`src/domain/model.ts` is an interface in this fixture, not the class from the 002 procedure. A package is green only when every file in it is types, and the 002 class is not. The 002 fixture files are not edited.

The 002 scenario no longer says that dragging a box leaves it unmoved. Pan and zoom stay. The QA role, not the coder, deletes from `qa/layered-package-view.e2e.ts` the drag of the `app` box and the check that every centre stays within 2px, leaves the pan and zoom checks, and writes the end-to-end test for this procedure. The coder writes no file under `qa/`.

A refresh of the address after the token has left it still shows the 001 line `bindweed: use the link bindweed printed in the terminal`. "Open the printed link again" is the reload that must keep a pin. Where JSON is expected, the order of keys, nodes and edges may differ, and a key the expected body omits is absent.

## Setup

Port 4800 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p $QA/layered/src/app $QA/layered/src/domain $QA/layered/src/infra $QA/layered/notes && cd $QA/layered
printf '%s\n' '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}' > tsconfig.json
printf '# notes\n' > notes/readme.md
printf "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n" > src/app/a.ts
printf "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n" > src/app/b.ts
printf "import { a } from './a';\n" > src/app/a.test.ts
printf 'export interface Model { id: number }\n' > src/domain/model.ts
printf 'export interface Shape { draw(): void }\n' > src/domain/shape.ts
printf "import { Model } from '../domain/model';\nexport const query = new Model();\n" > src/infra/db.ts
printf "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n" > src/infra/repo.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export QA=$QA U=http://127.0.0.1:4800"
```

Paste the `export` line it prints into the second terminal. `app` imports `infra` twice at runtime and once type-only, and `domain` once type-only through the `@domain/*` alias. `infra` imports `domain` twice at runtime, and `repo.ts` implements `Shape`. `a.ts` and `b.ts` import each other. `domain` is two interfaces. `repo.ts` also imports `react`. `a.test.ts`, `node:fs` and `react` are scanned and hidden until their checkboxes are on.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 4800`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4800/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout; echo; test ! -e $QA/layered/.bindweed/layout.json && echo 'no layout file'`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"`.
   **Expect:** the layout body is `{"version":1,"views":{},"settings":{"tests":false,"external":false}}` and the echo is `no layout file`. The graph has crumbs `layered`, `src`. Three nodes: `app` (package, `"files":2`, row 0), `infra` (`"files":2`, row 1), `domain` (`"files":2`, row 2, `"abstract":true`). `app` and `infra` have no `abstract` field. Three edges: app→infra `"runtime":2,"type":1` and no `heritage`; app→domain `"runtime":0,"type":1` and no `heritage`; infra→domain `"runtime":2,"type":0,"heritage":1`. Nothing named `a.test.ts`, `node:fs` or `react`.

3. Run each command, then `test ! -e $QA/layered/.bindweed/layout.json && echo 'no layout file'`.
   **Expect:** the status and body in its row, then `no layout file`.

   | command | status | body |
   |---|---|---|
   | `curl -si -H "Authorization: Bearer $TOKEN" -X PUT $U/api/layout --data 'not json'` | 400 | `{"error":"bad layout"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/detail?id=missing&at=src"` | 404 | `{"error":"no such node"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=notes"` | 404 | `{"error":"no such directory"}` |
   | `curl -si $U/api/layout` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si -X POST -H "Authorization: Bearer $TOKEN" $U/api/layout` | 404 | `{"error":"not found"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" $U/api/tree` | 200 | top-level entries `notes`, `src`, `tsconfig.json`, in that order |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/file?path=src/domain/shape.ts"` | 200 | `{"path":"src/domain/shape.ts","text":"export interface Shape { draw(): void }\n"}` |

4. Open `http://127.0.0.1:4800/?token=$TOKEN` in the browser, with the token written out.
   **Expect:** the tab title is `bindweed — layered` and the address bar reads `http://127.0.0.1:4800/`. `Files` is the selected tab. The left side shows `layered/`, `notes/`, `src/`, `tsconfig.json`. The right side shows `select a file`. There is no checkbox named `Tests` or `External packages`.

5. Click `Architecture`.
   **Expect:** one box, `src`, reading `6 files`, and no arrow. The toolbar shows unchecked `Tests` and `External packages`, and the buttons `Reset layout` and `Rescan`.

6. Double-click `src`.
   **Expect:** `app` above `infra` above `domain`. `app` and `infra` each read `2 files`. `domain` reads `2 files` and is green (pale green fill, green border); `app` and `infra` are not green. The arrow from `app` to `infra` is solid with a filled head and the label `3`, and its tooltip is `2 runtime · 1 type-only · 0 extends/implements`. The arrow from `app` to `domain` is dashed with a filled head and no label, and its tooltip is `0 runtime · 1 type-only · 0 extends/implements`. The arrow from `infra` to `domain` is solid with a hollow head and the label `2`, and its tooltip is `2 runtime · 0 type-only · 1 extends/implements`. Nothing is red. The address bar reads `http://127.0.0.1:4800/#at=src`.

7. Hover `infra`, then move the pointer off it.
   **Expect:** while hovered, the arrows from `app` to `infra` and from `infra` to `domain` stay bright, and the `app` box, the `domain` box and the dashed arrow are dimmed. Moving away restores them. The address bar does not change.

8. Click `infra`. In the side panel click `domain`.
   **Expect:** the panel is beside the canvas, headed `infra`, and shows the path `src/infra`, the word `package` and `2 files`, not the word `abstract`. Under `Imports` a button shows `domain` and `2 runtime · 0 type-only · 1 extends/implements`. Under `Imported by` a button shows `app` and `2 runtime · 1 type-only · 0 extends/implements`. After the click the `domain` box is the selected one and sits nearest the middle of the canvas. The panel is now headed `domain`, shows `abstract` and `2 files`, and `Imports` has no button. Under `Imported by` one button shows `app` and `0 runtime · 1 type-only · 0 extends/implements`, and one shows `infra` and `2 runtime · 0 type-only · 1 extends/implements`. The address bar still reads `http://127.0.0.1:4800/#at=src`.

9. Double-click `app`, click `a.ts`, then click `db.ts` in the panel.
   **Expect:** after double-clicking `app` the panel is gone, the address bar reads `http://127.0.0.1:4800/#at=src/app`, and the app view shows the red boxes `a.ts` and `b.ts` and no `a.test.ts`. After clicking `a.ts` the panel lists `db.ts` under `Imports`. After clicking `db.ts` the address bar reads `http://127.0.0.1:4800/#at=src/infra`, the `db.ts` box is selected, and the panel is headed `db.ts`, shows the path `src/infra/db.ts`, and under `Imported by` lists `a.ts` and `b.ts` (each `1 runtime · 0 type-only · 0 extends/implements`).

10. Click `src` in the breadcrumb. Drag `domain` until the whole box sits above `app` — the top of `domain` is at least `domain`'s own height above the top of `app` — and drop it.
    **Expect:** `domain` stays where it was dropped. The dashed arrow from `app` to `domain` turns red, stays dashed with a filled head, and its tooltip is `points up: app is drawn below domain`. The arrow from `infra` to `domain` turns red, stays solid with a hollow head and the label `2`, and its tooltip is `points up: infra is drawn below domain`. The arrow from `app` to `infra` stays grey. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` shows `views` with only the key `src`, and under it only the node id `src/domain`, with numeric `x` and `y`. `settings` is still `"tests":false,"external":false`.

11. Open the printed link with `#at=src` added, in a new tab. Then, in that tab, open `http://127.0.0.1:4800/#at=src` with no token.
    **Expect:** the new tab still shows `domain` above `app` and the two red arrows with the same `points up` tooltips. The token-less address shows only `bindweed: use the link bindweed printed in the terminal`.

12. In the first terminal press Ctrl-C. Run `node $BW/src/cli.ts --port 4800` again, set `TOKEN` from the new first line, and open the new printed link with `#at=src`.
    **Expect:** the token differs from step 1. `domain` is still above `app`.

13. Click `Rescan`. Double-click `app`, drag `a.ts` to the right of `b.ts` and drop it, click `src` in the breadcrumb, check `Tests`, then click `Reset layout`. Double-click `app`.
    **Expect:** after Rescan, `domain` is still above `app`. After Reset, `app` is above `infra` and `infra` is above `domain`, no arrow is red, and `Tests` is still checked. Back in `app`, `a.ts` is still to the right of where the layers would put it, and `a.test.ts` is on the canvas because Tests stayed on. The layout JSON has no `src` key, still has `src/app` → `src/app/a.ts`, and `"tests":true`.

14. On the app view, click `Reset layout`. Click `a.ts`, then click `a.test.ts`. Open the printed link with `#at=src/app` in a new tab, then uncheck `Tests` there.
    **Expect:** `Tests` is still checked, and `a.ts` is back beside `b.ts`. `a.test.ts` is above that pair, with a small `test` tag. The arrow from `a.test.ts` to `a.ts` is solid with a filled head and no label, and its tooltip is `1 runtime · 0 type-only · 0 extends/implements`. Under Imported by the only buttons are `b.ts` and `a.test.ts`, each with `1 runtime · 0 type-only · 0 extends/implements`. The `a.test.ts` panel is headed `a.test.ts`. Under Imports the only button is `a.ts` with `1 runtime · 0 type-only · 0 extends/implements`, and Imported by has no button. The new tab opens with `Tests` already checked and that box visible. Unchecking removes the box and leaves `a.ts` and `b.ts` side by side. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` then has `"tests":false`.

15. Click `src` in the breadcrumb and check `External packages`. Open the printed link with `#at=src` in a new tab. In that tab click `infra`, then `node:fs`, then `react`. Check `Tests` as well, look at the row under `domain`, double-click `app`, click `src` in the breadcrumb, and uncheck both boxes.
    **Expect:** `node:fs` and `react`, each with a dashed border, share the row below `domain`, with `node:fs` left of `react`. The arrow from `infra` to `node:fs` and the arrow from `infra` to `react` are each solid with a filled head and no label, and each tooltip is `1 runtime · 0 type-only · 0 extends/implements`. `app` stays above `infra` and `infra` above `domain`. `domain` stays green. The new tab opens with `External packages` already checked, `Tests` unchecked, and both boxes still on that row. Under Imports the only buttons are `domain`, `node:fs` and `react`; `node:fs` and `react` each show `1 runtime · 0 type-only · 0 extends/implements`. The `node:fs` panel is headed `node:fs`, shows the path `node:fs`, the word `external`, and no file count. Imports has no button, and under Imported by the only button is `infra` with `1 runtime · 0 type-only · 0 extends/implements`. The `react` panel is headed `react`, shows the path `react`, the word `external`, and no file count, and reads the same way under Imports and Imported by. With both boxes checked, that row is unchanged, and in the app view `a.test.ts` is on the canvas with its `test` tag while both checkboxes stay checked. Unchecking both removes `node:fs` and `react`. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` then has `"tests":false` and `"external":false`.

16. Save a pin on the cell `react` will want, with externals already on:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src":{"src/domain":{"x":260,"y":420}}},"settings":{"tests":false,"external":true}}'
    ```

    Open the printed link with `#at=src`.
    **Expect:** `External packages` is checked and `Tests` is not. `app` is at data-x 0, data-y 0 and `infra` at data-x 0, data-y 140. `domain` stays at data-x 260, data-y 420. `node:fs` is at data-x 0, data-y 420. `react` has stepped right to data-x 520, data-y 420. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` is still `{"version":1,"views":{"src":{"src/domain":{"x":260,"y":420}}},"settings":{"tests":false,"external":true}}`.

17. In the second terminal save a pin on the cell `main.ts` will want, add that file, and rescan:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src":{"src/app":{"x":200,"y":100},"src/domain":{"x":260,"y":0}}},"settings":{"tests":false,"external":false}}'
    printf "import { a } from './app/a';\n" > $QA/layered/src/main.ts
    curl -s -X POST -H "Authorization: Bearer $TOKEN" $U/api/rescan; echo
    curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"; echo
    ```

    Reload the src view with the printed link.
    **Expect:** the rescan body holds `"files":8` and `"ms"` a number, and it has no `row`. The graph body has `main.ts` at row 0 and `app` at row 1. On the canvas `main.ts` has stepped right past the cell of `app` and the pinned `domain` box to column 2 (data-x 520, data-y 0), while `app` stays at x 200, y 100 and `domain` at x 260, y 0; `infra` is at data-x 0, data-y 280. The pin does not change `row`.

18. Replace the layout with a pin for a file that is not there, and open the domain view:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src/domain":{"src/domain/gone.ts":{"x":0,"y":0}}},"settings":{"tests":false,"external":false}}'
    ```

    Open the printed link with `#at=src/domain`.
    **Expect:** the only boxes are `model.ts` and `shape.ts`, both green, with `model.ts` the leftmost and one column between them — the same spacing `a.ts` and `b.ts` had before any pin, not a vacant column to the left of `model.ts`. There is no box named `gone.ts`. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` still contains `src/domain/gone.ts`.

19. Click `shape.ts`, then double-click it. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/file?path=src/domain/model.ts"`.
    **Expect:** after the click the panel is headed `shape.ts`, shows the path `src/domain/shape.ts`, the word `file`, the word `abstract`, no file count, and under `Imported by` shows `repo.ts` with `1 runtime · 0 type-only · 1 extends/implements`. After the double-click the panel is gone, the page is on the Files tab, the right side shows the header `src/domain/shape.ts` and line 1 `export interface Shape { draw(): void }`, and the address bar reads `http://127.0.0.1:4800/#file=src/domain/shape.ts`. The curl body is `{"path":"src/domain/model.ts","text":"export interface Model { id: number }\n"}`.

20. Overwrite the layout with bytes that are not JSON, then reject a later write. In the second terminal:

    ```sh
    printf 'not json' > $QA/layered/.bindweed/layout.json
    cp $QA/layered/.bindweed/layout.json /tmp/layout-corrupt
    curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout; echo
    cmp /tmp/layout-corrupt $QA/layered/.bindweed/layout.json && echo 'corrupt bytes unchanged'
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src":{"src/domain":{"x":3,"y":4}}},"settings":{"tests":true,"external":false}}'
    echo
    cp $QA/layered/.bindweed/layout.json /tmp/layout-valid
    curl -si -H "Authorization: Bearer $TOKEN" -X PUT $U/api/layout --data 'not json'
    cmp /tmp/layout-valid $QA/layered/.bindweed/layout.json && echo 'valid bytes unchanged'
    ```

    **Expect:** the GET body is `{"version":1,"views":{},"settings":{"tests":false,"external":false}}` and the first `cmp` prints `corrupt bytes unchanged`. The PUT of the document returns that same JSON. The PUT of `not json` is status 400 and body `{"error":"bad layout"}`. The second `cmp` prints `valid bytes unchanged`.

21. Pin `a.ts` more than half a box above `b.ts` and open the app view:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src/app":{"src/app/a.ts":{"x":0,"y":-400}}},"settings":{"tests":false,"external":false}}'
    ```

    Open the printed link with `#at=src/app`.
    **Expect:** `a.ts` sits more than half a box above `b.ts`. Both boxes stay red. The arrow from `b.ts` to `a.ts` is solid with a filled head and no number, and its tooltip is `points up: b.ts is drawn below a.ts`, not the cycle sentence. The arrow from `a.ts` to `b.ts` has the tooltip `a.ts → b.ts → a.ts`.

22. In the first terminal press Ctrl-C, then run `sed -n '/## Routes/,/## Environment/p' $BW/README.md` and `rm -rf $QA`.
    **Expect:** the Routes table has live rows for `/api/graph`, `/api/rescan`, `/api/layout` and `/api/detail`, and the earlier live rows for `/`, `/assets/`, `/api/tree` and `/api/file` are still there. The playground is gone.
