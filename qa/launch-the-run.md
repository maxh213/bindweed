# QA: launch a plan as a run in its own worktree

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl, and a clipboard tool: `pbpaste`, `wl-paste -n` or `xclip -selection clipboard -o`). The tree is the checked-in `qa/fixtures/layered`. No real agent runs. The fakes below match `features/launch-the-run.feature`, except `overnight.sh` and `sc` sleep 900 seconds here, not 30. That departs from the task's 30 seconds on purpose, so step 8 still finds the run alive. The QA role, not the coder, writes the end-to-end test. The coder writes no file under `qa/`.

Launch never commits in the repository being browsed. `.bindweed/` is gitignored, so `git status --porcelain` stays empty. The tick is `✓` (U+2713). The em dash in the task bodies is `—` (U+2014). Where JSON is expected, key order may differ.

## Setup

Port 5000 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
NODEBIN=$(dirname "$(command -v node)")
mkdir -p "$QA/fakes/bin" "$QA/fakes/tools" "$QA/fakes/nosh" "$QA/log"
cat > "$QA/fakes/bin/marestail" << EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$QA/log/marestail.log"
if [ "\$1" = install ]; then
  if [ -e "$QA/log/fail-install" ]; then echo "install failed" >&2; exit 1; fi
  if [ -e "$QA/log/fail-install-quiet" ]; then exit 1; fi
  if [ -e "$QA/log/install.wait" ]; then while [ ! -e "$QA/log/install.go" ]; do sleep 0.1; done; fi
  printf 'installed=1\n' > marestail.toml
  printf 'qa tasks\n' > tasks/README.md
  printf 'qa-ignore\n' >> .gitignore
fi
exit 0
EOF
cat > "$QA/fakes/tools/overnight.sh" << EOF
#!/bin/sh
node -e 'const fs=require("fs"); const e=process.env; fs.writeFileSync("$QA/log/overnight.json", JSON.stringify({argv:process.argv.slice(1), cwd:process.cwd(), model:e.MODEL??null, scope:e.SCOPE??null, focus:e.FOCUS??null, stop:e.STOP_AT??null, claudecode:e.CLAUDECODE??null, entrypoint:e.CLAUDE_CODE_ENTRYPOINT??null, configDir:e.CLAUDE_CONFIG_DIR??null, pathHead:(e.PATH||"").split(":")[0]})+"\\n")' -- "\$@"
if [ -e "$QA/log/overnight.quick" ]; then exit 3; fi
sleep 900
EOF
cat > "$QA/fakes/bin/sc" << EOF
#!/bin/sh
node -e 'const fs=require("fs"); fs.writeFileSync("$QA/log/sc.json", JSON.stringify({argv:process.argv.slice(1), cwd:process.cwd()})+"\\n")' -- "\$@"
printf 'started\n'
sleep 900
EOF
cat > "$QA/fakes/bin/systemd-inhibit" << 'EOF'
#!/bin/sh
while [ "$#" -gt 0 ]; do case "$1" in --*) shift ;; *) break ;; esac; done
exec "$@"
EOF
chmod +x "$QA/fakes/bin/marestail" "$QA/fakes/bin/sc" "$QA/fakes/bin/systemd-inhibit" "$QA/fakes/tools/overnight.sh"
cp "$QA/fakes/bin/sc" "$QA/fakes/bin/systemd-inhibit" "$QA/fakes/nosh/"
cp -a "$BW/qa/fixtures/layered" "$QA/layered"
cd "$QA/layered"
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export BW=$BW QA=$QA NODEBIN=$NODEBIN U=http://127.0.0.1:5000"
```

Paste the printed `export` line into the second terminal. `PATH` for bindweed is only the fakes, `NODEBIN`, `/usr/bin` and `/bin`, so a real `marestail` or `sc` is not used.

## Steps

1. In the first terminal run `PATH="$QA/fakes/bin:$NODEBIN:/usr/bin:/bin" CLAUDECODE=1 CLAUDE_CODE_ENTRYPOINT=cli CLAUDE_CONFIG_DIR=/tmp/qa/claude node $BW/src/cli.ts --port 5000`. Open the printed address with `#at=src` appended. In the second terminal set `TOKEN` to the printed token, and run `command -v marestail; command -v sc`.
   **Expect:** `app` (2 files), `infra` and `domain`. The toolbar has a gear button named `Settings`. There is no `Launch` button. The two commands print `$QA/fakes/bin/marestail` and `$QA/fakes/bin/sc`.

2. Create a plan named `Empty`. Click `Launch`.
   **Expect:** `Launch` is in the toolbar after `Tasks` and before the gear. The dialog is labelled `Launch` and looks like this, with `FOCUS` blank and the dialog's `Launch` disabled. The reason is text in the dialog, not only a tooltip:

