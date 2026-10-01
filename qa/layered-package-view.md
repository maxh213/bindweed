# QA: bindweed shows the architecture as layered boxes

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 4700, clear of every port in `qa/serve-the-file-tree.md`, so the two never fight.

## Setup

Port 4700 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p $QA/layered/src/app $QA/layered/src/domain $QA/layered/src/infra $QA/layered/notes && cd $QA/layered
printf '%s\n' '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}' > tsconfig.json
printf '# notes\n' > notes/readme.md
printf "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\n" > src/app/a.ts
printf "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n" > src/app/b.ts
printf 'export class Model { id = 0; }\n' > src/domain/model.ts
printf "import { Model } from '../domain/model';\nexport const query = new Model();\n" > src/infra/db.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
mkdir -p $QA/workspace/packages/core/src $QA/workspace/packages/web/src && cd $QA/workspace
printf '%s\n' '{"name":"acme","private":true,"workspaces":["packages/*"]}' > package.json
printf '%s\n' '{"name":"@acme/core","version":"1.0.0","main":"src/index.ts"}' > packages/core/package.json
printf "export const greet = 'hi';\n" > packages/core/src/index.ts
printf '%s\n' '{"name":"@acme/web","version":"1.0.0","main":"src/index.ts"}' > packages/web/package.json
printf "import { greet } from '@acme/core';\nexport const msg = greet;\n" > packages/web/src/index.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
cd $QA/layered
echo "export QA=$QA U=http://127.0.0.1:4700"
```

Paste the `export` line it prints into the second terminal. The `layered` fixture: `app` imports `infra` twice and `domain` once (type-only, through the `@domain/*` tsconfig alias), `a.ts` and `b.ts` import each other, `infra` imports `domain`, `domain` imports nothing; `notes/` has no code at all. Where JSON is expected, the order of keys, nodes and edges may differ.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 4700`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4700/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/graph`, then the same with `$U/api/graph?at=`.
   **Expect:** both answer `{"at":"","crumbs":[{"name":"layered","at":""}],"nodes":[{"id":"src","kind":"package","name":"src","path":"src","files":4,"row":0,"order":0,"cycle":false}],"edges":[]}`. The `notes` folder appears nowhere.

3. Run `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"`.
   **Expect:** crumbs `layered`, `src`. Three nodes, all `cycle:false`: `app` (package, `"files":2`, row 0), `infra` (`"files":1`, row 1), `domain` (`"files":1`, row 2). Three edges: app→infra `"runtime":2,"type":0`, app→domain `"runtime":0,"type":1`, infra→domain `"runtime":1,"type":0` — the alias import and the `import type` are counted here.

4. Run `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src/app"`.
   **Expect:** two file nodes, `a.ts` (row 0, order 0) and `b.ts` (row 0, order 1), both `"cycle":true`; two edges, a.ts→b.ts and b.ts→a.ts, each `"runtime":1,"type":0,"cycle":true` with `cycleText` `a.ts → b.ts → a.ts` and `b.ts → a.ts → b.ts`. No other edge: the imports to infra and domain lie outside this view.

5. Run each command.
   **Expect:** the status and body in its row.

   | command | status | body |
   |---|---|---|
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=notes"` | 404 | `{"error":"no such directory"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=tsconfig.json"` | 404 | `{"error":"no such directory"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=.."` | 404 | `{"error":"no such directory"}` |
   | `curl -si $U/api/graph` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si -X POST $U/api/rescan` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si -H "Host: evil.example:4700" "$U/api/graph?token=$TOKEN"` | 403 | `{"error":"bad host"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" $U/api/rescan` | 404 | `{"error":"not found"}` |

6. Run `curl -si -X POST -H "Authorization: Bearer $TOKEN" $U/api/rescan`, then `ls $QA/layered/.bindweed/cache`.
   **Expect:** status 200, a JSON body with `"files":4` and `"ms"` a number; the cache listing shows `scan.json`.

7. Run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/tree` and `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/file?path=src/domain/model.ts"`.
   **Expect:** the tree's top-level entries are `notes`, `src` and `tsconfig.json`; the file body is `{"path":"src/domain/model.ts","text":"export class Model { id = 0; }\n"}`. The 001 routes are unchanged.

8. Open `http://127.0.0.1:4700/?token=$TOKEN` in the browser, with the token written out.
   **Expect:** the tab title is `bindweed — layered` and the address bar reads `http://127.0.0.1:4700/`. The tab bar holds `Files` and `Architecture`, with `Files` selected. The left side shows the rows `layered/`, `notes/`, `src/`, `tsconfig.json`; the right side shows `select a file`.

9. Click `Architecture`.
   **Expect:** `Architecture` is the selected tab; the canvas shows one box, `src`, reading `4 files`, and no arrow. The address bar reads `http://127.0.0.1:4700/#at=`.

10. Double-click the `src` box.
    **Expect:** boxes `app` above `infra` above `domain`; `app` reads `2 files`, the other two `1 file`. An arrow runs from `app` to `infra` labelled `2`, one from `app` to `domain` and one from `infra` to `domain`, both without a label. Nothing is red. The breadcrumb shows `layered / src`; the address bar reads `http://127.0.0.1:4700/#at=src`.

11. Double-click the `app` box.
    **Expect:** the box `a.ts` left of the box `b.ts` in one row, both red; the arrow from `a.ts` to `b.ts` and the one from `b.ts` to `a.ts` are both red; no other box or arrow is shown. Hovering the first arrow shows the tooltip `a.ts → b.ts → a.ts`, the second `b.ts → a.ts → b.ts`. The breadcrumb shows `layered / src / app`; the address bar reads `http://127.0.0.1:4700/#at=src/app`.

12. Press the browser's Back button twice.
    **Expect:** first the `src` view from step 10, address `…/#at=src`; then the root view with the one `src` box, address `…/#at=`.

13. Double-click `src`, click `layered` in the breadcrumb, double-click `src` again, double-click `domain`, then double-click the `model.ts` box.
    **Expect:** the breadcrumb click returns to the root view. At the end the page is on the Files tab, the right side shows the header `src/domain/model.ts` and line 1 `export class Model { id = 0; }`, the tree row `model.ts` is selected, and the address bar reads `http://127.0.0.1:4700/#file=src/domain/model.ts`.

14. Open `http://127.0.0.1:4700/?token=$TOKEN#at=src/app` in a new browser tab, with the token written out.
    **Expect:** the Architecture tab is selected and shows the red `a.ts` and `b.ts` boxes; the breadcrumb shows `layered / src / app`; the address bar keeps `#at=src/app`.

15. In the Architecture tab, drag the empty canvas, then zoom in and out with the wheel.
    **Expect:** the boxes move and scale together when panning and zooming. Dragging a box is specified by `qa/edge-kinds-pins-and-toggles.md`, not by this procedure.

16. In the second terminal run `printf "import { a } from './app/a';\n" > $QA/layered/src/main.ts`. In the browser go back to the `src` view and click `Rescan`.
    **Expect:** a `main.ts` box appears on a new top row above `app`, with an arrow from `main.ts` to `app`.

17. Run `printf "import { a } from './a';\n" > $QA/layered/src/app/a.test.ts`, then `curl -s -X POST -H "Authorization: Bearer $TOKEN" $U/api/rescan`. In the browser double-click `app`.
    **Expect:** the rescan body holds `"files":6`; the view still shows only the two red boxes `a.ts` and `b.ts` — the test file was scanned but no `a.test.ts` box and no third arrow appears.

18. Run `printf "import { readFileSync } from 'node:fs';\nexport const rf = readFileSync;\n" > $QA/layered/src/infra/env.ts`, then the rescan curl again, and look at the `src` view.
    **Expect:** the rescan body holds `"files":7`; the view shows the `main.ts`, `app`, `infra` and `domain` boxes with the same four arrows as after step 16 — nothing named `node:fs`, no fifth arrow.

19. In the first terminal press Ctrl-C, then run `cd $QA/workspace && node $BW/src/cli.ts --port 4700`. Set `TOKEN` from its first line, run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/graph`, then open the newly printed link in the browser and click `Architecture`.
    **Expect:** the JSON holds nodes `@acme/web` (row 0) and `@acme/core` (row 1) and one edge from `packages/web` to `packages/core` with `"runtime":1`. The page shows the `@acme/web` box above the `@acme/core` box with an arrow from `@acme/web` to `@acme/core`; the breadcrumb shows `workspace`.

20. In the first terminal press Ctrl-C, then run `grep -n 'api/graph\|api/rescan' $BW/README.md` and `rm -rf $QA`.
    **Expect:** two README lines, one naming `/api/graph` and one `/api/rescan`, both in the Routes table marked `live`. The playground is gone.
