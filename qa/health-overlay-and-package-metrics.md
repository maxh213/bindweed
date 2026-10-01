# QA: colour the architecture by health and show the package metrics

For a person with two terminals and a desktop browser on the machine that runs bindweed (Node 22.18 or newer, git, curl). Every step runs the real `node src/cli.ts`. This procedure uses port 4900, clear of 4477, 4700 and 4800.

Bindweed never runs a gate. The reports below are written by hand. It still writes nothing but `.bindweed/`. The en dash in a missing number is the character `–` (U+2013), not a hyphen.

Function coverage is statements only. A statement counts when its `statementMap` start line lies inside the function's start line through its end line. marestail's own CRAP gate also counts branch arms; this task does not, and the fixture has no branches. A function with no statements inside its span is fully covered.

The three functions were counted with marestail's `marestail/js/ts_complexity.mjs`. `keep` is cc 3 (two `if`). `mid` is cc 4 (two `if`, one `&&`). `bad` is cc 6 (three `if`, one `&&`, one `||`).

CRAP is cc² × (1 − coverage)³ + cc. `keep` covers 3 of 3 statements, so 3² × 0³ + 3 = 3, green at the limit 4. `mid` covers 2 of 4, so 4² × (0.5)³ + 4 = 6, amber (over 4, at or under 8). `bad` covers 0 of 4, so 6² × 1³ + 6 = 42, red. `plain.ts` and `clean.ts` have no function, so their CRAP is `–`.

Coverage of a box is covered statements over statements, summed. `green.ts` is 3/3 = 1.00. `amber.ts` is 2/4 = 0.50. `red.ts` is 0/4 = 0.00. The `src` package is 7/13 = 0.54: 3+2+0+1+1 = 7 covered statements and 3+4+4+1+1 = 13 statements. Package CRAP is the worst file, 42. Surviving mutants are status `Survived` or `NoCoverage`; `Killed` and `Timeout` are not. `plain.ts` has two `Survived` and one `NoCoverage`, so 3. `clean.ts` has `Killed` and `Timeout`, so 0. The package sums to 3.

## Setup

Port 4900 must be free. In the first terminal set `BW` to bindweed's checkout, then paste:

```sh
(cd "$BW" && npm run build)
export QA=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p $QA/healthy/src && cd $QA/healthy
printf '%s\n' '{"compilerOptions":{}}' > tsconfig.json
printf '%s\n' '[ts]' 'crap_max = 4' > marestail.toml
printf 'export function keep(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n' > src/green.ts
printf 'export function mid(n: number): number {\n  if (n > 0 && n < 10) return 1;\n  if (n < 0) return -1;\n  const spare = 0;\n  return spare;\n}\n' > src/amber.ts
printf 'export function bad(n: number): number {\n  if (n > 0 && n < 3) return 1;\n  if (n > 3 || n < 0) return 2;\n  if (n === 9) return 9;\n  return 0;\n}\n' > src/red.ts
printf 'export const n = 1;\n' > src/plain.ts
printf 'export const n = 1;\n' > src/clean.ts
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
ROOT=$(pwd -P)
mkdir -p .marestail/ts-coverage reports/mutation
node --input-type=module -e '
import { writeFileSync } from "node:fs";
const root = process.argv[1];
const stmt = (lines, hits) => ({ statementMap: Object.fromEntries(lines.map((line, i) => [String(i), { start: { line } }])), s: Object.fromEntries(hits.map((h, i) => [String(i), h])), fnMap: {}, f: {}, branchMap: {}, b: {} });
writeFileSync(".marestail/ts-coverage/coverage-final.json", JSON.stringify({
  [root + "/src/green.ts"]: stmt([2, 3, 4], [1, 1, 1]),
  [root + "/src/amber.ts"]: stmt([2, 3, 4, 5], [1, 0, 1, 0]),
  [root + "/src/red.ts"]: stmt([2, 3, 4, 5], [0, 0, 0, 0]),
  [root + "/src/plain.ts"]: stmt([1], [1]),
  [root + "/src/clean.ts"]: stmt([1], [1]),
}));
writeFileSync("reports/mutation/mutation.json", JSON.stringify({ files: {
  [root + "/src/plain.ts"]: { mutants: [{ status: "Survived" }, { status: "NoCoverage" }, { status: "Survived" }] },
  [root + "/src/clean.ts"]: { mutants: [{ status: "Killed" }, { status: "Timeout" }] },
  [root + "/src/green.ts"]: { mutants: [{ status: "Killed" }] },
}}));
' "$ROOT"
echo "export QA=$QA U=http://127.0.0.1:4900"
```

