# 011 — a Runs panel shows where every launched run stands

After this task the developer can open a **Runs** tab and see every run launched from this repository with bindweed: which plan, which tool, where it is (the marestail role it is on, or slop-cannon's phase and bead counts), the last lines of its log, and whether it is **running**, **stopped for a human**, **failed**, **done** or **dead** (the process is gone without finishing). The panel is read-only.

## State, per run in `.bindweed/runs.json`

marestail (read from the worktree):

- The newest `.marestail/runs/overnight-*.md` summary: `all tasks complete` → **done**; a line `stopped: <task> exited <code>` → **stopped for a human** when the last `pipeline.log` line contains `stopping for a human`, else **failed**.
- Current task: the newest `.marestail/runs/<task>/pipeline.log`. Current role: its last line starting `== ` (for example `== coder (112-coder) attempt 2` → role `coder`, step `112`, attempt 2). A task whose log ends with `pipeline complete` is finished.
- Tasks done: the count of the run's tasks whose `pipeline.log` contains `pipeline complete`, shown as `2 of 4 tasks`.
- The launch pid alive and none of the above → **running**. Pid gone and not done, stopped or failed → **dead**.
- Log tail: the last 20 lines of the current task's `pipeline.log`.

slop-cannon:

- `sc status --repo <worktree> --json` (10-second timeout): `state.phase`, the number of live agents, bead counts by state, and the pull requests it has opened (with links). Pid alive → **running**; phase `done`/`complete` → **done**; pid gone otherwise → **dead**. If `sc status` fails, show its error and the pid state.
- Log tail: the last 20 lines of the run's `.out` file.

## Page

- A **Runs** tab next to Files and Architecture, badge showing the number of running runs.
- One card per run, newest first: plan name (clicking opens the plan), tool, branch, worktree path (copyable), started time and elapsed, state as a coloured pill, the position line (`task 006 · hardener · attempt 1 · 1 of 3 tasks`, or `running · 4 agents · 7 open · 3 done · 2 PRs`), and a collapsible log tail.
- The panel refreshes every 5 seconds while visible (`GET /api/runs`), and stops polling when hidden.
- Runs whose worktree no longer exists show **worktree removed**, and a **Forget** button removes them from `runs.json`; nothing else writes.

## QA

Fake worktrees built by the test, no real agents: one with an overnight summary ending `all tasks complete` (done); one whose summary says `stopped: tasks/002-x.md exited 1` and whose pipeline log ends with a `stopping for a human` line (stopped for a human); one with a live `sleep` pid and a pipeline log ending `== hardener (07-hardener) attempt 1` (running, `hardener`); one with a dead pid and no summary (dead); an sc run whose fake `sc status --json` prints a canned state (running, counts and a PR link). Check every card's state, position line and log tail; the badge shows 2; Forget on a removed worktree removes its card; polling stops when the tab is hidden (no requests for 15 seconds).

## Must not change

- Launch (010) and `runs.json` entries it writes; fields may be added.
