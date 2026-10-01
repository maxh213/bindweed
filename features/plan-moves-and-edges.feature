Feature: plan a refactor on the canvas by moving files, cutting and drawing arrows, and leaving notes
  A developer opens a named plan and reshapes the architecture by hand. The canvas
  shows the planned shape, the change list can undo, redo and remove, and the plan
  is still there after a restart. Nothing in the repository changes.

  Assumptions the scenarios rely on. The served tree is the 004 layered repository
  plus src/app/save.ts, which imports nothing and is imported by nothing. The
  checked-in qa/fixtures/layered tree is the older four-file one and is not this
  tree. save.ts is added so that moving it does not create or remove an arrow;
  moving a.ts or b.ts would. With no plan open the canvas matches 004 on this tree:
  no file rows, no draw handles, no box or arrow menu, no change list, no Now /
  Planned switch, and dragging a box still pins it. The toolbar does gain the plan
  controls. A response that carries no plan query has no "planned" field and is the
  004 body for this tree, so the older suites keep passing.

  While a plan is open, each package box lists the files whose parent in that graph
  is the package, as rows in name order. A row's data-path is the file's path in
  that graph. Dragging a row onto another package box records a move. Dragging it
  onto its own package does not. In a drilled file view the file boxes are the
  boxes, and dragging one onto a breadcrumb entry records a move; dropping it on
  its own directory's crumb does not. The new path is the target directory plus
  "/" plus the file name, or the file name alone when the target is the repository
  root. A ghost is drawn where that graph does not contain the file: a dashed row
  in the other package, and a dashed box in the drilled view at the other graph's
  data-x and data-y. Ghosts are faint (opacity 0.35), carry data-ghost "true", and
  are not drag sources. Stale edits draw nothing.

  Conventions: "bindweed" is "node <bindweed dir>/src/cli.ts"; /tmp/qa is a fresh
  temporary directory; bindweed serves /tmp/qa/layered on port 5000 unless a
  scenario says otherwise; {token} is that process's token and {head} is
  "git rev-parse HEAD" of the served repository; "with the token" means
  "Authorization: Bearer {token}"; requests carry "Host: 127.0.0.1:5000" unless a
  scenario sets another. JSON is compared as JSON. A key these bodies omit is
  absent. Nodes, edges, imports and importedBy match as sets. In a table cell \n
  is a newline. Each scenario starts from the Background again.
  The plan combobox is labelled "Plan". The change list is the complementary
  region labelled "changes". The switch is the radiogroup labelled "Shown graph".
  A notice is the status labelled "notice". Dialogues are labelled "New plan",
  "Delete plan" and "Add note". The en dash in a missing metric is U+2013.
  An added edge is dashed (#2563eb) with a filled head, data-planned "true", and
  no label, unless the planned graph marks it as a cycle or as pointing up: then
  it is #dc2626 and keeps the dash, and the 003 tooltip rule wins. In the Now
  view the same edit is only a marker: dashed #2563eb, data-cycle "false",
  data-up "false", tooltip "0 runtime · 0 type-only · 0 extends/implements", and
  it does not turn a box red. A cut marker is a thin dashed #94a3b8 line with a
  "✂" (U+2702) labelled "cut" and data-cut "true"; it is never red. In Now the
  real arrow remains beside that marker.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is a git repository with these files committed:
      | path                | content                                                                                                                                          |
      | tsconfig.json       | {"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}                                                                       |
      | notes/readme.md     | # notes\n                                                                                                                                        |
      | src/app/a.ts        | import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Repo } from '../infra/repo';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\nexport type Use = Repo;\n |
      | src/app/b.ts        | import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n                               |
      | src/app/a.test.ts   | import { a } from './a';\n                                                                                                                       |
      | src/app/save.ts     | export const save = 1;\n                                                                                                                         |
      | src/domain/model.ts | export interface Model { id: number }\n                                                                                                          |
      | src/domain/shape.ts | export interface Shape { draw(): void }\n                                                                                                        |
      | src/infra/db.ts     | import { Model } from '../domain/model';\nexport const query = new Model();\n                                                                    |
      | src/infra/repo.ts   | import { readFileSync } from 'node:fs';\nimport React from 'react';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n |

  Rule: A plan is a document under .bindweed/plans, and the old routes stay
    The slug is the name with surrounding whitespace removed, then lowercased,
    then each run of characters outside a-z and 0-9 replaced by one "-", then
    trimmed of "-", then cut to 40 characters. Trim happens before the cut, so
    the cut may end in "-". A slug that comes out empty is refused. The stored
    name is the trimmed name. A clash appends "-2", "-3", and so on after the
    cut, and the suffix is not itself cut. Deleting a slug frees it. POST
    /api/plans with {"name"} creates the document and answers 201. GET /api/plans
    answers {"plans":[...]} sorted by createdAt then slug, each item name, slug,
    editCount (the edits array's length, not redo) and createdAt. GET and PUT
    and DELETE speak the whole document. PUT of an unknown slug answers 404 and
    creates nothing. A bad POST answers 400 {"error":"bad name"}; a bad PUT
    answers 400 {"error":"bad plan"} and leaves the file's bytes. GET of a file
    that is not a document answers 404 {"error":"no such plan"} and does not
    rewrite it, and the list skips it. DELETE answers 200 {"ok":true}. A missing
    plan answers 404 {"error":"no such plan"}. A slug segment that is not
    ^[a-z0-9]+(?:-[a-z0-9]+)*$ answers the same 404 and never reads outside
    .bindweed/plans/. createdAt is an ISO-8601 UTC string with milliseconds,
    matching \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z. baseCommit is {head}.
    When rev-parse fails, POST answers 400 {"error":"no commit"} and writes
    nothing. An edit is exactly one of:
      | kind      | fields                                                                 |
      | move-file | kind, file, to                                                         |
      | cut-edge  | kind, from, to, files; files is one or more pairs of two strings       |
      | add-edge  | kind, from, to, and from is not to                                     |
      | note      | kind, target, text; target is {node} or {edge:[from,to]}; text non-empty |
    The document's keys are exactly version, name, slug, createdAt,
    baseCommit, edits, redo. version is 1. GET never writes a file.

    Scenario: Creating "Split app" writes an empty plan and does not touch the tree
      When I send "POST /api/plans" with the token and the body {"name":"Split app"}
      Then the status is 201
      And the body has version 1, name "Split app", slug "split-app", edits [] and redo []
      And createdAt matches the ISO pattern above and baseCommit is {head}
      And "GET /api/plans/split-app" with the token returns that same document
      And "GET /api/plans" with the token returns {"plans":[{"name":"Split app","slug":"split-app","editCount":0,"createdAt":"<that createdAt>"}]}
      And the file "/tmp/qa/layered/.bindweed/plans/split-app.json" parses as that document
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      And "GET /api/file?path=src/app/save.ts" with the token returns {"path":"src/app/save.ts","text":"export const save = 1;\n"}

    Scenario: Slugs clash, truncate, and keep a trailing dash from the cut
      When I send "POST /api/plans" with the token and the body {"name":"Split app"}
      And I send "POST /api/plans" with the token and the body {"name":"Split app"}
      And I send "POST /api/plans" with the token and the body {"name":"Split app"}
      Then the three slugs are "split-app", "split-app-2" and "split-app-3"
      And each document's name is "Split app"
      When I send "DELETE /api/plans/split-app" with the token
      Then the status is 200 and the body is {"ok":true}
      And "/tmp/qa/layered/.bindweed/plans/split-app.json" does not exist
      When I send "POST /api/plans" with the token and the body {"name":"Split app"}
      Then the new slug is "split-app"
      When I send "POST /api/plans" with the token and the body {"name":"aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaa x"}
      Then the slug is "aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa-"
      When I send "POST /api/plans" with the token and the body {"name":"aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaa x"}
      Then the slug is "aaaaaaaaaa-aaaaaaaaaa-aaaaaaaaaa-aaaaaa--2"
      When I send "POST /api/plans" with the token and the body {"name":"Łódź plan"}
      Then the slug is "d-plan" and the name is "Łódź plan"
      When I send "POST /api/plans" with the token and the body {"name":"Hello!!!"}
      Then the slug is "hello"

    Scenario Outline: A name that does not slug is refused and writes nothing
      When I send "POST /api/plans" with the token and the body "<body>"
      Then the status is 400 and the body is {"error":"bad name"}
      And "/tmp/qa/layered/.bindweed" does not exist
      Examples:
        | body                          |
        | not json                      |
        | {}                            |
        | {"name":""}                   |
        | {"name":"   "}                |
        | {"name":"!!!"}                |
        | {"name":3}                    |
        | {"name":"Split app","slug":"x"} |

    Scenario: A repository with no commit refuses to create a plan
      Given "/tmp/qa/plain" is a directory containing "src/only.ts" with "export const n = 1;\n" and is not a git repository
      And bindweed is serving "/tmp/qa/plain" on port 5000
      When I send "POST /api/plans" with the token and the body {"name":"Split app"}
      Then the status is 400 and the body is {"error":"no commit"}
      And "/tmp/qa/plain/.bindweed" does not exist

    Scenario: A bad PUT leaves the file, and a corrupt file is skipped
      Given "POST /api/plans" has saved a plan named "Split app"
      When I send "PUT /api/plans/split-app" with the token and the body "not json"
      Then the status is 400 and the body is {"error":"bad plan"}
      And the file's bytes are unchanged
      When I send "PUT /api/plans/missing" with the token and this body:
        """
        {"version":1,"name":"Missing","slug":"missing","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[]}
        """
      Then the status is 404 and the body is {"error":"no such plan"}
      And "/tmp/qa/layered/.bindweed/plans/missing.json" does not exist
      Given the file "/tmp/qa/layered/.bindweed/plans/split-app.json" contains exactly the bytes of "not json"
      When I send "GET /api/plans/split-app" with the token
      Then the status is 404 and the body is {"error":"no such plan"}
      And the file still contains exactly those bytes
      And "GET /api/plans" with the token returns {"plans":[]}

    Scenario Outline: A document that is not a plan is refused
      Given "POST /api/plans" has saved a plan named "Split app"
      When I send "PUT /api/plans/split-app" with the token and the body "<body>"
      Then the status is 400 and the body is {"error":"bad plan"}
      And the file's bytes are unchanged
      Examples:
        | body |
        | {"version":2,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"other","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[]} |
        | {"version":1,"name":"","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"yesterday","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"abc","edits":[],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"add-edge","from":"src/app","to":"src/app"}],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"note","target":{"node":"src/domain"},"text":""}],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"cut-edge","from":"src/app","to":"src/domain","files":[]}],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"fold","file":"src/app/save.ts"}],"redo":[]} |
        | {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[],"redo":[],"extra":1} |

    Scenario: The new routes keep the host and token checks, and the old routes still answer
      When I send "GET /api/plans/Split-App" with the token
      Then the status is 404 and the body is {"error":"no such plan"}
      When I send "GET /api/tree" with the token
      Then the status is 200 and the entries at the top level are "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then the status is 200 and the body is {"path":"src/domain/model.ts","text":"export interface Model { id: number }\n"}
      When I send "GET /api/graph?at=notes" with the token
      Then the status is 404 and the body is {"error":"no such directory"}
      When I send "GET /api/graph?at=src&plan=missing" with the token
      Then the status is 404 and the body is {"error":"no such plan"}
      When I send "GET /api/detail?id=missing&at=src" with the token
      Then the status is 404 and the body is {"error":"no such node"}
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      And "/tmp/qa/layered/.bindweed/layout.json" does not exist
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 8 and "ms" a number

    Scenario Outline: Host, token and method
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                 | credentials                          | status | body                               |
        | GET /api/plans          | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans         | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/plans/split-app | no header of my own                 | 401    | {"error":"missing or wrong token"} |
        | PUT /api/plans/split-app | no header of my own                 | 401    | {"error":"missing or wrong token"} |
        | DELETE /api/plans/split-app | no header of my own              | 401    | {"error":"missing or wrong token"} |
        | GET /api/plans?token={token} | the header "Host: evil.example:5000" | 403 | {"error":"bad host"}            |
        | POST /api/plans/split-app | the token                          | 404    | {"error":"not found"}              |
        | DELETE /api/plans       | the token                            | 404    | {"error":"not found"}              |
        | GET /api/graph          | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/tree           | no header of my own                  | 401    | {"error":"missing or wrong token"} |

    Scenario: The README lists the plan route beside the old ones
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route         | status |
        | `/api/tree`   | live   |
        | `/api/file`   | live   |
        | `/api/graph`  | live   |
        | `/api/rescan` | live   |
        | `/api/layout` | live   |
        | `/api/detail` | live   |
        | `/api/plans`  | live   |

  Rule: applyPlan builds the planned graph and skips a stale edit
    applyPlan(scan, edits) in src/domain returns the scan after the non-stale
    edits, in order. Each edit sees the paths the earlier non-stale edits left.
    A move puts the file at its new path and keeps its imports and importers.
    A cut removes exactly the listed file pairs. An added edge is a planned edge
    between those two nodes and has no file. A note changes nothing in the scan.
    A planned edge does not change Ca, Ce, I, A, D, zone, CRAP, coverage or
    mutants. GET /api/graph and GET /api/detail with plan=<slug> return the 004
    view of that scan, plus "planned":true on an added edge. Without the query,
    or with plan empty, the plan is not applied. An unknown slug is 404
    {"error":"no such plan"}. staleReasons(scan, edits) in src/domain returns
    one entry per edit, null when it applies, otherwise the first reason below.
    The plan file is not rewritten with that reason.
    A move is stale when its file is gone ("no such file <file>"), when "to" is
    not the root and not an ancestor of a scanned file ("no such directory <to>"),
    or when the destination path is already a scanned file ("<dest> already exists").
    A move onto the file's own directory is not stale and changes nothing.
    A cut or an add or a note is stale when a named box is gone ("no such box <path>",
    from before to). A cut is then stale when a listed path is gone ("no such file <path>")
    or a listed pair is no longer an edge ("<importer> no longer imports <imported>").
    An add is stale when that edge is already in the planned graph, file or
    planned ("<from> already imports <to>"). A note on an edge is stale when
    that arrow is neither in the planned graph nor a non-stale cut's from/to
    ("no such arrow <from> → <to>").

    Scenario: With no plan query the src view is the 004 view plus save.ts
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"crapMax":4,"coverage":"off","mutation":"off","nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":3,"row":0,"order":0,"cycle":false,"ca":0,"ce":2,"i":"1.00","a":"0.00","d":"0.00","zone":"healthy"},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":2,"row":1,"order":0,"cycle":false,"ca":2,"ce":2,"i":"0.50","a":"0.00","d":"0.50","zone":"healthy"},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":2,"row":2,"order":0,"cycle":false,"abstract":true,"ca":3,"ce":0,"i":"0.00","a":"1.00","d":"0.00","zone":"healthy"}],"edges":[{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]}
        """
      When I send "GET /api/graph" with the token
      Then the only node is "src" and it has files 7, ca 0, ce 0, i "–", a "0.29", d "–" and no zone field
      And it has no crap, coverage or mutants field
      When I send "GET /api/graph?at=src&plan=" with the token
      Then the body is the same as "GET /api/graph?at=src"

    Scenario: The three edits move save.ts, drop the domain import, and add a cycle
      Given "PUT /api/plans/split-app" has saved the plan "Split app" with these edits, in order, and redo []:
        | kind      | body |
        | move-file | {"kind":"move-file","file":"src/app/save.ts","to":"src/infra"} |
        | cut-edge  | {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]} |
        | add-edge  | {"kind":"add-edge","from":"src/infra","to":"src/app"} |
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"crapMax":4,"coverage":"off","mutation":"off","nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":2,"row":0,"order":0,"cycle":true,"ca":0,"ce":2,"i":"1.00","a":"0.00","d":"0.00","zone":"healthy"},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":3,"row":0,"order":1,"cycle":true,"ca":2,"ce":2,"i":"0.50","a":"0.00","d":"0.50","zone":"healthy"},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":2,"row":1,"order":0,"cycle":false,"abstract":true,"ca":2,"ce":0,"i":"0.00","a":"1.00","d":"0.00","zone":"healthy"}],"edges":[{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":true,"cycleText":"app → infra → app"},{"from":"src/infra","to":"src/app","runtime":0,"type":0,"planned":true,"cycle":true,"cycleText":"infra → app → infra"},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]}
        """
      And no edge runs from "src/app" to "src/domain"
      When I send "GET /api/detail?id=src/domain&at=src&plan=split-app" with the token
      Then the body has files 2, abstract true, ca 2, ce 0, i "0.00", a "1.00", d "0.00" and zone "healthy"
      And "imports" is empty and the only "importedBy" entry is "src/infra" with runtime 2, type 0 and heritage 1
      When I send "GET /api/detail?id=src/domain&at=src" with the token
      Then the body has ca 3
      And "importedBy" holds "src/app" with runtime 0, type 1 and heritage 0, and "src/infra" with runtime 2, type 0 and heritage 1
      When I send "GET /api/graph?at=src/infra&plan=split-app" with the token
      Then the only nodes are "db.ts" at order 0, "repo.ts" at order 1 and "save.ts" at order 2, all at row 0, and there is no edge
      And "save.ts" has ca 0, ce 0, i "–", a "0.00", d "–" and no zone field
      When I send "GET /api/file?path=src/infra/save.ts" with the token
      Then the status is 404 and the body is {"error":"no such file"}
      And the file "src/app/save.ts" still holds "export const save = 1;\n"

    Scenario: Moving b.ts keeps both directions of its imports
      Given the plan "Split app" has the only edit {"kind":"move-file","file":"src/app/b.ts","to":"src/infra"}
      When I send "GET /api/detail?id=src/infra/b.ts&at=src/infra&plan=split-app" with the token
      Then the status is 200 and the path is "src/infra/b.ts"
      And "imports" holds "src/app/a.ts" with runtime 1, type 0 and heritage 0, and "src/infra/db.ts" with runtime 1, type 0 and heritage 0
      And the only "importedBy" entry is "src/app/a.ts" with runtime 1, type 0 and heritage 0
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the edge from "src/infra" to "src/app" has runtime 1, type 0, cycle true and no planned field
      And the edge from "src/app" to "src/infra" has runtime 2, type 1 and cycle true
      And "src/app" has files 2 and "src/infra" has files 3

    Scenario: A cut removes only the pairs it lists
      Given the plan "Split app" has the only edit {"kind":"cut-edge","from":"src/app","to":"src/infra","files":[["src/app/a.ts","src/infra/db.ts"]]}
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the edge from "src/app" to "src/infra" has runtime 1 and type 1
      And the edge from "src/app" to "src/domain" is still present with runtime 0 and type 1

    Scenario: A note does not change the graph, and a stale move is skipped and kept
      Given the plan "Split app" has the only edit {"kind":"note","target":{"node":"src/domain"},"text":"pull an interface out here"}
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the body equals "GET /api/graph?at=src"
      Given the plan "Split app" has the only edit {"kind":"move-file","file":"src/app/missing.ts","to":"src/infra"}
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the body equals "GET /api/graph?at=src"
      And "GET /api/plans/split-app" still has that edit and no stale field
      When I send "POST /api/rescan" with the token
      Then "GET /api/plans/split-app" is unchanged

  Rule: The page opens a plan, draws it, and saves every change at once
    The Plan combobox lists "No plan" and each plan. Two plans with the same
    name label the later ones "<name> (<slug>)". "New plan…" opens the dialogue;
    Create trims the name and POSTs it; an empty name shows "write a name" and
    does not POST; Cancel closes. "Delete plan" is disabled with no plan open.
    It confirms "Delete <name>?"; Cancel keeps the plan; Delete removes it and
    leaves no plan open. The open slug is written "&plan=<slug>" after the at
    parameter. "#at=src" with no plan parameter opens no plan. The hash the page
    writes with a plan open on src is "#at=src&plan=<slug>". Choosing Now or
    Planned is not written to the hash or the plan. Opening or switching a plan
    selects Planned.
    The change list shows one entry per edit, top to bottom, in order. The
    sentences are "Move <file> to <to>" (a root target is "."), "<from> must not
    import <to> (<n> import)" or "imports" when n is not 1, "<from> should use
    <to>", and "Note on <node>: \"<text>\"" or "Note on <from> → <to>: \"<text>\"".
    n is the number of pairs. A stale entry keeps its sentence, adds the reason,
    carries data-stale "true", and its background is rgb(254, 249, 195).
    Clicking the sentence selects and centres the target, drilling to the parent
    view when the target is not a box here. A move's target is the file's path
    after the non-stale moves up to and including itself. A stale sentence whose
    target is gone does not navigate, and the notice shows the reason. The "×"
    button is named "Remove" and removes that edit only. It does not push redo
    and does not clear redo. Later edits that no longer apply stay, marked stale.
    Undo (the button or Ctrl+Z) moves the last edit onto the end of redo. Redo
    (the button or Ctrl+Shift+Z) moves it back. Either key does nothing in an
    input, a textarea, or a select, and nothing when its stack is empty. A new
    edit clears redo. Every one of these saves the whole plan at once.
    The Menu button is on the selected box or arrow, and only while a plan is
    open. A box menu has "Add note". An arrow menu has "Cut" and "Add note".
    Delete on a selected arrow cuts it; Delete on a box does nothing. Cut and
    Delete store one cut-edge whose files are every underlying file pair of that
    arrow, one entry per importer and imported however many kinds that import
    has, tests and externals included only while their checkbox is on, pairs
    sorted by importer then imported. Cutting an arrow that is not in the
    planned graph shows the notice "no such arrow <from> → <to>" and stores
    nothing. A draw handle labelled "Draw dependency" sits on each box only
    while a plan is open. Dropping it on the same box shows "a box cannot depend
    on itself". Dropping it on a box the planned graph already joins shows
    "<from> already imports <to>". Neither stores an edit, and neither clears
    redo. Add note refuses an empty text with "write a note". A successful edit
    clears the notice. Double-clicking a file still opens its on-disk path in
    the Files tab; a moved file's on-disk path is the path before the moves. A
    ghost does not open. Returning from the Files tab writes the open plan back
    into the hash. A reload of a file hash opens no plan.

    Scenario: With no plan open the canvas still pins, and the plan chrome is idle
      When I open "http://127.0.0.1:5000/?token={token}#at=src" in a browser
      Then the address bar shows "http://127.0.0.1:5000/#at=src"
      And the Plan combobox shows "No plan" and "Delete plan" is disabled
      And the "Shown graph" switch is not shown and the changes region is not shown
      And no box has a file row, a "Draw dependency" handle or a "Menu" button
      And the "app" box reads "3 files", the "infra" box reads "2 files" and the "domain" box reads "2 files"
      And "domain" is green and no box carries data-cycle "true"
      And the "CRAP" option is disabled and its tooltip is "no coverage data: run marestail gate"
      When I drag the "domain" box until its top is at least one box height above the "app" box and drop it
      Then the "domain" box stays where it was dropped
      And "GET /api/plans" returns {"plans":[]}
      When I click "Reset layout"
      Then "app" is above "infra" and "infra" is above "domain"
      When I open "http://127.0.0.1:5000/?token={token}#at=src&plan=missing" in a browser
      Then the canvas shows "no such plan" and the Plan combobox shows "No plan"
      When I choose "No plan"
      Then the address bar shows "http://127.0.0.1:5000/#at=src" and the "app" box reads "3 files"

    Scenario: New plan asks for a name, and Cancel and an empty name write nothing
      Given the Architecture tab shows the "src" view and no plan is open
      When I click "New plan…" and then "Cancel"
      Then the dialogue is not shown and "GET /api/plans" returns {"plans":[]}
      When I click "New plan…" and click "Create" with the name empty
      Then the dialogue shows "write a name" and "GET /api/plans" returns {"plans":[]}
      When I type "Split app" and click "Create"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=split-app"
      And the Plan combobox shows "Split app" and "Planned" is selected
      And the changes region is shown and has no entry
      And the "app" box lists the rows "a.ts", "b.ts" and "save.ts"

    Scenario: Dragging save.ts onto infra ghosts it in app and leaves the disk alone
      Given the plan "Split app" is open on the "src" view
      When I drag the "save.ts" row of "app" onto the "app" box
      Then the changes region has no entry
      When I drag the "save.ts" row of "app" onto the "infra" box
      Then the only entry reads "Move src/app/save.ts to src/infra"
      And the "infra" box reads "3 files" and lists "db.ts", "repo.ts" and "save.ts"
      And the "app" box reads "2 files", lists "a.ts" and "b.ts", and has a ghost row "save.ts"
      And "GET /api/plans/split-app" has the one edit {"kind":"move-file","file":"src/app/save.ts","to":"src/infra"} and redo []
      And "src/app/save.ts" still holds "export const save = 1;\n" and "src/infra/save.ts" does not exist
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      When I click that entry
      Then the address bar shows "http://127.0.0.1:5000/#at=src/infra&plan=split-app"
      And the "save.ts" box carries data-selected "true", data-x 520 and data-y 0
      When I open the "src/app" view
      Then the "a.ts" box has data-x 0 and data-y 0, the "b.ts" box has data-x 260 and data-y 0, and a ghost box "save.ts" has data-x 520 and data-y 0

    Scenario: A breadcrumb drop moves the file to that directory, and Undo takes it back
      Given the plan "Split app" is open on the "src/app" view and the change list is empty
      When I drag the "save.ts" box onto the "src" breadcrumb
      Then the only entry reads "Move src/app/save.ts to src"
      And "GET /api/plans/split-app" has the edit {"kind":"move-file","file":"src/app/save.ts","to":"src"}
      When I click "Undo"
      Then the changes region has no entry and the "save.ts" box is back in the "src/app" view

    Scenario: Cutting app to domain records the one file pair and draws a scissors
      Given the plan "Split app" is open on the "src" view and save.ts has been moved onto infra
      When I click the arrow from "app" to "domain" and press Delete
      Then the changes region ends with "src/app must not import src/domain (1 import)"
      And there is a cut marker from "src/app" to "src/domain" and no ordinary arrow between those boxes
      And "GET /api/plans/split-app" has a second edit {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}
      When I click the "infra" to "domain" arrow and choose "Cut" from its menu
      Then a new entry reads "src/infra must not import src/domain (2 imports)"
      When I click "Undo"
      Then that entry is gone and the "app" to "domain" cut marker remains

    Scenario: Drawing infra to app cycles in red, and a repeat or a self-drop is refused
      Given the plan "Split app" is open on the "src" view, save.ts has been moved onto infra, and the app to domain arrow has been cut
      When I drag the "Draw dependency" handle of "infra" onto the "app" box
      Then the changes region ends with "src/infra should use src/app"
      And the "app" box and the "infra" box carry data-cycle "true" and are red
      And the "app" box has data-x 0 and data-y 0 and the "infra" box has data-x 260 and data-y 0
      And the "domain" box has data-x 0 and data-y 140, carries data-cycle "false", and is green
      And the arrow from "infra" to "app" carries data-planned "true", data-line "dashed", data-cycle "true" and data-up "false", is #dc2626, and its tooltip is "infra → app → infra"
      And the arrow from "app" to "infra" is #dc2626, is labelled "3", and its tooltip is "app → infra → app"
      When I drag the "Draw dependency" handle of "infra" onto the "app" box again
      Then the notice reads "src/infra already imports src/app" and the changes region still has three entries
      When I drag the "Draw dependency" handle of "app" onto the "app" box
      Then the notice reads "a box cannot depend on itself" and the changes region still has three entries

    Scenario: Undo and Redo move the cycle, and a new edit clears the redo stack
      Given the plan "Split app" is open on the "src" view with the move of save.ts, the cut of app to domain, and the added edge from infra to app saved
      When I press Ctrl+Z
      Then the entry "src/infra should use src/app" is gone
      And no box carries data-cycle "true" and no arrow is #dc2626
      And the "app" box has data-y 0, the "infra" box has data-y 140 and the "domain" box has data-y 280
      And "GET /api/plans/split-app" has two edits and redo holding the add-edge
      When I press Ctrl+Shift+Z
      Then the entry "src/infra should use src/app" is back and the "app" box and the "infra" box are red
      When I press Ctrl+Z and then add the note "pull an interface out here" on "domain"
      Then the changes region ends with "Note on src/domain: \"pull an interface out here\""
      And it has no entry "src/infra should use src/app"
      And Ctrl+Shift+Z does not bring that entry back
      And "GET /api/plans/split-app" has redo []

    Scenario: A note shows on the box and on the arrow, and an empty note is refused
      Given the plan "Split app" is open on the "src" view
      When I choose "Add note" on the "domain" box and click "Add" with the text empty
      Then the dialogue shows "write a note" and the changes region has no entry
      When I type "pull an interface out here" and click "Add"
      Then the "domain" box has a marker labelled "note" whose title is "pull an interface out here"
      And the last entry reads "Note on src/domain: \"pull an interface out here\""
      When I choose "Add note" on the arrow from "app" to "infra" and type "keep this"
      Then that arrow has a marker labelled "note" whose title is "keep this"
      And the last entry reads "Note on src/app → src/infra: \"keep this\""

    Scenario: Now shows the current graph with the markers, and the metrics follow
      Given the plan "Split app" is open on the "src" view with the move, the cut, the added edge and the domain note saved
      When I choose "Now"
      Then the "app" box has data-x 0 and data-y 0 and reads "3 files", and lists "a.ts", "b.ts" and "save.ts"
      And the "infra" box has data-x 0 and data-y 140, reads "2 files", and has a ghost row "save.ts"
      And the "domain" box has data-x 0 and data-y 280 and no box carries data-cycle "true"
      And the ordinary arrow from "app" to "domain" is still drawn, and a cut marker from "src/app" to "src/domain" is also drawn
      And the arrow from "infra" to "app" is #2563eb, carries data-planned "true", data-cycle "false" and data-up "false", and its tooltip is "0 runtime · 0 type-only · 0 extends/implements"
      And the "domain" note marker is shown
      When I click "Metrics"
      Then the rows are "infra", "app", "domain"
      And the "app" row reads Files 3, Ca 0, Ce 2, I 1.00, A 0.00, D 0.00, Zone healthy, CRAP "–", Coverage "–", Mutants "–"
      And the "domain" row reads Files 2, Ca 3, Ce 0, I 0.00, A 1.00, D 0.00, Zone healthy, CRAP "–", Coverage "–", Mutants "–"
      When I choose "Planned" and click "Metrics"
      Then the "app" row reads Files 2 and the "domain" row reads Ca 2
      And the "infra" row reads Files 3, Ca 2, Ce 2, I 0.50, A 0.00, D 0.50
      When I click the "domain" box
      Then under "Imported by" the only button is "infra"

    Scenario: Removing the move stales the note on the moved file and leaves the rest
      Given the plan holds the move of save.ts, the cut, the added edge, the domain note, and then {"kind":"note","target":{"node":"src/infra/save.ts"},"text":"keep the writer here"}
      When the "src" view of that plan is open
      Then the last entry reads "Note on src/infra/save.ts: \"keep the writer here\""
      When I click "Remove" on the entry "Move src/app/save.ts to src/infra"
      Then that entry is gone
      And the entry "Note on src/infra/save.ts: \"keep the writer here\"" carries data-stale "true", its background is rgb(254, 249, 195), and it shows "no such box src/infra/save.ts"
      And the entries for the cut, the added edge and the domain note do not carry data-stale
      And the "app" box and the "infra" box are still red
      And "GET /api/plans/split-app" has those four remaining edits and does not contain "move-file"

    Scenario: A rescan marks an edit whose file is gone, and restoring the file clears it
      Given the plan "Split app" is open with the move of save.ts saved
      And the file "src/app/save.ts" is deleted from the repository
      When I click "Rescan"
      Then the move entry carries data-stale "true" and shows "no such file src/app/save.ts"
      And "GET /api/plans/split-app" still has the move edit and no stale field
      Given "src/app/save.ts" is restored to "export const save = 1;\n"
      When I click "Rescan"
      Then the move entry does not carry data-stale
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: The plan survives a reload and a restart, and a file hash does not open it
      Given the plan "Split app" is open on the "src" view with the move, the cut, the added edge and the domain note saved
      When I reload the page
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=split-app"
      And "Planned" is selected, the four entries are shown, and the "app" box and the "infra" box are red
      And the "domain" note marker's title is "pull an interface out here"
      When I open "http://127.0.0.1:5000/#file=src/app/a.ts" in a browser
      Then "Files" carries aria-selected "true" and no plan is applied
      When I stop bindweed and start it again on "/tmp/qa/layered"
      And I open the newly printed link with "#at=src&plan=split-app"
      Then the token differs from the one before the restart
      And the four entries are shown and the "infra" box lists "save.ts"
      When I double-click the "save.ts" row of "infra"
      Then "Files" carries aria-selected "true" and the right side shows the header "src/app/save.ts" and the line "export const save = 1;"
      When I click "Architecture"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=split-app"

    Scenario: Delete asks, and a second "Split app" is split-app-2
      Given the plan "Split app" is open
      When I click "Delete plan" and then "Cancel"
      Then the combobox shows "Split app" and the address bar contains "plan=split-app"
      When I click "Delete plan" and then "Delete"
      Then the dialogue is not shown and the combobox shows "No plan"
      And the address bar shows "http://127.0.0.1:5000/#at=src"
      And the "app" box reads "3 files" and has no file row
      And "GET /api/plans/split-app" answers 404 {"error":"no such plan"}
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      When I create a plan named "Split app" and then another named "Split app"
      Then the combobox offers "Split app" and "Split app (split-app-2)"
      When I choose "Split app (split-app-2)"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=split-app-2"
