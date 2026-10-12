# QA: a plan becomes task files and a slop-cannon brief

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl, and a clipboard tool: `pbpaste`, `wl-paste -n` or `xclip -selection clipboard -o`). The tree is `qa/fixtures/layered` plus a `tasks/` folder. No real LLM runs: the backend is bindweed's `qa/fixtures/fake-llm.mjs`, which saves each prompt as `<log>/<n>.prompt` and its environment as `<n>.env.json`, answers two questions, then three slices and a brief once the prompt holds an `A: ` line or `Reply with slices now.`, answers invalid JSON once when the prompt holds `BAD-ONCE`, and sleeps when it holds `SLEEP-NOW` (see `features/flesh-out-into-tasks-and-brief.feature`). `.bindweed/` is gitignored, so `git status --porcelain` stays empty.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a "$BW/qa/fixtures/layered" "$QA/layered" && mkdir "$QA/log" "$QA/layered/tasks"
printf '# 004 — x\n' > "$QA/layered/tasks/004-x.md"
printf '# Our guide\n\nOne slice per step.\n' > "$QA/layered/tasks/README.md"
cd "$QA/layered"
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export BW=$BW QA=$QA U=http://127.0.0.1:5000"
echo "node $BW/qa/fixtures/fake-llm.mjs $QA/log"
```

Paste the printed `export` line into the second terminal. Keep the last printed line; it is "the fake command".

## Steps

1. In the first terminal run `CLAUDECODE=1 CLAUDE_CODE_ENTRYPOINT=cli node $BW/src/cli.ts --port 5000`. Open the printed address with `#at=src` appended.
   **Expect:** the page shows `app` (2 files), `infra` and `domain`. A gear button named `Settings` is in the toolbar. There is no `Tasks` button.

2. Click `Settings`; note what it shows. Choose `command` in `Backend`, leave `Command` blank and click `Save`. Then paste the fake command into `Command` and click `Save`. In the second terminal run `cat $QA/layered/.bindweed/config.json; echo`.
   **Expect:** the dialog opens with `Backend` on `route` and `Command` blank. The blank save shows `write a command` and the dialog stays. After the second save the dialog closes, and the file is `{"llm":{"backend":"command","command":"<the fake command>"}}`.

3. Create a plan named `Gate`. Click the arrow from `app` to `domain` and press Delete. Click `Tasks`, then `Generate`.
   **Expect:** the run line reads `command: <the fake command>` and two questions show: `Must a.ts keep exporting a?` with `Other code may import it.`, and `Should b.ts move before the cut?` with `The order decides which slice breaks the build.`

4. In the second terminal run `grep -c 'src/app must not import src/domain (1 import)' $QA/log/1.prompt; grep -F -e '# Our guide' -e 004-x.md -e 'src/app/a.ts imports' -e 'freezes everything else' -e 'thin slice' -e 'JSON object' -e 'To ask, reply' -e 'To write, reply' $QA/log/1.prompt; cat $QA/log/1.env.json; echo`.
   **Expect:** the count is at least `1`. grep prints `# Our guide`, a line naming `004-x.md`, `src/app/a.ts imports src/app/b.ts, src/domain/model.ts, src/infra/db.ts`, a line holding `A slice that changes no behaviour says so in its first line and freezes everything else.` one holding `Write one thin slice per logical step.`, the line `Reply with exactly one JSON object, in a fenced json block.`, a line starting `To ask, reply {"questions":` and one starting `To write, reply {"slices":`. The JSON has `cwd` and `root` equal to `$QA/layered`, and `claudecode` and `entrypoint` both `null`.

5. Type `Yes, keep it.` for the first question, leave the second blank, and click `Continue`. Then run `grep -A1 '^Q: ' $QA/log/2.prompt`.
   **Expect:** three slices: `005-add-core.md`, `006-move-b.md`, `007-cut-app-domain.md`. The third body is `# 007 — Cut app from domain`, a blank line, `No behaviour changes.`. grep shows `A: Yes, keep it.` under the first question and `A: your call` under the second. The brief box holds `# Reshape layered`, a blank line, `Move b, then cut app from domain.`.

6. Click `Move 007-cut-app-domain.md up`.
   **Expect:** the order is `005-add-core.md`, `006-cut-app-domain.md`, `007-move-b.md`. Their bodies start `# 005 — Add the core package`, `# 006 — Cut app from domain`, `# 007 — Move b into infra`.

7. Click `Merge 005-add-core.md with next`, then `Delete 006-move-b.md`.
   **Expect:** after the merge the slices are `005-add-core.md` and `006-move-b.md`, and the first body is `# 005 — Add the core package`, blank, `Create src/core.`, blank, `No behaviour changes.`. After the delete only `005-add-core.md` is left.

