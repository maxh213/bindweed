# QA: a Runs panel shows where every launched run stands

For a person with two terminals and a desktop browser with developer tools on the machine that runs bindweed (Node 22.18 or newer, git, and a clipboard tool: `pbpaste`, `wl-paste -n` or `xclip -selection clipboard -o`). Fake worktrees, no real agent. The fixtures are the ones in `features/runs-panel.feature`, minus `between`, `fresh`, `sc-one`, `sc-done`, `sc-slow`, `sc-junk` and `sc-text`. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
NODEBIN=$(dirname "$(command -v node)")
R="$QA/runs"; mkdir -p "$QA/fakes/bin" "$R"
cat > "$QA/fakes/bin/sc" << 'EOF'
#!/bin/sh
d="$3"
if [ -e "$d/sc-status.slow" ]; then sleep 15; fi
if [ -e "$d/sc-status.err" ]; then cat "$d/sc-status.err" >&2; exit 1; fi
cat "$d/sc-status.json"
EOF
chmod +x "$QA/fakes/bin/sc"
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git config user.name qa && git config user.email qa@example.test
git add -A && git -c commit.gpgsign=false commit -qm fixture
log() { mkdir -p "$R/wt-$1/.marestail/runs/$2" "$R/wt-$1/tasks"; printf "$3" > "$R/wt-$1/.marestail/runs/$2/pipeline.log"; touch -t "20261021$4" "$R/wt-$1/.marestail/runs/$2/pipeline.log"; }
sum() { printf "$2" > "$R/wt-$1/.marestail/runs/overnight-20261021T1230.md"; touch -t 202610211230 "$R/wt-$1/.marestail/runs/overnight-20261021T1230.md"; }
log done 001-a '== qa (09-qa) attempt 1\npipeline complete\n' 1210
log done 002-b '== qa (09-qa) attempt 1\npipeline complete\n' 1220
sum done '001-a ok\n002-b ok\nall tasks complete 2026-10-21 12:30:00\n'
log stopped 001-w 'pipeline complete\n' 1210
log stopped 002-x '== coder (03-coder) attempt 2\ngate failed\nstopping for a human\n' 1220
sum stopped 'stopped: tasks/002-x.md exited 1\n'
log failed 001-f '== coder (03-coder) attempt 1\nnpm ERR! boom\n' 1210
sum failed 'stopped: tasks/001-f.md exited 2\n'
log running 000-old 'pipeline complete\n' 1225
log running 001-init 'pipeline complete\n' 1210
printf 'x\n' > "$R/wt-running/.marestail/runs/direct-001-20261021T1226.log"; touch -t 202610211226 "$R/wt-running/.marestail/runs/direct-001-20261021T1226.log"
log running 002-step 'starting\n== coder (07-coder) attempt 2\n== hardener (07-hardener) attempt 1\n' 1220
log dead 001-task 'starting\n' 1210
touch "$R"/wt-done/tasks/001-a.md "$R"/wt-done/tasks/002-b.md "$R"/wt-stopped/tasks/001-w.md "$R"/wt-stopped/tasks/002-x.md \
  "$R"/wt-failed/tasks/001-f.md "$R"/wt-running/tasks/README.md "$R"/wt-running/tasks/000-old.md "$R"/wt-running/tasks/001-init.md "$R"/wt-running/tasks/002-step.md \
  "$R"/wt-running/tasks/003-later.md "$R"/wt-dead/tasks/README.md "$R"/wt-dead/tasks/001-task.md
