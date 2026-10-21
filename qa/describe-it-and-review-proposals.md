# QA: say what you dislike and review the proposals on the canvas

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). The tree is `qa/fixtures/layered`. No real LLM runs. The backend is `qa/fixtures/fake-llm.mjs`, extended as in `features/describe-it-and-review-proposals.feature`: the line under `## What they dislike` chooses the reply. `the ui knows about the scanner` returns the summary `Pull scanning out of the ui so app has one job.` and four edits (cut `src/app` → `src/domain`, create `src/ports`, move `src/app/b.ts` into it, move the missing `src/no-such.ts`). `keep scan where it is` returns the summary `Leave scanning in app.` and one added edge from `src/domain` to `src/app`. `app is doing three jobs` returns the summary `Give each job its own package.` and four edits (split `src/app` into `scan` with `a.ts` and `jobs` with `b.ts`, move `src/app/scan/a.ts` to `src/infra`, delete `src/infra/db.ts`, a note on `src/app`). `keep scan where it is` is matched before the scanner phrase, and only on that dislike line, so a later turn can quote the earlier text. The QA role, not the coder, writes the end-to-end test and that fixture change. The coder writes no file under `qa/`.

The server adds `.bindweed/` to the fixture's git exclude, so `git status --porcelain` stays empty. Purple is `#7c3aed`. The dash in a dropped line is `—` (U+2014).

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a "$BW/qa/fixtures/layered" "$QA/layered" && mkdir "$QA/log"
cd "$QA/layered"
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
node -e 'const fs=require("fs"); fs.mkdirSync(".bindweed",{recursive:true}); fs.writeFileSync(".bindweed/config.json", JSON.stringify({llm:{backend:"command",command:process.argv[1]}}))' "node $BW/qa/fixtures/fake-llm.mjs $QA/log"
echo "export BW=$BW QA=$QA U=http://127.0.0.1:5000"
```

Paste the printed `export` line into the second terminal.

## Steps

1. In the first terminal run `node $BW/src/cli.ts --port 5000`. Open the printed address with `#at=src` appended.
   **Expect:** `app` (2 files) above `infra` above `domain`, and the arrow from `app` to `domain`. There is no `Ask` box and no `Proposals` region.

2. Click `New plan…`, type `Gate`, click `Create`. Click `Propose` with the box empty. Then type `the ui knows about the scanner`, press Enter, and in the second terminal run `ls "$QA/log"`.
   **Expect:** the column order is `Changes`, then `Ask` (a textarea labelled `Ask`, and `Propose`). There is no `Conversation` button. The empty Propose shows `write what you dislike`. After Enter, `ls` prints nothing.

3. Click `Propose`.
   **Expect:** `Ask` is empty. `ran` shows `command: node <bindweed>/qa/fixtures/fake-llm.mjs <log>`. The column is now:

```
Proposals
  Pull scanning out of the ui so app has one job.
  src/app must not import src/domain (1 import)    Accept    Reject
  Create package src/ports                          Accept    Reject
  Move src/app/b.ts to src/ports                    Accept    Reject
  dropped: Move src/no-such.ts to src/ports — no such file src/no-such.ts
                                                    Reject
  Accept all    Reject all
Changes
  Undo    Redo
  (no sentence)
Conversation          (collapsed)
Ask
  (empty)
  Propose
```

   On the planned canvas the real boxes `app`, `infra` and `domain` stay in one column, `app` still lists `a.ts` and `b.ts` with nothing struck through, and the real arrow from `app` to `domain` stays. Over that arrow is a purple `✂`. A dashed purple box `ports` sits to the right of `app` on the top row, overlapping nothing, and holds a dashed purple row `b.ts`. In the browser's inspector `ports` has `data-x="260"` and `data-y="0"`, and `app` has `data-x="0"` and `data-y="0"`. Nothing is drawn for `src/no-such.ts`. The dropped row has no Accept button.

```
top row      [ app: a.ts b.ts ]   [ ports: b.ts ]   <- ports dashed purple
second row   [ infra: db.ts ]
third row    [ domain: model.ts ]
```

4. In the second terminal run `grep -F '## What they dislike' -A1 "$QA/log/1.prompt"; echo; grep -c 'edge src/app -> src/domain runtime 0 type 1' "$QA/log/1.prompt"; grep -c 'node src/app/a.ts file a.ts' "$QA/log/1.prompt"; grep -c 'cycles a.ts → b.ts → a.ts' "$QA/log/1.prompt"; grep -c '{"kind":"move-file","file":"<path>","to":"<dir>"}' "$QA/log/1.prompt"; grep -c 'Reply with slices now.' "$QA/log/1.prompt"; echo`.
   **Expect:** the first grep prints `## What they dislike` and, on the next line, `the ui knows about the scanner`. The counts are `1`, `1`, `1`, `1` and `0`.

5. Hover `src/app must not import src/domain (1 import)`. Then click `Accept Move src/app/b.ts to src/ports` and in the second terminal run `node -e 'const p=require(process.argv[1]); console.log(p.edits.length)' "$QA/layered/.bindweed/plans/gate.json"; node -e 'console.log(JSON.stringify(require(process.argv[1])[0].decisions))' "$QA/layered/.bindweed/plans/gate.chat.json"`.
   **Expect:** on hover the purple `✂` is highlighted and the `ports` box is not. After the click the move's row, still third, reads `dropped: Move src/app/b.ts to src/ports — no such directory src/ports` with only `Reject`. The `ports` box stays and its `b.ts` row is gone. The commands print `0` and `{}`.

