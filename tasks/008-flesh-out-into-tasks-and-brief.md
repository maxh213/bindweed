# 008 — flesh a plan out into ordered marestail task files and a slop-cannon brief

After this task the developer can press **Generate** on a plan and have an LLM interview them briefly about the gaps (values, what must not change, what order to do things in), or skip the interview with **Just write it**. They get back a suggested ordered set of refactor slices as marestail task files, which they can edit, reorder, merge, split or delete, plus a slop-cannon brief for the same plan. Everything is saved with the plan and can be copied or saved as files in `.bindweed/`; writing to a run branch is 010's job.

## LLM backend

- Settings dialog (gear icon) editing `.bindweed/config.json`: `{ "llm": { "backend": "route" | "claude" | "command", "command"?: "<shell command>" } }`. Default `route`.
- `route`: run `marestail route --high` (60 s timeout). It prints one line `<model> <effort> <provider>`, e.g. `claude-fable-5-1 max claude` or `claude-opus-5-5 max claude-work`. Provider `claude` → `claude -p --model <model> --effort <effort> --output-format text --allowedTools Read,Grep,Glob`. Provider `claude-work` → the same with `CLAUDE_CONFIG_DIR=$HOME/.claude-work`. Any other provider, `marestail` missing, a non-zero exit or an unparseable line → use the `claude` backend and show `route picked <provider>; bindweed speaks to claude only, so it used claude-opus-5-5` (or the failure reason).
- `claude`: `claude -p --model claude-opus-5-5 --effort high --output-format text --allowedTools Read,Grep,Glob`.
- `command`: `sh -c <command>`, with `BINDWEED_ROOT` set to the repo root.
- Every backend: the prompt goes on stdin, the reply is stdout, the working directory is the repo root, `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are unset, 15-minute timeout. The page shows which backend and model ran, a spinner with elapsed time, and **Cancel**, which kills the process group.

## Protocol

- The prompt asks for exactly one JSON object, in a fenced `json` block, of one of two shapes: `{ "questions": [{ "id", "text", "why" }] }` with at most 5 questions, or `{ "slices": [{ "title", "slug", "body" }], "brief": "<markdown>" }`.
- Parse the last fenced `json` block in stdout, else the whole of stdout. On invalid JSON or a wrong shape, retry once with the error appended to the prompt; if that fails too, show the error and the raw output.
- The prompt contains: the plan's edits as the change-list sentences plus their JSON; the notes; the planned-graph warnings; the contract rules from 007 when saved; for every file the plan touches, its current imports and importers; the repository's task-writing guide (the target's `tasks/README.md` if present, else the copy bindweed ships of marestail's `templates/tasks-README.md`); the names of existing files in the target's `tasks/`; the interview so far.
- It instructs: order slices so each leaves the repository working (leaves and new packages first, then moves, then cuts, then the contract); a slice that changes no behaviour says so in its first line and freezes everything; each slice names the files it touches, the imports that must be gone when it ends, the contract rules it makes pass, and what must not change; one slice per logical step, thin.

## Interview

- **Generate** runs round 1. Questions show with their `why`; each has a text box, and a blank answer is sent as `your call`. **Continue** sends the answers for the next round. After 3 rounds the prompt demands slices. **Just write it** asks for slices at once, at any point.
- The transcript is saved in the plan as `"interview": [{ "round", "questions", "answers" }]`.

## Slices

- Numbered from the next free number in the target's `tasks/` (highest `NNN` + 1, `001` when there is none), consecutive, three digits. File name `NNN-<slug>.md`; the body's first line is `# NNN — <title>`, rewritten by bindweed on renumbering.
- Editable list: title; body in a markdown textarea with a preview toggle; move up/down; **Merge with next** (joins bodies under the first title); **Split** (duplicates the slice for editing); delete. Numbers follow the order.
- Saved in the plan as `"tasks": [{ "file", "title", "body" }]`.
- **Save as files** writes them to `.bindweed/plans/<slug>/tasks/` (clearing that folder first) and shows the path. **Copy** on each.

## slop-cannon brief

- Shown under the slices as an editable markdown textarea, saved as `"brief"` in the plan. **Save as files** also writes `.bindweed/plans/<slug>/brief.md`.
- A copyable command: `sc --repo <root> --safety on -m "$(cat <root>/.bindweed/plans/<slug>/brief.md)"`.

## QA

Use the `command` backend with a fake: `qa/fixtures/fake-llm.mjs` reads the prompt from stdin and answers by what it finds, returning two questions on the first call, three slices and a brief when the prompt contains answers or asks to write, and invalid JSON once when the prompt contains a marker the test sets in a note. Check: the interview shows two questions with their reasons; answering one and leaving one blank sends `your call` (the fake echoes the prompt into a file the test reads); three slices appear numbered after the fixture's existing `tasks/004-x.md` as `005`, `006`, `007`; moving the last one up renumbers files and headings; merge and delete work; Save as files writes exactly those files under `.bindweed/plans/<slug>/tasks/`; the brief and the command show; the invalid-JSON reply retries once and then succeeds; Cancel on a fake that sleeps kills it within 2 seconds. `git status --porcelain` in the fixture stays empty. A unit test pins the `route` line parsing and the fallback message for provider `grok`.

## Must not change

- Plans from 005–007 load unchanged. The target's `tasks/` folder is read, never written.
