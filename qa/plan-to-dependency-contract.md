# QA: a plan becomes a dependency contract

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl, and a clipboard tool: `pbpaste` on macOS, `wl-paste` on Wayland, `xclip` on X11). The tree is the checked-in `qa/fixtures/layered` (four TypeScript files). It is not the tree in `qa/plan-moves-and-edges.md`. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

A plan never edits the repository, and this task never writes `.dependency-cruiser.cjs`. `.bindweed/` is gitignored, so `git status --porcelain` stays empty. Where JSON is expected, key order may differ, and a key the expected body omits is absent. "Save the clipboard into F" means `pbpaste > "F"` on macOS, `wl-paste -n > "F"` on Wayland or `xclip -selection clipboard -o > "F"` on X11; the text already ends in one newline, so add none.

## Setup

Port 5000 and 5001 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export BW=$BW QA=$QA U=http://127.0.0.1:5000 TEXT=$HOME/cruiser.cjs TEXT2=$HOME/cruiser2.cjs"
```

Paste the printed `export` line into the second terminal.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 5000`.
   **Expect:** stdout shows `bindweed: http://127.0.0.1:5000/?token=` and 32 hex characters, then `serving $QA/layered`. The command keeps running. In the second terminal run `export TOKEN=` followed by that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/pairs?from=src/app&to=src/domain&at=src"; echo`, then `git -C $QA/layered status --porcelain`.
   **Expect:** plans is `{"plans":[]}`. The graph has `app` files 2, `infra` files 1 and `domain` files 1, and no `contract` key. Pairs are `[["src/app/a.ts","src/domain/model.ts"]]`. Git prints nothing.

3. Open `http://127.0.0.1:5000/?token=<TOKEN>#at=src` with the token from step 1. Create a plan named `Gate`.
   **Expect:** there is no `Contract` button until the plan exists. After Create, the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`, `Planned` is selected, and `Contract` is in the toolbar. `app` reads `2 files`, `infra` reads `1 file`, `domain` reads `1 file`.

4. Click the arrow from `app` to `domain` and press Delete. Double-click `app`, click the arrow from `a.ts` to `b.ts`, and press Delete. Click `src` in the breadcrumb.
   **Expect:** the change list holds `src/app must not import src/domain (1 import)` and `src/app/a.ts must not import src/app/b.ts (1 import)`. The address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`.

5. Click `Contract`.
   **Expect:** the panel lists these rows, in order, each checkbox checked. The accessible name of a checkbox is the rule name.
   - `src/app must not import src/domain` — `bindweed:no-src-app-to-src-domain`
   - `src/app/a.ts must not import src/app/b.ts` — `bindweed:no-src-app-a-ts-to-src-app-b-ts`
   - `src/domain does not use src/infra` — `bindweed:src-domain-does-not-use-src-infra`
   - `src/infra does not use src/app` — `bindweed:src-infra-does-not-use-src-app`
   - `No circular dependencies` — `bindweed:no-circular`

   There is no `bindweed:src-domain-does-not-use-src-app`. The diff's `+` lines include every rule name and `tsConfig: { fileName: 'tsconfig.json' }`. The address bar is unchanged.

6. Uncheck `bindweed:no-circular`.
   **Expect:** the diff no longer contains `bindweed:no-circular` and still contains `bindweed:no-src-app-to-src-domain`. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/gate; echo` has no `contract` key, and `test ! -e $QA/layered/.dependency-cruiser.cjs && echo 'not written'` prints `not written`.

7. Click `Save to plan`. In the second terminal run the same `curl` for `/api/plans/gate`.
   **Expect:** the panel closes. `contract.rules` holds four rules named, in order, `bindweed:no-src-app-to-src-domain`, `bindweed:no-src-app-a-ts-to-src-app-b-ts`, `bindweed:src-domain-does-not-use-src-infra`, `bindweed:src-infra-does-not-use-src-app`. `edits` holds the two cuts.

8. Without reloading, click the arrow from `infra` to `domain` and press Delete, then click `Undo`. Run the same `curl` again. Then click `Contract`.
   **Expect:** `edits` holds the two cuts, `redo` is `[{"kind":"cut-edge","from":"src/infra","to":"src/domain","files":[["src/infra/db.ts","src/domain/model.ts"]]}]`, and `contract.rules` still holds the same four names. In the panel `bindweed:no-circular` is unchecked and the other four are checked.

9. Check `bindweed:no-circular`. Click `Copy`, then `Save to plan`. In the second terminal save the clipboard into `$TEXT`, then run `cat "$TEXT"` and the same `curl`.
   **Expect:** `$TEXT` holds the five rule names in the order of step 5, `severity: 'error'` five times, and the options `doNotFollow`, `tsPreCompilationDeps` and `tsConfig`; its last line is `};`. `contract.rules` holds the five names and `edits` the two cuts. `git -C $QA/layered status --porcelain && echo clean` prints only `clean`.

10. Reload the page and click `Contract`, then `Close`.
    **Expect:** the same five rows, all checked. After `Close` the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`.

11. In the second terminal paste:

```sh
export COPY=$(cd "$(mktemp -d)" && pwd -P)
echo "$COPY"
cp -a "$QA/layered" "$COPY/layered"
cp "$TEXT" "$COPY/layered/.dependency-cruiser.cjs"
cd "$COPY/layered"
npx --prefix "$BW" depcruise --config .dependency-cruiser.cjs src; echo "exit:$?"
```

   **Expect:** `exit:3`. Stdout contains `error bindweed:no-src-app-to-src-domain: src/app/a.ts → src/domain/model.ts`, `error bindweed:no-src-app-a-ts-to-src-app-b-ts: src/app/a.ts → src/app/b.ts`, `error bindweed:no-circular:` and `x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised.` Stdout does not contain `db.ts` or `does-not-use`. Ignore stderr.

12. In the first terminal press Ctrl-C, `cd` to the path step 11 printed followed by `/layered`, and run `node $BW/src/cli.ts --port 5001`. Open `http://127.0.0.1:5001/?token=<TOKEN2>#at=src&plan=gate` with the token it prints, and click `Contract`. Click `Copy`, and in the second terminal save the clipboard into `$TEXT2`, then run `cmp -s "$TEXT" "$TEXT2" && echo identical`.
    **Expect:** the five boxes are checked. The diff is exactly two lines, `--- a/.dependency-cruiser.cjs` and `+++ b/.dependency-cruiser.cjs`, and nothing else. `cmp` prints `identical`.

13. In the second terminal run `printf '%s\n' 'const base = [];' 'module.exports = { forbidden: [...base] };' > "$COPY/layered/.dependency-cruiser.cjs"`. Reload the page and click `Contract`. Click `Copy`, save the clipboard into `$HOME/snippet.txt`, and run `grep -c "name: 'bindweed:" $HOME/snippet.txt` and `cat "$COPY/layered/.dependency-cruiser.cjs"`.
    **Expect:** the panel shows `bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array`, a snippet whose first two lines are `    {` and `      name: 'bindweed:no-src-app-to-src-domain',`, and no diff. `grep` prints `5`. `cat` prints the two lines just written.

14. In the first terminal press Ctrl-C. In the second terminal run `cd ~ && test ! -e $QA/layered/.dependency-cruiser.cjs && git -C $QA/layered status --porcelain && echo clean`, then `rm -rf "$QA" "$COPY" "$TEXT" "$TEXT2" "$HOME/snippet.txt"`.
    **Expect:** only `clean` is printed. The playground, the copy and the saved texts are gone.
