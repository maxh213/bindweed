# QA: say what you dislike and review the proposals on the canvas

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). The tree is `qa/fixtures/layered`. No real LLM runs. The backend is `qa/fixtures/fake-llm.mjs`, extended as in `features/describe-it-and-review-proposals.feature`: the line under `## What they dislike` chooses the reply. `the ui knows about the scanner` returns the summary `Pull scanning out of the ui so app has one job.` and four edits (cut `src/app` → `src/domain`, create `src/ports`, move `src/app/b.ts` into it, move the missing `src/no-such.ts`). `keep scan where it is` returns the summary `Leave scanning in app.` and one added edge from `src/domain` to `src/app`. `keep scan where it is` is matched before the scanner phrase, and only on that dislike line, so a later turn can quote the earlier text. The QA role, not the coder, writes the end-to-end test and that fixture change. The coder writes no file under `qa/`.

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

   On the planned canvas the real boxes `app`, `infra` and `domain` stay, `app` still lists `a.ts` and `b.ts`, and the real arrow from `app` to `domain` stays. Over that arrow is a purple `✂`. A dashed purple box `ports` holds a dashed purple row `b.ts`. Nothing is drawn for `src/no-such.ts`. The dropped row has no Accept button.

4. In the second terminal run `grep -F '## What they dislike' -A1 "$QA/log/1.prompt"; echo; grep -c 'edge src/app -> src/domain runtime 0 type 1' "$QA/log/1.prompt"; grep -c 'node src/app/a.ts file a.ts' "$QA/log/1.prompt"; grep -c 'cycles a.ts → b.ts → a.ts' "$QA/log/1.prompt"; grep -c '{"kind":"move-file","file":"<path>","to":"<dir>"}' "$QA/log/1.prompt"; grep -c 'Reply with slices now.' "$QA/log/1.prompt"; echo`.
   **Expect:** the first grep prints `## What they dislike` and, on the next line, `the ui knows about the scanner`. The counts are `1`, `1`, `1`, `1` and `0`.

5. Hover `src/app must not import src/domain (1 import)`.
   **Expect:** the purple `✂` is highlighted and the `ports` box is not.

6. Click `Accept src/app must not import src/domain (1 import)`. Click `Undo`, then `Redo`, then `Undo`.
   **Expect:** Accept puts that sentence in `Changes` and removes it from `Proposals`. The first Undo clears `Changes`. Redo brings the sentence back. The second Undo clears it again. `Proposals` does not regain the cut. The package, the move and the dropped line stay.

7. Click `Reject all`. In the second terminal run `node -e 'const c=require(process.argv[1]); console.log(JSON.stringify(c[0].decisions)); console.log(c.length)' "$QA/layered/.bindweed/plans/gate.chat.json"` and `node -e 'const p=require(process.argv[1]); console.log(p.edits.length, p.redo.length)' "$QA/layered/.bindweed/plans/gate.json"`.
   **Expect:** `Proposals` is gone and `Changes` has no sentence. The first command prints `{"0":"accepted","1":"rejected","2":"rejected","3":"rejected"}` and `1`. The second prints `0 1`.

8. Type `keep scan where it is` and click `Propose`.
   **Expect:** `Proposals` lists only `src/domain should use src/app`, with Accept and Reject. The purple `✂`, the `ports` box and the `b.ts` row are gone. A dashed purple arrow runs from `domain` to `app`.

9. Reload the page. Click `Conversation`.
   **Expect:** before the click, `Conversation` is collapsed and the dashed purple arrow from `domain` to `app` is back. After the click you see `the ui knows about the scanner`, `Pull scanning out of the ui so app has one job.`, `keep scan where it is` and `Leave scanning in app.`.

10. Click `Tasks`, then `Generate`. Close the dialog.
    **Expect:** the two questions `Must a.ts keep exporting a?` and `Should b.ts move before the cut?` show, with their reasons. After closing, `Conversation` still has both turns and the purple arrow is still there.

11. Click `Settings`, replace `Command` with `echo nope`, click `Save`. Type `hello` and click `Propose`.
    **Expect:** the ask region shows text starting `the LLM's reply was not usable: ` and a `Raw output` block holding `nope`. The textarea still holds `hello`. `Proposals` still lists `src/domain should use src/app`.

12. Click `Settings`, set `Command` back to `node $BW/qa/fixtures/fake-llm.mjs $QA/log`, click `Save`. Clear `Ask`, type `SLEEP-NOW` and click `Propose`. When `running for` is counting, click `Cancel` and wait 2 seconds. In the second terminal run `for p in $(cat "$QA/log/sleep.pids"); do kill -0 "$p" 2>/dev/null && echo alive "$p"; done; echo checked`.
    **Expect:** while it runs, `Propose` is disabled. After Cancel the page shows `cancelled` and `Proposals` still lists `src/domain should use src/app`. The loop prints only `checked`.

13. In the first terminal press Ctrl-C. In the second run `git -C "$QA/layered" status --porcelain; echo clean`, then `rm -rf "$QA"`.
    **Expect:** `clean`, and nothing else.
