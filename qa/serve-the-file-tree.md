# QA: bindweed serves the file tree

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`.

## Setup

Ports 4477 to 4497, 4555 and 4600 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p $QA/plain $QA/demo-repo/src/lib $QA/demo-repo/docs $QA/demo-repo/build && cd $QA/demo-repo
printf "export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n" > src/a.ts
printf 'export const id = 1;\n' > src/lib/util.ts
printf '# guide\n' > docs/guide.md; printf '# demo\n' > README.md
printf 'z\n' > Zebra.txt; printf 'a\n' > apple.txt; printf '*.log\n' > .gitignore
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
printf 'secret\n' > debug.log; printf 'out\n' > build/out.log
hold() { node -e "for (let p = $1; p <= $2; p++) require('node:net').createServer().listen(p, '127.0.0.1')" & }
echo "export QA=$QA U=http://127.0.0.1:4477"
```

Paste the `export` line it prints into the second terminal. `hold 4477 4497` keeps those ports taken until `kill %%`. Where a step shows `$QA`, bindweed prints the path spelled out.

## Steps

1. In the first terminal, in `$QA/demo-repo`, run `node $BW/src/cli.ts`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4477/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/demo-repo`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `ss -ltnH 'sport = :4477'` (macOS: `lsof -nP -iTCP:4477 -sTCP:LISTEN`).
   **Expect:** one listener, on `127.0.0.1:4477`.

3. In the second terminal run each command.
   **Expect:** the status and body in its row.

   | command | status | body |
   |---|---|---|
   | `curl -si $U/api/tree` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si "$U/api/tree?token=00000000000000000000000000000000"` | 401 | `{"error":"missing or wrong token"}` |
   | `curl -si -H "Authorization: Bearer $TOKEN" $U/api/tree` | 200 | JSON whose `root` is `demo-repo`; `debug.log`, `build` and `.bindweed` appear nowhere |
   | `curl -si -H "Host: evil.example:4477" "$U/api/tree?token=$TOKEN"` | 403 | `{"error":"bad host"}` |
   | `curl -si $U/` | 401 | `bindweed: use the link bindweed printed in the terminal` |
   | `curl -si "$U/api/file?token=$TOKEN&path=debug.log"` | 404 | `{"error":"no such file"}` |
   | `curl -si "$U/api/file?token=$TOKEN&path=../plain"` | 404 | `{"error":"no such file"}` |

4. In the second terminal fetch every asset the page names, without a token:

   ```sh
   curl -s "$U/?token=$TOKEN" | grep -o '/assets/[^"]*' | xargs -I{} curl -so /dev/null -w '%{http_code}\n' $U{}
   ```

   **Expect:** one or more lines, each `200`.

5. Open the printed link in the browser.
   **Expect:** the tab title is `bindweed — demo-repo`. The address bar reads `http://127.0.0.1:4477/`, without the token. The left side shows the rows `demo-repo/`, `docs/`, `src/`, `.gitignore`, `README.md`, `Zebra.txt`, `apple.txt`, in that order and no others. The right side shows `select a file`.

6. Click `src/`, then click it again, then a third time.
   **Expect:** first `lib/` then `a.ts` appear beneath it, and `util.ts` does not; the second click hides them; the third shows them again.

7. Click `a.ts`.
   **Expect:** the right side shows the header `src/a.ts` and, in a fixed-width font, three lines numbered 1 to 3: `export const a = 1;`, `export const name = 'żółw';`, `export const sum = a + 2;`. There is no line 4. `a.ts` is marked as selected in the tree. The address bar reads `http://127.0.0.1:4477/#file=src/a.ts`.

8. Open the browser's developer tools, look at session storage, then click `README.md` with the network panel open.
   **Expect:** session storage holds the key `bindweed.token` with the token as its value. The request to `/api/file?path=README.md` carries the request header `Authorization: Bearer` plus the token, and has no `token=` in its address.

9. Reload the page.
   **Expect:** only the plain text `bindweed: use the link bindweed printed in the terminal`, because the address no longer holds the token.

10. In a new tab open `http://127.0.0.1:4477/?token=$TOKEN#file=src/a.ts`, then `http://127.0.0.1:4477/?token=$TOKEN#file=src/lib/util.ts`, with the token written out.
    **Expect:** the first shows `src/a.ts` as in step 7, with `src/` expanded and `docs/` collapsed. The second shows the header `src/lib/util.ts` and line 1 `export const id = 1;`, with `src/` and `lib/` expanded, and the address bar reads `http://127.0.0.1:4477/#file=src/lib/util.ts`.

11. In the second terminal run the lines below. Then open the printed link again and click `notes.txt`, `blob.bin`, `big.txt`, `notes/` and `żółw i zając.md`.

    ```sh
    cd $QA/demo-repo && printf 'todo\n' > notes.txt && printf 'a\0b' > blob.bin && ln -s README.md link.txt
    head -c 1048577 /dev/zero | tr '\0' x > big.txt; mkdir notes; printf 'cześć\n' > 'notes/żółw i zając.md'
    ```

    **Expect:** the rows under the root are `docs/`, `notes/`, `src/`, `.gitignore`, `README.md`, `Zebra.txt`, `apple.txt`, `big.txt`, `blob.bin`, `notes.txt`; the symlink `link.txt` is not among them. `notes.txt` shows line 1 `todo`; `blob.bin` shows `binary file, not shown`; `big.txt` shows `file too large to show`; the last shows the header `notes/żółw i zając.md` and line 1 `cześć`, and the address bar reads `http://127.0.0.1:4477/#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md`.

