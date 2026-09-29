# 004 — colour the architecture by health and show Uncle Bob's package metrics

After this task the developer can switch the Architecture canvas to colour every box by CRAP score, test coverage or surviving mutants, taken from the reports marestail already leaves in the repository, and open a **Metrics** table that gives each package at the current level Martin's fan-in, fan-out, instability, abstractness, distance from the main sequence and zone. They can see where the pain is before deciding how to reshape it.

## Inputs (read only; bindweed never runs a gate)

- Coverage: `<root>/.marestail/ts-coverage/coverage-final.json` (Istanbul JSON: per file `statementMap`, `s`, `fnMap`, `f`, `branchMap`, `b`; keys are absolute paths).
- Mutation: `<root>/reports/mutation/mutation.json` (mutation-testing-report-schema: `files[path].mutants[].status`).
- Missing or unparseable file: that overlay option is disabled with the tooltip `no coverage data: run marestail gate` (or `no mutation report: run marestail gate --tier full`). Nothing else breaks.
- A report older than the newest scanned source file gets a `stale` badge next to the overlay selector.
- CRAP limit: `[ts] crap_max` from `<root>/marestail.toml` when present, else 4.

## Numbers

- **Cyclomatic complexity** per function, counted exactly as `marestail/js/ts_complexity.mjs` in marestail counts it: 1, plus one for each `if`, conditional expression, `for`, `for...in`, `for...of`, `while`, `do`, `case` clause, `catch` clause, and each `&&`, `||`, `??` binary expression; nested functions are counted on their own; the functions counted are function declarations and expressions, arrow functions, methods, constructors, getters and setters.
- **Function coverage**: covered statements / statements whose location lies inside the function's span, from `statementMap`/`s`. A function with no statements counts as fully covered.
- **CRAP** = cc² × (1 − coverage)³ + cc. File CRAP = the highest of its functions; package CRAP = the highest of its files. No coverage data for a file: CRAP is shown as `–`.
- **Coverage** for a file or package = covered statements / statements, summed.
- **Surviving mutants** for a file = mutants with status `Survived` or `NoCoverage`; a package sums its files.
- Colours: CRAP green ≤ limit, amber ≤ 2 × limit, red above. Coverage green at 100%, amber from 80%, red below. Mutants green at 0, amber 1–2, red 3 or more. Each box shows the value as a small badge.

## Package metrics (Martin), per package node in the current view

Counted over internal, non-test files only; tests and external packages never count.

- **Ca** (afferent, fan-in): files outside the package that import at least one file inside it.
- **Ce** (efferent, fan-out): files inside the package that import at least one file outside it.
- **I** = Ce / (Ca + Ce); shown as `–` when both are 0.
- **A** = abstract files / files, using 003's definition of an abstract file.
- **D** = |A + I − 1|; `–` when I is.
- **Zone**: `pain` when D > 0.5 and A + I < 1; `useless` when D > 0.5 and A + I > 1; otherwise `healthy`.

## Page

- An overlay selector above the canvas: **None**, **CRAP**, **Coverage**, **Surviving mutants**. The choice is remembered in `layout.json` `settings`.
- A **Metrics** drawer lists every package node in the current view: name, files, Ca, Ce, I, A, D, zone, CRAP, coverage, surviving mutants. Numbers to two decimals. Sortable by clicking a column header; default sort D descending. Clicking a row selects that box.
- The details panel from 003 gains the same numbers for the selected box, and for a file lists its functions over the CRAP limit with their line, cc and coverage.

## QA

Add `qa/fixtures/healthy`: a small repo with a hand-written `.marestail/ts-coverage/coverage-final.json` and `reports/mutation/mutation.json` whose values give one function cc 3 at 100% coverage (CRAP 3, green), one cc 4 at 50% (CRAP 6, amber), one cc 6 at 0% (CRAP 42, red), and a file with 3 surviving mutants.

Check in the browser: the CRAP overlay colours those boxes green, amber and red with badges 3, 6 and 42; the mutants overlay shows the red `3`; a fixture without reports disables both options with their tooltips; touching a source file after the report shows `stale`; the Metrics table for the `layered` fixture gives `domain` I = 0.00, `app` I = 1.00, and sorts by D. Hand-compute every expected metric in the QA notes.

## Must not change

- Everything from 001–003. Bindweed still writes nothing but `.bindweed/`.
