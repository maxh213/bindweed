# QA: plan a refactor on the canvas

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 5000, clear of 4477, 4700, 4800 and 4900.

The tree is the 004 layered repository plus `src/app/save.ts` (`export const save = 1;`, no imports). The checked-in `qa/fixtures/layered` is the older four-file tree and is not this one. `save.ts` is here so that moving it does not itself draw or remove an arrow. The QA role, not the coder, writes the end-to-end test for this procedure. The coder writes no file under `qa/`.

A plan never edits the repository. `.bindweed/` is gitignored, so `git status --porcelain` stays empty while a plan exists. The en dash below is `–` (U+2013). Where JSON is expected, key order may differ, and a key the expected body omits is absent.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p $QA/layered/src/app $QA/layered/src/domain $QA/layered/src/infra $QA/layered/notes && cd $QA/layered
printf '%s\n' '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}' > tsconfig.json
printf '# notes\n' > notes/readme.md
printf "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n" > src/app/a.ts
printf "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n" > src/app/b.ts
printf "import { a } from './a';\n" > src/app/a.test.ts
printf 'export const save = 1;\n' > src/app/save.ts
printf 'export interface Model { id: number }\n' > src/domain/model.ts
printf 'export interface Shape { draw(): void }\n' > src/domain/shape.ts
printf "import { Model } from '../domain/model';\nexport const query = new Model();\n" > src/infra/db.ts
printf "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n" > src/infra/repo.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export QA=$QA U=http://127.0.0.1:5000"
```

Paste the `export` line into the second terminal. `app` imports `domain` once, type-only, from `a.ts` through `@domain/model`. `save.ts` imports nothing.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 5000`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:5000/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token and `HEAD` to `git rev-parse HEAD`.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"; echo`, then `git -C $QA/layered status --porcelain`.
   **Expect:** the plans body is `{"plans":[]}`. The graph's `app` node has `"files":3`, `infra` has `"files":2` and `domain` has `"files":2` and `"abstract":true`. There is no `planned` field. `git status` prints nothing.

3. Run each command.
   **Expect:** the status and body in its row.

   | command | status | body |
   |---|---|---|
   | `curl -si -H "Authorization: Bearer $TOKEN" -X POST $U/api/plans --data 'not json'` | 400 | `{"error":"bad name"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" -X POST $U/api/plans --data '{"name":"!!!"}'` | 400 | `{"error":"bad name"}` |
   | `curl -si $U/api/plans` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" $U/api/plans/nope` | 404 | `{"error":"no such plan"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" $U/api/tree` | 200 | top-level entries `notes`, `src`, `tsconfig.json` |
   | `curl -si -H "Authorization: Bearer $TOKEN" "$U/api/file?path=src/app/save.ts"` | 200 | `{"path":"src/app/save.ts","text":"export const save = 1;\n"}` |

   Then `git -C $QA/layered status --porcelain; find $QA/layered/.bindweed/plans -type f 2>/dev/null | wc -l`.
   **Expect:** git status prints nothing, and the count is `0`. `.bindweed` itself may exist.

4. Open `http://127.0.0.1:5000/?token=$TOKEN#at=src` in the browser, with the token written out.
   **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src`. The Plan combobox shows `No plan` and `Delete plan` is disabled. There is no `Now` / `Planned` switch and no change list. No box lists file names. `app` reads `3 files`, `infra` reads `2 files`, `domain` reads `2 files` and is green. Nothing is red.

5. Drag `domain` until its top is at least its own height above `app`, and drop it. Click `Reset layout`.
   **Expect:** after the drop, `domain` stays where it was dropped. After Reset, `app` is above `infra` and `infra` is above `domain`. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans` is still `{"plans":[]}`.

6. Click `New plan…`, then `Cancel`. Click `New plan…` again, click `Create` without a name, then type `Split app` and click `Create`.
   **Expect:** Cancel closes the dialogue and no plan exists. An empty name shows `write a name` and still no plan exists. After Create, the address bar reads `http://127.0.0.1:5000/#at=src&plan=split-app`, the combobox shows `Split app`, `Planned` is selected, and the change list is empty. The `app` box lists `a.ts`, `b.ts` and `save.ts`.

7. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/split-app; echo` and `git -C $QA/layered status --porcelain && echo clean`.
   **Expect:** the document has `"name":"Split app"`, `"slug":"split-app"`, `"version":1`, `"edits":[]`, `"redo":[]`, `"baseCommit"` equal to `$HEAD`, and `"createdAt"` matching `YYYY-MM-DDTHH:MM:SS.mmmZ`. `git status` prints `clean`.

8. Double-click `app`. Drag the `save.ts` box onto the `src` breadcrumb, then click `Undo`. Drag the `save.ts` box onto the `layered` breadcrumb and click the new entry. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/split-app; echo` and `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=&plan=split-app"; echo`. Back in the browser click `Undo`, then double-click the `src` box.
   **Expect:** the first drop's entry reads `Move src/app/save.ts to src`, and Undo clears the list with `save.ts` back in `app`. The root drop's entry reads `Move src/app/save.ts to .`, and clicking it opens the root view at `http://127.0.0.1:5000/#at=&plan=split-app` with the `save.ts` box selected beside the `src` box, which reads `6 files`. The plan document holds the edit `{"kind":"move-file","file":"src/app/save.ts","to":"."}` and the graph body has `"stale":[null]`. After the last Undo the list is empty, and on `src` the `app` box still lists `a.ts`, `b.ts` and `save.ts`.

9. Drag the `save.ts` row of `app` onto the `app` box. Then drag it onto the `infra` box.
   **Expect:** the first drop adds no entry. After the second, the only entry is `Move src/app/save.ts to src/infra`. `infra` reads `3 files` and lists `db.ts`, `repo.ts` and `save.ts`. `app` reads `2 files`, lists `a.ts` and `b.ts`, and shows a faint dashed ghost row `save.ts`. `test -f $QA/layered/src/app/save.ts && test ! -e $QA/layered/src/infra/save.ts && echo 'still on disk'` prints `still on disk`.

10. Click that entry. Click `src` in the breadcrumb, then double-click `app`. Click `src` again.
    **Expect:** the address bar first reads `http://127.0.0.1:5000/#at=src/infra&plan=split-app`, and the `save.ts` box is selected at the right of `db.ts` and `repo.ts`. In `app`, `a.ts` and `b.ts` are on the row and a faint dashed ghost box `save.ts` sits to the right of `b.ts`. After the last click the address bar reads `http://127.0.0.1:5000/#at=src&plan=split-app`.

