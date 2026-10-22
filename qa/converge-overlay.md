# QA: watch a run converge on the plan

For a person with two terminals and a desktop browser with developer tools on the machine that runs bindweed (Node 22.18 or newer, git, curl). The browsed repository is the checked-in four-file `qa/fixtures/layered`. The worktree is a copy of the committed fixture, `.git` included, plus the untracked `src/app/c.ts`, not a real agent; bindweed lists its files with `git ls-files`, as for the browsed repository. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

The separator in the header is ` · ` (U+00B7). `.bindweed/` is gitignored, so `git status --porcelain` stays empty.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git config user.name qa && git config user.email qa@example.test
git add -A && git -c commit.gpgsign=false commit -qm fixture
HEAD=$(git rev-parse HEAD)
WT="$QA/converge-wt"
cp -a "$QA/layered" "$WT"
printf "import { query } from '../infra/db';\nexport const c = query;\n" > "$WT/src/app/c.ts"
mkdir -p "$QA/layered/.bindweed/plans"
python3 - "$HEAD" "$QA/layered/.bindweed/plans/gate.json" << 'PY'
import json, sys
head, path = sys.argv[1], sys.argv[2]
rules = [
  {"name":"bindweed:no-src-app-to-src-infra","severity":"error","comment":"src/app must not import src/infra","from":{"path":"^src/app/"},"to":{"path":"^src/infra/"}},
  {"name":"bindweed:no-circular","severity":"error","comment":"No circular dependencies","from":{},"to":{"circular":True}},
]
doc = {"version":1,"name":"Gate","slug":"gate","createdAt":"2026-10-22T12:00:00.000Z","baseCommit":head,"redo":[],"contract":{"rules":rules},"edits":[
  {"kind":"move-file","file":"src/domain/model.ts","to":"src/core"},
  {"kind":"cut-edge","from":"src/app","to":"src/infra","files":[["src/app/a.ts","src/infra/db.ts"],["src/app/b.ts","src/infra/db.ts"],["src/app/c.ts","src/infra/db.ts"]]},
  {"kind":"create-package","path":"src/ports"},
  {"kind":"fate","file":"src/app/b.ts","fate":"delete"},
]}
open(path,"w").write(json.dumps(doc))
PY
cp "$QA/layered/.bindweed/plans/gate.json" "$QA/plan.json"
LIVE=$(sh -c 'sleep 7200 >/dev/null 2>&1 & echo $!')
true & DEAD=$!; wait "$DEAD"
printf '[{"slug":"gone","tool":"marestail","worktree":"%s/converge-gone","branch":"bindweed/gone","pid":%s,"startedAt":"2026-10-22T11:00:00.000Z","out":"%s/missing.out","settings":{}},{"slug":"gate","tool":"marestail","worktree":"%s","branch":"bindweed/gate","pid":%s,"startedAt":"2026-10-22T12:00:00.000Z","out":"%s/missing.out","settings":{}}]' \
  "$QA" "$DEAD" "$QA" "$WT" "$LIVE" "$QA" > "$QA/layered/.bindweed/runs.json"
echo "export BW=$BW QA=$QA WT=$WT LIVE=$LIVE"
```

Paste the printed `export` line into the second terminal.

## Steps

1. In the first terminal run `node $BW/src/cli.ts --port 5000`. In the second terminal set `TOKEN` from the printed line and `U=http://127.0.0.1:5000`. Open `http://127.0.0.1:5000/?token=$TOKEN#at=src&plan=gate` with the token written out.
   **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`. The toolbar has `Tasks`, then `Launch`, then `⚙` (Settings), then `Converge`. There is no header `0 of 4 edits done`. The cut row shows `no such file src/app/c.ts`, because the browsed repository has no `c.ts`. `app` reads `2 files`.

2. Click `Converge`, the toolbar button just after `⚙` (Settings).
   **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate&converge=gate`. The button now reads `Leave`. `Undo`, `Redo`, every `Remove`, the `Plan` select, `New plan…`, `Delete plan`, `Contract`, `Tasks` and `Launch` are greyed out. There is no `Canvas` button, no `Menu` on any box or arrow, and no ask box. `Now`, `Planned`, `⚙` and `Rescan` still work. The change list is this, and the `○` marks are grey, not green:

```
Changes
0 of 4 edits done · 0 of 2 rules hold

○  Move src/domain/model.ts to src/core
○  src/app must not import src/infra (3 imports)
     src/app/a.ts:2
     src/app/b.ts:2
     src/app/c.ts:1
○  Create package src/ports
○  Delete src/app/b.ts

Rules
○  src/app must not import src/infra
     src/app/a.ts:2
     src/app/b.ts:2
     src/app/c.ts:1
○  No circular dependencies
     src/app/a.ts:1
     src/app/b.ts:1
```

   The canvas at `src` has `app` listing `a.ts`, `b.ts` (struck through) and `c.ts`, `infra` listing `db.ts`, `core` listing `model.ts`, and `ports` reading `0 files`. The `model.ts` row is not green. A grey dashed line with a grey `✂` joins `app` and `infra`. Nothing is fetched from the worktree's own `.bindweed`.
   Drag from the bottom edge of `domain` to `app`, then drag the `a.ts` row onto `infra`.
   **Expect:** no new arrow, no new row in the change list, still four edits. `cmp "$QA/plan.json" "$QA/layered/.bindweed/plans/gate.json" && echo plan` prints `plan`.

