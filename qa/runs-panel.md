# QA: Runs panel shows where every launched run stands

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl, and a clipboard tool: `pbpaste`, `wl-paste -n` or `xclip -selection clipboard -o`).
Fake worktrees built by the test, no real agents. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
NODEBIN=$(dirname "$(command -v node)")
mkdir -p "$QA/fakes/bin" "$QA/log"
cat > "$QA/fakes/bin/sc" << 'EOF'
#!/bin/sh
if [ "$1" = "status" ]; then
  case "$*" in
    *--repo*wt-sc*)
      printf '{"state":{"phase":"running"},"live_agents":4,"agents":[{"id":"1","alive":true},{"id":"2","alive":true},{"id":"3","alive":true},{"id":"4","alive":true}],"beads":{"open":7,"done":3},"prs":[{"url":"https://example.test/pull/42","title":"#42"}]}\n'
      exit 0
      ;;
    *)
      printf 'unknown repo\n' >&2
      exit 1
      ;;
  esac
fi
exit 0
EOF
chmod +x "$QA/fakes/bin/sc"
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git config user.name qa && git config user.email qa@example.test
git add -A && git -c commit.gpgsign=false commit -qm fixture

# Build fake worktrees
mkdir -p "$QA/wt-done/.marestail/runs/001-a" "$QA/wt-done/.marestail/runs/002-b" "$QA/wt-done/tasks"
printf 'all tasks complete\n' > "$QA/wt-done/.marestail/runs/overnight-20261021.md"
printf 'pipeline complete\n' > "$QA/wt-done/.marestail/runs/001-a/pipeline.log"
printf 'pipeline complete\n' > "$QA/wt-done/.marestail/runs/002-b/pipeline.log"
touch "$QA/wt-done/tasks/001-a.md" "$QA/wt-done/tasks/002-b.md"

mkdir -p "$QA/wt-stopped/.marestail/runs/001-w" "$QA/wt-stopped/.marestail/runs/002-x" "$QA/wt-stopped/tasks"
printf 'stopped: tasks/002-x.md exited 1\n' > "$QA/wt-stopped/.marestail/runs/overnight-20261021.md"
printf 'pipeline complete\n' > "$QA/wt-stopped/.marestail/runs/001-w/pipeline.log"
printf 'error on step\nstopping for a human\n' > "$QA/wt-stopped/.marestail/runs/002-x/pipeline.log"
touch "$QA/wt-stopped/tasks/001-w.md" "$QA/wt-stopped/tasks/002-x.md"

sleep 900 &
PID_RUNNING=$!
mkdir -p "$QA/wt-running/.marestail/runs/001-init" "$QA/wt-running/.marestail/runs/002-step" "$QA/wt-running/tasks"
printf 'pipeline complete\n' > "$QA/wt-running/.marestail/runs/001-init/pipeline.log"
printf 'starting\n== hardener (07-hardener) attempt 1\n' > "$QA/wt-running/.marestail/runs/002-step/pipeline.log"
touch "$QA/wt-running/tasks/001-init.md" "$QA/wt-running/tasks/002-step.md"

mkdir -p "$QA/wt-dead/.marestail/runs/001-task" "$QA/wt-dead/tasks"
printf 'starting\n' > "$QA/wt-dead/.marestail/runs/001-task/pipeline.log"
touch "$QA/wt-dead/tasks/001-task.md"

sleep 900 &
PID_SC=$!
mkdir -p "$QA/wt-sc"
for i in $(seq 1 25); do echo "[sc] log line $i" >> "$QA/wt-sc/sc.out"; done

mkdir -p "$QA/layered/.bindweed/plans"
cat > "$QA/layered/.bindweed/runs.json" << EOF
[
  {"slug":"plan-removed","tool":"marestail","worktree":"$QA/wt-removed","branch":"bindweed/plan-removed","pid":999996,"startedAt":"2026-10-21T12:00:00.000Z"},
  {"slug":"plan-done","tool":"marestail","worktree":"$QA/wt-done","branch":"bindweed/plan-done","pid":999997,"startedAt":"2026-10-21T12:01:00.000Z"},
  {"slug":"plan-stopped","tool":"marestail","worktree":"$QA/wt-stopped","branch":"bindweed/plan-stopped","pid":999998,"startedAt":"2026-10-21T12:02:00.000Z"},
  {"slug":"plan-running","tool":"marestail","worktree":"$QA/wt-running","branch":"bindweed/plan-running","pid":$PID_RUNNING,"startedAt":"2026-10-21T12:03:00.000Z"},
  {"slug":"plan-dead","tool":"marestail","worktree":"$QA/wt-dead","branch":"bindweed/plan-dead","pid":999999,"startedAt":"2026-10-21T12:04:00.000Z"},
  {"slug":"plan-sc","tool":"slop-cannon","worktree":"$QA/wt-sc","branch":"bindweed/plan-sc","pid":$PID_SC,"startedAt":"2026-10-21T12:05:00.000Z","out":"$QA/wt-sc/sc.out"}
]
EOF