```
Launch
  Tool      marestail
  MODEL     dandelion/route-best
  SCOPE     hard
  FOCUS
  STOP_AT   qa
  this plan has no tasks
  Launch                          Close
```

3. Choose `slop-cannon` in `Tool`.
   **Expect:** `MODEL`, `SCOPE`, `FOCUS` and `STOP_AT` are gone. `Safety` is `on`. `Ammo` and `Cartridge` are blank. The dialog shows `this plan has no brief` and `Launch` is disabled.

4. Click `Close`. In the first terminal press Ctrl-C, then run `PATH="$QA/fakes/nosh:$NODEBIN:/usr/bin:/bin" CLAUDECODE=1 CLAUDE_CODE_ENTRYPOINT=cli CLAUDE_CONFIG_DIR=/tmp/qa/claude node $BW/src/cli.ts --port 5000`. Open the new address with `#at=src&plan=empty` and the new token. Click `Launch`.
   **Expect:** the dialog shows `marestail is not on PATH` and `Launch` is disabled. Choosing `slop-cannon` replaces that with `this plan has no brief`.

5. Click `Close`. Press Ctrl-C and start bindweed again with the step 1 `PATH` and the same three `CLAUDE` variables. Open the new address with `#at=src` and the new token. Create a plan named `Gate`. Click the arrow from `app` to `domain` and press Delete. Click `Contract`, then `Save to plan`. Click `Contract`, then `Copy`, and in the second terminal save the clipboard into `$QA/preview.cjs` (for example `wl-paste -n > $QA/preview.cjs`). Then paste:

```sh
curl -s -H "Authorization: Bearer $TOKEN" $U/api/plans/gate > "$QA/gate.json"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
doc.tasks = [
  {file:"005-add-core.md", title:"Add the core package", body:"# 005 — Add the core package\n\nCreate src/core.\n"},
  {file:"006-move-b.md", title:"Move b into infra", body:"# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n"},
  {file:"007-cut-app-domain.md", title:"Cut app from domain", body:"# 007 — Cut app from domain\n\nNo behaviour changes.\n"}
];
doc.brief = "# Reshape layered\n\nMove b, then cut app from domain.\n";
fs.writeFileSync(process.argv[1], JSON.stringify(doc));
' "$QA/gate.json"
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PUT --data-binary @"$QA/gate.json" $U/api/plans/gate > /dev/null
```

   Reload the page, open plan `Gate`, and click `Tasks`, then `Close`.
   **Expect:** the change list holds `src/app must not import src/domain (1 import)`. The dialog lists `005-add-core.md`, `006-move-b.md` and `007-cut-app-domain.md`, and the brief starts `# Reshape layered`.

6. Click `Launch`, then `Close`. Click `Launch` and press Escape. Click `Launch`. Type `mine` over `MODEL` and `narrow` over `SCOPE`, choose `slop-cannon`, type `3` over `Ammo`, then choose `marestail`. Choose `slop-cannon` again. Choose `marestail`, click `Close`, click `Launch`, and click the dialog's `Launch`.
   **Expect:** `Close` and Escape leave no `$QA/layered-bw-gate`. The reopened dialog has `MODEL` `dandelion/route-best`, `SCOPE` `hard`, `FOCUS` `src/app/a.ts src/domain/model.ts` and `STOP_AT` `qa`. Back on `marestail`, `MODEL` is `mine` and `SCOPE` is `narrow`. On `slop-cannon` again, `Ammo` is `3` and `Cartridge` is blank. After `Close` and `Launch` the four fields are the defaults again, and the dialog's `Launch` starts the run.

7. Look at the dialog, and click `Copy worktree`, `Copy branch` and `Copy command`, pasting each into the second terminal without running it.
   **Expect:** five steps, `Worktree ✓`, `Files ✓`, `Commit ✓`, `Start ✓`, `Record ✓`. Then the path, the branch and the watch command:

```
Steps
  Worktree ✓
  Files ✓
  Commit ✓
  Start ✓
  Record ✓
<QA>/layered-bw-gate          Copy worktree
bindweed/gate                 Copy branch
marestail watch               Copy command
```

   `<QA>` is the expanded `$QA`. The three pastes are that path, `bindweed/gate` and `marestail watch`, with nothing added.

8. In the second terminal, paste:

```sh
PID=$(node -e 'const r=require(process.argv[1]); console.log(r[r.length-1].pid)' "$QA/layered/.bindweed/runs.json")
echo "pid $PID"
kill -0 "$PID" && echo alive
```

   In the first terminal press Ctrl-C. In the second run `kill -0 "$PID" && echo still-alive`. Start bindweed again with the step 1 `PATH` and `CLAUDE` variables. Open the new address with `#at=src&plan=gate` and the new token, and click `Launch`.
   **Expect:** both `alive` and `still-alive` print. The dialog shows `a run for this plan is still alive`, its `Launch` is disabled, and the same path, `bindweed/gate` and `marestail watch` are shown.