8. Click `Save as files`. Run `ls $QA/layered/.bindweed/plans/gate/tasks; cat $QA/layered/.bindweed/plans/gate/brief.md`. Click `Copy command` and paste the clipboard into the second terminal without pressing Enter.
   **Expect:** the page shows `saved to $QA/layered/.bindweed/plans/gate/tasks/`. `ls` prints only `005-add-core.md`; `cat` prints the brief. The pasted line is `sc --repo $QA/layered --safety on -m "$(cat $QA/layered/.bindweed/plans/gate/brief.md)"` with `$QA` expanded. Clear the line.

9. Reload the page and click `Tasks`.
   **Expect:** the one slice `005-add-core.md` with its merged body and the brief are still there.

10. Close the dialog. Open `domain`'s menu, choose `Add note`, add `ASK-AGAIN`. Click `Tasks` and look for `Continue`. Click `Generate`. Type `a` for the first question, leave the second blank, and click `Just write it`. Run `grep -A1 '^Q: ' $QA/log/4.prompt; grep -c 'Reply with slices now.' $QA/log/4.prompt; grep -o '"answers":\[[^]]*\]' $QA/layered/.bindweed/plans/gate.json`.
    **Expect:** before Generate there is no `Continue` button. Generate shows the two questions and a `Continue` button. After Just write it, three slices `005-add-core.md`, `006-move-b.md`, `007-cut-app-domain.md` replace the one slice, with no error, and `Continue` is gone. grep shows `A: a` under the first question and `A: your call` under the second, then `1`, then `"answers":["a","your call"]` and nothing else.

11. Close the dialog. Open `domain`'s menu, choose `Add note`, add `BAD-ONCE`. Click `Tasks`, then `Just write it`. Run `ls $QA/log; grep -c 'Your last reply was not usable: ' $QA/log/6.prompt; grep -c '^A: a$' $QA/log/5.prompt; grep -c '^To ask, reply' $QA/log/5.prompt`.
    **Expect:** the slices are again `005-add-core.md`, `006-move-b.md`, `007-cut-app-domain.md`, with no error shown. `ls` shows `bad.done` and prompts `1` to `6`. The three greps print `1`, `1` (the answered round is kept) and `0` (no questions are offered when slices are demanded).

12. Type `Add src/core` over `Title of 005-add-core.md` and press Tab. Click `Split 005-add-core.md`, then `Move 006-add-core.md down`. Click `Preview 005-add-core.md`, look, and click it again. Click `Copy 008-cut-app-domain.md`, save the clipboard into `$QA/copied` (for example `wl-paste -n > $QA/copied`) and run `cat $QA/copied`. Type `Just cut it.` over `Brief`, press Tab, click `Save as files` and run `cat $QA/layered/.bindweed/plans/gate/brief.md; echo`.
    **Expect:** after the rename the body starts `# 005 — Add src/core` and the name is still `005-add-core.md`. After the split the slices are `005-add-core.md`, `006-add-core.md` (body `# 006 — Add src/core`, blank, `Create src/core.`), `007-move-b.md`, `008-cut-app-domain.md`. After the move: `005-add-core.md`, `006-move-b.md`, `007-add-core.md`, `008-cut-app-domain.md`. While previewing, the body box is gone and `005 — Add src/core` shows as a large heading over the text `Create src/core.`; the second click brings the box back. The first `cat` prints `# 008 — Cut app from domain`, a blank line, `No behaviour changes.`. The second prints `Just cut it.`, and the command line under the brief is unchanged.

13. Close the dialog, add the note `SLEEP-NOW` to `domain`, click `Tasks`, then `Just write it`. Watch the page for three seconds, then run `cat $QA/log/sleep.pids`, click `Cancel`, wait 2 seconds and run `for p in $(cat $QA/log/sleep.pids); do kill -0 $p 2>/dev/null && echo alive $p; done; echo checked`. Close the dialog and click `Undo`. Reload the page and click `Tasks`.
    **Expect:** while it runs the page shows `running for 0 s` counting up and a `Cancel` button, and `Generate` and `Just write it` are disabled. After Cancel the page shows `cancelled` and the four slices from step 12 are unchanged. Only `checked` is printed. Undo removes the `SLEEP-NOW` note from `domain`. After the reload the dialog lists the four slices from step 12, the first body starting `# 005 — Add src/core`, and the brief `Just cut it.`.

14. Close the dialog. Click `Settings`, type `echo nope` over `Command` and click `Save`. Click `Tasks`, then `Generate`.
    **Expect:** the page shows `command: echo nope`, an error starting `the LLM's reply was not usable: `, and a `Raw output` block holding `nope`. The four slices from step 12 are still listed.

15. In the first terminal press Ctrl-C. In the second run `cd ~ && git -C $QA/layered status --porcelain && ls $QA/layered/tasks && echo clean`, then `rm -rf "$QA"`.
    **Expect:** `004-x.md`, `README.md` and `clean`, and nothing else.
