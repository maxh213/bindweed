# QA: colour the architecture by health and show the package metrics

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 4900, clear of 4477, 4700 and 4800.

Bindweed never runs a gate. The reports below are written by hand. It still writes nothing but `.bindweed/`. The en dash in a missing number is the character `–` (U+2013), not a hyphen.

Function coverage is statements only. A statement counts when its `statementMap` start line lies inside the function's start line through its end line. marestail's own CRAP gate also counts branch arms; this task does not, and the fixture has no branches. A function whose span holds no statement is fully covered.

The three functions were counted with marestail's `marestail/js/ts_complexity.mjs`. `keep` is cc 3 (two `if`). `mid` is cc 4 (two `if`, one `&&`). `bad` is cc 6 (three `if`, one `&&`, one `||`).

CRAP is cc² × (1 − coverage)³ + cc. `keep` covers 3 of 3 statements, so 3² × 0³ + 3 = 3, green at the limit 4. `mid` covers 2 of 4, so 4² × 0.5³ + 4 = 6, amber (over 4, at or under 8). `bad` covers 0 of 4, so 6² × 1³ + 6 = 42, red. `plain.ts` and `clean.ts` have no function, so their CRAP is `–`.

Coverage of a box is covered statements over statements, summed. `green.ts` is 3/3 = 1.00. `amber.ts` is 2/4 = 0.50. `red.ts` is 0/4 = 0.00. The `src` package is 7/13 = 0.54: 3+2+0+1+1 = 7 covered statements and 3+4+4+1+1 = 13 statements. Package CRAP is the worst file, 42. Surviving mutants are status `Survived` or `NoCoverage`; `Killed` and `Timeout` are not. `plain.ts` has two `Survived` and one `NoCoverage`, so 3. `clean.ts` has `Killed` and `Timeout`, so 0. The package sums to 3.

The layered hand count, over internal non-test files only: `domain` holds `model.ts` and `shape.ts`, both interfaces, and `a.ts`, `db.ts` and `repo.ts` each import one of them, so Ca 3, Ce 0, I = 0/3 = 0.00, A = 2/2 = 1.00, D = |1.00+0.00−1| = 0.00, healthy. `app` holds `a.ts` and `b.ts`; nothing outside imports either (the test file `a.test.ts` is inside and does not count), and both import `../infra/db` (a.ts also `../infra/repo` and `@domain/model`), so Ca 0, Ce 2, I = 2/2 = 1.00, A = 0.00, D = |0.00+1.00−1| = 0.00, healthy. `infra` holds `db.ts` and `repo.ts`; `a.ts` and `b.ts` import `db.ts`, so Ca 2, and both files import a file outside (`../domain/model`, `../domain/shape`), so Ce 2, I = 2/4 = 0.50, A = 0.00, D = |0.00+0.50−1| = 0.50, which is not above 0.5, so healthy. File nodes: `a.ts` has Ca 1 (`b.ts` imports it) and Ce 4 (`b.ts`, `db.ts`, `repo.ts`, `model.ts`), I = 4/5 = 0.80, D = 0.20; `b.ts` has Ca 1 (`a.ts`) and Ce 2 (`a.ts`, `db.ts`), I = 2/3 = 0.67, D = 0.33. The `src` root has Ca 0, Ce 0, so I and D are `–` and the box has no zone; A = 2/6 = 0.33.

## Setup