9. In the second terminal paste:

```sh
git -C "$QA/layered-bw-gate" log -1 --format='%s%n%n%b' 
git -C "$QA/layered-bw-gate" diff-tree --no-commit-id --name-only -r HEAD
cmp -s "$QA/preview.cjs" "$QA/layered-bw-gate/.dependency-cruiser.cjs" && echo cruiser-matches
echo "--- overnight ---"
node -e 'const o=require(process.argv[1]); console.log(o.argv.join(" ")); console.log([o.model,o.scope,o.focus,o.stop,o.claudecode,o.pathHead].join(" | "))' "$QA/log/overnight.json"
echo "--- script ---"
grep -c "systemd-inhibit --what=idle --who=bindweed --why='bindweed gate'" "$QA/layered-bw-gate"/.marestail/runs/launch-*.sh
grep -c "$QA/fakes/tools/overnight.sh" "$QA/layered-bw-gate"/.marestail/runs/launch-*.sh
echo "--- toml ---"
cat "$QA/layered-bw-gate/marestail.toml"
echo "--- readme ---"
cat "$QA/layered-bw-gate/tasks/README.md"
echo "--- ignore ---"
cat "$QA/layered-bw-gate/.gitignore"
echo "--- browsed ---"
git -C "$QA/layered" status --porcelain && echo porcelain-empty
test ! -e "$QA/layered/.dependency-cruiser.cjs" && echo cruiser-not-here
cat "$QA/log/marestail.log"
```

   **Expect:** the subject is `bindweed: Gate`, then a blank line, then `src/app must not import src/domain (1 import)`, `Plan: gate` and `Base: ` plus 40 hex characters. The paths, in this order, are `.dependency-cruiser.cjs`, `.gitignore`, `marestail.toml`, `tasks/005-add-core.md`, `tasks/006-move-b.md`, `tasks/007-cut-app-domain.md` and `tasks/README.md`. `cruiser-matches` prints. The overnight line is `tasks/005-add-core.md tasks/006-move-b.md tasks/007-cut-app-domain.md`, then `dandelion/route-best | hard | src/app/a.ts src/domain/model.ts | qa | null | $QA/fakes/bin`. Both greps print `1`. The toml cat prints `installed=1`. The readme cat prints `qa tasks`. The ignore cat prints `qa-ignore`. `porcelain-empty` and `cruiser-not-here` print. The log is the line `install .`.

10. Kill the run and the branch it left, then launch into a branch that already exists. Paste:

```sh
kill -- -"$PID" 2>/dev/null || true
git -C "$QA/layered" worktree remove --force "$QA/layered-bw-gate"
git -C "$QA/layered" branch -D bindweed/gate
git -C "$QA/layered" branch bindweed/gate
```

   Click `Close`, then `Launch`, and click the dialog's `Launch`.
   **Expect:** the dialog's `Launch` was enabled before the click. The only step is `Worktree a branch named 'bindweed/gate' already exists`, with no `✓` and no `Copy worktree`. `test ! -e $QA/layered-bw-gate && git -C $QA/layered status --porcelain && echo clean` prints `clean`.

11. Paste `git -C "$QA/layered" branch -D bindweed/gate`. Choose `slop-cannon`, leave `Safety` on and `Ammo` and `Cartridge` blank, and click the dialog's `Launch`. Click `Copy command` and paste it.
   **Expect:** the five steps are ticked. The watch command, and the paste, is `sc status --repo $QA/layered-bw-gate`. In the second terminal, `node -e 'const o=require(process.argv[1]); console.log(o.cwd); console.log(o.argv.join(" "))' "$QA/log/sc.json"` prints `$QA/layered` and then `--repo $QA/layered-bw-gate --headless --safety on -m # Reshape layered` followed, after a blank line, by `Move b, then cut app from domain.` The worktree has no `tasks/005-add-core.md`. `git -C $QA/layered status --porcelain && echo clean` prints `clean`.

12. In the second terminal take the last pid from `$QA/layered/.bindweed/runs.json` the same way as step 8 and run `kill -- -"$PID"`. Then `git -C "$QA/layered" worktree remove --force "$QA/layered-bw-gate"` and `git -C "$QA/layered" branch -D bindweed/gate`. In the first terminal press Ctrl-C. Run `git -C "$QA/layered" status --porcelain && git -C "$QA/layered" worktree list && echo clean`, then `cd ~ && rm -rf "$QA"`.
   **Expect:** one worktree line, the browsed repository, then `clean`.