11. Click the arrow from `app` to `domain` and press Delete.
    **Expect:** the list ends with `src/app must not import src/domain (1 import)`. The ordinary arrow from `app` to `domain` is gone. A thin dashed grey line with a ✂ joins them. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/split-app` has a second edit `{"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}`.

12. Drag the draw handle on `infra` onto `app`. Drag that handle onto `app` again. Then drag the handle on `app` onto `app`.
    **Expect:** the first drag adds `src/infra should use src/app`. `app` and `infra` are on one row, `infra` to the right of `app`, both red. `domain` is below them and still green. The new arrow is dashed and red, and its tooltip is `infra → app → infra`. The arrow from `app` to `infra` is red, labelled `3`, tooltip `app → infra → app`. The second drag shows the notice `src/infra already imports src/app` and adds no entry. The self-drop shows `a box cannot depend on itself` and adds no entry. The list has three entries.

13. Click the empty canvas, then press Ctrl+Z. Press Ctrl+Shift+Z.
    **Expect:** after Ctrl+Z the `should use` entry is gone, nothing is red, and `app` is above `infra` and `infra` is above `domain`. The ✂ line remains. After Ctrl+Shift+Z the entry is back and `app` and `infra` are red again on one row.

14. Click the dashed arrow from `infra` to `app` and press `Delete`. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/split-app; echo`. Drag the draw handle on `infra` onto `app`. Click that arrow, open its menu, and choose `Cut`. Run the curl again. Drag the handle onto `app` once more.
    **Expect:** after `Delete` the `should use` entry is gone, nothing is red, and the document holds exactly the move and the cut with `"redo":[]` — no `cut-edge` naming `src/infra` was stored. The first re-drag restores the entry and the red row. The menu's `Cut` removes it the same way, and the second curl shows the same two edits. After the last drag the list again ends with `src/infra should use src/app`, and `app` and `infra` are red.

15. Click `domain`, open its menu, choose `Add note`, click `Add` with no text, then type `pull an interface out here` and click `Add`. Double-click `app` and click the entry `src/app must not import src/domain (1 import)`. Double-click `app` again and click the entry `Note on src/domain: "pull an interface out here"`.
    **Expect:** the empty note shows `write a note` and adds no entry. Afterwards `domain` has a small note marker, and hovering it shows `pull an interface out here`. The list ends with `Note on src/domain: "pull an interface out here"`. The `should use` entry is still there. Clicking the cut entry from the `app` view opens `http://127.0.0.1:5000/#at=src&plan=split-app` with the ✂ marker selected and the canvas centred halfway between the `app` and `domain` boxes. Clicking the note entry from the `app` view opens the same address with the `domain` box selected and centred in the canvas.

16. Reload the page.
    **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src&plan=split-app`. `Planned` is selected. The four entries are there. `app` and `infra` are red. The ghost row is in `app`, `save.ts` is listed in `infra`, the ✂ line is there, and the note marker still shows `pull an interface out here` on hover.

17. In the first terminal press Ctrl-C. Run `node $BW/src/cli.ts --port 5000` again, set `TOKEN` from the new first line, and open the new printed link with `#at=src&plan=split-app`.
    **Expect:** the token differs from step 1. The same four entries, the red row, the ghost, the ✂ and the note are all there. Double-click the `save.ts` row in `infra`. The Files tab shows the header `src/app/save.ts` and line 1 `export const save = 1;`. Click `Architecture`. The address bar reads `http://127.0.0.1:5000/#at=src&plan=split-app` and the plan is back.

18. Choose `Now`. Click `Metrics` once. Choose `Planned`. Click the `domain` box.
    **Expect:** on Now, `app` is above `infra` and `infra` is above `domain`, nothing is red, `app` reads `3 files` and lists `save.ts`, and `infra` shows a ghost row `save.ts`. The ordinary dashed arrow from `app` to `domain` is back, with the ✂ as well. A dashed blue arrow runs from `infra` up to `app` and is not red. The Metrics table is open and its rows are `infra`, `app`, `domain`. `app` reads Files 3 and `domain` reads Ca 3. After choosing Planned the table stays open: `app` reads Files 2, `infra` reads Files 3, and `domain` reads Ca 2. The details panel is headed `domain` and under Imported by the only button is `infra`.

19. In the second terminal run `rm $QA/layered/src/app/save.ts`. In the browser click `Rescan`. Then restore the file and rescan again:

    ```sh
    printf 'export const save = 1;\n' > $QA/layered/src/app/save.ts
    ```

    Click `Rescan` again. Then `git -C $QA/layered status --porcelain && echo clean`.
    **Expect:** after the first Rescan the move entry is yellow and shows `no such file src/app/save.ts`, and the other three entries are not yellow. After the restore and the second Rescan the move entry is not yellow. `git status` prints `clean`.

20. Double-click `infra`, click `save.ts`, and add the note `keep the writer here`. Click `src` in the breadcrumb. Click `×` on `Move src/app/save.ts to src/infra`.
    **Expect:** the new entry is `Note on src/infra/save.ts: "keep the writer here"`. After the `×`, that move entry is gone, and the new note's entry is yellow and shows `no such box src/infra/save.ts`. The cut, the `should use` entry and the domain note are not yellow. `app` and `infra` are still red.

21. Click `Delete plan`, then `Cancel`. Click `Delete plan`, then `Delete`.
    **Expect:** Cancel leaves `Split app` in the combobox and `plan=split-app` in the address. Delete clears it. The combobox shows `No plan`, the address bar reads `http://127.0.0.1:5000/#at=src`, `app` reads `3 files`, and no box lists file names. `curl -si -H "Authorization: Bearer $TOKEN" $U/api/plans/split-app` is status 404 and body `{"error":"no such plan"}`.

22. Create a plan named `Split app`, then another named `Split app`. Choose the second. Delete the open plan, choose the remaining `Split app`, and delete that too.
    **Expect:** the combobox offers `Split app` and `Split app (split-app-2)`. Choosing the second puts `plan=split-app-2` in the address. After both deletes the combobox shows `No plan`.

23. In the first terminal press Ctrl-C, then run `sed -n '/## Routes/,/## Environment/p' $BW/README.md`, `git -C $QA/layered status --porcelain && echo clean`, and `rm -rf $QA`.
    **Expect:** the Routes table has a live row for `/api/plans`, and the live rows for `/`, `/assets/`, `/api/tree`, `/api/file`, `/api/graph`, `/api/rescan`, `/api/layout` and `/api/detail` are still there. `git status` prints `clean`. The playground is gone.