6. Click `Accept src/app must not import src/domain (1 import)`. Click `Undo`, then `Redo`, then `Undo`.
   **Expect:** Accept puts that sentence in `Changes` and removes it from `Proposals`, and the move is back with `Accept` and `Reject` and its `b.ts` row in `ports`. The first Undo clears `Changes`. Redo brings the sentence back. The second Undo clears it again. `Proposals` does not regain the cut. The package, the move and the dropped line stay.

7. Click `Reject all`. In the second terminal run `node -e 'const c=require(process.argv[1]); console.log(JSON.stringify(c[0].decisions)); console.log(c.length)' "$QA/layered/.bindweed/plans/gate.chat.json"` and `node -e 'const p=require(process.argv[1]); console.log(p.edits.length, p.redo.length)' "$QA/layered/.bindweed/plans/gate.json"`.
   **Expect:** `Proposals` is gone and `Changes` has no sentence. The first command prints `{"0":"accepted","1":"rejected","2":"rejected","3":"rejected"}` and `1`. The second prints `0 1`.

8. Type `keep scan where it is` and click `Propose`. In the second terminal run `grep -F -A1 "## The plan's edits so far" "$QA/log/2.prompt"; grep -F -A6 '## Conversation so far' "$QA/log/2.prompt"`.
   **Expect:** `Proposals` lists only `src/domain should use src/app`, with Accept and Reject. The purple `✂`, the `ports` box and the `b.ts` row are gone. A dashed purple arrow runs from `domain` to `app`. The first grep prints `## The plan's edits so far` and `none`. The second prints `## Conversation so far`, `They said: the ui knows about the scanner`, `Summary: Pull scanning out of the ui so app has one job.`, `0 accepted: src/app must not import src/domain (1 import)`, `1 rejected: Create package src/ports`, `2 rejected: Move src/app/b.ts to src/ports` and `3 rejected: Move src/no-such.ts to src/ports`.

9. Reload the page. Click `Conversation`.
   **Expect:** before the click, `Conversation` is collapsed and the dashed purple arrow from `domain` to `app` is back. After the click it shows, in order: `They said: the ui knows about the scanner`, `Summary: Pull scanning out of the ui so app has one job.`, `0 accepted: src/app must not import src/domain (1 import)`, `1 rejected: Create package src/ports`, `2 rejected: Move src/app/b.ts to src/ports`, `3 rejected: Move src/no-such.ts to src/ports`, `They said: keep scan where it is`, `Summary: Leave scanning in app.` and `0 open: src/domain should use src/app`.

10. Click `Tasks`, then `Generate`. Close the dialog.
    **Expect:** the two questions `Must a.ts keep exporting a?` and `Should b.ts move before the cut?` show, with their reasons. After closing, `Conversation` still has both turns and the purple arrow is still there.

11. Click `Settings`, replace `Command` with `echo nope`, click `Save`. Type `hello` and click `Propose`.
    **Expect:** the ask region shows `the LLM's reply was not usable: it is not valid JSON` and a `Raw output` block holding `nope`. The textarea still holds `hello`. `Proposals` still lists `src/domain should use src/app`.

12. Click `Settings`, set `Command` back to `node $BW/qa/fixtures/fake-llm.mjs $QA/log`, click `Save`. Clear `Ask`, type `SLEEP-NOW` and click `Propose`. When `running for` is counting, click `Cancel` and wait 2 seconds. In the second terminal run `for p in $(cat "$QA/log/sleep.pids"); do kill -0 "$p" 2>/dev/null && echo alive "$p"; done; echo checked`.
    **Expect:** while it runs, `Propose` is disabled. After Cancel the page shows `cancelled` and `Proposals` still lists `src/domain should use src/app`. The loop prints only `checked`.

13. Type `app is doing three jobs` and click `Propose`. Hover each proposal in turn, then click `Reject all`.
    **Expect:** `Proposals` shows `Give each job its own package.` and, each with Accept and Reject, `Split src/app into src/app/scan (1 file) and src/app/jobs (1 file)`, `Move src/app/scan/a.ts to src/infra`, `Delete src/infra/db.ts` and `Note on src/app: "three jobs"`. No dropped line. The arrow from `domain` to `app` is gone. Right of `app` on the top row is a dashed purple box `jobs` holding a dashed row `b.ts`; right of `infra` on the second row is an empty dashed purple box `scan`. `infra` lists `db.ts`, struck through in purple, then a dashed purple row `a.ts`. The name `app` is struck through in purple, and its rows `a.ts` and `b.ts` are not. Nothing on the canvas says `three jobs`. Hovering the split highlights `jobs`, `scan`, the `b.ts` row in `jobs` and the strike on `app`. Hovering the move highlights only the `a.ts` row in `infra`. Hovering the note highlights nothing. After `Reject all` no purple mark is left and `Changes` has no sentence.

14. Click `Delete plan`, then `Delete`. In the second terminal run `ls "$QA/layered/.bindweed/plans"; echo listed`. Click `New plan…`, type `Gate`, click `Create`.
    **Expect:** `ls` prints only `listed`. The new `Gate` shows `Ask` but no `Conversation` button and no `Proposals`.

15. In the second terminal run `printf '{not json' > "$QA/layered/.bindweed/plans/gate.chat.json"`. Reload the page. Type `keep scan where it is` and click `Propose`. Run `node -e 'const c=require(process.argv[1]); console.log(c.length, c[0].text)' "$QA/layered/.bindweed/plans/gate.chat.json"`.
    **Expect:** after the reload there is no `Conversation` button, no `Proposals` and no error. After Propose, `Proposals` lists only `src/domain should use src/app`. The command prints `1 keep scan where it is`.

16. In the first terminal press Ctrl-C. In the second run `git -C "$QA/layered" status --porcelain; echo clean`, then `rm -rf "$QA"`.
    **Expect:** `clean`, and nothing else.