3. In the second terminal run `mkdir -p "$QA/held" && mv "$WT/src/domain/model.ts" "$QA/held/model.ts"`. Do not reload.
   **Expect:** within 25 seconds the move's mark is a red `✗`, the header is still `0 of 4 edits done · 0 of 2 rules hold`, and a red dashed `model.ts` is drawn under `core`.
   Run `mkdir -p "$WT/src/core" && mv "$QA/held/model.ts" "$WT/src/core/model.ts"`.
   **Expect:** within 25 seconds the header is `1 of 4 edits done · 0 of 2 rules hold`, the move's mark is a green `✓`, and the `model.ts` row in `core` is green. `domain` in the browsed repository is untouched: `test -f "$QA/layered/src/domain/model.ts" && echo kept` prints `kept`.

4. Run:

```sh
python3 - "$WT" << 'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
old = "import { query } from '../infra/db';\n"
for name in ("src/app/a.ts", "src/app/b.ts"):
    p = root / name
    p.write_text(p.read_text().replace(old, ""))
PY
```

   **Expect:** within 25 seconds the cut is still `○`, the only line under it is `src/app/c.ts:1`, and the path rule lists only that line. The header is still `1 of 4 edits done · 0 of 2 rules hold`. The circular rule still lists `src/app/a.ts:1` and `src/app/b.ts:1`.

5. Run `printf 'export const c = 1;\n' > "$WT/src/app/c.ts"`.
   **Expect:** within 25 seconds the cut's mark is a green `✓`, nothing is listed under it, and the `✂` and its line are green. The header is `2 of 4 edits done · 1 of 2 rules hold`. The path rule has a `✓` and no lines under it. The circular rule is still `○`.

6. Open the Network panel, filtered to `converge`. Immediately run `mkdir -p "$WT/src/ports" && printf 'export const port = 1;\n' > "$WT/src/ports/port.ts"` and switch the browser to another tab for 25 seconds, then come back.
   **Expect:** while the other tab is in front, the panel records no `/api/converge` request and no graph request with `converge=gate`. On return, one such pair starts at once. Without `Rescan` and without a reload the header becomes `3 of 4 edits done · 1 of 2 rules hold`, the `ports` box border is green, and `ports` lists `port.ts`.

7. Run `rm "$WT/src/app/b.ts"`.
   **Expect:** within 25 seconds the delete stays `○` and the line under it is `src/app/a.ts:1`. The header is `3 of 4 edits done · 2 of 2 rules hold`. Both rules have a `✓`.

8. Run `kill "$LIVE"`. Wait 25 seconds.
   **Expect:** the header stays `3 of 4 edits done · 2 of 2 rules hold`. A refresh during that wait, if one was already due, does not change the picture. Then run `rm "$WT/src/ports/port.ts"` and watch the Network panel for 25 seconds.
   **Expect:** no `/api/converge` request, the header stays `3 of 4 edits done · 2 of 2 rules hold`, and `ports` stays green. Click `Rescan`.
   **Expect:** the header becomes `2 of 4 edits done · 2 of 2 rules hold` and `ports` reads `0 files` and is not green. The move and the cut stay green. `cmp "$QA/plan.json" "$QA/layered/.bindweed/plans/gate.json" && echo plan` prints `plan`.

9. Click `Leave`.
   **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate`. There is no converge header and no `✓`. `app` reads `2 files` and does not list `c.ts`. The cut row shows `no such file src/app/c.ts` again. On Planned, `core` lists `model.ts` only as the plan's move. On Now, `domain` lists `model.ts` and there is no `core` box. Switch back to Planned.

10. In the second terminal run `test ! -e "$WT/.bindweed" && echo 'worktree clean'; python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert all("line" not in i for f in d["files"].values() for i in f["imports"])' "$QA/layered/.bindweed/cache/scan.json"; test -f "$QA/layered/.bindweed/cache/gate/scan.json" && echo 'slug cache'; git -C "$QA/layered" status --porcelain; curl -s -H "Authorization: Bearer $TOKEN" "$U/api/graph?at=src" | python3 -c 'import json,sys; ids=[n["id"] for n in json.load(sys.stdin)["nodes"]]; assert "src/app/c.ts" not in ids and "src/core" not in ids; print("browsed")'; curl -s -H "Authorization: Bearer $TOKEN" "$U/api/runs" | python3 -c 'import json,sys; print(json.load(sys.stdin)["runs"][0]["planName"])'`.
    **Expect:** `worktree clean`, then `slug cache`, then no git output, then `browsed`, then `Gate`.

11. Click `Runs`.
    **Expect:** the `Gate` card has a `Converge` button and the `gone` card does not. The `gone` card shows `worktree removed` and `Forget`. Click `Converge` on `Gate`.
    **Expect:** the address bar reads `http://127.0.0.1:5000/#at=src&plan=gate&converge=gate` and the header is back.

12. In the first terminal press Ctrl-C, then run `rm -rf "$QA"; echo clean`.
    **Expect:** `clean`.