mkdir -p "$R/wt-sc" "$R/wt-sc-err" "$QA/layered/.bindweed/runs" "$QA/layered/.bindweed/plans"
printf '{"state":{"phase":"running"},"agents":[{"alive":true},{"alive":true},{"alive":true},{"alive":true},{"alive":false}],"beads":{"open":7,"done":3},"prs":[{"url":"https://example.test/pull/41"},{"url":"https://example.test/pull/42"}]}\n' > "$R/wt-sc/sc-status.json"
printf 'no slop-cannon state here\nsecond line\n' > "$R/wt-sc-err/sc-status.err"
for i in $(seq 1 25); do echo "[sc] line $i"; done > "$QA/layered/.bindweed/runs/plan-sc.out"
LIVE1=$(sh -c 'sleep 900 >/dev/null 2>&1 & echo $!')
LIVE2=$(sh -c 'sleep 900 >/dev/null 2>&1 & echo $!')
true & DEAD=$!; wait "$DEAD"
entry() { printf '{"slug":"plan-%s","tool":"%s","worktree":"%s/wt-%s","branch":"bindweed/plan-%s","pid":%s,"startedAt":"2026-10-21T%s:00.000Z","out":"%s/layered/.bindweed/runs/plan-%s.out","settings":{}%s}' "$1" "$2" "$R" "$1" "$1" "$3" "$4" "$QA" "$1" "$5"; }
t() { printf ',"tasks":[%s]' "$(printf '"tasks/%s.md",' "$@" | sed 's/,$//')"; }
printf '[%s,%s,%s,%s,%s,%s,%s,%s]' "$(entry removed marestail $DEAD 12:00 ',"tasks":[]')" "$(entry done marestail $DEAD 12:01 "$(t 001-a 002-b)")" \
  "$(entry stopped marestail $DEAD 12:02 "$(t 001-w 002-x)")" "$(entry failed marestail $DEAD 12:03 "$(t 001-f)")" \
  "$(entry running marestail $LIVE1 12:04 "$(t 001-init 002-step 003-later)")" "$(entry dead marestail $DEAD 12:05 '')" \
  "$(entry sc-err slop-cannon $DEAD 12:12 ',"tasks":[]')" "$(entry sc slop-cannon $LIVE2 12:09 ',"tasks":[]')" > "$QA/layered/.bindweed/runs.json"
HEAD=$(git -C "$QA/layered" rev-parse HEAD)
plan() { printf '{"version":1,"name":"%s","slug":"%s","createdAt":"2026-10-21T12:00:00.000Z","baseCommit":"%s","edits":[],"redo":[]}\n' "$1" "$2" "$HEAD" > "$QA/layered/.bindweed/plans/$2.json"; }
plan "Plan Running" plan-running
plan "Plan SC" plan-sc
printf '{"name":"Bad"}\n' > "$QA/layered/.bindweed/plans/plan-dead.json"
echo "export BW=$BW QA=$QA R=$R LIVE1=$LIVE1 LIVE2=$LIVE2"
```

Paste the printed `export` line into the second terminal.

## Steps

1. In the first terminal run `PATH="$QA/fakes/bin:$NODEBIN:/usr/bin:/bin" node $BW/src/cli.ts --port 5000`. In a new browser tab open the developer tools' Network panel, filtered to `api/runs`, then open the printed address with `#at=src` appended.
   **Expect:** the tab bar is `Files`, `Architecture`, `Runs`, and `Runs` carries a badge `2`. Exactly one `GET /api/runs` was made on load, and no more follow while Architecture is shown.

2. Click `Runs`.
   **Expect:** the hash is `#runs`, a `GET /api/runs` is made at once, then one every 5 seconds. Eight cards, newest start first (`plan-sc-err` at 12:12 is above `Plan SC` at 12:09), in this layout. `<elapsed>` is the time since that start, as `42s`, `7m`, `3h 5m` or `2d 3h`. Only `Plan SC` and `Plan Running` are links; `plan-dead` is plain text, as its plan file `{"name":"Bad"}` is not a plan bindweed loads. Every `Log tail` is closed.