cat > "$QA/layered/.bindweed/plans/plan-running.json" << EOF
{"version":1,"name":"Plan Running","slug":"plan-running","createdAt":"2026-10-21T12:00:00.000Z","baseCommit":"HEAD","edits":[],"redo":[]}
EOF
cat > "$QA/layered/.bindweed/plans/plan-sc.json" << EOF
{"version":1,"name":"Plan SC","slug":"plan-sc","createdAt":"2026-10-21T12:00:00.000Z","baseCommit":"HEAD","edits":[],"redo":[]}
EOF

echo "export BW=$BW QA=$QA NODEBIN=$NODEBIN PID_RUNNING=$PID_RUNNING PID_SC=$PID_SC U=http://127.0.0.1:5000"
```

Paste the printed `export` line into the second terminal.

## Steps

1. In the first terminal run `PATH="$QA/fakes/bin:$NODEBIN:/usr/bin:/bin" node $BW/src/cli.ts --port 5000`. In the second terminal export `TOKEN` from the printed address. Open `http://127.0.0.1:5000/?token=$TOKEN#runs`.
   **Expect:** the tab bar shows `Files`, `Architecture`, and `Runs` with a badge of `2`. The Runs panel lists 6 cards, newest first (`plan-sc` down to `plan-removed`), matching this visual layout:

```
[Files]  [Architecture]  [Runs 2]

Runs
  Plan SC · slop-cannon · bindweed/plan-sc          [running]
  <QA>/wt-sc                                       Copy worktree
  Started 2026-10-21T12:05:00.000Z · 1m ago
  running · 4 agents · 7 open · 3 done · 1 PR
  ▶ Log tail

  plan-dead · marestail · bindweed/plan-dead        [dead]
  <QA>/wt-dead                                     Copy worktree
  Started 2026-10-21T12:04:00.000Z · 2m ago
  task 001-task · 0 of 1 tasks
  ▶ Log tail

  Plan Running · marestail · bindweed/plan-running  [running]
  <QA>/wt-running                                  Copy worktree
  Started 2026-10-21T12:03:00.000Z · 3m ago
  task 002-step · hardener · attempt 1 · 1 of 2 tasks
  ▶ Log tail

  plan-stopped · marestail · bindweed/plan-stopped  [stopped for a human]
  <QA>/wt-stopped                                  Copy worktree
  Started 2026-10-21T12:02:00.000Z · 4m ago
  task 002-x · 1 of 2 tasks
  ▶ Log tail

  plan-done · marestail · bindweed/plan-done        [done]
  <QA>/wt-done                                     Copy worktree
  Started 2026-10-21T12:01:00.000Z · 5m ago
  all tasks complete · 2 of 2 tasks
  ▶ Log tail

  plan-removed · marestail · bindweed/plan-removed  [worktree removed]
  <QA>/wt-removed                                  Copy worktree
  worktree removed                                 Forget
```

2. Expand the `Log tail` on `Plan SC`, `Plan Running` and `plan-stopped`.
   **Expect:**
   - `Plan SC` log tail shows the last 20 lines of `$QA/wt-sc/sc.out` (lines 6 to 25). The position line has a link `1 PR` pointing to `https://example.test/pull/42`.
   - `Plan Running` log tail shows `starting` and `== hardener (07-hardener) attempt 1`.
   - `plan-stopped` log tail shows `stopping for a human`.
   - `plan-done` shows state `done`.
   - `plan-dead` shows state `dead`.
   - `plan-removed` shows state `worktree removed` and has a `Forget` button. None of the other 5 cards have a `Forget` button.

3. Click `Copy worktree` on the `Plan Running` card, then in the second terminal paste the clipboard (`pbpaste`, `wl-paste -n` or `xclip -selection clipboard -o`).
   **Expect:** the pasted text is exactly `<QA>/wt-running`.

4. Click the link `Plan Running` in the title of the running card.
   **Expect:** the browser navigates to the Architecture tab with plan `Plan Running` selected (`#at=src&plan=plan-running`).

5. Stay on the Architecture tab for 15 seconds without navigating. In the second terminal or browser network panel, observe network requests.
   **Expect:** polling has stopped; no `GET /api/runs` requests occur during these 15 seconds.

6. Click the `Runs` tab.
   **Expect:** the view returns to the Runs panel (`#runs`). A `GET /api/runs` request is made immediately and refreshes every 5 seconds while visible.

7. Click the `Forget` button on the `plan-removed` card.
   **Expect:** the `plan-removed` card is removed from the panel. In the second terminal run `node -e 'const r=require(process.argv[1]); console.log(r.map(x=>x.slug).join(" "))' "$QA/layered/.bindweed/runs.json"`. It prints `plan-done plan-stopped plan-running plan-dead plan-sc` without `plan-removed`.

8. In the first terminal press Ctrl-C. In the second terminal run:
   ```sh
   kill -9 "$PID_RUNNING" "$PID_SC" 2>/dev/null || true
   rm -rf "$QA"
   echo clean
   ```
   **Expect:** `clean`.
