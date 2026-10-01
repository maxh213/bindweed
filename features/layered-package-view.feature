Feature: bindweed shows a repository's architecture as layered boxes and arrows
  A developer opens the Architecture tab and sees one box per package, arrows for the
  imports between them, high-level code at the top and cycles in red. Double-clicking a
  package drills into it; the breadcrumb and the browser's Back button climb back out;
  double-clicking a file opens it in the Files tab.

  Conventions: "bindweed" is "node <bindweed dir>/src/cli.ts"; /tmp/qa is a fresh temporary
  directory; bindweed serves /tmp/qa/layered on port 4700 unless a scenario says otherwise;
  {token} is the token it printed and {wrong} is 32 zeros; "with the token" means with the
  header "Authorization: Bearer {token}"; requests carry "Host: 127.0.0.1:4700" unless a
  scenario sets another. JSON bodies are compared as JSON, with "nodes" and "edges" matched
  as sets, by their fields and not their place in the list. In a table cell \n is a newline.
  In the page the "canvas" is the Architecture tab's drawing area, the selected tab carries
  aria-selected "true", the breadcrumb is the nav labelled "breadcrumb", a red box or arrow
  carries data-cycle "true", an arrow's tooltip is its title, and "above" compares where
  boxes are drawn on the screen.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is a git repository with these files committed:
      | path                | content                                                                                                                     |
      | tsconfig.json       | {"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}                                                  |
      | notes/readme.md     | # notes\n                                                                                                                   |
      | src/app/a.ts        | import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\n |
      | src/app/b.ts        | import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n          |
      | src/domain/model.ts | export class Model { id = 0; }\n                                                                                            |
      | src/infra/db.ts     | import { Model } from '../domain/model';\nexport const query = new Model();\n                                               |
    And "/tmp/qa/workspace" is a git repository with these files committed:
      | path                       | content                                                           |
      | package.json               | {"name":"acme","private":true,"workspaces":["packages/*"]}        |
      | packages/core/package.json | {"name":"@acme/core","version":"1.0.0","main":"src/index.ts"}     |
      | packages/core/src/index.ts | export const greet = 'hi';\n                                      |
      | packages/web/package.json  | {"name":"@acme/web","version":"1.0.0","main":"src/index.ts"}      |
      | packages/web/src/index.ts  | import { greet } from '@acme/core';\nexport const msg = greet;\n  |

  Rule: The graph API lays each directory out in layers
    A view's nodes are the directory's scanned children, row 0 the top layer. Edges are the
    imports between them, counted runtime and type; an import through the tsconfig "paths"
    alias counts like any other.

    Scenario: The root of layered holds one package box
      When I send "GET /api/graph" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"","crumbs":[{"name":"layered","at":""}],"nodes":[{"id":"src","kind":"package","name":"src","path":"src","files":4,"row":0,"order":0,"cycle":false}],"edges":[]}
        """
      When I send "GET /api/graph?at=" with the token
      Then the status is 200 and the body is that same JSON

    Scenario: The src view lies in three layers
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":2,"row":0,"order":0,"cycle":false},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":1,"row":1,"order":0,"cycle":false},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":1,"row":2,"order":0,"cycle":false}],"edges":[{"from":"src/app","to":"src/infra","runtime":2,"type":0,"cycle":false},{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":1,"type":0,"cycle":false}]}
        """

    Scenario: The app view is a red cycle of two files
      When I send "GET /api/graph?at=src/app" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src/app","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"},{"name":"app","at":"src/app"}],"nodes":[{"id":"src/app/a.ts","kind":"file","name":"a.ts","path":"src/app/a.ts","row":0,"order":0,"cycle":true},{"id":"src/app/b.ts","kind":"file","name":"b.ts","path":"src/app/b.ts","row":0,"order":1,"cycle":true}],"edges":[{"from":"src/app/a.ts","to":"src/app/b.ts","runtime":1,"type":0,"cycle":true,"cycleText":"a.ts → b.ts → a.ts"},{"from":"src/app/b.ts","to":"src/app/a.ts","runtime":1,"type":0,"cycle":true,"cycleText":"b.ts → a.ts → b.ts"}]}
        """

    Scenario: The workspace root shows boxes named by package.json
      Given bindweed is serving "/tmp/qa/workspace" on port 4700
      When I send "GET /api/graph" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"","crumbs":[{"name":"workspace","at":""}],"nodes":[{"id":"packages/web","kind":"package","name":"@acme/web","path":"packages/web","files":1,"row":0,"order":0,"cycle":false},{"id":"packages/core","kind":"package","name":"@acme/core","path":"packages/core","files":1,"row":1,"order":0,"cycle":false}],"edges":[{"from":"packages/web","to":"packages/core","runtime":1,"type":0,"cycle":false}]}
        """

    Scenario Outline: An at that names no view is not found
      When I send "GET /api/graph?at=<at>" with the token
      Then the status is 404 and the body is {"error":"no such directory"}
      Examples:
        | at                  | why                      |
        | notes               | no scanned files         |
        | tsconfig.json       | a file                   |
        | src/app/a.ts        | a scanned file           |
        | ..                  | leaves the repository    |
        | /tmp/qa/layered/src | absolute                 |

    Scenario: Rescan re-runs the scanner and reports
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 4 and "ms" a number

  Rule: The new routes keep the host and token checks
    Scenario Outline: The graph and rescan routes answer like the 001 ones
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                          | credentials                             | status | body                               |
        | GET /api/graph                   | no header of my own                     | 401    | {"error":"missing or wrong token"} |
        | GET /api/graph?token={wrong}     | no header of my own                     | 401    | {"error":"missing or wrong token"} |
        | POST /api/rescan                 | no header of my own                     | 401    | {"error":"missing or wrong token"} |
        | GET /api/graph?token={token}     | the header "Host: evil.example:4700"    | 403    | {"error":"bad host"}               |
        | POST /api/rescan?token={token}   | the header "Host: evil.example:4700"    | 403    | {"error":"bad host"}               |
        | GET /api/rescan                  | the token                               | 404    | {"error":"not found"}              |
        | POST /api/graph                  | the token                               | 404    | {"error":"not found"}              |

  Rule: The Architecture tab draws the view and drills down
    Scenario: The page opens on the Files tab
      When I open "http://127.0.0.1:4700/?token={token}" in a browser
      Then the tab bar holds the tabs "Files" and "Architecture", and "Files" carries aria-selected "true"
      And the left side shows exactly these rows, top to bottom:
        | layered/ | notes/ | src/ | tsconfig.json |
      And the right side shows "select a file"
      And the address bar shows "http://127.0.0.1:4700/"

    Scenario: The Architecture tab shows the root view
      Given the page is open
      When I click "Architecture"
      Then "Architecture" carries aria-selected "true"
      And the canvas shows one box, "src", with the text "4 files", and no arrow
      And the address bar shows "http://127.0.0.1:4700/#at="

    Scenario: Double-clicking a package drills in and the breadcrumb climbs out
      Given the page is open and the Architecture tab shows the root view
      When I double-click the "src" box
      Then the canvas shows the boxes "app", "infra" and "domain", with "app" above "infra" and "infra" above "domain"
      And the box "app" shows "2 files" and the boxes "infra" and "domain" show "1 file"
      And the breadcrumb shows "layered / src"
      And the address bar shows "http://127.0.0.1:4700/#at=src"
      When I click "layered" in the breadcrumb
      Then the canvas shows one box, "src"
      And the address bar shows "http://127.0.0.1:4700/#at="

    Scenario: Arrows run from importer to imported with their count
      Given the Architecture tab shows the "src" view
      Then an arrow runs from "app" to "infra", another from "app" to "domain" and a third from "infra" to "domain"
      And the arrow from "app" to "infra" is labelled "2" and the other two carry no label
      And no box or arrow is red

    Scenario: A cycle is drawn in red and its tooltip names it
      Given the Architecture tab shows the "src/app" view
      Then the canvas shows the box "a.ts" left of the box "b.ts" in one row, and both carry data-cycle "true"
      And an arrow runs from "a.ts" to "b.ts" and one from "b.ts" to "a.ts", both carrying data-cycle "true"
      And no other box or arrow is shown
      And the tooltip of the arrow from "a.ts" to "b.ts" is "a.ts → b.ts → a.ts"
      And the tooltip of the arrow from "b.ts" to "a.ts" is "b.ts → a.ts → b.ts"

    Scenario: The browser's Back button climbs out one level
      Given the Architecture tab shows the "src/app" view
      When I press the browser's Back button
      Then the canvas shows the boxes "app", "infra" and "domain"
      And the address bar shows "http://127.0.0.1:4700/#at=src"
      When I press the browser's Back button again
      Then the canvas shows one box, "src"
      And the address bar shows "http://127.0.0.1:4700/#at="

    Scenario: A deep link opens a drilled-down view
      When I open "http://127.0.0.1:4700/?token={token}#at=src/app" in a browser
      Then "Architecture" carries aria-selected "true"
      And the canvas shows the boxes "a.ts" and "b.ts", both carrying data-cycle "true"
      And the breadcrumb shows "layered / src / app"
      And the address bar shows "http://127.0.0.1:4700/#at=src/app"

    Scenario: Double-clicking a file opens it in the Files tab
      Given the Architecture tab shows the "src/domain" view
      When I double-click the "model.ts" box
      Then "Files" carries aria-selected "true"
      And the right side shows the header "src/domain/model.ts" and the numbered line 1 "export class Model { id = 0; }"
      And the row "model.ts" is marked as selected
      And the address bar shows "http://127.0.0.1:4700/#file=src/domain/model.ts"

    Scenario: The canvas pans and zooms
      Given the Architecture tab shows the "src" view
      When I drag the empty canvas and turn the zoom wheel
      Then the boxes move and scale together

    Scenario: The Rescan button picks up a new file and its arrow
      Given the Architecture tab shows the "src" view
      When the working tree gains "src/main.ts" holding "import { a } from './app/a';"
      And I click "Rescan"
      Then the canvas shows a box "main.ts" on a row above "app"
      And an arrow runs from "main.ts" to "app"

    Scenario: The workspace view puts the app above its library
      Given bindweed is serving "/tmp/qa/workspace" on port 4700
      When I open "http://127.0.0.1:4700/?token={token}" in a browser
      And I click "Architecture"
      Then the canvas shows the box "@acme/web" above the box "@acme/core"
      And an arrow runs from "@acme/web" to "@acme/core"
      And the breadcrumb shows "workspace"

  Rule: Tests and external packages are scanned but not shown
    Scenario: Test files are scanned but not shown
      When the working tree gains "src/app/a.test.ts" holding "import { a } from './a';"
      And I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 5
      When I send "GET /api/graph?at=src/app" with the token
      Then the body holds exactly 2 nodes and 2 edges, and no node is named "a.test.ts"

    Scenario: An external import is scanned but not drawn
      When the working tree gains "src/infra/env.ts" holding "import { readFileSync } from 'node:fs';\nexport const rf = readFileSync;"
      And I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 5
      When I send "GET /api/graph?at=src" with the token
      Then the body holds exactly 3 nodes and 3 edges, and nothing in it is named "node:fs"

  Rule: Everything from 001 keeps working
    Scenario: The tree and file routes answer on the same server
      When I send "GET /api/tree" with the token
      Then the status is 200 and the entries at the top level are "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then the status is 200 and the body is {"path":"src/domain/model.ts","text":"export class Model { id = 0; }\n"}

    Scenario: The README lists the new routes
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route         | status |
        | `/api/graph`  | live   |
        | `/api/rescan` | live   |
