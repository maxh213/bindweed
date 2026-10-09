# QA: reshape packages in a plan

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). The tree is the one built by the Setup in `qa/plan-moves-and-edges.md`: the layered repository plus `src/app/save.ts`. The checked-in `qa/fixtures/layered` has no `shape.ts` and is not this tree. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

A plan never edits the repository. `.bindweed/` is gitignored, so `git status --porcelain` stays empty. The en dash in a metric is `–` (U+2013). The ellipsis in `Fold into…` is `…` (U+2026). Where JSON is expected, key order may differ, and a key the expected body omits is absent.

## Setup

Do the Setup in `qa/plan-moves-and-edges.md`, including the commit. It leaves `QA` and `U` set and the shell in `$QA/layered`. Port 5000 must be free.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 5000`.
   **Expect:** stdout shows `bindweed: http://127.0.0.1:5000/?token=` and 32 hex characters, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/pairs?from=src/app&to=src/infra&at=src"; echo`, then `git -C $QA/layered status --porcelain`.
   **Expect:** plans is `{"plans":[]}`. The graph has no `planned` field, no `stale` key and no `warnings` key, and `domain` has `"files":2` and `"abstract":true`. Pairs are `src/app/a.ts`→`src/infra/db.ts`, `src/app/a.ts`→`src/infra/repo.ts` and `src/app/b.ts`→`src/infra/db.ts`. Git prints nothing.

3. Open `http://127.0.0.1:5000/?token=$TOKEN#at=src`. Create a plan named `Reshape` (Cancel and an empty name still write nothing, as in 005).
   **Expect:** there is no `Canvas` button until the plan exists. After Create, the address bar reads `http://127.0.0.1:5000/#at=src&plan=reshape`, `Planned` is selected, and the change list is empty. `app` reads `3 files`, `infra` reads `2 files`, `domain` reads `2 files`.

4. Open `Canvas` and choose `New package`. Click `Create` with no name, then type `has space`, then type `infra`, then type `ports`, clicking `Create` each time.
   **Expect:** the empty name shows `write a name`, `has space` shows `bad name`, and `infra` shows `src/infra already exists`. The list stays empty until `ports`. The only entry is `Create package src/ports`. A `ports` box reads `0 files` and lists nothing. Under the entry is `src/ports is empty`. The `Changes` heading has a badge `1` whose accessible name is `1 warning`. `test ! -e $QA/layered/src/ports && echo 'not on disk'` prints `not on disk`.

5. Double-click `app`. On `save.ts` choose `Rename`, type `b` and click `Rename`, then type `writer` and click `Rename`. Click `Undo`.
   **Expect:** `b` shows `src/app/b.ts already exists` and adds no entry. `writer` adds `Rename src/app/save.ts to writer.ts` and the box is named `writer.ts`. Undo leaves only `Create package src/ports`, and the box is `save.ts` again.

6. Click `src` in the breadcrumb. Drag the `shape.ts` row of `domain` onto `ports`.
   **Expect:** the empty warning and the badge are gone. `ports` reads `1 file`, lists `shape.ts` and is green. `domain` reads `1 file`, lists `model.ts`, and has a faint dashed ghost row `shape.ts`. The new entry is `Move src/domain/shape.ts to src/ports`. `test -f $QA/layered/src/domain/shape.ts && echo 'still on disk'` prints `still on disk`.

7. On `infra` choose `Rename`, type `adapters` and click `Rename`.
   **Expect:** the entry is `Rename src/infra to src/adapters`. There is no `infra` box. `adapters` lists `db.ts` and `repo.ts`. The move entry still says `src/ports`, not a renamed path. A solid arrow with a hollow head runs from `adapters` to `ports`.

8. On `app` choose `Split`. Click `Split` with both names empty. Type `has space` in `Part 1` and `write` in `Part 2` and click `Split`. Type `read` in both and click `Split`. Type `read` in `Part 1` and `write` in `Part 2`, leave `a.ts` on `choose`, and click `Split`. Type `a.ts` in `Part 1` and `write` in `Part 2`, assign every file, and click `Split`. Then set `Part 1` back to `read`, set `a.test.ts` and `a.ts` to `read`, and `b.ts` and `save.ts` to `write`, and click `Split`. Click `layered` in the breadcrumb, then click `src`.
   **Expect:** the `Split package` dialogue opens with exactly two name fields, `Part 1` and `Part 2`, and one select per file, `a.test.ts`, `a.ts`, `b.ts` and `save.ts`, each on `choose`. The empty click shows `name at least two parts`. `has space` shows `bad name`. Both fields `read` shows `duplicate part`. The unassigned `a.ts` shows `assign every file`. The part name `a.ts` shows `src/app/a.ts already exists`. None of those clicks adds an entry. The list then ends with `Split src/app into src/app/read (2 files) and src/app/write (2 files)`. There is no `app` box. `read` is on the left of the top row and `write` is on its right; both are red. The entry shows `this plan adds a cycle: read → write → read`. The badge reads `1`. On `layered` the only box is `src`, the address bar reads `http://127.0.0.1:5000/#at=&plan=reshape`, and the badge still reads `1` with that same cycle sentence. `src` returns to `#at=src&plan=reshape`.

