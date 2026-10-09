Feature: reshape a plan by creating, renaming, merging and splitting packages, and by renaming, deleting or folding files
  A developer can do more than move a file. The planned view and the change list
  show the new packages, names, deletions and folds, and a warning sits under the
  edit that leaves something dangling. Nothing in the repository changes.

  The repository, server, token, {head} and the 005 edit rules are the Background
  and the Rules of features/plan-moves-and-edges.feature. version stays 1. A plan
  written by 005 still parses, and its move, cut, add and note sentences stay
  those sentences. The kind "fold" is still refused. Undo, redo and remove work
  as they do there. The en dash in a metric is U+2013. The ellipsis in "Fold into…"
  is U+2026.

  Assumptions the scenarios rely on. The tree is that 005 tree, not the four-file
  qa/fixtures/layered, because this task names src/domain/shape.ts. A name is one
  segment matching ^[A-Za-z0-9._-]+$, and "." and ".." are refused even so. A
  package rename stores both full paths and only the last segment differs. A file
  rename stores the new file name only. The dialogue appends the old last
  extension, including the dot, when the typed name has no dot; the stored name
  is what the dialogue decided. Parts of a split are <package>/<name>, drawn in
  the original's place once the plan empties it (see the applyPlan rule). With
  no plan, and in Now, grouping is unchanged. Merge keeps the path of each file relative to its own
  package. A deleted file stays, struck through, and its edges stay. A fold
  removes the file, points its edges and its external imports at "into", and
  drops an edge whose ends become the same file. There is no ghost for a fold.
  Warnings come from the graph response. The page does not invent them. The key
  "warnings" is absent when every edit has none, so a 005 plan that adds no cycle
  keeps that feature's graph body. A 005 plan that does add a cycle gains the key.

  Background:
    Given the Background of features/plan-moves-and-edges.feature

  Rule: the new edits are documents, and the old routes still answer
    An edit is one of the 005 kinds or exactly one of these, with no extra key:
      | kind            | fields                                                                 |
      | create-package  | kind, path; every segment is a name                                    |
      | rename-package  | kind, from, to; same parent; both last segments are names; from is not to |
      | rename-file     | kind, from, to; to is a single name                                    |
      | merge-packages  | kind, packages, into; packages has two or more distinct paths, none inside another |
      | split-package   | kind, package, parts; two or more parts; each part is name and files; names are unique and legal; no file is listed twice; files may be empty |
      | fate            | kind, file, fate "delete", and no into; or fate "fold", into a different file |
    sentenceOf is the 005 sentence for a 005 edit, and otherwise:
      | edit | sentence |
      | {"kind":"create-package","path":"src/ports"} | Create package src/ports |
      | {"kind":"rename-package","from":"src/util","to":"src/text"} | Rename src/util to src/text |
      | {"kind":"rename-file","from":"src/app/x.ts","to":"y.ts"} | Rename src/app/x.ts to y.ts |
      | {"kind":"merge-packages","packages":["src/io","src/net"],"into":"src/infra"} | Merge src/io and src/net into src/infra |
      | {"kind":"merge-packages","packages":["src/app","src/domain","src/infra"],"into":"src/core"} | Merge src/app, src/domain and src/infra into src/core |
      | {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.ts","src/app/b.ts","src/app/c.ts","src/app/d.ts"]},{"name":"write","files":["src/app/e.ts","src/app/f.ts","src/app/g.ts"]}]} | Split src/app into src/app/read (4 files) and src/app/write (3 files) |
      | {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.ts"]},{"name":"write","files":["src/app/b.ts"]}]} | Split src/app into src/app/read (1 file) and src/app/write (1 file) |
      | {"kind":"fate","file":"src/legacy.ts","fate":"delete"} | Delete src/legacy.ts |
      | {"kind":"fate","file":"src/helpers.ts","fate":"fold","into":"src/text/format.ts"} | Fold src/helpers.ts into src/text/format.ts |
    Three or more parts use the same comma join as three packages. The count is
    the files array's length, tests included. PUT of a bad edit answers 400
    {"error":"bad plan"} and leaves the file's bytes. GET /api/plans returns the
    document with no warnings and no stale field.

    Scenario: A 005 plan loads unchanged and warns about the cycle it adds
      Given "PUT /api/plans/split-app" has saved the plan "Split app" with these edits, in order, and redo []:
        | kind      | body |
        | move-file | {"kind":"move-file","file":"src/app/save.ts","to":"src/infra"} |
        | cut-edge  | {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]} |
        | add-edge  | {"kind":"add-edge","from":"src/infra","to":"src/app"} |
      When I send "GET /api/plans/split-app" with the token
      Then the document's edits are those three, in that order, and it has no warnings field and no stale field
      And the sentences are "Move src/app/save.ts to src/infra", "src/app must not import src/domain (1 import)" and "src/infra should use src/app"
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then every key except "warnings" equals the body in "The three edits move save.ts, drop the domain import, and add a cycle" in features/plan-moves-and-edges.feature
      And "warnings" is [[], [], [{"kind":"added-cycle","cycle":"app → infra → app"}]]
      When I send "GET /api/graph?plan=split-app" with the token
      Then the only node is "src" and it has files 7

    Scenario Outline: A document that is not one of these edits is refused
      Given "POST /api/plans" has saved a plan named "Reshape"
      When I send "PUT /api/plans/reshape" with the token and the body "<body>"
      Then the status is 400 and the body is {"error":"bad plan"}
      And the file's bytes are unchanged
      Examples:
        | body |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"fold","file":"src/app/save.ts"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"create-package","path":"src/../ports"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"rename-package","from":"src/infra","to":"lib/adapters"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"rename-file","from":"src/app/a.ts","to":"src/app/b.ts"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"merge-packages","packages":["src/app"],"into":"src/app"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.ts"]}]}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"fate","file":"src/app/save.ts","fate":"fold"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"fate","file":"src/app/save.ts","fate":"delete","into":"src/app/a.ts"}],"redo":[]} |
        | {"version":1,"name":"Reshape","slug":"reshape","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"fate","file":"src/app/a.ts","fate":"fold","into":"src/app/a.ts"}],"redo":[]} |

    Scenario: The old routes still answer on this tree
      When I send "GET /api/tree" with the token
      Then the status is 200 and the entries at the top level are "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/shape.ts" with the token
      Then the status is 200 and the body is {"path":"src/domain/shape.ts","text":"export interface Shape { draw(): void }\n"}
      When I send "GET /api/graph?at=src" with the token
      Then the body is the no-plan src body from features/plan-moves-and-edges.feature and it has no "warnings" key and no "stale" key
      When I send "GET /api/graph" with the token
      Then the only node is "src" and it has files 7, a "0.29" and no "warnings" key
      When I send "GET /api/graph?at=notes" with the token
      Then the status is 404 and the body is {"error":"no such directory"}
      When I send "GET /api/detail?id=src/domain&at=src" with the token
      Then the status is 200 and the body has ca 3
      When I send "GET /api/pairs?from=src/app&to=src/infra&at=src" with the token
      Then the body is {"pairs":[["src/app/a.ts","src/infra/db.ts"],["src/app/a.ts","src/infra/repo.ts"],["src/app/b.ts","src/infra/db.ts"]]}
      When I send "GET /api/pairs?from=src/infra&to=react&at=src&external=1" with the token
      Then the body is {"pairs":[["src/infra/repo.ts","react"]]}
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 8
      When I send "GET /api/plans" with the token
      Then the status is 200 and the body is {"plans":[]}
      And "git status --porcelain" in "/tmp/qa/layered" is empty

  Rule: applyPlan applies the new edits in order and warns about what is left
    Each edit sees the paths the earlier non-stale edits left. The walk keeps a
    set of declared packages: a create adds its path and a split adds each part
    path; a package rename renames every declared path at or under "from"; a
    merge drops each listed package other than "into". A known package is an
    ancestor directory of a file in the scan so far, or a declared package. A
    path is taken when it is a scanned file or a known package. A move may
    target a declared package. A declared package with no file is still in the
    planned graph and is drawn with files 0, ca 0, ce 0, i "–", a "0.00",
    d "–", no zone and no abstract, where a file directly in it would be
    grouped. A rename moves every file under "from" to the same relative path
    under "to", and edges and external imports follow, as they do for a move.
    A merge moves each file to "into" plus its path relative to its own
    package. A split moves each listed file to <package>/<part>/<path relative
    to package>; an unlisted file stays. A fate delete draws the file and keeps
    its edges; the mark follows the file through later moves and renames. A
    fate fold deletes the file from the scan after the retarget.
    Grouping with a plan query adds one step, the same in graph, detail and
    pairs: a package that has a file directly in it in the current scan, has
    none in the planned scan, and still has a file or a declared package under
    it is not a node; its child packages are nodes in its place, repeated
    while a child qualifies. So after the split "src" shows "src/app/read" and
    "src/app/write" and no "src/app", and after the merge back "src/app" is one
    node again. The root view still has the one node "src".
    An edit is stale when the first of its checks fails, and the reason is:
      | kind           | checks, in order                                                                                       |
      | create-package | parent not "." and not known: "no such directory <parent>"; path taken: "<path> already exists"         |
      | rename-package | "from" not known: "no such directory <from>"; "to" taken: "<to> already exists"                         |
      | rename-file    | "from" not a file: "no such file <from>"; <parent of from>/<to> taken: "<that path> already exists"     |
      | merge-packages | first listed package not known: "no such directory <p>"; "into" a file, or a file outside the listed packages under it: "<into> already exists"; two files landing on one path: "<that path> already exists" |
      | split-package  | package not known: "no such directory <package>"; first listed file not a file under it: "no such file <f>"; first part path taken: "<part path> already exists" |
      | fate delete    | file not a file: "no such file <file>"; already deleted: "<file> is already deleted"                   |
      | fate fold      | file not a file: "no such file <file>"; into not a file: "no such file <into>"                          |
    "warnings" is one array per edit. An empty entry is []. The objects are
    {"kind":"empty-package","path"} for a declared package still in the
    planned graph with no file at the end, on the edit that declared it, with
    its final path; a package a later merge or rename removed does not warn.
    {"kind":"deleted-imports","file","importers"} for a delete
    whose file is still imported, and {"kind":"added-cycle","cycle"} for a cycle
    text the planned graph draws and the current graph does not. Importers are
    the distinct files with an edge to the deleted file, tests included, sorted
    by path. A cycle that is only the current a.ts ↔ b.ts cycle is not new.
    Two texts of one pair of boxes are one warning, the lexicographically
    smaller text. A warning sits on the earliest edit that introduces it and
    only if it is still true at the end. Empty packages are listed before
    cycles, each group sorted by its text. A stale edit is not applied and
    warns nothing. The shown sentences are "src/ports is empty",
    "1 file still imports src/app/save.ts, which this plan deletes" when one
    file imports it, "2 files still import src/domain/model.ts, which this plan
    deletes" when two do, and "this plan adds a cycle: read → write → read".

    Scenario: An empty src/ports warns, and the move of shape.ts clears it
      Given the plan "Reshape" has these edits, in order:
        | kind           | body |
        | create-package | {"kind":"create-package","path":"src/ports"} |
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null] and "warnings" is [[{"kind":"empty-package","path":"src/ports"}]]
      And "src/ports" has files 0, row 2, order 1, cycle false, ca 0, ce 0, i "–", a "0.00", d "–" and no zone and no abstract
      And "src/app", "src/infra" and "src/domain" and the three edges equal "GET /api/graph?at=src"
      And "src/ports" does not exist on disk and "src/domain/shape.ts" still holds "export interface Shape { draw(): void }\n"
      Given the plan "Reshape" also has {"kind":"move-file","file":"src/domain/shape.ts","to":"src/ports"}
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null] and there is no "warnings" key
      And "src/domain" has files 1, abstract true, ca 2 and row 2 order 0
      And "src/ports" has files 1, abstract true, ca 1, ce 0, i "0.00", a "1.00", d "0.00", zone "healthy", row 2 and order 1
      And the edge from "src/infra" to "src/domain" has runtime 1 and type 0 and no heritage
      And the edge from "src/infra" to "src/ports" has runtime 1, type 0 and heritage 1
      When I send "GET /api/file?path=src/ports/shape.ts" with the token
      Then the status is 404 and the body is {"error":"no such file"}

    Scenario: Renaming the empty package chains into the move
      Given the plan "Reshape" has these edits, in order:
        | kind           | body |
        | create-package | {"kind":"create-package","path":"src/ports"} |
        | rename-package | {"kind":"rename-package","from":"src/ports","to":"src/hex"} |
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null] and "warnings" is [[{"kind":"empty-package","path":"src/hex"}], []]
      And there is no node "src/ports" and "src/hex" has files 0
      Given the plan also has {"kind":"move-file","file":"src/domain/shape.ts","to":"src/hex"}
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null, null] and there is no "warnings" key
      And "src/hex" has files 1 and abstract true
      And the sentences are "Create package src/ports", "Rename src/ports to src/hex" and "Move src/domain/shape.ts to src/hex"

    Scenario: Splitting app hides it and warns about the new cycle
      Given the plan "Reshape" has the create of "src/ports", the move of shape.ts into it, the rename of "src/infra" to "src/adapters", and this split:
        | kind          | body |
        | split-package | {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.test.ts","src/app/a.ts"]},{"name":"write","files":["src/app/b.ts","src/app/save.ts"]}]} |
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then there is no node "src/app" and no node "src/infra"
      And "src/app/read" has files 1, row 0, order 0, cycle true, ca 1, ce 1, i "0.50", a "0.00", d "0.50" and zone "healthy"
      And "src/app/write" has files 2, row 0, order 1 and cycle true
      And "src/adapters" has files 2, row 1, order 0 and cycle false
      And "src/domain" has row 2 order 0 and "src/ports" has row 2 order 1
      And the edge from "src/app/read" to "src/app/write" has runtime 1, cycle true and cycleText "read → write → read"
      And the edge from "src/app/write" to "src/app/read" has cycleText "write → read → write"
      And "warnings" is [[], [], [], [{"kind":"added-cycle","cycle":"read → write → read"}]]
      And the split sentence is "Split src/app into src/app/read (2 files) and src/app/write (2 files)"
      When I send "GET /api/graph?at=src/app&plan=reshape" with the token
      Then the only nodes are "src/app/read" and "src/app/write"
      When I send "GET /api/graph?plan=reshape" with the token
      Then the only node is "src" and it has files 7
      When I send "GET /api/graph?at=src" with the token
      Then the body is the no-plan src body from features/plan-moves-and-edges.feature

    Scenario: A split part that stays empty is drawn and warns
      Given the plan "Reshape" has the only edit {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/app/a.test.ts","src/app/a.ts","src/app/b.ts","src/app/save.ts"]},{"name":"spare","files":[]}]}
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null] and "warnings" is [[{"kind":"empty-package","path":"src/app/spare"}]]
      And there is no node "src/app"
      And "src/app/read" has files 3, row 0, order 0, ca 0, ce 2, i "1.00" and zone "healthy"
      And "src/app/spare" has files 0, row 2, order 1, cycle false, ca 0, ce 0, i "–", a "0.00", d "–" and no zone and no abstract
      And "src/domain" has row 2 order 0
      And the sentence is "Split src/app into src/app/read (4 files) and src/app/spare (0 files)"

    Scenario: Merge, delete and fold leave one warning and move the arrow
      Given the plan "Reshape" has the create, the move, the rename and the split of the previous scenario, then these edits, in order:
        | kind           | body |
        | merge-packages | {"kind":"merge-packages","packages":["src/app/read","src/app/write"],"into":"src/app"} |
        | fate           | {"kind":"fate","file":"src/domain/model.ts","fate":"delete"} |
        | fate           | {"kind":"fate","file":"src/adapters/repo.ts","fate":"fold","into":"src/ports/shape.ts"} |
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null, null, null, null, null, null]
      And "warnings" is [[], [], [], [], [], [{"kind":"deleted-imports","file":"src/domain/model.ts","importers":["src/adapters/db.ts","src/app/a.ts"]}], []]
      And the nodes are "src/app" files 3 row 0, "src/adapters" files 1 ca 2 ce 1 i "0.33" a "0.00" d "0.67" zone "pain" row 1, "src/domain" files 1 abstract true ca 2 row 2 order 0, and "src/ports" files 1 abstract true ca 1 row 2 order 1
      And the edges are "src/adapters" to "src/domain" runtime 1, "src/app" to "src/adapters" runtime 2 type 0, "src/app" to "src/domain" runtime 0 type 1, and "src/app" to "src/ports" runtime 0 type 1
      And none of those edges is a cycle, and no edge runs from "src/adapters" to "src/ports"
      And the sentences end with "Merge src/app/read and src/app/write into src/app", "Delete src/domain/model.ts" and "Fold src/adapters/repo.ts into src/ports/shape.ts"
      When I send "GET /api/detail?id=src/ports/shape.ts&at=src/ports&plan=reshape" with the token
      Then the only "importedBy" entry is "src/app/a.ts" with runtime 0, type 1 and heritage 0
      When I send "GET /api/pairs?from=src/ports&to=react&at=src&external=1&plan=reshape" with the token
      Then the body is {"pairs":[["src/ports/shape.ts","react"]]}
      When I send "GET /api/pairs?from=src/adapters&to=react&at=src&external=1&plan=reshape" with the token
      Then the body is {"pairs":[]}
      When I send "GET /api/pairs?from=src/infra&to=react&at=src&external=1" with the token
      Then the body is {"pairs":[["src/infra/repo.ts","react"]]}
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      And "src/infra/repo.ts" is still on disk

    Scenario: Deleting a file nothing imports does not warn
      Given the plan "Reshape" has the only edit {"kind":"fate","file":"src/app/save.ts","fate":"delete"}
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null] and there is no "warnings" key
      And "src/app" has files 3

    Scenario Outline: Each new kind gives its reason when it no longer applies
      Given the plan "Reshape" has the only edit <edit>
      When I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is ["<reason>"] and there is no "warnings" key
      And every key other than "stale" equals "GET /api/graph?at=src"
      Examples:
        | edit | reason |
        | {"kind":"move-file","file":"src/domain/shape.ts","to":"src/ports"} | no such directory src/ports |
        | {"kind":"create-package","path":"src/infra"} | src/infra already exists |
        | {"kind":"create-package","path":"lib/ports"} | no such directory lib |
        | {"kind":"rename-package","from":"src/io","to":"src/net"} | no such directory src/io |
        | {"kind":"rename-package","from":"src/infra","to":"src/domain"} | src/domain already exists |
        | {"kind":"rename-file","from":"src/app/save.ts","to":"b.ts"} | src/app/b.ts already exists |
        | {"kind":"merge-packages","packages":["src/app/read","src/app/write"],"into":"src/app"} | no such directory src/app/read |
        | {"kind":"merge-packages","packages":["src/app","src/infra"],"into":"src/domain"} | src/domain already exists |
        | {"kind":"split-package","package":"src/app","parts":[{"name":"read","files":["src/infra/db.ts"]},{"name":"write","files":[]}]} | no such file src/infra/db.ts |
        | {"kind":"fate","file":"src/app/gone.ts","fate":"delete"} | no such file src/app/gone.ts |
        | {"kind":"fate","file":"src/app/save.ts","fate":"fold","into":"src/app/gone.ts"} | no such file src/app/gone.ts |

    Scenario: Removing the split stales the merge, and a fold that follows a removed rename is stale
      Given the plan "Reshape" has the seven edits of "Merge, delete and fold leave one warning and move the arrow"
      When I remove the split edit with "PUT /api/plans/reshape"
      And I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null, null, "no such directory src/app/read", null, null]
      And "warnings" is [[], [], [], [], [{"kind":"deleted-imports","file":"src/domain/model.ts","importers":["src/adapters/db.ts","src/app/a.ts"]}], []]
      And "src/app" has files 3 and there is no node "src/app/read"
      When I also remove the rename edit with "PUT /api/plans/reshape"
      And I send "GET /api/graph?at=src&plan=reshape" with the token
      Then "stale" is [null, null, "no such directory src/app/read", null, "no such file src/adapters/repo.ts"]
      And "GET /api/plans/reshape" still has the merge and the fold edits and no stale field

  Rule: the page creates, renames, merges, splits, deletes and folds
    While a plan is open the architecture view has a "Canvas" button whose menu
    has "New package". It is absent with no plan. The dialogue is "New package",
    the field is "Name" and the button is "Create". The path is <view>/<name>,
    or the name alone at the root. An empty field shows "write a name". A bad
    name shows "bad name". A taken name shows "<path> already exists". The
    dialogue stays open and stores nothing. "Rename" on a box menu asks the same
    way, with the button "Rename", and stores a rename-package or a rename-file.
    A file name with no dot keeps the old extension. The same name stores
    nothing. A clash shows the full destination and " already exists". "Split"
    opens "Split package" with two name fields, "Part 1" and "Part 2", and
    lists every file under the package, tests included, by its relative path,
    each select starting on "choose" and offering the typed part names. "Add
    part" adds "Part 3", then "Part 4", and so on. "Split" stores the edit only when at least two
    part names are legal and distinct, every file has a part, and no part path
    already exists. Otherwise the dialogue shows the first failure, in this
    order: "name at least two parts", "bad name", "duplicate part",
    "assign every file", "<path> already exists". It stores nothing. Shift-click adds a package to the
    selection. "Merge" appears on a selected package's menu only when two or
    more packages are selected. The dialogue is "Merge packages". The name of a
    selected box merges into that box; any other name merges into <view>/<name>.
    A name whose path holds a file outside the selected packages shows
    "<into> already exists".
    "Delete" on a file box menu stores a delete fate. The Delete key on a box
    still does nothing. "Fold into…" arms a fold; the notice is
    "click a file to fold <file> into". The next click on a file box or a file
    row, including after a breadcrumb, stores the fold. The same file shows
    "a file cannot fold into itself" and stays armed. A package menu still has
    "Add note", and a file menu has it too. A deleted file, in Planned only,
    has data-fate "delete" and text-decoration-line "line-through", on the row
    and on the file box. The changes heading is "Changes". A badge with the
    warning count and aria-label "1 warning" or "N warnings" shows only when
    the count is not 0. A deleted-imports warning has a "Show importers" button
    that reveals the paths and becomes "Hide importers". A warning does not set
    data-stale. Clicking a new entry treats its target as 005 treats a move's:
    the target is the path below as it stands right after that edit; the page
    opens the view whose at is the target's parent directory ("" for none)
    unless the target is a box in the current view, selects that box, and puts
    its centre at the centre of the canvas. The targets are: create, the path;
    rename-package, "to"; rename-file, the renamed file; merge, "into"; split,
    the first part; delete, the file; fold, "into". A target that is not a box
    in the planned graph shows the notice "no such box <path>" and does not
    navigate.

    Scenario: The canvas asks for a package, refuses a bad name, and lists the warning
      Given the plan "Reshape" is open on the "src" view and the change list is empty
      Then the "Canvas" button is shown
      When I click "New package" and click "Create" with the name empty
      Then the dialogue shows "write a name" and the changes region has no entry
      When I type "has space" and click "Create"
      Then the dialogue shows "bad name"
      When I type "infra" and click "Create"
      Then the dialogue shows "src/infra already exists"
      When I type "ports" and click "Create"
      Then the dialogue is not shown
      And the only entry reads "Create package src/ports"
      And the "ports" box reads "0 files", has data-x 260 and data-y 280, and no file row
      And the "Changes" heading's badge reads "1" and its aria-label is "1 warning"
      And the entry shows "src/ports is empty"
      And "GET /api/plans/reshape" has the one edit {"kind":"create-package","path":"src/ports"}
      And "src/ports" does not exist on disk

    Scenario: Rename, split, merge, delete and fold, then undo, redo and a stale fold
      Given the plan "Reshape" is open on the "src" view and src/ports has been created
      When I open the "src/app" view, choose "Rename" on "save.ts", type "b" and click "Rename"
      Then the dialogue shows "src/app/b.ts already exists" and the only entry is the create
      When I type "writer" and click "Rename"
      Then the last entry reads "Rename src/app/save.ts to writer.ts"
      And the file box is "writer.ts"
      And "GET /api/plans/reshape" has {"kind":"rename-file","from":"src/app/save.ts","to":"writer.ts"}
      When I click "Undo"
      Then the only entry is the create and the file box is "save.ts"
      When I open the "src" view and drag the "shape.ts" row of "domain" onto the "ports" box
      Then the entry "src/ports is empty" is gone and the badge is not shown
      And the "ports" box reads "1 file", lists "shape.ts" and is green
      And the "domain" box reads "1 file" and has a ghost row "shape.ts"
      When I choose "Rename" on "infra" and type "adapters"
      Then the entry reads "Rename src/infra to src/adapters"
      And there is no "infra" box and the "adapters" box lists "db.ts" and "repo.ts"
      And the move entry still reads "Move src/domain/shape.ts to src/ports"
      When I choose "Split" on "app"
      Then the dialogue "Split package" has the fields "Part 1" and "Part 2" and the selects "a.test.ts", "a.ts", "b.ts" and "save.ts", each on "choose"
      When I type "read" in "Part 1" and "write" in "Part 2", leave "a.ts" on "choose" and click "Split"
      Then the dialogue shows "assign every file" and the split entry is absent
      When I assign "a.test.ts" and "a.ts" to "read" and "b.ts" and "save.ts" to "write" and click "Split"
      Then the last entry reads "Split src/app into src/app/read (2 files) and src/app/write (2 files)"
      And there is no "app" box
      And the "read" box has data-x 0 and data-y 0, the "write" box has data-x 260 and data-y 0, and both carry data-cycle "true" and are red
      And the entry shows "this plan adds a cycle: read → write → read"
      And the badge reads "1"
      When I click "read", shift-click "write", choose "Merge" and type "adapters" and click "Merge"
      Then the dialogue shows "src/adapters already exists"
      When I type "app" and click "Merge"
      Then the last entry reads "Merge src/app/read and src/app/write into src/app"
      And the "app" box is back, reads "3 files" and lists "a.ts", "b.ts" and "save.ts"
      And the badge is not shown
      When I open the "src/domain" view and choose "Delete" on "model.ts"
      Then the last entry reads "Delete src/domain/model.ts"
      And the "model.ts" box has data-fate "delete" and text-decoration-line "line-through"
      And the entry shows "2 files still import src/domain/model.ts, which this plan deletes"
      When I click "Show importers"
      Then the entry lists "src/adapters/db.ts" and "src/app/a.ts"
      When I open the "src/adapters" view and choose "Fold into…" on "repo.ts"
      Then the notice reads "click a file to fold src/adapters/repo.ts into"
      When I click the "src" breadcrumb and click the "shape.ts" row of "ports"
      Then the last entry reads "Fold src/adapters/repo.ts into src/ports/shape.ts"
      And the "adapters" box reads "1 file" and lists "db.ts"
      And no arrow runs from "adapters" to "ports"
      And a dashed arrow runs from "app" to "ports" and its tooltip is "0 runtime · 1 type-only · 0 extends/implements"
      And the badge still reads "1"
      When I click the empty canvas and press Ctrl+Z seven times
      Then the changes region has no entry and the badge is not shown
      And the "app" box reads "3 files", the "infra" box reads "2 files" and there is no "ports" box
      When I press Ctrl+Shift+Z seven times
      Then the entries are the create, the move, the rename of infra, the split, the merge, the delete and the fold
      And the "model.ts" row of "domain" is struck through and the badge reads "1"
      When I reload the page
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=reshape"
      And the seven entries, the struck-through "model.ts" and the badge "1" are shown
      When I open the "src/app" view and click the entry "Rename src/infra to src/adapters"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=reshape"
      And the "adapters" box carries data-selected "true" and its centre is at the centre of the canvas
      When I open the "src/app" view and click the entry "Fold src/adapters/repo.ts into src/ports/shape.ts"
      Then the address bar shows "http://127.0.0.1:5000/#at=src/ports&plan=reshape"
      And the "shape.ts" box carries data-selected "true" and its centre is at the centre of the canvas
      When I click the entry "Split src/app into src/app/read (2 files) and src/app/write (2 files)"
      Then the notice reads "no such box src/app/read" and the address bar still shows "http://127.0.0.1:5000/#at=src/ports&plan=reshape"
      When I click the "src" breadcrumb
      When I click "Remove" on "Rename src/infra to src/adapters"
      Then that entry is gone
      And the fold entry carries data-stale "true" and shows "no such file src/adapters/repo.ts"
      And the delete entry does not carry data-stale
      And "git status --porcelain" in "/tmp/qa/layered" is empty