Port 4900 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
FIX=$BW/qa/fixtures/healthy
mkdir -p $FIX/src $FIX/.marestail/ts-coverage $FIX/reports/mutation
printf '%s\n' '{"compilerOptions":{}}' > $FIX/tsconfig.json
printf '%s\n' '[ts]' 'crap_max = 4' > $FIX/marestail.toml
printf 'export function keep(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n' > $FIX/src/green.ts
printf 'export function mid(n: number): number {\n  if (n > 0 && n < 10) return 1;\n  if (n < 0) return -1;\n  const spare = 0;\n  return spare;\n}\n' > $FIX/src/amber.ts
printf 'export function bad(n: number): number {\n  if (n > 0 && n < 3) return 1;\n  if (n > 3 || n < 0) return 2;\n  if (n === 9) return 9;\n  return 0;\n}\n' > $FIX/src/red.ts
printf 'export const n = 1;\n' > $FIX/src/plain.ts
printf 'export const n = 1;\n' > $FIX/src/clean.ts
printf '%s\n' '{"src/green.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}}},"s":{"0":1,"1":1,"2":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/amber.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":1,"1":0,"2":1,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/red.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":0,"1":0,"2":0,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/plain.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/clean.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}}}' > $FIX/.marestail/ts-coverage/coverage-final.json
printf '%s\n' '{"files":{"src/plain.ts":{"mutants":[{"status":"Survived"},{"status":"NoCoverage"},{"status":"Survived"}]},"src/clean.ts":{"mutants":[{"status":"Killed"},{"status":"Timeout"}]},"src/green.ts":{"mutants":[{"status":"Killed"}]}}}' > $FIX/reports/mutation/mutation.json
export QA=$(cd "$(mktemp -d)" && pwd -P)
cp -a $FIX $QA/healthy
cd $QA/healthy
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
echo "export QA=$QA U=http://127.0.0.1:4900"
```

The block writes the fixture the task asks for at `qa/fixtures/healthy`, then serves a copy of it from `/tmp/qa/healthy`. Its two report files stay untracked in the checkout: `.gitignore` matches `.marestail/` and `reports/mutation/` at any depth, so a fresh clone has the sources but not the reports. The e2e written from this procedure should write the two report files at the served copy itself, with the JSON above, rather than trust them to be in the checkout. The keys are repository-relative, which bindweed accepts; Istanbul writes absolute paths in a real repo, and the absolute form is checked by the feature's graph scenarios.

Paste the `export` line into the second terminal. `keep` spans lines 1–5 and all three statements are covered. `mid` spans lines 1–6 and the statements on lines 3 and 5 are uncovered, so 2 of 4. `bad` spans lines 1–6 and all four statements are uncovered. The fixture's `statementMap` holds only the function bodies' statements, so the arithmetic above is exact.

## Steps

1. In the first terminal, still in `$QA/healthy`, run `node $BW/src/cli.ts --port 4900`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4900/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/healthy`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: ***" "$U/api/graph?at=src"`.
   **Expect:** the body has five file nodes. `green.ts` has `"crap":3`, `"coverage":"1.00"`, `"mutants":0`. `amber.ts` has `"crap":6`, `"coverage":"0.50"`, `"mutants":0`. `red.ts` has `"crap":42`, `"coverage":"0.00"`, `"mutants":0`. `plain.ts` has no `crap` field, `"coverage":"1.00"`, `"mutants":3`. `clean.ts` has no `crap` field, `"coverage":"1.00"`, `"mutants":0`. The body has `"coverage":"on"`, `"mutation":"on"` and `"crapMax":4`. Every file node has `ca` 0, `ce` 0, `"i":"–"`, `"a":"0.00"`, `"d":"–"` and no `zone` field, because nothing imports anything here.

3. Run `curl -s -H "Authorization: ***" $U/api/graph` and `curl -s -H "Authorization: ***" "$U/api/detail?id=src/red.ts&at=src"`.
   **Expect:** the graph's only node is `src`, with `"files":5`, `"crap":42`, `"coverage":"0.54"`, `"mutants":3`, `ca` 0, `ce` 0, `"i":"–"`, `"a":"0.00"`, `"d":"–"` and no `zone`. The detail body has `"crap":42`, `"coverage":"0.00"`, `"mutants":0`, and `hot` holding one entry: name `bad`, line `1`, cc `6`, coverage `"0.00"`, crap `42`. No other hot entry.

4. Run `curl -s -H "Authorization: ***" "$U/api/detail?id=src/green.ts&at=src"` and `curl -s -H "Authorization: ***" "$U/api/detail?id=src&at="`.
   **Expect:** `green.ts` has `"crap":3` and `hot` an empty array. The package detail has `"crap":42`, `"coverage":"0.54"`, `"mutants":3`, `"files":5`, and no `hot` field.

5. Open `http://127.0.0.1:4900/?token=$TOKEN#at=src` in the browser, with the token written out.
   **Expect:** the Architecture tab is selected. The toolbar has a combobox labelled `Overlay` showing `None`. No box has a health badge. The boxes are `green.ts`, `amber.ts`, `red.ts`, `plain.ts` and `clean.ts`.

6. Choose `CRAP` in the Overlay combobox.
   **Expect:** `green.ts` shows a badge `3` on pale green, `amber.ts` a badge `6` on pale amber, `red.ts` a badge `42` on pale red. `plain.ts` and `clean.ts` each show a badge `–` with no health colour. In the second terminal, `curl -s -H "Authorization: ***" $U/api/layout` has `"overlay":"crap"`.

