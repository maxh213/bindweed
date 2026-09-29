# 009 — say what you don't like and review the LLM's proposed reshaping on the canvas

After this task the developer can type what bothers them about the structure — "the ui knows about the scanner", "app is doing three jobs" — and see an LLM's proposed fix drawn on the canvas as ghost edits: boxes that would move, arrows that would be cut or added, packages that would be created or split. They accept or reject each proposal, or all at once; accepted proposals become ordinary plan edits. This is the loop from Uncle Bob's uml-viewer, where he describes what he dislikes and the agent draws the diagram it proposes until he is satisfied.

## Asking

- With a plan open, an **Ask** box sits under the change list: a textarea and **Propose**.
- The prompt, sent through the 008 backend with the same timeout, Cancel and parsing rules, contains: the text; the current view directory; the planned graph at the current view and one level below (nodes, edges with kinds and counts, cycles, 004 metrics when available); the plan's edits so far; the edit JSON schema from 005/006; the conversation for this plan so far.
- It asks for `{ "summary": "<one paragraph>", "edits": [ <edits in the 005/006 JSON> ] }`.
- Each returned edit is checked by the same domain code that applies plan edits, against the plan with the proposals before it applied. Ones that do not apply are listed as `dropped: <sentence> — <reason>` and not drawn.

## Proposals on the canvas

- Valid proposed edits are drawn on the planned view as a ghost layer in a single distinct colour (purple): moved boxes as ghost boxes at their proposed place, cut arrows with a purple ✂, added arrows dashed purple, new packages as dashed purple boxes, deletions struck through in purple.
- A **Proposals** list above the change list shows the summary and each proposal as its change-list sentence with **Accept** and **Reject**, plus **Accept all** and **Reject all**. Hovering a proposal highlights its ghost.
- Accept appends the edit to the plan (one undo step per accepted edit) and removes it from the list; the rest are re-checked against the new plan and marked dropped if they no longer apply. Reject removes it. Nothing reaches the plan without an accept.
- Sending another message (for example `keep scan where it is`) replaces the open proposals with the new reply.
- The conversation is saved as `.bindweed/plans/<slug>.chat.json`: `[{ "at", "text", "summary", "edits", "decisions": { "<index>": "accepted" | "rejected" } }]`, and shown collapsed above the Ask box.

## QA

Use the 008 fake backend, extended: when the prompt contains `ui knows about the scanner`, it returns a summary and three edits: a valid `cut-edge`, a valid `create-package` plus a `move-file` into it, and one invalid `move-file` of a file that does not exist. Check: two valid proposals are drawn purple and listed (three sentences), the invalid one shows as dropped with its reason; accepting the cut adds it to the change list and Undo removes it; Reject all clears the rest with the plan unchanged; a second message replaces the proposals; reload shows the conversation. `git status --porcelain` in the fixture stays empty.

## Must not change

- Plans, interview and slices from 005–008. The Ask box sends nothing unless Propose is pressed.
