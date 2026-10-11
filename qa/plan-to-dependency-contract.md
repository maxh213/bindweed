# QA: a plan becomes a dependency contract

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). The tree is the checked-in `qa/fixtures/layered` (four TypeScript files). It is not the tree in `qa/plan-moves-and-edges.md`. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

A plan never edits the repository, and this task never writes `.dependency-cruiser.cjs`. `.bindweed/` is gitignored, so `git status --porcelain` stays empty. Where JSON is expected, key order may differ, and a key the expected body omits is absent.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export QA=$QA U=http://127.0.0.1:5000"
```

Paste the `export` line into the second terminal.

## Steps

1. In the first terminal, still in `$QA/layered`, run `node $BW/src/cli.ts --port 5000`.
   **Expect:** stdout shows `bindweed: http://127.0.0.1:5000/?token=` and 32 hex characters, then `serving $QA/layered`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src"; echo`, then `curl -s -H "Authorization: Bearer $TOKEN" "$U/api/pairs?from=src/app&to=src/domain&at=src"; echo`, then `git -C $QA/layered status --porcelain`.
   **Expect:** plans is `{"plans":[]}`. The graph has `app` files 2, `infra` files 1 and `domain` files 1, and no `contract` key. Pairs are `[["src/app/a.ts","src/domain/model.ts"]]`. Git prints nothing.

3. Open `http://127.0.0.1:5000/?token=$TOKEN#at=src`. Create a plan named `Gate`.
   **Expect:** there is no `Contract` button until the plan exists. After Create, the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`, `Planned` is selected, and `Contract` is in the toolbar. `app` reads `2 files`, `infra` reads `1 file`, `domain` reads `1 file`.

4. Click the arrow from `app` to `domain` and press Delete. Double-click `app`, click the arrow from `a.ts` to `b.ts`, and press Delete. Click `src` in the breadcrumb.
   **Expect:** the entries are `src/app must not import src/domain (1 import)` and `src/app/a.ts must not import src/app/b.ts (1 import)`. The address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`.

5. Click `Contract`.
   **Expect:** the panel lists these rows, in order, each checkbox checked. The accessible name of a checkbox is the rule name.
   - `src/app must not import src/domain` — `bindweed:no-src-app-to-src-domain`
   - `src/app/a.ts must not import src/app/b.ts` — `bindweed:no-src-app-a-ts-to-src-app-b-ts`
   - `src/domain does not use src/infra` — `bindweed:src-domain-does-not-use-src-infra`
   - `src/infra does not use src/app` — `bindweed:src-infra-does-not-use-src-app`
   - `No circular dependencies` — `bindweed:no-circular`

   There is no `bindweed:src-domain-does-not-use-src-app`. The diff's `+` lines include every rule name and `tsConfig: { fileName: 'tsconfig.json' }`. The address bar is unchanged.

6. Uncheck `bindweed:no-circular`.
   **Expect:** the diff no longer contains `bindweed:no-circular` and still contains `bindweed:no-src-app-to-src-domain`. In the second terminal, `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/gate` has no `contract` key, and `test ! -e $QA/layered/.dependency-cruiser.cjs && echo 'not written'` prints `not written`.

7. Check `bindweed:no-circular` again. Click `Copy`, then click `Save to plan`. In the second terminal run `export TEXT=$HOME/cruiser.cjs` and save the clipboard as that file. The text already ends in one newline; do not add another.
   **Expect:** `$TEXT` contains the five rule names in the order above, `severity: 'error'` on each, and the options `doNotFollow`, `tsPreCompilationDeps` and `tsConfig`. `curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/gate` has `contract.rules` with those five names and the two cuts still in `edits`. `git -C $QA/layered status --porcelain && echo clean` prints `clean`.

8. Reload the page and click `Contract`.
   **Expect:** the same five rows are checked. `Close` is shown; clicking it does not change the address bar.

9. In the second terminal paste:

```sh
export COPY=$(cd "$(mktemp -d)" && pwd -P)
echo "$COPY"
cp -a "$QA/layered" "$COPY/layered"
cp "$TEXT" "$COPY/layered/.dependency-cruiser.cjs"
cd "$COPY/layered"
npx --prefix "$BW" depcruise --config .dependency-cruiser.cjs src; echo "exit:$?"
```

   **Expect:** exit status 3. Stdout contains `error bindweed:no-src-app-to-src-domain: src/app/a.ts → src/domain/model.ts`, `error bindweed:no-src-app-a-ts-to-src-app-b-ts: src/app/a.ts → src/app/b.ts`, `error bindweed:no-circular:` and `x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised.` Stdout does not contain `db.ts` or `does-not-use`. Ignore stderr.

10. In the first terminal press Ctrl-C. `$COPY` is set only in the second terminal, so `cd` to the path step 9 printed, plus `/layered` (`$BW` is already set in the first terminal), and run `node $BW/src/cli.ts --port 5001`. Set `TOKEN2` from that output. Open `http://127.0.0.1:5001/?token=$TOKEN2#at=src&plan=gate` and click `Contract`. Click `Copy` and save the paste as `$TEXT2` in the second terminal, again without an extra newline.
    **Expect:** the five boxes are checked. The diff is exactly two lines, `--- a/.dependency-cruiser.cjs` and `+++ b/.dependency-cruiser.cjs`, and nothing else. `cmp -s "$TEXT" "$TEXT2" && echo identical` prints `identical`.

11. In the second terminal run `printf '%s\n' 'const base = [];' 'module.exports = { forbidden: [...base] };' > $COPY/layered/.dependency-cruiser.cjs`. Reload the page and click `Contract`. Click `Copy`.
    **Expect:** the panel shows `bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array`, a snippet that contains `name: 'bindweed:no-src-app-to-src-domain'`, and no diff. The clipboard is that snippet. `cat $COPY/layered/.dependency-cruiser.cjs` is still the two lines just written.

12. In the second terminal run `test ! -e $QA/layered/.dependency-cruiser.cjs && git -C $QA/layered status --porcelain && echo clean`. In the first terminal press Ctrl-C. Run `rm -rf "$QA" "$COPY"`.
    **Expect:** `clean`. The playground and the copy are gone.