Paste the `export` line it prints into the second terminal. The coverage keys are absolute paths, which is what Istanbul writes. `keep` spans lines 1–5 and all three statements are covered. `mid` spans lines 1–5 and the statement on line 3 is uncovered, so 2 of 3. `bad` spans lines 1–6 and all four statements are uncovered.

## Steps

1. In the first terminal, still in `$QA/healthy`, run `node $BW/src/cli.ts --port 4900`.
   **Expect:** stdout shows exactly two lines: `bindweed: http://127.0.0.1:4900/?token=` followed by 32 characters from `0-9a-f`, then `serving $QA/healthy`. The command keeps running. In the second terminal set `TOKEN` to that token.

2. In the second terminal run `curl -s -H "Authorization: ***" "$U/api/graph?at=src"`.
   **Expect:** status is not shown by this curl; the body has five file nodes. `green.ts` has `"crap":3`, `"coverage":"1.00"`, `"mutants":0`. `amber.ts` has `"crap":6`, `"coverage":"0.50"`, `"mutants":0`. `red.ts` has `"crap":42`, `"coverage":"0.00"`, `"mutants":0`. `plain.ts` has no `crap` field, `"coverage":"1.00"`, `"mutants":3`. `clean.ts` has no `crap` field, `"coverage":"1.00"`, `"mutants":0`. The body has `"coverage":"on"`, `"mutation":"on"` and `"crapMax":4`.

3. Run `curl -s -H "Authorization: ***" $U/api/graph` and `curl -s -H "Authorization: ***" "$U/api/detail?id=src/red.ts&at=src"`.
   **Expect:** the graph's only node is `src`, with `"files":5`, `"crap":42`, `"coverage":"0.54"`, `"mutants":3`. The detail body has `"crap":42`, `"coverage":"0.00"`, `"mutants":0`, and `hot` holding one entry: name `bad`, line `1`, cc `6`, coverage `"0.00"`, crap `42`. No other hot entry.

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

   **Expect:** a `stale` badge sits next to the Overlay combobox. The `red.ts` badge still reads `42` on pale red. Choosing `Surviving mutants` hides the stale badge, because the mutation report was not aged.

10. In the first terminal press Ctrl-C. Copy the checked-in layered fixture and serve it with no reports:

    ```sh
    cp -a $BW/qa/fixtures/layered $QA/layered
    cd $QA/layered && git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.test -c commit.gpgsign=false commit -qm fixture
    node $BW/src/cli.ts --port 4900
    ```

    Set `TOKEN` from the new first line. Open the printed link with `#at=src`.
    **Expect:** the `CRAP` option and the `Coverage` option are disabled, and hovering either shows `no coverage data: run marestail gate`. The `Surviving mutants` option is disabled, and hovering it shows `no mutation report: run marestail gate --tier full`. Choosing `CRAP` leaves the combobox on `None` and adds no badge.

11. Click `Metrics`.
    **Expect:** a drawer opens listing three rows and no file row. The D header is the sorted one, descending, so the rows are `infra`, `app`, `domain`. The hand count, tests and `node:fs` excluded: `domain` is imported by `a.ts` and `db.ts` (Ca 2) and imports nothing (Ce 0), so I = 0/2 = 0.00; both its files are interfaces, so A = 1.00; D = |1+0−1| = 0.00; zone `healthy`. `app` is imported by `b.ts` only (Ca 1; `a.test.ts` is a test and does not count) and `a.ts` and `b.ts` each import something outside (Ce 2), so I = 2/3 = 0.67; neither file is abstract, so A = 0.00; D = |0+0.67−1| = 0.33; zone `healthy`. `infra` is imported by `a.ts` (Ca 1; `b.ts` imports it too, so still one file) and `db.ts` imports `model.ts` outside while `repo.ts` imports only `node:fs` and `react`, which are external and do not count (Ce 1), so I = 1/2 = 0.50; A = 0.00; D = |0+0.50−1| = 0.50, which is not greater than 0.5, so zone `healthy`. CRAP, Coverage and Mutants are `–` on every row, because this fixture has no reports.

12. Click the I header, then click the `domain` row, then click `Metrics` again.
    **Expect:** the rows become `app`, `infra`, `domain`. Clicking the row selects the `domain` box and the details panel is headed `domain`, showing I `0.00`, A `1.00`, D `0.00` and Zone `healthy`. Clicking `Metrics` again closes the drawer. The address bar still reads `#at=src`.

13. In the first terminal press Ctrl-C, then run `sed -n '/## Routes/,/## Environment/p' $BW/README.md` and `rm -rf $QA`.
    **Expect:** the Routes table has live rows for `/`, `/assets/`, `/api/tree`, `/api/file`, `/api/graph`, `/api/rescan`, `/api/layout` and `/api/detail`. The playground is gone.