12. Open `http://127.0.0.1:4477/?token=$TOKEN#file=nope.ts`, with the token written out. Afterwards, in the second terminal, run `(cd $QA/demo-repo && rm -r notes notes.txt blob.bin big.txt link.txt)`.
    **Expect:** the header `nope.ts` and the text `no such file`.

13. This step and all later ones run in the first terminal, which is still in `$QA/demo-repo`. With a bindweed page open in the browser, press Ctrl-C, run `echo $?; curl -s http://127.0.0.1:4477/; echo $?`, then click `README.md` in the page.
    **Expect:** the prompt returns within 2 seconds; the output is `0`, then `7` (curl could not connect). The page shows the header `README.md` and the text `cannot reach bindweed`.

14. Run `node $BW/src/cli.ts &`. When its two lines have appeared click `Zebra.txt` in the same page, then run `kill -TERM $!; wait $!; echo $?`.
    **Expect:** the token differs from the one in step 1. The page shows the header `Zebra.txt` and the text `missing or wrong token`. The output is `0`.

15. Run `grep -cxF '.bindweed/' .git/info/exclude; git status --porcelain; ls -d .bindweed`.
    **Expect:** `1`, nothing from git status, then `.bindweed`.

16. Run `cd $QA/plain && node $BW/src/cli.ts; echo $?; ls -A; cd $QA/demo-repo`.
    **Expect:** stderr shows `bindweed: $QA/plain is not inside a git repository` and stdout nothing; the output is `2`; the listing is empty.

17. Run each row: the `before` command if there is one, then the command. Stop a bindweed that keeps running with Ctrl-C, and release held ports with `kill %%`.
    **Expect:** the result in its row.

    | before | command | result |
    |---|---|---|
    | `hold 4555 4555` | `node $BW/src/cli.ts --port 4555; echo $?` | `bindweed: port 4555 is in use`, then `1` |
    | `hold 4477 4477` | `node $BW/src/cli.ts` | the link holds port `4478` |
    | `hold 4477 4497` | `node $BW/src/cli.ts; echo $?` | `bindweed: no free port between 4477 and 4497`, then `1` |
    | | `BINDWEED_PORT=4600 node $BW/src/cli.ts` | the link holds port `4600` |
    | | `BINDWEED_PORT=4600 node $BW/src/cli.ts --port 4555` | the link holds port `4555` |
    | | `node $BW/src/cli.ts --port abc; echo $?` | `bindweed: port abc is not a number from 1 to 65535`, then `2` |

18. Make a copy of bindweed that has no built ui, then a symlink that matches an npm install of the real entry:

    ```sh
    mkdir -p $QA/unbuilt $QA/bin && cp -r $BW/src $BW/package.json $QA/unbuilt/ && ln -sfn $BW/node_modules $QA/unbuilt/node_modules
    node $QA/unbuilt/src/cli.ts; echo $?
    ln -sfn $BW/src/cli.ts $QA/bin/bindweed
    node $QA/bin/bindweed
    ```

    After the unbuilt run exits, start via the symlink, set `TOKEN` from its first line, then in the second terminal run `curl -si "http://127.0.0.1:4477/?token=$TOKEN" | head -n 5` and stop bindweed with Ctrl-C.
    **Expect:** the unbuilt run prints `bindweed: the ui is not built; run npm run build in $QA/unbuilt`, then `1`. The symlink run prints the two usual stdout lines for `$QA/demo-repo` on port 4477. The curl status is `200` and the body is bindweed's own `dist/ui/index.html` (it names `/assets/`).

19. Take the exclude line out, start bindweed in a linked worktree, stop it with Ctrl-C, then run the last line:

    ```sh
    grep -vxF '.bindweed/' .git/info/exclude > $QA/exclude; cp $QA/exclude .git/info/exclude
    git worktree add -q $QA/demo-wt -b wt && cd $QA/demo-wt && node $BW/src/cli.ts
    grep -cxF '.bindweed/' $QA/demo-repo/.git/info/exclude; git status --porcelain; ls -d .bindweed; cat .git
    ```

    **Expect:** the second stdout line is `serving $QA/demo-wt`; then `1`, nothing from git status, `.bindweed`, and `gitdir: $QA/demo-repo/.git/worktrees/demo-wt`.

20. Stop any bindweed still running. In the first terminal:

    ```sh
    mkdir -p $QA/empty-repo && cd $QA/empty-repo && git init -q
    node $BW/src/cli.ts
    ```

    Set `TOKEN` from the first line. In the second terminal run `curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4477/api/tree`, then open the printed link in the browser.
    **Expect:** the API body is exactly `{"root":"empty-repo","entries":[]}`. The left side shows only `empty-repo/`; the right side shows `select a file`.