```
[Files]  [Architecture]  [Runs 2]

plan-sc-err                                         [dead]
slop-cannon · bindweed/plan-sc-err
<R>/wt-sc-err                                 [Copy worktree]
started 2026-10-21T12:12:00.000Z · <elapsed>
sc status failed: no slop-cannon state here · pid gone
▶ Log tail

Plan SC                                             [running]
slop-cannon · bindweed/plan-sc
<R>/wt-sc                                     [Copy worktree]
started 2026-10-21T12:09:00.000Z · <elapsed>
running · 4 agents · 7 open · 3 done · 2 PRs
https://example.test/pull/41
https://example.test/pull/42
▶ Log tail

plan-dead           … [dead]                 task 001-task · 0 of 1 tasks
Plan Running        … [running]              task 002-step · hardener · attempt 1 · 1 of 3 tasks
plan-failed         … [failed]               task 001-f · coder · attempt 1 · 0 of 1 tasks
plan-stopped        … [stopped for a human]  task 002-x · coder · attempt 2 · 1 of 2 tasks
plan-done           … [done]                 all tasks complete · 2 of 2 tasks
  (each laid out like plan-sc-err: tool · branch, worktree + Copy worktree, started line, position, Log tail)

plan-removed                                [worktree removed]
marestail · bindweed/plan-removed
<R>/wt-removed                                [Copy worktree]
started 2026-10-21T12:00:00.000Z · <elapsed>
worktree removed
▶ Log tail                                          [Forget]
```

3. In the developer tools console run `[...document.querySelectorAll('.pill')].map(p => p.className + ' ' + getComputedStyle(p).backgroundColor + ' ' + getComputedStyle(p).color).join('\n')`.
   **Expect:** eight lines, in card order: `pill pill-dead rgb(107, 114, 128)`, `pill pill-running rgb(37, 99, 235)`, `pill pill-dead rgb(107, 114, 128)`, `pill pill-running rgb(37, 99, 235)`, `pill pill-failed rgb(220, 38, 38)`, `pill pill-stopped rgb(217, 119, 6)`, `pill pill-done rgb(22, 163, 74)`, `pill pill-removed rgb(156, 163, 175)`, each followed by `rgb(255, 255, 255)`.

4. Open `Log tail` on `Plan SC`, `Plan Running`, `plan-stopped`, `plan-failed`, `plan-dead`, `plan-sc-err` and `plan-removed`.
   **Expect:** `Plan SC` shows `[sc] line 6` to `[sc] line 25`, 20 lines. `Plan Running` shows `starting`, `== coder (07-coder) attempt 2`, `== hardener (07-hardener) attempt 1`. `plan-stopped` ends `stopping for a human`. `plan-failed` ends `npm ERR! boom`. `plan-dead` shows `starting`. `plan-sc-err` and `plan-removed` are empty.

5. Click `Copy worktree` on `Plan Running` and paste the clipboard in the second terminal.
   **Expect:** exactly `<R>/wt-running`.

6. Click `Plan Running`.
   **Expect:** the hash is `#at=src&plan=plan-running` and Architecture shows plan `Plan Running`. No `GET /api/runs` for 15 seconds.

7. Click `Runs`. Switch the browser to another tab for 15 seconds, then back.
   **Expect:** one `GET /api/runs` at once on clicking `Runs`, none while the other tab is shown, one at once on return, then every 5 seconds.

8. Right after a `GET /api/runs` appears, run `mkdir "$R/wt-removed"` in the second terminal and click `Forget` on `plan-removed` within 5 seconds. If the card turned `dead` first, run `rmdir "$R/wt-removed"`, wait for the card to show `worktree removed` again, and retry.
   **Expect:** the card stays and shows `Forget failed: worktree still exists`.

9. Run `rmdir "$R/wt-removed"`. After the next refresh click `Forget` on `plan-removed`.
   **Expect:** the card disappears at once. `node -e 'console.log(require(process.argv[1]).map(x => x.slug).join(" "))' "$QA/layered/.bindweed/runs.json"` prints `plan-done plan-stopped plan-failed plan-running plan-dead plan-sc-err plan-sc`.

10. Run `kill "$LIVE1" "$LIVE2"`.
    **Expect:** within 5 seconds `Plan SC` and `Plan Running` turn `dead`, and the `Runs` tab has no badge.

11. Run `printf '[]' > "$QA/layered/.bindweed/runs.json"`.
    **Expect:** within 5 seconds the panel says `No runs launched from this repository yet.`

12. In the first terminal press Ctrl-C, then run `rm -rf "$QA"; echo clean`.
    **Expect:** `clean`.