9. Click `read`, Shift-click `write`, and choose `Merge`. Click `Merge` with no name. Type `read` and click `Merge`. Click `Undo`. Select `read` and `write` again, choose `Merge`, type `adapters` and click `Merge`, then type `app` and click `Merge`.
   **Expect:** the empty name shows `write a name` and adds no entry. `read` adds `Merge src/app/read and src/app/write into src/app/read`. `write` is gone. `read` reads `3 files` and lists `a.ts`, `b.ts` and `save.ts`. The badge is gone. Undo brings `read` and `write` back, restores the cycle sentence, and the badge reads `1`. `adapters` shows `src/adapters already exists` and adds no entry. `app` adds `Merge src/app/read and src/app/write into src/app`. The `app` box is back, reads `3 files` and lists `a.ts`, `b.ts` and `save.ts`. `read` and `write` are gone. The cycle warning and the badge are gone.

10. Double-click `domain`. On `model.ts` choose `Delete`. Click `Show importers` on that entry.
    **Expect:** the entry is `Delete src/domain/model.ts`. The `model.ts` box is struck through. The entry shows `2 files still import src/domain/model.ts, which this plan deletes`, and expanding it lists `src/adapters/db.ts` then `src/app/a.ts`. The badge reads `1`.

11. Click `src` in the breadcrumb, then double-click `adapters`. On `repo.ts` choose `Fold into…`. Click the `repo.ts` box. Then click `src`, then click the `shape.ts` row of `ports`.
    **Expect:** the notice reads `click a file to fold src/adapters/repo.ts into`. Clicking `repo.ts` shows `a file cannot fold into itself` and adds no entry. The fold stays armed: clicking the `shape.ts` row adds `Fold src/adapters/repo.ts into src/ports/shape.ts`. On the way back to `src`, `domain` reads `1 file` and its `model.ts` row is struck through. `adapters` reads `1 file` and lists only `db.ts`. The arrow from `adapters` to `ports` is gone. A dashed arrow runs from `app` to `ports` and its tooltip is `0 runtime · 1 type-only · 0 extends/implements`. The badge still reads `1`. The delete warning is unchanged.

12. Click the empty canvas. Press Ctrl+Z seven times, then Ctrl+Shift+Z seven times.
    **Expect:** after the undos the list is empty, the badge is gone, `app` reads `3 files`, `infra` reads `2 files`, and there is no `ports` box. After the redos the seven entries are back in the same order, `model.ts` is struck through, the `app` to `ports` arrow is back, and the badge reads `1`.

13. Reload the page. Double-click `app`, then click the entry `Rename src/infra to src/adapters`. Double-click `app` again, then click the entry `Fold src/adapters/repo.ts into src/ports/shape.ts`. Click the split entry. Click `src` in the breadcrumb.
    **Expect:** after the reload the address bar reads `http://127.0.0.1:5000/#at=src&plan=reshape`, and the same seven entries, the struck-through `model.ts`, the `app` to `ports` arrow and the badge `1` are there. The rename click opens `#at=src&plan=reshape` with `adapters` selected and centred on the canvas. The fold click opens `#at=src/ports&plan=reshape` with `shape.ts` selected and centred. The split click shows the notice `no such box src/app/read` and stays on `src/ports`. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/reshape` has those seven edits and no `warnings` field, and `git -C $QA/layered status --porcelain && echo clean` prints `clean`.

14. Click `×` on `Rename src/infra to src/adapters`. Choose `Now`.
    **Expect:** that entry is gone. The fold entry is yellow and shows `no such file src/adapters/repo.ts`. The delete entry is not yellow. On Now, `infra` is back, there is no `adapters` or `ports` box, nothing is struck through, and `app` reads `3 files`. `test -f $QA/layered/src/infra/repo.ts && test ! -e $QA/layered/src/adapters && echo 'still on disk'` prints `still on disk`.

15. In the second terminal run this, then open `http://127.0.0.1:5000/?token=$TOKEN#at=&plan=split-app` and `http://127.0.0.1:5000/?token=$TOKEN#at=src/app&plan=split-app`. Then run `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?plan=split-app"; echo` and `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src/app&plan=split-app"; echo`.

```sh
curl -s -H "Authorization: Bearer $TOKEN" -X POST $U/api/plans --data '{"name":"Split app"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const doc=JSON.parse(s);doc.edits=[{"kind":"move-file","file":"src/app/save.ts","to":"src/infra"},{"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]},{"kind":"add-edge","from":"src/infra","to":"src/app"}];process.stdout.write(JSON.stringify(doc))})' | curl -s -H "Authorization: Bearer $TOKEN" -X PUT $U/api/plans/split-app --data-binary @-; echo
```
    **Expect:** both pages show the badge `1`, and the entry `src/infra should use src/app` shows `this plan adds a cycle: app → infra → app`. The changes region does not show `a.ts → b.ts → a.ts`. At the root the only box is `src`. Inside `app` the boxes are `a.ts` and `b.ts`. Both graph bodies have `"warnings":[[],[],[{"kind":"added-cycle","cycle":"app → infra → app"}]]` and `"stale":[null,null,null]`. The root body draws no edge. The `src/app` body still has the edge cycle text `a.ts → b.ts → a.ts`.

16. In the second terminal run `cat $QA/layered/src/domain/shape.ts` and `git -C $QA/layered status --porcelain && echo clean`. In the first terminal press Ctrl-C, then run `rm -rf $QA`.
    **Expect:** the file is `export interface Shape { draw(): void }` plus a newline. Git prints `clean`. The playground is gone.
