# 010 — launch the plan as a marestail or slop-cannon run in its own worktree

After this task the developer can press **Launch** on a plan that has tasks (008) and choose marestail or slop-cannon. Bindweed makes a worktree and branch beside the repository, commits the plan's task files and contract as the first commit, and starts the run detached so it survives bindweed closing. The repository they are browsing is untouched; the run happens next door.

## Launch dialog

- **Tool**: `marestail` (default) or `slop-cannon`.
- marestail fields, prefilled: `MODEL` = `dandelion/route-best`; `SCOPE` = `hard`; `FOCUS` = every path the plan touches, space-separated, both current paths and planned ones, deduplicated and sorted; `STOP_AT` = `qa`. All editable; a blank `SCOPE` means none.
- slop-cannon fields: safety `on` (default) or `off`; ammo and cartridge blank by default, meaning sc's own configuration.
- Launch is disabled, with the reason shown, when the plan has no tasks (marestail) or no brief (slop-cannon), when the needed command is not on `PATH` (`marestail`; `sc`), or when a run for this plan is still alive (011 knows; until then: its recorded pid is alive).

## Steps

The dialog shows each step with a tick, or the error that stopped it:

1. Worktree: `git worktree add -b bindweed/<slug> <parent of root>/<repo dir name>-bw-<slug> HEAD`. If the branch or directory exists, stop with that message; nothing is changed.
2. Files, in the worktree: the plan's tasks as `tasks/<file>` (marestail only); the contract merged into `.dependency-cruiser.cjs` exactly as 007 shows it, when the plan has one; `marestail install .` when the worktree has no `marestail.toml` (marestail only).
3. First commit, as the user's git identity: subject `bindweed: <plan name>`, body the change-list sentences, one per line, then `Plan: <slug>` and `Base: <baseCommit>`.
4. Start:
   - marestail: write `<worktree>/.marestail/runs/launch-<YYYYMMDDTHHMM>.sh` and run it detached (`setsid`, stdin from `/dev/null`, stdout and stderr to `launch-<stamp>.out` beside it). The script puts the directory of the `marestail` found on `PATH` first on its own `PATH`, unsets `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_CONFIG_DIR`, `cd`s into the worktree, echoes a start line with its pid and settings, then runs `MODEL=... SCOPE=... FOCUS="..." STOP_AT=... systemd-inhibit --what=idle --who=bindweed --why="bindweed <slug>" bash <marestail dir>/../tools/overnight.sh tasks/<file> ...` (tasks in order; without `systemd-inhibit` on `PATH`, the same command without it), and echoes its exit code and end time. `<marestail dir>` is the directory of the real path of the `marestail` on `PATH`.
   - slop-cannon: run `sc --repo <worktree> --headless --safety <on|off> [--ammo N] [--cartridge NAME] -m <brief text>` detached the same way, output to `<root>/.bindweed/runs/<slug>-<stamp>.out`.
5. Record the run in `<root>/.bindweed/runs.json` as `{ "slug", "tool", "worktree", "branch", "pid", "startedAt", "out", "settings" }` (appending).

- The page shows the worktree path, the branch, and the command to watch it (`marestail watch`, or `sc status --repo <worktree>`), each copyable.
- Bindweed exiting does not stop the run.

## QA

With fakes, never real agents: QA puts fake `marestail`, `sc` and `systemd-inhibit` executables first on `PATH` for the bindweed process; the fake `marestail` has a sibling `../tools/overnight.sh` that records its arguments and environment into a file and sleeps 30 seconds; the fake `marestail install` writes a `marestail.toml`; the fake `sc` records its arguments and sleeps. Check: with a plan from 008 and a saved contract, Launch creates `../<fixture>-bw-<slug>` on `bindweed/<slug>` with one new commit whose message has the sentences, `Plan:` and `Base:`, containing the task files, the merged `.dependency-cruiser.cjs` and a `marestail.toml`; the fake overnight.sh saw the tasks in order and `MODEL=dandelion/route-best`, `SCOPE=hard`, the focus paths and `STOP_AT=qa`, with `CLAUDECODE` unset; killing bindweed leaves the fake run alive; Launch again says the run is still alive; with sc chosen, the fake sc saw `--headless --safety on -m <brief>`; an existing branch stops at step 1 with nothing created. The browsed fixture's `git status --porcelain` stays empty. Clean up worktrees after each test.

## Must not change

- Plans and everything from 005–009. Bindweed never commits in the browsed repository.
