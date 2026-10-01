Feature: the Architecture canvas colours boxes by health and lists Martin's package metrics
  A developer switches the Architecture canvas to colour every box by CRAP, coverage or
  surviving mutants, taken from reports already in the repository, and opens a Metrics
  table of fan-in, fan-out, instability, abstractness, distance and zone for each package
  in the current view. Bindweed never runs a gate, and it still writes nothing but
  .bindweed/.

  Assumptions, so the coder does not have to ask. Function coverage is statements only:
  covered statements divided by statements whose statementMap location lies inside the
  function's line span. The task names statementMap and s, and does not name branches;
  marestail's ts_crap.py also counts branch arms, and that extra count is not part of
  this task. A function whose span holds no statement is fully covered. File and package
  coverage stay a sum of statements, branches counted nowhere. The en dash in every
  missing number below is U+2013. CRAP is shown as a whole number when it is whole,
  otherwise to two decimals; coverage, I, A and D are always two decimals. A report is
  stale when its mtime is strictly older than the newest mtime among scanned source
  files; equal mtimes are fresh. Reports are read from the served repository root, not
  from [ts] root. A coverage or mutation key is an absolute path inside that root, or a
  path relative to it; any other key is ignored. A file with no coverage entry has CRAP
  "–" and is left out of a coverage sum; a file with no mutation entry counts 0 surviving
  mutants. Tests and external packages never enter Ca, Ce, I, A, D or zone, even while
  their checkboxes are on. A file node has no zone. The overlay choice is a third
  settings field and does not change tests or external. GET /api/graph and GET /api/detail
  gain fields and otherwise keep the 003 bodies.

  Conventions: "bindweed" is "node <bindweed dir>/src/cli.ts"; /tmp/qa is a fresh temporary
  directory; bindweed serves /tmp/qa/healthy on port 4900 unless a scenario says otherwise;
  {token} is the token of the bindweed that scenario started; "with the token" means
  "Authorization: Bearer {token}"; requests carry "Host: 127.0.0.1:4900" unless a scenario sets
  another. JSON is compared as JSON. A key these bodies omit is absent, not present with
  a default. In a table cell \n is a newline. Each scenario starts from the Background again.
  On the page the overlay control is the combobox labelled "Overlay", the stale mark is
  the element labelled "stale", and the Metrics control is the button "Metrics". A box's
  health badge is the element labelled "health" inside the box, and its colour is that
  badge's data-health: "green", "amber" or "red". Green is rgb(220, 252, 231), amber is
  rgb(254, 243, 199) and red is rgb(254, 226, 226), on the badge. The 003 abstract green
  and cycle red stay on the box itself and are not the badge colour. The Metrics drawer
  is the complementary region labelled "metrics". Its rows follow the current sort, and
  a column header carries aria-sort "descending", "ascending" or "none".

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/healthy" is a git repository with these files committed:
      | path            | content                                                                                          |
      | tsconfig.json   | {"compilerOptions":{}}                                                                           |
      | src/green.ts    | export function keep(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n |
      | src/amber.ts    | export function mid(n: number): number {\n  if (n > 0 && n < 10) return 1;\n  if (n < 0) return -1;\n  const spare = 0;\n  return spare;\n}\n |
      | src/red.ts      | export function bad(n: number): number {\n  if (n > 0 && n < 3) return 1;\n  if (n > 3 \|\| n < 0) return 2;\n  if (n === 9) return 9;\n  return 0;\n}\n |
      | src/plain.ts    | export const n = 1;\n                                                                            |
      | src/clean.ts    | export const n = 1;\n                                                                            |
      | marestail.toml  | [ts]\ncrap_max = 4\n                                                                              |
    And "/tmp/qa/layered" is a git repository with these files committed:
      | path                | content                                                                                                                                          |
      | tsconfig.json       | {"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}                                                                       |
      | notes/readme.md     | # notes\n                                                                                                                                        |
      | src/app/a.ts        | import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n |
      | src/app/b.ts        | import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n                               |
      | src/app/a.test.ts   | import { a } from './a';\n                                                                                                                       |
      | src/domain/model.ts | export interface Model { id: number }\n                                                                                                          |
      | src/domain/shape.ts | export interface Shape { draw(): void }\n                                                                                                        |
      | src/infra/db.ts     | import { Model } from '../domain/model';\nexport const query = new Model();\n                                                                    |
      | src/infra/repo.ts   | import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n |
    And "/tmp/qa/bare" is a git repository with "src/only.ts" committed, holding "export const n = 1;\n", and no marestail.toml
    And the coverage report of "/tmp/qa/healthy" is the file ".marestail/ts-coverage/coverage-final.json" holding this JSON:
      """
      {"src/green.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}}},"s":{"0":1,"1":1,"2":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/amber.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":1,"1":0,"2":1,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/red.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}},"2":{"start":{"line":4}},"3":{"start":{"line":5}}},"s":{"0":0,"1":0,"2":0,"3":0},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/plain.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}},"src/clean.ts":{"statementMap":{"0":{"start":{"line":1}}},"s":{"0":1},"fnMap":{},"f":{},"branchMap":{},"b":{}}}
      """
    And the mutation report of "/tmp/qa/healthy" is the file "reports/mutation/mutation.json" holding this JSON:
      """
      {"files":{"src/plain.ts":{"mutants":[{"status":"Survived"},{"status":"NoCoverage"},{"status":"Survived"}]},"src/clean.ts":{"mutants":[{"status":"Killed"},{"status":"Timeout"}]},"src/green.ts":{"mutants":[{"status":"Killed"}]}}}
      """
    And both of those reports are newer than every source file in "/tmp/qa/healthy"

  Rule: Health is read from the reports and never computed by running a gate
    A graph body carries "crapMax", and "coverage" and "mutation" as flag values "on",
    "stale" or "off". A detail body carries no crapMax and no flag; its "crap", "coverage"
    and "mutants" are the selected box's own numbers. Cyclomatic complexity is counted as
    marestail's ts_complexity.mjs counts it: 1, plus
    one for each if, conditional expression, for, for-in, for-of, while, do, case clause,
    catch clause, and each &&, || and ?? binary expression. Nested functions are counted
    on their own and do not add to the outer function. The functions counted are function
    declarations and expressions, arrow functions, methods, constructors, getters and
    setters. A function's span is its start line through its end line, both inclusive.
    CRAP is cc squared times (1 minus coverage) cubed, plus cc. File CRAP is the highest
    CRAP of its functions; a file with no function has no CRAP. Package CRAP is the
    highest CRAP of its files. Coverage of a file or package is covered statements over
    statements, summed across the files that have an entry. Surviving mutants are those
    with status Survived or NoCoverage; Killed, Timeout and any other status do not count,
    and a package sums its files. One rule decides every missing number: a report that is
    missing or unparsable puts its flag "off" and every node drops the fields that report
    feeds, so coverage "off" means no crap and no coverage field, and mutation "off" means
    no mutants field. With coverage on, a file with no entry has crap "–", no coverage
    field and no place in the coverage sum; with mutation on, a file with no entry has
    mutants 0. No statements in an entry: coverage is 1. The CRAP limit is the
    number [ts] crap_max in the repository's marestail.toml, otherwise 4. CRAP is green
    at or under the limit, amber at or under twice the limit, red above. Coverage is green
    at 1, amber from 0.8 inclusive, red below. Mutants are green at 0, amber at 1 or 2,
    red at 3 or more.

    Scenario: The src view reports CRAP, coverage and surviving mutants for every file
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      And the node "src/green.ts" has crap 3, coverage "1.00" and mutants 0
      And the node "src/amber.ts" has crap 6, coverage "0.50" and mutants 0
      And the node "src/red.ts" has crap 42, coverage "0.00" and mutants 0
      And the node "src/plain.ts" has no crap field, coverage "1.00" and mutants 3
      And the node "src/clean.ts" has no crap field, coverage "1.00" and mutants 0
      And the nodes, edges and crumbs are the 003 src view of this repository plus the health and Martin fields

    Scenario: The root package takes the worst CRAP, the summed coverage and the summed mutants
      When I send "GET /api/graph" with the token
      Then the only node is "src"
      And that node has crap 42, coverage "0.54" and mutants 3
      And it has "files" 5, "row" 0, "order" 0, ca 0, ce 0, i "–", a "0.00", d "–" and no zone field
      And it has "cycle" false
      And the body has "at" "" and one crumb "healthy" at ""
      And the body has no edges

    Scenario: A file detail lists only the functions over the CRAP limit
      When I send "GET /api/detail?id=src/amber.ts&at=src" with the token
      Then the status is 200
      And the body has crap 6, coverage "0.50", mutants 0 and no "files" field
      And "hot" is exactly one entry: name "mid", line 1, cc 4, coverage "0.50", crap 6
      When I send "GET /api/detail?id=src/red.ts&at=src" with the token
      Then "hot" is exactly one entry: name "bad", line 1, cc 6, coverage "0.00", crap 42
      When I send "GET /api/detail?id=src/green.ts&at=src" with the token
      Then "hot" is an empty array and crap is 3
      When I send "GET /api/detail?id=src/plain.ts&at=src" with the token
      Then the body has no crap field, "hot" is an empty array and mutants is 3

    Scenario: The package detail carries the same numbers and no function list
      When I send "GET /api/detail?id=src&at=" with the token
      Then the status is 200
      And the body has crap 42, coverage "0.54", mutants 3 and "files" 5
      And the body has no "hot" field

    Scenario: A missing coverage entry leaves CRAP blank and drops out of the sum
      Given the coverage report has no entry for "src/red.ts" and still has the other four
      When I send "GET /api/graph?at=src" with the token
      Then the node "src/red.ts" has crap "–", no coverage field and mutants 0
      And the node "src" is not in this view
      When I send "GET /api/graph" with the token
      Then the node "src" has crap 6, coverage "0.78" and mutants 3
      When I send "GET /api/detail?id=src/red.ts&at=src" with the token
      Then the body has crap "–", no coverage field, mutants 0 and "hot" an empty array

    Scenario: A coverage entry with no statements counts as fully covered
      Given the coverage entry for "src/green.ts" has empty "statementMap" and "s", and the other entries are unchanged
      When I send "GET /api/detail?id=src/green.ts&at=src" with the token
      Then the body has crap 3, coverage "1.00" and mutants 0
      And "hot" is an empty array

    Scenario: An unparsable report disables that overlay and nothing else
      Given the coverage report contains exactly the bytes "not json"
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      And every node has no crap field and no coverage field
      And the node "src/plain.ts" has mutants 3 and the node "src/clean.ts" has mutants 0
      And the body has "coverage" "off" and "mutation" "on"
      When I send "GET /api/detail?id=src/amber.ts&at=src" with the token
      Then the body has no crap field, no coverage field, mutants 0 and "hot" an empty array

    Scenario: A missing mutation report leaves mutants off and CRAP on
      Given the mutation report does not exist
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      And the node "src/green.ts" has crap 3 and coverage "1.00" and no mutants field
      And the body has "coverage" "on" and "mutation" "off"

    Scenario: Both reports missing leaves the 003 graph intact
      Given neither report exists
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      And no node has a crap, coverage or mutants field
      And the body has "coverage" "off" and "mutation" "off"
      And the nodes and edges are the 003 src view of this repository plus the Martin fields
      When I send "GET /api/tree" with the token
      Then the status is 200 and the top-level entries include "src" and "tsconfig.json"

    Scenario: A report older than a scanned source is marked stale
      Given the coverage report is older than "src/green.ts" and the mutation report is newer than every scanned source
      When I send "GET /api/graph?at=src" with the token
      Then the body has "coverage" "stale" and "mutation" "on"
      And the node "src/green.ts" still has crap 3

    Scenario: Equal mtimes are not stale
      Given both reports have the same mtime as the newest scanned source
      When I send "GET /api/graph" with the token
      Then the body has "coverage" "on" and "mutation" "on"

    Scenario: The CRAP limit comes from marestail.toml and is 4 when that file is absent
      Given "/tmp/qa/healthy/marestail.toml" holds "[ts]\ncrap_max = 6\n"
      When I send "GET /api/graph" with the token
      Then the body has "crapMax" 6
      And the node "src" has crap 42
      Given bindweed is serving "/tmp/qa/bare" on port 4900
      And "/tmp/qa/bare" has no coverage report and no mutation report
      When I send "GET /api/graph" with the token
      Then the body has "crapMax" 4, "coverage" "off" and "mutation" "off"

    Scenario: An absolute key inside the repository counts and a key outside it does not
      Given the coverage report keys "src/green.ts" by its absolute path under the served repository and keys "src/amber.ts" by "/tmp/elsewhere/amber.ts"
      And the mutation report keys "src/plain.ts" by its absolute path under the served repository and leaves its other entries as they are
      When I send "GET /api/graph?at=src" with the token
      Then the node "src/green.ts" has crap 3 and coverage "1.00"
      And the node "src/amber.ts" has crap "–" and no coverage field
      And the node "src/plain.ts" has mutants 3

    Scenario: Rescan reads the reports again and writes nothing but the cache
      Given I noted the mtime of every file outside ".bindweed"
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 5 and "ms" a number
      And the only file whose bytes changed is under ".bindweed"
      When I send "GET /api/graph" with the token
      Then the node "src" has crap 42, coverage "0.54" and mutants 3

  Rule: Martin's numbers describe each package in the current view
    Ca is the number of files outside the package that import at least one file inside it.
    Ce is the number of files inside the package that import at least one file outside it.
    A file that imports three files outside counts once. I is Ce divided by Ca plus Ce,
    and "–" when both are 0. A is the abstract files divided by the files, using the 003
    meaning of an abstract file. D is the absolute value of A plus I minus 1, and "–"
    when I is. When I is "–" the node has no zone field and the Metrics Zone cell reads
    "–". Zone is "pain" when D is greater than 0.5 and A plus I is less than 1, "useless"
    when D is greater than 0.5 and A plus I is greater than 1, and "healthy" otherwise,
    including when D is exactly 0.5. Tests and external packages never count, so a test
    file is neither a file inside nor a file outside. A file node has Ca, Ce, I, A and D
    and no zone: its Ca is the distinct files that import it and its Ce is the distinct
    files it imports, tests and external packages left out of both. The layered
    repository has no reports, so its nodes carry no crap, coverage or mutants field.

    Scenario: The src view of layered has a stable domain, an unstable app and a middle infra
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      And the node "src/domain" has files 2, ca 3, ce 0, i "0.00", a "1.00", d "0.00" and zone "healthy"
      And the node "src/app" has files 2, ca 0, ce 2, i "1.00", a "0.00", d "0.00" and zone "healthy"
      And the node "src/infra" has files 2, ca 2, ce 2, i "0.50", a "0.00", d "0.50" and zone "healthy"
      And no node has a crap, coverage or mutants field
      And the body has "coverage" "off" and "mutation" "off"
      And the edges are exactly:
        """
        [{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]
        """

    Scenario: The root package of layered imports nothing and is imported by nothing
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I send "GET /api/graph" with the token
      Then the only node is "src"
      And that node has files 6, ca 0, ce 0, i "–", a "0.33", d "–" and no zone field
      And it has no crap, coverage or mutants field

    Scenario: A file in the app view counts its own fan-in and fan-out
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I send "GET /api/graph?at=src/app" with the token
      Then the node "src/app/a.ts" has ca 1, ce 4, i "0.80", a "0.00" and d "0.20"
      And the node "src/app/b.ts" has ca 1, ce 2, i "0.67", a "0.00" and d "0.33"
      And neither node has a zone field
      And neither node is named "a.test.ts"

    Scenario: Turning tests on does not change a package's numbers
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I send "GET /api/graph?at=src&tests=1" with the token
      Then the node "src/app" has files 3, ca 0, ce 2, i "1.00", a "0.00", d "0.00" and zone "healthy"
      And the node "src/domain" has ca 3 and ce 0
      When I send "GET /api/graph?at=src/app&tests=1" with the token
      Then the node "src/app/a.ts" has ca 1, ce 4, i "0.80", a "0.00" and d "0.20"
      When I send "GET /api/detail?id=src/app&at=src&tests=1" with the token
      Then the body has files 3, ca 0, ce 2, i "1.00", a "0.00", d "0.00" and zone "healthy"

    Scenario: An external import does not count as fan-out
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I send "GET /api/graph?at=src&external=1" with the token
      Then the node "src/infra" has ca 2, ce 2, i "0.50", a "0.00", d "0.50" and zone "healthy"
      And the node "node:fs" has no ca field and no zone field
      When I send "GET /api/detail?id=node:fs&at=src&external=1" with the token
      Then the body has no ca field, no ce field, no i field, no a field, no d field and no zone field

    Scenario: A package nothing imports is pain, a pure-abstraction consumer is useless, and D of 0.5 is healthy
      Given "/tmp/qa/zones" is a git repository with these files committed:
        | path          | content                                                                                     |
        | src/pain/a.ts | export const a = 1;\n                                                                       |
        | src/use/b.ts  | export interface B { n: number }\n                                                          |
        | src/use/c.ts  | import type { B } from './b';\nimport type { D } from '../mid/d';\nexport type C = B \| D;\n |
        | src/mid/d.ts  | import { a } from '../pain/a';\nexport const d = a;\nexport type D = typeof a;\n           |
      And bindweed is serving "/tmp/qa/zones" on port 4900
      When I send "GET /api/graph?at=src" with the token
      Then the node "src/pain" has files 1, ca 1, ce 0, i "0.00", a "0.00", d "1.00" and zone "pain"
      And the node "src/use" has files 2, ca 0, ce 1, i "1.00", a "1.00", d "1.00" and zone "useless"
      And the node "src/mid" has files 1, ca 1, ce 1, i "0.50", a "0.00", d "0.50" and zone "healthy"

  Rule: The overlay is remembered, and a bad layout is still refused
    settings holds "tests", "external" and, once one was chosen, "overlay", one of "none",
    "crap", "coverage" and "mutants". A settings object of just "tests" and "external" is
    still a valid 003 document, it reads as overlay "none", and GET returns the document
    exactly as it was stored. A settings object with any other overlay value, or with any
    other key, is refused. A rejected PUT leaves the file as it was. GET still writes nothing.

    Scenario: A saved overlay is returned and a 003 document still reads
      When I send "PUT /api/layout" with the token and this body:
        """
        {"version":1,"views":{},"settings":{"tests":false,"external":false,"overlay":"crap"}}
        """
      Then the status is 200 and the body is that same JSON
      And "GET /api/layout" with the token returns that same JSON
      Given the file "/tmp/qa/healthy/.bindweed/layout.json" contains exactly the bytes of "{\"version\":1,\"views\":{},\"settings\":{\"tests\":true,\"external\":false}}"
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":true,"external":false}}
      And the file's bytes are unchanged

    Scenario: An unknown overlay is refused and the file is left as it was
      Given "PUT /api/layout" has saved {"version":1,"views":{},"settings":{"tests":false,"external":false,"overlay":"none"}}
      When I send "PUT /api/layout" with the token and the body "{\"version\":1,\"views\":{},\"settings\":{\"tests\":false,\"external\":false,\"overlay\":\"zones\"}}"
      Then the status is 400 and the body is {"error":"bad layout"}
      And "GET /api/layout" with the token still returns overlay "none"
      When I send "PUT /api/layout" with the token and the body "{\"version\":1,\"views\":{},\"settings\":{\"tests\":false,\"external\":false,\"overlay\":\"crap\",\"zones\":1}}"
      Then the status is 400 and the body is {"error":"bad layout"}
      And "GET /api/layout" with the token still returns overlay "none"

    Scenario: The old routes still answer, and the new fields do not move them
      When I send "GET /api/tree" with the token
      Then the status is 200 and the entries at the top level include "src" and "marestail.toml"
      When I send "GET /api/file?path=src/green.ts" with the token
      Then the status is 200 and the body's "path" is "src/green.ts"
      When I send "GET /api/graph?at=notes" with the token
      Then the status is 404 and the body is {"error":"no such directory"}
      When I send "GET /api/detail?id=missing&at=src" with the token
      Then the status is 404 and the body is {"error":"no such node"}

    Scenario Outline: Host, token and method
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request        | credentials                          | status | body                               |
        | GET /api/graph | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/layout | the header "Host: evil.example:4900" | 403    | {"error":"bad host"}               |
        | POST /api/graph | the token                            | 404    | {"error":"not found"}              |

  Rule: The page colours the boxes and opens the Metrics table
    The Overlay combobox sits in the Architecture toolbar and offers None, CRAP, Coverage
    and Surviving mutants. A disabled option has the tooltip named in the scenario, and
    choosing a disabled option does nothing. The choice is saved as settings.overlay.
    The stale badge is shown next to the combobox when the selected overlay's report is
    stale; None has no report, so it shows no badge. The Metrics button toggles the
    drawer. The drawer lists every package node in the current view and no file node, one
    row each, columns Name, Files, Ca, Ce, I, A, D, Zone, CRAP, Coverage and Mutants. A
    Metrics cell or a details-panel number for a field the body does not carry reads "–".
    It opens sorted by D descending, "–" sorting last and ties broken by name ascending.
    A click on a header sorts by that column, descending on the first click on a new
    column and toggling direction after that; ties still break by name ascending. A click
    on a row selects that box. The details panel shows the same numbers for the selected
    box, and for a file adds a Hot functions list of the functions over the limit.

    Scenario: CRAP colours the three functions green, amber and red
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      Then the Overlay combobox shows "None" and no box has a health badge
      When I choose "CRAP" in the Overlay combobox
      Then the "green.ts" badge reads "3" and its data-health is "green"
      And the "amber.ts" badge reads "6" and its data-health is "amber"
      And the "red.ts" badge reads "42" and its data-health is "red"
      And the "plain.ts" badge reads "–" and has no data-health
      And the "clean.ts" badge reads "–" and has no data-health
      And "GET /api/layout" returns settings.overlay "crap"
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      Then the Overlay combobox shows "CRAP" and the "red.ts" badge still reads "42"

    Scenario: Coverage and mutants colour by their own scales
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      And I choose "Coverage" in the Overlay combobox
      Then the "green.ts" badge reads "1.00" and its data-health is "green"
      And the "amber.ts" badge reads "0.50" and its data-health is "red"
      And the "red.ts" badge reads "0.00" and its data-health is "red"
      When I choose "Surviving mutants" in the Overlay combobox
      Then the "plain.ts" badge reads "3" and its data-health is "red"
      And the "clean.ts" badge reads "0" and its data-health is "green"
      And the "green.ts" badge reads "0" and its data-health is "green"

    Scenario: A missing report disables its option and names the command to run
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      Then the "CRAP" option and the "Coverage" option are disabled, and each one's tooltip is "no coverage data: run marestail gate"
      And the "Surviving mutants" option is disabled and its tooltip is "no mutation report: run marestail gate --tier full"
      And the "None" option is enabled
      When I choose "CRAP" in the Overlay combobox
      Then the combobox still shows "None" and no box has a health badge

    Scenario: A stale report shows the badge and still colours the boxes
      Given the coverage report is older than "src/green.ts"
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      And I choose "CRAP" in the Overlay combobox
      Then the stale badge is shown next to the Overlay combobox
      And the "red.ts" badge reads "42" and its data-health is "red"
      When I choose "Surviving mutants" in the Overlay combobox
      Then the stale badge is not shown

    Scenario: The Metrics table sorts by D and selecting a row selects the box
      Given bindweed is serving "/tmp/qa/layered" on port 4900
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      And I click "Metrics"
      Then the Metrics drawer is shown
      And its rows are "infra", "app", "domain", in that order
      And the "infra" row reads Files 2, Ca 2, Ce 2, I 0.50, A 0.00, D 0.50, Zone healthy, CRAP "–", Coverage "–", Mutants "–"
      And the "app" row reads Files 2, Ca 0, Ce 2, I 1.00, A 0.00, D 0.00, Zone healthy, CRAP "–", Coverage "–", Mutants "–"
      And the "domain" row reads Files 2, Ca 3, Ce 0, I 0.00, A 1.00, D 0.00, Zone healthy, CRAP "–", Coverage "–", Mutants "–"
      And the D header carries aria-sort "descending"
      When I click the I header
      Then the rows are "app", "infra", "domain" and the I header carries aria-sort "descending"
      When I click the "domain" row
      Then the "domain" box carries data-selected "true" and the details panel's heading is "domain"
      And the panel shows I 0.00, A 1.00, D 0.00 and Zone healthy
      When I click "Metrics" again
      Then the Metrics drawer is not shown

    Scenario: A file's panel lists the functions over the limit
      When I open "http://127.0.0.1:4900/?token={token}#at=src" in a browser
      And I click the "red.ts" box
      Then the details panel's heading is "red.ts"
      And the panel shows CRAP 42, Coverage 0.00 and Mutants 0
      And under "Hot functions" one row reads "bad", line 1, cc 6, coverage 0.00
      When I click the "green.ts" box
      Then under "Hot functions" there is no row
      And the panel shows CRAP 3 and Coverage 1.00

    Scenario: The README lists the same routes
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route         | status |
        | `/api/tree`   | live   |
        | `/api/file`   | live   |
        | `/api/graph`  | live   |
        | `/api/rescan` | live   |
        | `/api/layout` | live   |
        | `/api/detail` | live   |
