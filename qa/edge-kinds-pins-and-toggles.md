# QA: arrows show the kind of dependency, and dragged boxes stay put

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 4800, clear of every port in `qa/serve-the-file-tree.md` and of 4700 in `qa/layered-package-view.md`.

`src/domain/model.ts` is an interface in this fixture, not the class from the 002 procedure. A package is green only when every file in it is types, and the 002 class is not. The 002 files are not edited.

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
printf "import { readFileSync } from 'node:fs';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n" > src/infra/repo.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export QA=$QA U=http://127.0.0.1:4800"
```

Paste the `export` line it prints into the second terminal. `app` imports `infra` twice at runtime and once type-only, and `domain` once type-only through the `@domain/*` alias. `infra` imports `domain` twice at runtime, and `repo.ts` implements `Shape`. `a.ts` and `b.ts` import each other. `domain` is two interfaces. `a.test.ts` and `node:fs` are scanned and hidden until their checkboxes are on.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 4800`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4800/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout; echo; test ! -e $QA/layered/.bindweed/layout.json && echo 'no layout file'`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"`.
   **Expect:** the layout body is `{"version":1,"views":{},"settings":{"tests":false,"external":false}}` and the echo is `no layout file`. The graph has crumbs `layered`, `src`. Three nodes: `app` (package, `"files":2`, row 0), `infra` (`"files":2`, row 1), `domain` (`"files":2`, row 2, `"abstract":true`). `app` and `infra` have no `abstract` field. Three edges: app→infra `"runtime":2,"type":1` and no `heritage`; app→domain `"runtime":0,"type":1` and no `heritage`; infra→domain `"runtime":2,"type":0,"heritage":1`. Nothing named `a.test.ts` or `node:fs`.

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
   **Expect:** the panel is beside the canvas, headed `infra`, and shows the path `src/infra`, the word `package` and `2 files`, not the word `abstract`. Under `Imports` a button shows `domain` and `2 runtime · 0 type-only · 1 extends/implements`. Under `Imported by` a button shows `app` and `2 runtime · 1 type-only · 0 extends/implements`. After the click the `domain` box is the selected one and sits nearest the middle of the canvas. The panel is now headed `domain`, shows `abstract`, and `Imports` has no button. The address bar still reads `http://127.0.0.1:4800/#at=src`.

9. Double-click `app`, click `a.ts`, then click `db.ts` in the panel.
   **Expect:** the app view shows the red boxes `a.ts` and `b.ts` and no `a.test.ts`. The panel for `a.ts` lists `db.ts` under `Imports`. After clicking it the address bar reads `http://127.0.0.1:4800/#at=src/infra`, the `db.ts` box is selected, and the panel is headed `db.ts`.

10. Click `src` in the breadcrumb. Drag `domain` until the whole box sits above `app`, and drop it.
    **Expect:** `domain` stays where it was dropped. The dashed arrow from `app` to `domain` turns red and its tooltip is `points up: app is drawn below domain`. The hollow arrow from `infra` to `domain` turns red and its tooltip is `points up: infra is drawn below domain`. The arrow from `app` to `infra` stays grey. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` shows `src/domain` under `views` → `src`, with numeric `x` and `y`, and `settings` still `"tests":false,"external":false`.

11. Open the printed link with `#at=src` added, in a new tab. Then, in that tab, open `http://127.0.0.1:4800/#at=src` with no token.
    **Expect:** the new tab still shows `domain` above `app` and the two red arrows with the same `points up` tooltips. The token-less address shows only `bindweed: use the link bindweed printed in the terminal`.

12. In the first terminal press Ctrl-C. Run `node $BW/src/cli.ts --port 4800` again, set `TOKEN` from the new first line, and open the new printed link with `#at=src`.
    **Expect:** the token differs from step 1. `domain` is still above `app`.

13. Click `Rescan`. Double-click `app`, drag `a.ts` to the right of `b.ts` and drop it, click `src` in the breadcrumb, click `Reset layout`, then double-click `app` again.
    **Expect:** after Rescan, `domain` is still above `app`. After Reset, `app` is above `infra` and `infra` is above `domain`, and no arrow is red. Back in `app`, `a.ts` is still to the right of where the layers would put it. In the second terminal the layout JSON has no `src` key and still has `src/app` → `src/app/a.ts`.

14. On the app view, click `Reset layout`, then check `Tests`. Open the printed link with `#at=src/app` in a new tab, then uncheck `Tests` there.
    **Expect:** checking it shows a box `a.test.ts` above the red pair, with a small `test` tag, and an arrow from `a.test.ts` to `a.ts`. The new tab opens with `Tests` already checked and that box visible. Unchecking removes the box and leaves `a.ts` and `b.ts` side by side. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` then has `"tests":false`.

15. Open the src view and check `External packages`, then uncheck it.
    **Expect:** a box `node:fs` with a dashed border appears below `domain`, with an arrow from `infra` to it. `domain` stays green and stays above `node:fs`. The `app`, `infra` and `domain` rows are otherwise unchanged. Unchecking removes the `node:fs` box. The layout JSON has `"external":false` after the uncheck.

16. In the second terminal save a pin on the cell `main.ts` will want, add that file, and rescan:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src":{"src/app":{"x":0,"y":0}}},"settings":{"tests":false,"external":false}}'
    printf "import { a } from './app/a';\n" > $QA/layered/src/main.ts
    curl -s -X POST -H "Authorization: Bearer $TOKEN" $U/api/rescan
    ```

    Reload the src view with the printed link.
    **Expect:** the rescan body holds `"files":8`. On the canvas `app` and `main.ts` share the top row, with `main.ts` to the right of `app`, not on top of it. `infra` is below that row and `domain` below `infra`. The graph JSON still gives `main.ts` row 0 and `app` row 1: the pin does not change `row`.

17. Replace the layout with a pin for a file that is not there, and open the domain view:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT $U/api/layout \
      --data '{"version":1,"views":{"src/domain":{"src/domain/gone.ts":{"x":0,"y":0}}},"settings":{"tests":false,"external":false}}'
    ```

    Open the printed link with `#at=src/domain`.
    **Expect:** the only boxes are `model.ts` and `shape.ts`, both green, with `model.ts` the leftmost and one column between them — the same spacing `a.ts` and `b.ts` had before any pin, not a vacant column to the left of `model.ts`. There is no box named `gone.ts`. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/layout` still contains `src/domain/gone.ts`.

18. Double-click `shape.ts`. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/file?path=src/domain/model.ts"`.
    **Expect:** the page is on the Files tab, the right side shows the header `src/domain/shape.ts` and line 1 `export interface Shape { draw(): void }`, and the address bar reads `http://127.0.0.1:4800/#file=src/domain/shape.ts`. The curl body is `{"path":"src/domain/model.ts","text":"export interface Model { id: number }\n"}`.

19. In the first terminal press Ctrl-C, then run `grep -n 'api/layout\|api/detail\|api/graph\|api/rescan' $BW/README.md` and `rm -rf $QA`.
    **Expect:** the Routes table has live rows for `/api/graph`, `/api/rescan`, `/api/layout` and `/api/detail`, and the earlier live rows for `/`, `/assets/`, `/api/tree` and `/api/file` are still there. The playground is gone.
