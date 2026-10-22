Feature: watch a run converge on the plan
  While a run works in its worktree, the developer presses Converge and the
  Architecture canvas shows that worktree against the plan. Each edit is
  ticked, left open, or marked contradicted as the files land, and the
  contract line counts the rules that still hold. Leaving returns to the
  repository they were browsing. Nothing in that repository's scan changes.

  The tree, token, {token}, Host header, JSON comparison and \n are the
  Background of features/plan-to-dependency-contract.feature. "bindweed" is
  "node <bindweed dir>/src/cli.ts" on port 5000. The en dash is not used
  here; the separator in a header is " · " with U+00B7. A sentence is the
  one features/plan-moves-and-edges.feature and
  features/plan-package-edits-and-file-fates.feature already give that edit.
  Redo is ignored. "The browsed scan" is the scan GET /api/graph already
  uses. "The worktree scan" is a scan of the run's worktree only.

  Assumptions the scenarios rely on. The verdict is a pure function of the
  plan, the browsed scan and the worktree scan: no clock and no disk, so
  the same scans always return the same JSON. Former importers, and the
  files a rename, merge or split covers, come from the browsed scan at
  request time. A dangling import counts only when its specifier is
  relative. The spelled path is the specifier resolved against the
  importer's directory; when the specifier has no extension, the importer's
  extension is appended, so "./b" in src/app/a.ts spells src/app/b.ts.
  An alias such as "@domain/model" that fails to resolve counts as nothing.
  Type-only imports and heritage imports count, tests included. External
  imports count as neither an internal import nor a cycle edge. A covered
  file is in place when the worktree scan has it at its planned path and,
  if that path differs, not at its old path. An edit is contradicted when
  any covered file is at neither path and no fate's file is that old path
  or that planned path; else it is done when every covered file is in
  place; else it is not yet. add-edge, cut-edge, create-package and fate
  are never contradicted. The planned path of a path is that path carried
  through later edits the way a contract carries a cut end, non-stale on
  the browsed scan. While Converge is on, the plan's edits do not change.

  "The worktree" is "/tmp/qa/converge-wt", a copy of the four-file fixture
  plus src/app/c.ts containing "import { query } from '../infra/db';\nexport const c = query;\n".
  "The move" is {"kind":"move-file","file":"src/domain/model.ts","to":"src/core"}.
  "The cut" is {"kind":"cut-edge","from":"src/app","to":"src/infra","files":[["src/app/a.ts","src/infra/db.ts"],["src/app/b.ts","src/infra/db.ts"],["src/app/c.ts","src/infra/db.ts"]]}.
  "The package" is {"kind":"create-package","path":"src/ports"}.
  "The delete" is {"kind":"fate","file":"src/app/b.ts","fate":"delete"}.
  "The two rules" are {"name":"bindweed:no-src-app-to-src-infra","severity":"error","comment":"src/app must not import src/infra","from":{"path":"^src/app/"},"to":{"path":"^src/infra/"}}
  and {"name":"bindweed:no-circular","severity":"error","comment":"No circular dependencies","from":{},"to":{"circular":true}}.
  "The gate plan" is the plan "Gate", slug gate, edits the move, the cut,
  the package and the delete, in that order, redo [], and contract those
  two rules. "The run" is runs.json [{"slug":"gate","tool":"marestail","worktree":"/tmp/qa/converge-wt","branch":"bindweed/gate","pid":<live>,"startedAt":"2026-10-22T12:00:00.000Z","out":"/tmp/qa/converge-wt/missing.out","settings":{}}].
  <live> is the pid of a "sleep 900" the test spawned. "A dead pid" is the
  pid of a "true" the test spawned and waited for. A pid is alive as in
  features/launch-the-run.feature. Each scenario starts from the Background
  again, and each outline example does too.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed four-file fixture of features/plan-to-dependency-contract.feature
    And the worktree, the gate plan and the run are in place
    And bindweed is serving "/tmp/qa/layered"

  Rule: GET /api/converge compares the worktree with the plan
    GET /api/converge?slug=<slug> answers 200 with exactly slug, worktree,
    pidAlive, header, edits and rules. It reads the run GET /api/runs would
    list first for that slug, and it never writes runs.json, the plan, or
    the browsed ".bindweed/cache/scan.json". header is "<done> of <checked>
    edits done · <holding> of <rules> rules hold", always those words.
    <checked> counts every edit except a note. <done> counts status "done".
    <rules> is the saved contract's length, 0 when the plan has no contract.
    <holding> counts rules with no breaking import. edits follows the plan,
    each {"index","status","sentence"} plus "remain" only when that list is
    not empty. status is "done", "not yet", "contradicted" or "note".
    remain is "<file>:<line>" sorted by file then line, the line 1-based.
    A rule is {"name","comment","holds"} plus "breaks", the same strings,
    only when it does not hold. Rules stay in saved order.
    A path restriction matches when JavaScript RegExp.test of its pattern
    accepts the path; the pattern is not escaped again. from {} matches
    every importer. to {"circular":true} matches an import whose ends are
    the same file, or both lie on one cycle of internal imports. A rule
    breaks on an import only when every restriction it has matches. The
    cycle graph does not include a dangling import.
    A cut remains while any of its pairs, at the stored paths or the
    planned paths, still has an import, resolved or dangling, and remain
    lists those import lines. An add-edge is done when a resolved import
    runs from its from node, or that node carried forward, to its to node
    the same way: a file matches a node when the path equals the node or
    starts with "<node>/". A create-package is done when a scanned file
    sits inside that directory, at any depth. A markdown file does not
    count. A delete is done when the file is at neither its path nor its
    planned path and nothing imports either path; while it is gone but
    imported, remain names those imports. A fold is done when the file is
    gone the same way and every former importer imports into, at into or
    into's planned path. A former importer is a browsed-scan file, other
    than into, with an edge to the folded file. One that no longer has the
    old import line and does not import into is named as the path alone,
    with no colon. A note is "note" and has no remain.
    A missing slug parameter answers 400 {"error":"missing slug"}. An
    unknown slug, or one that fails ^[a-z0-9][a-z0-9-]*$, answers 404
    {"error":"no such run"}. A run whose plan is missing or not a plan
    answers 404 {"error":"no such plan"}. A run whose worktree directory
    is missing answers 404 {"error":"worktree removed"}. Host and token
    are checked first. None of these write a cache.

    Scenario: Four edits and two rules start undone
      When I send "GET /api/converge?slug=gate" with the token
      Then the status is 200 and the body is exactly:
        | slug | gate |
        | worktree | /tmp/qa/converge-wt |
        | pidAlive | true |
        | header | 0 of 4 edits done · 0 of 2 rules hold |
      And edit 0 is "not yet", "Move src/domain/model.ts to src/core", with no remain
      And edit 1 is "not yet", "src/app must not import src/infra (3 imports)", remain ["src/app/a.ts:2","src/app/b.ts:2","src/app/c.ts:1"]
      And edit 2 is "not yet", "Create package src/ports", with no remain
      And edit 3 is "not yet", "Delete src/app/b.ts", with no remain
      And rule 0 does not hold and breaks ["src/app/a.ts:2","src/app/b.ts:2","src/app/c.ts:1"]
      And rule 1 does not hold and breaks ["src/app/a.ts:1","src/app/b.ts:1"]
      And runs.json's bytes are unchanged

    Scenario: The move ticks only when the old path is gone, and a copy stays open
      Given "src/core/model.ts" is the worktree's "src/domain/model.ts" and the old path still exists
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 0 is "not yet" and the header starts "0 of 4 edits done"
      Given the old path is removed and "src/core/model.ts" remains
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 0 is "done" and the header is "1 of 4 edits done · 0 of 2 rules hold"
      Given neither "src/domain/model.ts" nor "src/core/model.ts" exists
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 0 is "contradicted" and the header starts "0 of 4 edits done"

    Scenario: A cut stays open until its last import, at the old path or the planned one
      Given the import lines of "src/app/a.ts" and "src/app/b.ts" that name "../infra/db" are removed
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "not yet" and its remain is ["src/app/c.ts:1"]
      And rule 0 breaks ["src/app/c.ts:1"] and rule 1 breaks ["src/app/a.ts:1","src/app/b.ts:1"]
      Given "src/app/c.ts" is "export const c = 1;\n"
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "done" and has no remain
      And rule 0 holds and the header is "1 of 4 edits done · 1 of 2 rules hold"

    Scenario: A cut follows the file to its planned path
      Given the plan's edits are only the move {"kind":"move-file","file":"src/app/b.ts","to":"src/domain"} then the cut {"kind":"cut-edge","from":"src/app/b.ts","to":"src/infra/db.ts","files":[["src/app/b.ts","src/infra/db.ts"]]}, and it has no contract
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "not yet", remain ["src/app/b.ts:2"], and the header ends "· 0 of 0 rules hold"
      Given "src/app/b.ts" is moved to "src/domain/b.ts" and its "../infra/db" import is still line 2
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "not yet" and its remain is ["src/domain/b.ts:2"]
      Given that import line is removed
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "done"

    Scenario: A stopped run still answers
      Given the run's pid is dead
      When I send "GET /api/converge?slug=gate" with the token
      Then pidAlive is false and the header is "0 of 4 edits done · 0 of 2 rules hold"

    Scenario: Creating the package, and deleting a file something still imports
      Given "src/ports/readme.md" is "# ports\n"
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 2 is "not yet"
      Given "src/ports/port.ts" is "export const port = 1;\n" and the readme is gone
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 2 is "done"
      Given "src/app/b.ts" is removed and "src/app/a.ts" still imports "./b" on line 1
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 3 is "not yet" and its remain is ["src/app/a.ts:1"]
      And rule 1 holds
      Given "src/app/a.ts" no longer imports "./b"
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 3 is "done" and has no remain

    Scenario: A fold names who does not import into, and ignores a file the browsed scan never had
      Given the plan's only edit is {"kind":"fate","file":"src/infra/db.ts","fate":"fold","into":"src/domain/model.ts"} and it has no contract
      When I send "GET /api/converge?slug=gate" with the token
      Then the only edit is "not yet", "Fold src/infra/db.ts into src/domain/model.ts", with no remain
      Given "src/infra/db.ts" is removed
      When I send "GET /api/converge?slug=gate" with the token
      Then the edit is "not yet" and its remain is ["src/app/b.ts:2"]
      Given "src/app/b.ts" is "export const b = 1;\n"
      When I send "GET /api/converge?slug=gate" with the token
      Then the remain is ["src/app/b.ts"]
      Given "src/app/b.ts" is "import { Model } from '../domain/model';\nexport const b = 1;\n"
      When I send "GET /api/converge?slug=gate" with the token
      Then the edit is "done" and has no remain

    Scenario Outline: The other edits, against a fresh worktree
      Given the plan's only edit is <edit> and it has no contract
      And the worktree <change>
      When I send "GET /api/converge?slug=gate" with the token
      Then the only edit has status "<status>" and remain <remain>
      And "none" means the remain key is absent

      Examples:
        | edit | change | status | remain |
        | {"kind":"add-edge","from":"src/domain","to":"src/app"} | is unchanged | not yet | none |
        | {"kind":"add-edge","from":"src/domain","to":"src/app"} | has "src/domain/model.ts" starting "import { a } from '../app/a';\n" | done | none |
        | {"kind":"rename-file","from":"src/domain/model.ts","to":"entity.ts"} | has "src/domain/entity.ts" and no "src/domain/model.ts" | done | none |
        | {"kind":"rename-package","from":"src/app","to":"src/ui"} | has a.ts and b.ts under "src/ui" and not under "src/app", and "src/app/c.ts" still in place | done | none |
        | {"kind":"rename-package","from":"src/domain","to":"src/core"} | has neither "src/domain/model.ts" nor "src/core/model.ts" | contradicted | none |
        | {"kind":"merge-packages","packages":["src/app","src/domain"],"into":"src/core"} | has "src/core/a.ts", "src/core/b.ts" and "src/core/model.ts", and not the three old paths | done | none |
        | {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.ts"]},{"name":"write","files":["src/app/b.ts"]}]} | has "src/app/read/a.ts" and "src/app/write/b.ts" and not the two old paths, with "src/app/c.ts" still in place | done | none |
        | {"kind":"note","target":{"node":"src/domain"},"text":"look here"} | is unchanged | note | none |

    Scenario: A note is outside the count, a redo is ignored, and a fate covers a move
      Given the gate plan's edits gain a trailing note {"kind":"note","target":{"node":"src/domain"},"text":"look here"} and the cut is also the only redo entry
      When I send "GET /api/converge?slug=gate" with the token
      Then the header starts "0 of 4 edits done" and edit 4 is "note", "Note on src/domain: \"look here\"", with no remain
      Given the plan's edits are the move and then {"kind":"fate","file":"src/domain/model.ts","fate":"delete"}, it has no contract, and neither model path exists
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 0 is "done" and edit 1 is "not yet" with remain ["src/infra/db.ts:1"]

    Scenario: A saved rule is matched as written, and a test import breaks it
      Given the plan's contract is only {"name":"bindweed:no-src-c++-to-src-app-a-ts","severity":"error","comment":"src/c++ must not import src/app/a.ts","from":{"path":"^src/c\\+\\+/"},"to":{"path":"^src/app/a\\.ts$"}}
      And "src/c++/plus.ts" is "import { a } from '../app/a';\nexport const plus = a;\n"
      When I send "GET /api/converge?slug=gate" with the token
      Then the only rule does not hold and breaks ["src/c++/plus.ts:1"]
      Given "src/app/a.test.ts" is "import { query } from '../infra/db';\nexport const t = query;\n" and the plan's contract is the two rules
      And the three "../infra/db" imports in a.ts, b.ts and c.ts are removed
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1 is "done" and rule 0 breaks ["src/app/a.test.ts:1"]

    Scenario: The newest run for a slug is the one that is scanned
      Given runs.json is the run, then the same entry with worktree "/tmp/qa/converge-old" and startedAt "2026-10-22T11:00:00.000Z"
      And "/tmp/qa/converge-old" is a copy of the worktree with no "src/app/c.ts"
      When I send "GET /api/converge?slug=gate" with the token
      Then worktree is "/tmp/qa/converge-wt" and edit 1's remain is ["src/app/a.ts:2","src/app/b.ts:2","src/app/c.ts:1"]
      Given that first entry's startedAt is "2026-10-22T11:00:00.000Z" and the second entry's startedAt is "2026-10-22T12:00:00.000Z"
      When I send "GET /api/converge?slug=gate" with the token
      Then worktree is "/tmp/qa/converge-old" and edit 1's remain is ["src/app/a.ts:2","src/app/b.ts:2"]

    Scenario Outline: A converge request that cannot be answered writes nothing
      Given <world>
      When I send "<request>" <auth>
      Then the status is <status> and the body is <body>
      And "/tmp/qa/layered/.bindweed/cache/gate" does not exist

      Examples:
        | world | request | auth | status | body |
        | the Background | GET /api/converge | with the token | 400 | {"error":"missing slug"} |
        | the Background | GET /api/converge?slug=nope | with the token | 404 | {"error":"no such run"} |
        | the Background | GET /api/converge?slug=../gate | with the token | 404 | {"error":"no such run"} |
        | the plan file is {"name":"Bad"} | GET /api/converge?slug=gate | with the token | 404 | {"error":"no such plan"} |
        | the worktree directory is removed | GET /api/converge?slug=gate | with the token | 404 | {"error":"worktree removed"} |
        | the Background | GET /api/converge?slug=gate | without authorization | 401 | {"error":"missing or wrong token"} |
        | the Background | GET /api/converge?slug=gate | with Host "evil.example:5000" and the token | 403 | {"error":"bad host"} |

  Rule: the canvas reads the worktree and the cache stays under the browsed root
    GET /api/graph, GET /api/detail and GET /api/pairs with converge=<slug>
    build the same body as they would for that worktree, plan and flags.
    POST /api/rescan?converge=<slug> answers {"files","ms"} for the worktree
    scan and is otherwise the rescan of features/layered-package-view.feature.
    The same errors as GET /api/converge apply, and a bad one does not scan.
    Without the parameter every one of these routes is unchanged.
    The worktree scan is cached only at
    "<root>/.bindweed/cache/<slug>/scan.json", never under the worktree.
    The file is {"version":2,"files":{<path>:{"mtimeMs","size","imports"}}}.
    An import is {"specifier","typeOnly","line"} plus "heritage" only when
    the import has one. A second request reuses an entry whose mtimeMs and
    size still match and does not re-read that file. The browsed
    ".bindweed/cache/scan.json" keeps the shape it has today: its imports
    have no "line" key. The worktree directory ".bindweed" is not created.

    Scenario: The worktree graph has c.ts and the browsed graph does not
      When I send "GET /api/graph?at=src&plan=gate&converge=gate" with the token
      Then the status is 200 and "src/app" has files 3
      And "src/core" and "src/ports" are nodes
      When I send "GET /api/pairs?from=src/app&to=src/infra&at=src&converge=gate" with the token
      Then the pairs are ["src/app/a.ts","src/infra/db.ts"], ["src/app/b.ts","src/infra/db.ts"] and ["src/app/c.ts","src/infra/db.ts"]
      When I send "GET /api/detail?id=src/app&at=src&converge=gate" with the token
      Then the body names "src/app/c.ts"
      When I send "GET /api/graph?at=src&plan=gate" with the token
      Then "src/app" has files 2 and there is no node "src/app/c.ts"
      When I send "GET /api/pairs?from=src/app&to=src/infra&at=src" with the token
      Then the pairs are ["src/app/a.ts","src/infra/db.ts"] and ["src/app/b.ts","src/infra/db.ts"]
      And "/tmp/qa/converge-wt/.bindweed" does not exist

    Scenario: A warm cache entry is reused until the file's stamp changes
      Given "GET /api/converge?slug=gate" has been sent with the token
      And the slug cache's entry for "src/app/a.ts" says the "../infra/db" import is line 9, with mtimeMs and size unchanged
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1's remain starts with "src/app/a.ts:9"
      Given one newline is appended to the worktree's "src/app/a.ts"
      When I send "GET /api/converge?slug=gate" with the token
      Then edit 1's remain starts with "src/app/a.ts:2"
      And the browsed ".bindweed/cache/scan.json" bytes are the bytes from before the first converge request
      And a browsed import object has no "line" key

    Scenario: Rescan of the worktree does not rescan the browsed repository
      When I send "POST /api/rescan?converge=gate" with the token
      Then the status is 200 and "files" is 5
      And the browsed ".bindweed/cache/scan.json" bytes are unchanged
      And "/tmp/qa/converge-wt/.bindweed" does not exist
      When I send "POST /api/rescan" with the token
      Then "files" is 4
      When I send "POST /api/rescan?converge=nope" with the token
      Then the status is 404 and the body is {"error":"no such run"}

  Rule: the page shows Converge, then returns to the browsed repository
    A run whose worktreeExists and planExists are both true gets a button
    "Converge". It is on that run's card, and on the plan toolbar after
    Settings when the open plan is that run's slug. The toolbar order
    Tasks, Launch, Settings stays the order 010 pinned. The button is
    absent otherwise. It opens "#at=<at>&plan=<slug>&converge=<slug>",
    <at> the Architecture view's current at, "" when never set, and selects
    the Architecture tab with the plan open on Planned.
    The change list then hides stale reasons and warning lines. Above it a
    "p.converge-header" shows the header. Each edit row starts with a
    "span.converge-mark": "✓" for done, "○" for not yet, "✗" for
    contradicted, and nothing for a note. The span's data-status is the
    status word. Its computed color is rgb(22, 163, 74), rgb(100, 116, 139)
    or rgb(220, 38, 38) for those three. remain and breaks are
    "ul.converge-remain" under the row, and the rules sit in
    "ul.converge-rules" using the comment as their text. A rule row starts
    with the same mark, "✓" when it holds and "○" when it does not. Undo, Redo and
    Remove are disabled, and a drop does not change the plan's bytes.
    On the canvas a not-yet mark stays as in 005 and 006, with no
    data-converge. A done cut is drawn even when the graph calls that edit
    stale, so the tick has a marker to colour. A done move paints the row of its planned path
    data-converge="done" and computed color rgb(22, 163, 74). A done cut
    sets data-converge="done" on its "g.cutmark"; the line's stroke and the
    "✂" fill are "#16a34a", not "#94a3b8" and "#64748b". A done
    create-package sets data-converge="done" on the box "[data-id=<path>]"
    and its computed border-top-color is rgb(22, 163, 74). A contradicted
    move draws a dashed row of the file at its planned path,
    data-ghost="true" and data-converge="contradicted", computed color
    rgb(220, 38, 38), inside the planned package even when that package is
    not in the scan. While the hash has converge, the toolbar button reads
    "Leave". Leave, and clicking Architecture again after Files or Runs,
    drops the converge key and shows the browsed plan view. A converge
    error shows its error text in the architecture pane, and Leave still
    works.
    While the Architecture tab shows a converge hash, document.visibilityState
    is "visible", and pidAlive is true, the page fetches GET /api/converge
    and the converge graph at once, then 20 seconds after they answer,
    never starting a pair while the last has not answered. A test may
    control that clock. At 19999 ms no second pair has started. At 20000 ms
    it starts. A hidden document, another tab, or a dead pid fetches
    nothing. Becoming visible fetches at once. Rescan posts
    POST /api/rescan?converge=<slug> and then fetches. Rescan with no
    converge key posts POST /api/rescan, as before.

    Scenario: The card and the toolbar open the worktree, and Leave restores the browsed view
      When I open bindweed at "#at=src&plan=gate"
      Then the toolbar buttons include "Tasks", "Launch", "Settings", "Converge" in that order, with nothing between Tasks and Launch or Launch and Settings
      And there is no "p.converge-header"
      And the cut row shows "no such file src/app/c.ts"
      When I click "Converge"
      Then the hash is "#at=src&plan=gate&converge=gate" and the header is "0 of 4 edits done · 0 of 2 rules hold"
      And the marks are "○", "○", "○", "○" and their computed colors are rgb(100, 116, 139)
      And the cut's remain shows "src/app/a.ts:2", "src/app/b.ts:2" and "src/app/c.ts:1"
      And the rules show "src/app must not import src/infra" and "No circular dependencies", each with an "○"
      And "g.cutmark[data-from='src/app'][data-to='src/infra']" has no data-converge, its stroke is "#94a3b8" and its "✂" fill is "#64748b"
      And "[data-id='src/ports']" reads "0 files" and has no data-converge
      And "[data-path='src/core/model.ts']" has no data-converge and its computed color is not rgb(22, 163, 74)
      And "[data-path='src/app/b.ts']" has data-fate "delete"
      And Undo, Redo and Remove are disabled
      When I click "Leave"
      Then the hash is "#at=src&plan=gate", there is no converge header, and "src/app" shows 2 files

    Scenario: Done marks turn green, a contradicted move turns red, and the plan file stays
      Given neither model path exists in the worktree
      When I open bindweed at "#at=src&plan=gate&converge=gate"
      Then the move's mark is "✗" with computed color rgb(220, 38, 38)
      And a dashed "[data-path='src/core/model.ts']" has data-converge "contradicted" and computed color rgb(220, 38, 38)
      Given "src/core/model.ts" is restored as the only model path, the three "../infra/db" import lines are removed, and "src/ports/port.ts" is "export const port = 1;\n"
      When I click "Rescan"
      Then the header is "3 of 4 edits done · 1 of 2 rules hold"
      And "[data-path='src/core/model.ts']" has data-converge "done" and computed color rgb(22, 163, 74)
      And the cut's "✂" fill is "#16a34a" and its line's stroke is "#16a34a"
      And "[data-id='src/ports']" has data-converge "done" and computed border-top-color rgb(22, 163, 74)
      And the move's, the cut's and the package's marks are "✓" with computed color rgb(22, 163, 74)
      And the path rule's mark is "✓" and the circular rule's mark is "○"
      And the gate plan's bytes are unchanged

    Scenario: The view refreshes while the pid is alive and the tab is visible
      When I open bindweed at "#at=src&plan=gate&converge=gate"
      Then GET /api/converge and "GET /api/graph?at=src&plan=gate&converge=gate" are requested once
      When 19999 ms have passed
      Then no second pair has started
      When 20000 ms have passed
      Then a second pair starts
      When document.visibilityState becomes "hidden"
      Then no pair is requested for 25 seconds
      When document.visibilityState becomes "visible"
      Then a pair is requested at once
      When I click "Files"
      Then no pair is requested for 25 seconds
      When the run's pid is dead and I open the converge hash again
      Then one pair is requested and no second pair starts within 25 seconds
      When I click "Rescan"
      Then the page posts "POST /api/rescan?converge=gate" and fetches the pair
      And it does not post "POST /api/rescan"

    Scenario: A missing run is the error text, and a card with no worktree has no button
      Given runs.json also holds {"slug":"gone","tool":"marestail","worktree":"/tmp/qa/converge-gone","branch":"bindweed/gone","pid":<dead>,"startedAt":"2026-10-22T11:00:00.000Z","out":"/tmp/qa/missing.out","settings":{}}
      When I open bindweed at "#runs"
      Then the "Gate" card has a "Converge" button and the "gone" card does not
      And the "gone" card still shows "worktree removed"
      When I click "Converge" on "Gate"
      Then the hash is "#at=&plan=gate&converge=gate"
      When I open bindweed at "#at=src&plan=gate&converge=missing"
      Then the architecture pane shows "no such run" and the toolbar button reads "Leave"
      When I click "Leave"
      Then the hash is "#at=src&plan=gate" and "src/app" shows 2 files
      When I click "Converge", then "Files", then "Architecture"
      Then the hash is "#at=src&plan=gate" and there is no converge header

  Rule: the routes from 001 to 011 keep working
    Scenario: Old routes still answer and README lists /api/converge
      When I send "GET /api/tree" with the token
      Then the status is 200
      When I send "GET /api/file?path=src/app/a.ts" with the token
      Then the status is 200 and the body names "src/app/a.ts"
      When I send "GET /api/plans" with the token
      Then the status is 200
      When I send "GET /api/plans/gate/contract" with the token
      Then the status is 200
      When I send "GET /api/runs" with the token
      Then the status is 200 and run 0 has slug "gate" and planName "Gate"
      When I send "GET /api/config" with the token
      Then the status is 200
      When I send "GET /api/layout" with the token
      Then the status is 200
      When I read bindweed's README.md
      Then "## Routes" has a row `/api/converge` with status "live", beside the rows already there, including `/api/runs`
