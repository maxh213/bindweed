Feature: a Runs panel shows where every launched run stands
  A developer can open a Runs tab next to Files and Architecture to see every
  run launched with bindweed: plan name, tool, branch, worktree path, started
  and elapsed time, state pill, position line, and a collapsible log tail.
  The badge counts running runs. Runs whose worktrees are gone show worktree
  removed and offer a Forget button to clean up runs.json.

  The tree, token, {token}, Host header, JSON comparison and \n are the
  Background of features/plan-to-dependency-contract.feature. "bindweed" is
  "node <bindweed dir>/src/cli.ts" on port 5000. "The worktree" is
  "/tmp/qa/layered-bw-gate".

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed four-file fixture of features/plan-to-dependency-contract.feature
    And "/tmp/qa/fakes/bin" holds executable fakes for "sc" and "marestail"
    And bindweed is serving "/tmp/qa/layered" with "/tmp/qa/fakes/bin" first on PATH

  Rule: GET /api/runs reports state, position line and log tail for every run
    GET /api/runs answers {"runs":[...]}. When ".bindweed/runs.json" is missing,
    not a list, or empty, "runs" is []. Each run object contains "slug",
    "planName", "tool", "branch", "worktree", "worktreeExists", "pid",
    "startedAt", "state", "position", and "logTail" (up to 20 lines). Runs are
    ordered newest first by "startedAt".

    For marestail runs:
    - If worktree does not exist: state is "worktree removed", worktreeExists is false.
    - If the newest ".marestail/runs/overnight-*.md" contains "all tasks complete": state is "done".
    - If the newest summary contains "stopped: <task> exited <code>": state is "stopped for a human"
      when that task's "pipeline.log" last line contains "stopping for a human", else "failed".
    - Otherwise: state is "running" if pid is alive (kill -0 exits 0 or EPERM), else "dead".
    - Current task is the newest ".marestail/runs/<task>/pipeline.log". Current role and attempt
      come from its last line starting "== " (e.g. "== hardener (07-hardener) attempt 1").
    - Tasks done counts tasks whose "pipeline.log" contains "pipeline complete".
    - Position line is "task <task> · <role> · attempt <N> · <done> of <total> tasks" or
      "all tasks complete · <total> of <total> tasks".
    - Log tail is the last 20 lines of the current task's "pipeline.log".

    For slop-cannon runs:
    - "sc status --repo <worktree> --json" (10s timeout) provides state.phase, live agents count,
      bead counts by state, and pull requests opened (with links).
    - If phase is "done" or "complete": state is "done".
    - Otherwise: state is "running" if pid is alive, else "dead".
    - If sc status fails: state follows pid alive/dead, position shows error and pid state.
    - Position line is "<phase> · <agents> agents · <open> open · <done> done · <count> PRs".
    - Log tail is the last 20 lines of the run's ".out" file.

    Scenario: Missing or empty runs file answers empty list
      When I send "GET /api/runs" with the token
      Then the status is 200 and the body is {"runs":[]}

    Scenario: Marestail run states reflect summaries, logs and pid
      Given "/tmp/qa/wt-done" has an overnight summary ending "all tasks complete\n", 2 completed tasks, and a dead pid
      And "/tmp/qa/wt-stopped" has summary "stopped: tasks/002-x.md exited 1\n" and pipeline log ending "stopping for a human\n"
      And "/tmp/qa/wt-running" has live sleep pid 11111 and pipeline log ending "== hardener (07-hardener) attempt 1\n"
      And "/tmp/qa/wt-dead" has no summary, dead pid 22222, and incomplete pipeline log
      And "/tmp/qa/layered/.bindweed/runs.json" records these 4 runs
      When I send "GET /api/runs" with the token
      Then the status is 200 and "runs" has 4 items
      And run 0 state is "dead"
      And run 1 state is "running" and position is "task 002 · hardener · attempt 1 · 1 of 2 tasks"
      And run 1 "logTail" contains "== hardener (07-hardener) attempt 1"
      And run 2 state is "stopped for a human" and "logTail" contains "stopping for a human"
      And run 3 state is "done"

    Scenario: Slop-cannon run states reflect sc status and out log
      Given "/tmp/qa/wt-sc" is a worktree with an out log of 25 lines and live sleep pid 33333
      And fake sc status prints {"state":{"phase":"running"},"agents":[{"id":"1","alive":true},{"id":"2","alive":true},{"id":"3","alive":true},{"id":"4","alive":true}],"beads":{"open":7,"done":3},"prs":[{"url":"https://example.test/pull/1"}]}
      And "/tmp/qa/layered/.bindweed/runs.json" records this slop-cannon run
      When I send "GET /api/runs" with the token
      Then the status is 200 and run 0 state is "running"
      And run 0 position is "running · 4 agents · 7 open · 3 done · 1 PR"
      And run 0 "logTail" has 20 lines matching the tail of its out file

    Scenario: A missing worktree shows worktree removed
      Given "/tmp/qa/layered/.bindweed/runs.json" records a run whose worktree "/tmp/qa/nonexistent" is missing
      When I send "GET /api/runs" with the token
      Then the status is 200 and run 0 state is "worktree removed"
      And run 0 "worktreeExists" is false
      And run 0 "logTail" is []

    Scenario: Requests require bearer token and allowed host
      When I send "GET /api/runs" without authorization
      Then the status is 401 and the body is {"error":"missing or wrong token"}
      When I send "GET /api/runs" with Host "evil.example:5000" and the token
      Then the status is 403 and the body is {"error":"bad host"}

  Rule: Forget removes a run whose worktree no longer exists from runs.json
    DELETE /api/runs?worktree=<path> removes the matching entry from
    ".bindweed/runs.json" when that worktree does not exist on disk.
    If the worktree still exists on disk, it returns 400 {"error":"worktree still exists"}.
    If no run matches the worktree, it returns 404 {"error":"no such run"}.
    Nothing else is deleted or written.

    Scenario: Forget deletes the entry from runs.json and leaves others unchanged
      Given "/tmp/qa/layered/.bindweed/runs.json" records an active run "/tmp/qa/wt-live" and a removed run "/tmp/qa/wt-gone"
      And "/tmp/qa/wt-live" exists and "/tmp/qa/wt-gone" does not exist
      When I send "DELETE /api/runs?worktree=/tmp/qa/wt-gone" with the token
      Then the status is 200 and the body is {"ok":true}
      And "/tmp/qa/layered/.bindweed/runs.json" contains "/tmp/qa/wt-live" and does not contain "/tmp/qa/wt-gone"

    Scenario: Forget refuses a run whose worktree still exists
      Given "/tmp/qa/layered/.bindweed/runs.json" records run "/tmp/qa/wt-live"
      And "/tmp/qa/wt-live" exists on disk
      When I send "DELETE /api/runs?worktree=/tmp/qa/wt-live" with the token
      Then the status is 400 and the body is {"error":"worktree still exists"}
      And "/tmp/qa/layered/.bindweed/runs.json" still contains "/tmp/qa/wt-live"

  Rule: The UI provides a Runs tab, running count badge, cards, and polling controls
    - The tab bar has tabs "Files", "Architecture", and "Runs".
    - The Runs tab has a badge showing the number of runs currently in "running" state.
    - Opening the Runs tab sets location hash to "#runs".
    - The Runs view lists cards newest first. Each card shows:
      - Plan name (clicking opens the plan in the Architecture tab "#at=src&plan=<slug>")
      - Tool, branch, started time and elapsed time
      - State as a coloured pill ("running", "stopped for a human", "failed", "done", "dead", "worktree removed")
      - Position line (with PR links for slop-cannon)
      - Copy worktree button that copies the path to clipboard
      - Collapsible log tail toggle showing the last 20 log lines
      - Runs with missing worktrees show "worktree removed" and a "Forget" button
      - Runs with existing worktrees do not show a "Forget" button
    - Polling refreshes GET /api/runs every 5 seconds while the Runs tab is visible, and stops when hidden.

    Scenario: Runs tab displays badge and cards with details and copy action
      Given 5 runs in runs.json: 2 running, 1 done, 1 stopped for a human, 1 dead
      When I open bindweed at "#runs"
      Then the Runs tab badge shows "2"
      And 5 cards are rendered
      When I click "Copy worktree" on the running card
      Then the clipboard holds the worktree path

    Scenario: Forget button appears only for removed worktree and removes its card
      Given runs.json has a run with removed worktree "/tmp/qa/wt-gone"
      When I open bindweed at "#runs"
      Then the card for "/tmp/qa/wt-gone" shows "worktree removed" and a "Forget" button
      When I click "Forget" on that card
      Then the card is removed from the view
      And ".bindweed/runs.json" no longer contains "/tmp/qa/wt-gone"

    Scenario: Polling refreshes every 5 seconds while visible and stops when hidden
      When I open bindweed at "#runs"
      Then GET /api/runs is requested every 5 seconds
      When I switch to the "Files" tab
      Then no GET /api/runs request is sent for 15 seconds

  Rule: Every existing route still answers
    Scenario: Old routes still answer and README lists /api/runs
      When I send "GET /api/tree" with the token
      Then the status is 200
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      When I send "GET /api/plans" with the token
      Then the status is 200
      When I send "GET /api/config" with the token
      Then the status is 200
      When I read bindweed's README.md
      Then "## Routes" has a row `/api/runs` with status "live", beside the rows already there