7. Choose `Surviving mutants` in the Overlay combobox.
   **Expect:** `plain.ts` shows a badge `3` on pale red. `clean.ts` and `green.ts` each show a badge `0` on pale green. `amber.ts` and `red.ts` each show a badge `0` on pale green.

8. Choose `Coverage` in the Overlay combobox, then click the `red.ts` box.
   **Expect:** `green.ts` shows `1.00` on pale green, `amber.ts` shows `0.50` on pale red, `red.ts` shows `0.00` on pale red. The details panel is headed `red.ts` and shows CRAP `42`, Coverage `0.00` and Mutants `0`. Under `Hot functions` one row reads `bad`, line `1`, cc `6`, coverage `0.00`.

9. In the second terminal, age the coverage report and touch a source file, then reload the page and choose `CRAP` again:

   ```sh
   touch -d '2000-01-01 00:00:00' $QA/healthy/.marestail/ts-coverage/coverage-final.json
   touch $QA/healthy/src/green.ts
   ```

   **Expect:** a `stale` badge sits next to the Overlay combobox. The `red.ts` badge still reads `42` on pale red. Choosing `Surviving mutants` hides the stale badge, because the mutation report was not aged. Choosing `None` also hides it.

10. In the first terminal press Ctrl-C. Build the layered repository by hand, exactly as the feature's Background has it, and serve it with no reports:

    ```sh
    mkdir -p $QA/layered/src/app $QA/layered/src/domain $QA/layered/src/infra $QA/layered/notes
    cd $QA/layered
    printf '%s\n' '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}' > tsconfig.json
    printf '# notes\n' > notes/readme.md
    printf "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n" > src/app/a.ts
    printf "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n" > src/app/b.ts
    printf "import { a } from './a';\n" > src/app/a.test.ts
    printf 'export interface Model { id: number }\n' > src/domain/model.ts
    printf 'export interface Shape { draw(): void }\n' > src/domain/shape.ts
    printf "import { Model } from '../domain/model';\nexport const query = new Model();\n" > src/infra/db.ts
    printf "import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n" > src/infra/repo.ts
    git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
    node $BW/src/cli.ts --port 4900
    ```

    This is the 004 Background tree, not the checked-in `qa/fixtures/layered`, which 002 and 003 pin with four files. Set `TOKEN` from the new first line. Open the printed link with `#at=src`.
    **Expect:** the `CRAP` option and the `Coverage` option are disabled, and hovering either shows `no coverage data: run marestail gate`. The `Surviving mutants` option is disabled, and hovering it shows `no mutation report: run marestail gate --tier full`. Choosing `CRAP` leaves the combobox on `None` and adds no badge.

11. Click `Metrics`.
    **Expect:** a drawer opens listing three rows and no file row. The D header is the sorted one, descending, so the rows are `infra` (D 0.50), then `app` and `domain` (both D 0.00, tie broken by name). The hand count above, with tests and `node:fs` and `react` excluded, gives:

    | row | files | Ca | Ce | I | A | D | zone | CRAP | coverage | mutants |
    |---|---|---|---|---|---|---|---|---|---|---|
    | infra | 2 | 2 | 2 | 0.50 | 0.00 | 0.50 | healthy | – | – | – |
    | app | 2 | 0 | 2 | 1.00 | 0.00 | 0.00 | healthy | – | – | – |
    | domain | 2 | 3 | 0 | 0.00 | 1.00 | 0.00 | healthy | – | – | – |

    CRAP, Coverage and Mutants are `–` on every row, because this fixture has no reports.

12. Click the I header, then click the `domain` row, then click `Metrics` again.
    **Expect:** the rows become `app` (I 1.00), `infra` (I 0.50), `domain` (I 0.00). Clicking the row selects the `domain` box and the details panel is headed `domain`, showing I `0.00`, A `1.00`, D `0.00` and Zone `healthy`. Clicking `Metrics` again closes the drawer. The address bar still reads `#at=src`.

13. In the first terminal press Ctrl-C, then run `sed -n '/## Routes/,/## Environment/p' $BW/README.md` and `rm -rf $QA`.
    **Expect:** the Routes table has live rows for `/`, `/assets/`, `/api/tree`, `/api/file`, `/api/graph`, `/api/rescan`, `/api/layout` and `/api/detail`. The playground is gone.
