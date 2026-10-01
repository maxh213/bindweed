Feature: arrows show what kind of dependency they are, and dragged boxes stay put
  A developer opens the Architecture tab of the extended layered repository and reads the
  arrows the way a class diagram does: solid for a runtime import, dashed when every
  import on the arrow is type-only, a hollow head when the arrow carries extends or
  implements, green when a box is nothing but types. Dragging a box pins it. Tests and
  external packages stay hidden until their checkboxes are turned on. Clicking a box
  lists what it imports and what imports it.

  src/domain/model.ts is an interface here. The class body in the 002 fixture is not an
  abstract file, and a package is green only when every file counted in it is, so this
  fixture replaces that class. The 002 fixture files are unchanged.
  features/layered-package-view.feature still pans and zooms, and it no longer says that
  dragging a box leaves the box where it was. Boxes can be dragged.

  Conventions: "bindweed" is "node <bindweed dir>/src/cli.ts"; /tmp/qa is a fresh temporary
  directory; bindweed serves /tmp/qa/layered on port 4800 unless a scenario says otherwise;
  {token} is the token of the bindweed that scenario started and {wrong} is 32 zeros;
  "with the token" means "Authorization: Bearer {token}"; requests carry
  "Host: 127.0.0.1:4800" unless a scenario sets another. JSON is compared as JSON, and
  nodes, edges, imports and importedBy as sets. A key these bodies omit is absent, not
  present with a default.
  Each scenario starts from the Background again. In a table cell \n is a newline.
  "tests=1" and "external=1" are the only query values that turn those flags on.
  A saved settings.tests or settings.external never changes /api/graph or /api/detail.
  On the page the canvas is the Architecture drawing area, the selected tab carries
  aria-selected "true", the breadcrumb is the nav labelled "breadcrumb", and the details
  panel is the complementary region labelled "details". A box carries data-x and data-y,
  its top-left in flow coordinates, data-cycle "true" or "false", data-abstract "true" or
  "false", and data-selected "true" only while it is the selected box. An arrow carries
  data-from and data-to (the node ids), data-line "solid" or "dashed", data-head "filled"
  or "hollow", data-cycle and data-up "true" or "false", and its tooltip is its title.
  A hollow head is an unfilled triangle, stroked in the arrow colour; a filled head is a
  filled triangle.
  Unpinned boxes sit at x = order × 260 and y = row × 140. A box is green when
  data-abstract is "true" and data-cycle is "false": background rgb(220, 252, 231),
  border rgb(21, 128, 61), and the package tab uses those same two colours. A cycle box
  stays the 002 red even when it is also abstract. An arrow is red (#dc2626) when
  data-cycle or data-up is "true", otherwise #64748b. Its label is the text of
  runtime + type when that sum is above 1, and heritage is not part of the label.
  A cycle arrow's tooltip is its cycleText, unless that arrow also points up: then the
  tooltip is the points-up sentence. data-line, data-head and the label still follow the
  counts, and data-cycle stays "true".
  An edge points up when the importing box's data-y exceeds the imported box's data-y by
  more than half the importing box's flow height. Flow height is the .box offsetHeight
  divided by the canvas zoom; at the default stylesheet it is more than 16 and less than
  200, so a gap of 8 does not point up and a gap of 400 does. One box height is that
  flow height. Tops on the screen follow the same test. The cell of a point is (floor(x / 260), floor(y / 140)),
  floor toward -infinity. Hovering a box gives every other box, and every arrow that does
  not touch it, the class "dim" (opacity 0.25).

  Background:
    Given bindweed's ui was built with "npm run build"
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
      | src/infra/repo.ts   | import { readFileSync } from 'node:fs';\nimport { Shape } from '../domain/shape';\nexport class Repo implements Shape { draw(): void { readFileSync('/dev/null'); } }\n |
    And "/tmp/qa/kinds" is a git repository with these files committed:
      | path                  | content                                                                                                          |
      | named/shape.ts        | export interface Shape { draw(): void }\n                                                                        |
      | named/repo.ts         | import { Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n              |
      | default/shape.ts      | export default class Shape { draw(): void { return; } }\n                                                        |
      | default/repo.ts       | import Shape from './shape';\nexport class Repo extends Shape { draw(): void { return; } }\n                     |
      | ns/shape.ts           | export class Shape { draw(): void { return; } }\n                                                                |
      | ns/repo.ts            | import * as ns from './shape';\nexport class Repo implements ns.Shape { draw(): void { return; } }\n             |
      | iface/shape.ts        | export interface Shape { draw(): void }\n                                                                        |
      | iface/box.ts          | import { Shape } from './shape';\nexport interface Box extends Shape { draw(): void }\n                          |
      | alias/shape.ts        | export interface Shape { draw(): void }\n                                                                        |
      | alias/repo.ts         | import { Shape as S } from './shape';\nexport class Repo implements S { draw(): void { return; } }\n             |
      | inline/shape.ts       | export interface Shape { draw(): void }\n                                                                        |
      | inline/repo.ts        | import { type Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n         |
      | typed/shape.ts        | export interface Shape { draw(): void }\n                                                                        |
      | typed/repo.ts         | import type { Shape } from './shape';\nexport class Repo implements Shape { draw(): void { return; } }\n         |
      | twice/shape.ts        | export class Shape { id = 0; }\n                                                                                 |
      | twice/repo.ts         | import { Shape } from './shape';\nexport class A extends Shape { id = 1; }\nexport class B extends Shape { id = 2; }\n |
      | pair/a.ts             | export interface A { a: number }\n                                                                               |
      | pair/b.ts             | export interface B { b: number }\n                                                                               |
      | pair/repo.ts          | import { A } from './a';\nimport { B } from './b';\nexport class Repo implements A, B { a = 0; b = 0; }\n         |
      | local/repo.ts         | export class Base { id = 0; }\nexport class Repo extends Base { id = 1; }\n                                      |
      | loose/repo.ts         | export class Repo implements Unknown { id = 0; }\n                                                               |
      | pure/iface.ts         | export interface I { n: number }\n                                                                               |
      | pure/alias.ts         | export type Id = string;\n                                                                                       |
      | pure/door.ts          | export abstract class Door { abstract open(): void }\n                                                           |
      | pure/decl.ts          | declare function ready(): void;\n                                                                                |
      | pure/reexp.ts         | export type { Id } from './alias';\n                                                                             |
      | pure/onlyimport.ts    | import type { Id } from './alias';\n                                                                             |
      | mixed/iface.ts        | export interface I { n: number }\n                                                                               |
      | mixed/value.ts        | export class Model { id = 0; }\n                                                                                 |
      | other/ns.ts           | export namespace Bag { export type Id = string; }\n                                                              |
      | other/empty.ts        | \n                                                                                                               |
      | other/both.ts         | export interface I { n: number }\nexport const n = 1;\n                                                          |
      | cyc/a.ts              | import type { B } from './b';\nexport interface A { b: B }\n                                                      |
      | cyc/b.ts              | import type { A } from './a';\nexport interface B { a: A }\n                                                      |
      | half/iface.ts         | export interface I { n: number }\n                                                                               |
      | half/value.test.ts    | export const n = 1;\n                                                                                            |

  Rule: The graph keeps the 002 layers and adds a field only when there is something to say
    Tests and externals stay out unless the query asks. Heritage is omitted at 0, abstract
    is omitted when false, and test is omitted when false. row and order are the 002
    layering and never move because of a pin. External nodes are given the next row after
    that layering, in name order, and their edges are not fed into layering or cycles.

    Scenario: The src view has three layers, one hollow count and one green box
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":2,"row":0,"order":0,"cycle":false},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":2,"row":1,"order":0,"cycle":false},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":2,"row":2,"order":0,"cycle":false,"abstract":true}],"edges":[{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":false},{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]}
        """

    Scenario: The root counts the six non-test files and draws nothing else
      When I send "GET /api/graph" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"","crumbs":[{"name":"layered","at":""}],"nodes":[{"id":"src","kind":"package","name":"src","path":"src","files":6,"row":0,"order":0,"cycle":false}],"edges":[]}
        """

    Scenario: The app view is still the 002 cycle and the test file is absent
      When I send "GET /api/graph?at=src/app" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src/app","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"},{"name":"app","at":"src/app"}],"nodes":[{"id":"src/app/a.ts","kind":"file","name":"a.ts","path":"src/app/a.ts","row":0,"order":0,"cycle":true},{"id":"src/app/b.ts","kind":"file","name":"b.ts","path":"src/app/b.ts","row":0,"order":1,"cycle":true}],"edges":[{"from":"src/app/a.ts","to":"src/app/b.ts","runtime":1,"type":0,"cycle":true,"cycleText":"a.ts → b.ts → a.ts"},{"from":"src/app/b.ts","to":"src/app/a.ts","runtime":1,"type":0,"cycle":true,"cycleText":"b.ts → a.ts → b.ts"}]}
        """

    Scenario: Both files in domain are abstract
      When I send "GET /api/graph?at=src/domain" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src/domain","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"},{"name":"domain","at":"src/domain"}],"nodes":[{"id":"src/domain/model.ts","kind":"file","name":"model.ts","path":"src/domain/model.ts","row":0,"order":0,"cycle":false,"abstract":true},{"id":"src/domain/shape.ts","kind":"file","name":"shape.ts","path":"src/domain/shape.ts","row":0,"order":1,"cycle":false,"abstract":true}],"edges":[]}
        """

    Scenario: Turning tests on puts a.test.ts above the cycle and counts it in app
      When I send "GET /api/graph?at=src/app&tests=1" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"at":"src/app","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"},{"name":"app","at":"src/app"}],"nodes":[{"id":"src/app/a.test.ts","kind":"file","name":"a.test.ts","path":"src/app/a.test.ts","row":0,"order":0,"cycle":false,"test":true},{"id":"src/app/a.ts","kind":"file","name":"a.ts","path":"src/app/a.ts","row":1,"order":0,"cycle":true},{"id":"src/app/b.ts","kind":"file","name":"b.ts","path":"src/app/b.ts","row":1,"order":1,"cycle":true}],"edges":[{"from":"src/app/a.test.ts","to":"src/app/a.ts","runtime":1,"type":0,"cycle":false},{"from":"src/app/a.ts","to":"src/app/b.ts","runtime":1,"type":0,"cycle":true,"cycleText":"a.ts → b.ts → a.ts"},{"from":"src/app/b.ts","to":"src/app/a.ts","runtime":1,"type":0,"cycle":true,"cycleText":"b.ts → a.ts → b.ts"}]}
        """
      When I send "GET /api/graph?at=src&tests=1" with the token
      Then the node "src/app" has "files" 3 and there is still no node named "a.test.ts"

    Scenario: Turning externals on adds node:fs on its own row under the layers
      When I send "GET /api/graph?at=src&external=1" with the token
      Then the three nodes and three edges of the default src view are unchanged
      And the body also has the node {"id":"node:fs","kind":"external","name":"node:fs","path":"node:fs","row":3,"order":0,"cycle":false}
      And the body also has the edge {"from":"src/infra","to":"node:fs","runtime":1,"type":0,"cycle":false}
      When I send "GET /api/graph?at=src/infra&external=1" with the token
      Then "db.ts" and "repo.ts" are row 0 and "node:fs" is row 1
      And the only edge is {"from":"src/infra/repo.ts","to":"node:fs","runtime":1,"type":0,"cycle":false}

    Scenario: Rescan counts the test file
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 7 and "ms" a number

  Rule: Heritage is a separate count on the import that binds the name
    A class extends, a class implements and an interface extends each count once, for
    every name, through the import in that file that binds it: a named import, an
    aliased name, a default import, an inline type import, or the namespace import of
    ns.Name. A deeper name such as ns.A.B makes no edge. The import's own runtime or type
    count is unchanged. A name declared in the same file, or bound by no import, makes no edge.

    Scenario Outline: One folder records the heritage of its import
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I send "GET /api/graph?at=<at>" with the token
      Then the view has <n> edges
      And when <n> is 1 the only edge runs from "<from>" to "<to>" with runtime <runtime>, type <type>, heritage <heritage> and cycle false
      Examples:
        | at      | from             | to               | runtime | type | heritage | n |
        | named   | named/repo.ts    | named/shape.ts   | 1       | 0    | 1        | 1 |
        | default | default/repo.ts  | default/shape.ts | 1       | 0    | 1        | 1 |
        | ns      | ns/repo.ts       | ns/shape.ts      | 1       | 0    | 1        | 1 |
        | iface   | iface/box.ts     | iface/shape.ts   | 1       | 0    | 1        | 1 |
        | alias   | alias/repo.ts    | alias/shape.ts   | 1       | 0    | 1        | 1 |
        | inline  | inline/repo.ts   | inline/shape.ts  | 0       | 1    | 1        | 1 |
        | typed   | typed/repo.ts    | typed/shape.ts   | 0       | 1    | 1        | 1 |
        | twice   | twice/repo.ts    | twice/shape.ts   | 1       | 0    | 2        | 1 |
        | local   | -                | -                | 0       | 0    | 0        | 0 |
        | loose   | -                | -                | 0       | 0    | 0        | 0 |

    Scenario: implements A, B is two heritage edges
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I send "GET /api/graph?at=pair" with the token
      Then the only edges are {"from":"pair/repo.ts","to":"pair/a.ts","runtime":1,"type":0,"heritage":1,"cycle":false} and {"from":"pair/repo.ts","to":"pair/b.ts","runtime":1,"type":0,"heritage":1,"cycle":false}

  Rule: A box is abstract only when every one of its statements is a type
    A scanned file is abstract when it has at least one top-level statement and every
    top-level statement is an interface, a type alias, an abstract class, a declare
    declaration, an export type or import type, or a re-export of only types. A
    namespace, a value, an empty file, or a type next to a value is not. A package is
    abstract when every file counted in it is. Test files count only while tests=1.

    Scenario Outline: The file's box is abstract only in the yes rows
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I send "GET /api/graph?at=<at>" with the token
      Then the node named "<name>" has abstract true if "<abstract>" is yes, and no abstract field if "<abstract>" is no
      Examples:
        | at    | name         | abstract |
        | pure  | iface.ts     | yes      |
        | pure  | alias.ts     | yes      |
        | pure  | door.ts      | yes      |
        | pure  | decl.ts      | yes      |
        | pure  | reexp.ts     | yes      |
        | pure  | onlyimport.ts | yes     |
        | mixed | iface.ts     | yes      |
        | mixed | value.ts     | no       |
        | other | ns.ts        | no       |
        | other | empty.ts     | no       |
        | other | both.ts      | no       |

    Scenario: A package is green only when all of its files are abstract
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I send "GET /api/graph" with the token
      Then the node "pure" has abstract true and "files" 6, and the node "cyc" has abstract true and "cycle" false
      And the nodes "mixed" and "other" have no abstract field

    Scenario: A value test file counts against abstract only while tests=1
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I send "GET /api/graph" with the token
      Then the node "half" has abstract true and "files" 1
      When I send "GET /api/graph?at=half" with the token
      Then the only node is "iface.ts", it has abstract true, and there is no node named "value.test.ts"
      When I send "GET /api/graph?tests=1" with the token
      Then the node "half" has "files" 2 and no abstract field
      When I send "GET /api/graph?at=half&tests=1" with the token
      Then the node "iface.ts" has abstract true
      And the node "value.test.ts" has "test" true and no abstract field

    Scenario: A cycle of abstract files is drawn red, and the cycle tooltip stays the cycle text
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I open "http://127.0.0.1:4800/?token={token}#at=cyc" in a browser
      Then the boxes "a.ts" and "b.ts" carry data-abstract "true" and data-cycle "true" and are drawn red, not green
      And both arrows carry data-cycle "true" and data-up "false"
      And the tooltip of the arrow from "a.ts" to "b.ts" is "a.ts → b.ts → a.ts"

    Scenario: A type-only heritage arrow is dashed and hollow
      Given bindweed is serving "/tmp/qa/kinds" on port 4800
      When I open "http://127.0.0.1:4800/?token={token}#at=typed" in a browser
      Then the arrow from "repo.ts" to "shape.ts" carries data-line "dashed", data-head "hollow" and data-up "false"
      And its tooltip is "0 runtime · 1 type-only · 1 extends/implements"
      And the box "shape.ts" is green and the box "repo.ts" is not

  Rule: Layout is saved for the view, and a bad document is refused
    The document is {"version":1,"views":{"<at>":{"<node id>":{"x":<number>,"y":<number>}}},"settings":{"tests":<bool>,"external":<bool>}}.
    GET returns the file, or that document with empty views and both settings false when
    the file is missing or not valid, and GET never writes it. A rejected PUT leaves the
    file as it was. A pin for a node the view does not show is kept and takes no cell.

    Scenario: A missing layout reads as the default and writes nothing
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      And "/tmp/qa/layered/.bindweed/layout.json" does not exist

    Scenario: A saved pin is returned and a pin for a gone node is kept
      When I send "PUT /api/layout" with the token and this body:
        """
        {"version":1,"views":{"src":{"src/domain":{"x":0,"y":-400},"src/gone":{"x":1,"y":2}},"src/app":{"src/app/a.ts":{"x":40,"y":10}}},"settings":{"tests":false,"external":true}}
        """
      Then the status is 200 and the body is that same JSON
      And "GET /api/layout" with the token returns that same JSON
      And the file "/tmp/qa/layered/.bindweed/layout.json" parses as that same JSON
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the body is exactly this JSON, with no "node:fs" and no "a.test.ts":
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":2,"row":0,"order":0,"cycle":false},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":2,"row":1,"order":0,"cycle":false},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":2,"row":2,"order":0,"cycle":false,"abstract":true}],"edges":[{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":false},{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]}
        """
      When I send "PUT /api/layout" with the token and this body:
        """
        {"version":1,"views":{"src":{"src/domain":{"x":0,"y":-400},"src/gone":{"x":1,"y":2}},"src/app":{"src/app/a.ts":{"x":40,"y":10}}},"settings":{"tests":true,"external":false}}
        """
      Then the status is 200 and the body is that same JSON
      And "GET /api/layout" with the token returns that same JSON, still including the pin for "src/gone"
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the body is exactly this JSON, with no "a.test.ts" and no "node:fs":
        """
        {"at":"src","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"}],"nodes":[{"id":"src/app","kind":"package","name":"app","path":"src/app","files":2,"row":0,"order":0,"cycle":false},{"id":"src/infra","kind":"package","name":"infra","path":"src/infra","files":2,"row":1,"order":0,"cycle":false},{"id":"src/domain","kind":"package","name":"domain","path":"src/domain","files":2,"row":2,"order":0,"cycle":false,"abstract":true}],"edges":[{"from":"src/app","to":"src/infra","runtime":2,"type":1,"cycle":false},{"from":"src/app","to":"src/domain","runtime":0,"type":1,"cycle":false},{"from":"src/infra","to":"src/domain","runtime":2,"type":0,"heritage":1,"cycle":false}]}
        """
      When I send "GET /api/graph?at=src/app" with the token
      Then the status is 200 and the body is exactly this JSON, with no "a.test.ts":
        """
        {"at":"src/app","crumbs":[{"name":"layered","at":""},{"name":"src","at":"src"},{"name":"app","at":"src/app"}],"nodes":[{"id":"src/app/a.ts","kind":"file","name":"a.ts","path":"src/app/a.ts","row":0,"order":0,"cycle":true},{"id":"src/app/b.ts","kind":"file","name":"b.ts","path":"src/app/b.ts","row":0,"order":1,"cycle":true}],"edges":[{"from":"src/app/a.ts","to":"src/app/b.ts","runtime":1,"type":0,"cycle":true,"cycleText":"a.ts → b.ts → a.ts"},{"from":"src/app/b.ts","to":"src/app/a.ts","runtime":1,"type":0,"cycle":true,"cycleText":"b.ts → a.ts → b.ts"}]}
        """

    Scenario: A bad file is not rewritten, and a rejected PUT leaves a valid file
      Given the file "/tmp/qa/layered/.bindweed/layout.json" contains exactly the bytes of "not json"
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      And the file "/tmp/qa/layered/.bindweed/layout.json" still contains exactly those bytes
      When I send "PUT /api/layout" with the token and this body:
        """
        {"version":1,"views":{"src":{"src/domain":{"x":3,"y":4}}},"settings":{"tests":true,"external":false}}
        """
      Then the status is 200 and the body is that same JSON
      And the file parses as that same JSON
      When I send "PUT /api/layout" with the token and the body "not json"
      Then the status is 400 and the body is {"error":"bad layout"}
      And the file's bytes are unchanged from after the successful PUT

    Scenario Outline: A layout that is not the document is refused
      When I send "PUT /api/layout" with the token and the body "<body>"
      Then the status is 400 and the body is {"error":"bad layout"}
      And "/tmp/qa/layered/.bindweed/layout.json" does not exist
      Examples:
        | body                                                                                          |
        | not json                                                                                      |
        | {"version":2,"views":{},"settings":{"tests":false,"external":false}}                         |
        | {"version":1,"settings":{"tests":false,"external":false}}                                     |
        | {"version":1,"views":{},"settings":{"tests":false}}                                           |
        | {"version":1,"views":{"src":{"src/app":{"x":"no","y":0}}},"settings":{"tests":false,"external":false}} |
        | {"version":1,"views":{},"settings":{"tests":false,"external":false},"extra":1}                |

    Scenario: The new routes keep the host and token checks, and the old routes still answer
      When I send "GET /api/tree" with the token
      Then the status is 200 and the entries at the top level are "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then the status is 200 and the body is {"path":"src/domain/model.ts","text":"export interface Model { id: number }\n"}
      When I send "GET /api/graph?at=notes" with the token
      Then the status is 404 and the body is {"error":"no such directory"}
      When I send "GET /api/detail?id=missing&at=src" with the token
      Then the status is 404 and the body is {"error":"no such node"}

    Scenario Outline: Host, token and method
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                        | credentials                          | status | body                               |
        | GET /api/layout                | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | PUT /api/layout                | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/detail?id=src         | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/graph                 | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | POST /api/rescan               | no header of my own                  | 401    | {"error":"missing or wrong token"} |
        | GET /api/layout?token={token}  | the header "Host: evil.example:4800" | 403    | {"error":"bad host"}               |
        | PUT /api/layout?token={token}  | the header "Host: evil.example:4800" | 403    | {"error":"bad host"}               |
        | GET /api/detail?token={token}  | the header "Host: evil.example:4800" | 403    | {"error":"bad host"}               |
        | POST /api/layout               | the token                            | 404    | {"error":"not found"}              |
        | GET /api/rescan                | the token                            | 404    | {"error":"not found"}              |
        | POST /api/graph                | the token                            | 404    | {"error":"not found"}              |

  Rule: The details list the far end of every edge, including a file outside the view
    Counts in a detail entry are always present, zeros included. External entries are
    included only with external=1, and test files only with tests=1. The entry's id is
    the file, package or external the edge reaches. An external entry's kind is "external".

    Scenario: infra's package lists domain and app
      When I send "GET /api/detail?id=src/infra&at=src" with the token
      Then the status is 200 and the body is this JSON:
        """
        {"id":"src/infra","name":"infra","path":"src/infra","kind":"package","files":2,"imports":[{"id":"src/domain","name":"domain","kind":"package","runtime":2,"type":0,"heritage":1}],"importedBy":[{"id":"src/app","name":"app","kind":"package","runtime":2,"type":1,"heritage":0}]}
        """

    Scenario: domain's detail says abstract and lists both importers
      When I send "GET /api/detail?id=src/domain&at=src" with the token
      Then the body has "abstract" true, "files" 2 and an empty "imports" array
      And "importedBy" holds "src/app" with runtime 0, type 1 and heritage 0, and "src/infra" with runtime 2, type 0 and heritage 1

    Scenario: a.ts lists the files outside the app view
      When I send "GET /api/detail?id=src/app/a.ts&at=src/app" with the token
      Then the body has no "files" field and no "abstract" field
      And "imports" is exactly these entries, in any order:
        | id                  | name    | kind | runtime | type | heritage |
        | src/app/b.ts        | b.ts    | file | 1       | 0    | 0        |
        | src/domain/model.ts | model.ts | file | 0       | 1    | 0        |
        | src/infra/db.ts     | db.ts   | file | 1       | 0    | 0        |
        | src/infra/repo.ts   | repo.ts | file | 0       | 1    | 0        |
      And the only "importedBy" entry is "src/app/b.ts" with runtime 1, type 0 and heritage 0
      When I send "GET /api/detail?id=src/app/a.test.ts&at=src/app" with the token
      Then the status is 404 and the body is {"error":"no such node"}
      When I send "GET /api/detail?id=node:fs&at=src" with the token
      Then the status is 404 and the body is {"error":"no such node"}

    Scenario: external=1 lists node:fs and tests=1 lists a.test.ts
      When I send "GET /api/detail?id=src/infra&at=src&external=1" with the token
      Then the status is 200 and "files" is 2 and there is no "abstract" field
      And "imports" is exactly these entries, in any order:
        | id         | name    | kind     | runtime | type | heritage |
        | src/domain | domain  | package  | 2       | 0    | 1        |
        | node:fs    | node:fs | external | 1       | 0    | 0        |
      And the only "importedBy" entry is "src/app" with runtime 2, type 1 and heritage 0
      When I send "GET /api/detail?id=src/app/a.ts&at=src/app&tests=1" with the token
      Then the status is 200 and the body has no "files" field and no "abstract" field
      And "importedBy" is exactly these entries, in any order:
        | id                | name      | kind | runtime | type | heritage |
        | src/app/b.ts      | b.ts      | file | 1       | 0    | 0        |
        | src/app/a.test.ts | a.test.ts | file | 1       | 0    | 0        |
      And "imports" is exactly these entries, in any order:
        | id                  | name     | kind | runtime | type | heritage |
        | src/app/b.ts        | b.ts     | file | 1       | 0    | 0        |
        | src/domain/model.ts | model.ts | file | 0       | 1    | 0        |
        | src/infra/db.ts     | db.ts    | file | 1       | 0    | 0        |
        | src/infra/repo.ts   | repo.ts  | file | 0       | 1    | 0        |

  Rule: The Architecture tab draws the kinds, the pin and the panel
    The toolbar holds the breadcrumb, the checkboxes "Tests" and "External packages"
    (both unchecked when nothing is saved), the button "Reset layout" and the button
    "Rescan". The Files tab has none of those checkboxes. A single click selects a box
    and opens the panel; a double-click still drills into a package or opens a file,
    and the panel closes. An entry whose id is already a box is selected and centred
    (its centre is the box centre closest to the canvas centre). Any other entry opens
    the view of the id's parent directory and selects the box there.

    Scenario: The src view shows green, a hollow head, a solid mix and a dashed arrow
      When I open "http://127.0.0.1:4800/?token={token}#at=src" in a browser
      Then "Architecture" carries aria-selected "true" and the breadcrumb shows "layered / src"
      And the box "app" is above "infra" and "infra" is above "domain"
      And "domain" carries data-abstract "true" and is green, and "app" and "infra" are not
      And the checkboxes "Tests" and "External packages" are unchecked
      And the arrow from "app" to "infra" carries data-line "solid" and data-head "filled", is labelled "3", and its tooltip is "2 runtime · 1 type-only · 0 extends/implements"
      And the arrow from "app" to "domain" carries data-line "dashed" and data-head "filled", has no label, and its tooltip is "0 runtime · 1 type-only · 0 extends/implements"
      And the arrow from "infra" to "domain" carries data-line "solid" and data-head "hollow", is labelled "2", and its tooltip is "2 runtime · 0 type-only · 1 extends/implements"
      And no arrow carries data-up "true" and no box carries data-cycle "true"

    Scenario: Hovering infra dims everything that does not touch it
      Given the Architecture tab shows the "src" view
      When I hover the "infra" box
      Then the "infra" box and the arrows between "app" and "infra" and between "infra" and "domain" do not carry "dim"
      And the "app" box, the "domain" box and the arrow from "app" to "domain" carry "dim"

    Scenario: Clicking infra opens the panel, and domain in the panel selects that box
      Given the Architecture tab shows the "src" view and the address bar shows "http://127.0.0.1:4800/#at=src"
      When I click the "infra" box
      Then the address bar is unchanged and the details panel's heading is "infra"
      And the panel shows the path "src/infra", the word "package" and "2 files", and not the word "abstract"
      And under "Imports" one button shows "domain" and "2 runtime · 0 type-only · 1 extends/implements"
      And under "Imported by" one button shows "app" and "2 runtime · 1 type-only · 0 extends/implements"
      When I click "domain" in the panel
      Then the "domain" box carries data-selected "true", no other box does, and its centre is the closest to the canvas centre
      And the panel's heading is "domain", it shows "abstract", and under "Imports" there is no button

    Scenario: Clicking db.ts in a.ts's panel drills to the infra view
      Given the Architecture tab shows the "src/app" view
      When I click the "a.ts" box and then click "db.ts" in the panel
      Then the address bar shows "http://127.0.0.1:4800/#at=src/infra"
      And the "db.ts" box carries data-selected "true" and the panel's heading is "db.ts"

    Scenario: Double-clicking a file still opens it in the Files tab
      Given the Architecture tab shows the "src/domain" view
      When I double-click the "shape.ts" box
      Then "Files" carries aria-selected "true" and the panel is gone
      And the right side shows the header "src/domain/shape.ts" and the numbered line 1 "export interface Shape { draw(): void }"
      And the address bar shows "http://127.0.0.1:4800/#file=src/domain/shape.ts"

    Scenario: Dragging the canvas pans, and dropping a box pins only that box
      Given the Architecture tab shows the "src" view
      When I drag the empty canvas
      Then the boxes move together and "GET /api/layout" still returns the default document
      When I drag the "domain" box until its top is at least one box height above the "app" box and drop it
      Then the "domain" box stays where it was dropped, and its data-y is less than the "app" box's data-y by at least the "domain" box's flow height
      And the arrow from "app" to "domain" carries data-up "true", data-line "dashed" and data-head "filled", and its tooltip is "points up: app is drawn below domain"
      And the arrow from "infra" to "domain" carries data-up "true", data-line "solid" and data-head "hollow", and its tooltip is "points up: infra is drawn below domain"
      And the arrow from "app" to "infra" carries data-up "false"
      And "GET /api/layout" returns a document whose "views" "src" "src/domain" x and y are the dropped data-x and data-y, and whose other views are absent

    Scenario: A gap of half a box or less does not point up
      Given "PUT /api/layout" has saved {"version":1,"views":{"src":{"src/app":{"x":0,"y":0},"src/domain":{"x":0,"y":-8}}},"settings":{"tests":false,"external":false}}
      When I open "http://127.0.0.1:4800/?token={token}#at=src" in a browser
      Then the arrow from "app" to "domain" carries data-up "false" and its tooltip is "0 runtime · 1 type-only · 0 extends/implements"
      And the arrow from "infra" to "domain" carries data-up "true"
      When "PUT /api/layout" saves the same document with "src/domain" y -400
      And I open "http://127.0.0.1:4800/?token={token}#at=src" in a browser
      Then the arrow from "app" to "domain" carries data-up "true" and its tooltip is "points up: app is drawn below domain"

    Scenario: A cycle arrow that points up says so and stays a cycle
      Given "PUT /api/layout" has saved {"version":1,"views":{"src/app":{"src/app/a.ts":{"x":0,"y":-400}}},"settings":{"tests":false,"external":false}}
      When I open "http://127.0.0.1:4800/?token={token}#at=src/app" in a browser
      Then the "a.ts" box has data-x 0 and data-y -400, and the "b.ts" box has data-x 260 and data-y 0
      And the arrow from "b.ts" to "a.ts" carries data-cycle "true", data-up "true", data-line "solid" and data-head "filled", has no label, and its tooltip is "points up: b.ts is drawn below a.ts"
      And the arrow from "a.ts" to "b.ts" carries data-cycle "true", data-up "false", data-line "solid" and data-head "filled", has no label, and its tooltip is "a.ts → b.ts → a.ts"

    Scenario: The pin survives a new page load, a rescan and a restart, and a token-less refresh still fails
      Given the "domain" box is pinned above "app" in the "src" view
      When I click "Rescan"
      Then the "domain" box is still above "app"
      When I open "http://127.0.0.1:4800/#at=src" in a browser
      Then the page shows the line "bindweed: use the link bindweed printed in the terminal"
      When I open "http://127.0.0.1:4800/?token={token}#at=src" in a browser
      Then the "domain" box is above "app"
      When I stop bindweed and start it again on "/tmp/qa/layered"
      And I open the newly printed link with "#at=src"
      Then the "domain" box is above "app"

    Scenario: Reset layout clears this view's pins and leaves settings and every other view
      Given the "domain" box is pinned above "app" in the "src" view and "a.ts" is pinned away from its layer in the "src/app" view
      And "Tests" is checked, so "settings" "tests" is true
      When I click "Reset layout" while the "src" view is showing
      Then "app" is above "infra" and "infra" is above "domain", and no arrow carries data-up "true"
      And "Tests" is still checked
      And "GET /api/layout" has no "src" key under "views", still has the pin for "src/app/a.ts", and "settings" "tests" is still true
      When I open the "src/app" view
      Then the "a.ts" box is still where it was pinned

    Scenario: A new box that would land on a pinned box steps right
      Given "PUT /api/layout" has saved {"version":1,"views":{"src":{"src/app":{"x":0,"y":0}}},"settings":{"tests":false,"external":false}}
      And the working tree gains "src/main.ts" holding "import { a } from './app/a';\n"
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 8
      And "GET /api/graph?at=src" has "main.ts" at row 0, "app" at row 1, "infra" at row 2 and "domain" at row 3
      When I open "http://127.0.0.1:4800/?token={token}#at=src" in a browser
      Then the "app" box has data-x 0 and data-y 0
      And the "main.ts" box has data-x 260 and data-y 0
      And "infra" is below that row and "domain" is below "infra"

    Scenario: A pin for a deleted file is ignored and left in the file
      Given "PUT /api/layout" has saved {"version":1,"views":{"src/domain":{"src/domain/gone.ts":{"x":0,"y":0}}},"settings":{"tests":false,"external":false}}
      When I open "http://127.0.0.1:4800/?token={token}#at=src/domain" in a browser
      Then the only boxes are "model.ts" at data-x 0 and "shape.ts" at data-x 260, both at data-y 0
      And "GET /api/layout" still has the pin for "src/domain/gone.ts"

    Scenario: The Tests checkbox shows a.test.ts and is remembered
      Given the Architecture tab shows the "src/app" view
      When I check "Tests"
      Then the box "a.test.ts" is above "a.ts" and "b.ts", it shows a "test" tag, and an arrow runs from "a.test.ts" to "a.ts"
      And "GET /api/layout" has "settings" "tests" true
      When I click the "a.ts" box
      Then under "Imported by" the only buttons are "a.test.ts" and "b.ts", each showing "1 runtime · 0 type-only · 0 extends/implements"
      When I open "http://127.0.0.1:4800/?token={token}#at=src/app" in a browser
      Then "Tests" is checked and the "a.test.ts" box is shown
      When I uncheck "Tests"
      Then the "a.test.ts" box is gone and the "a.ts" and "b.ts" boxes are one row again

    Scenario: The External packages checkbox shows node:fs under the layers
      Given the Architecture tab shows the "src" view and both checkboxes are unchecked
      When I check "External packages"
      Then a box "node:fs" with a dashed border is below "domain", and an arrow runs from "infra" to "node:fs"
      And "domain" is still above "node:fs" and still green
      And "GET /api/layout" has "settings" "external" true
      When I click the "infra" box
      Then under "Imports" the only buttons are "domain" showing "2 runtime · 0 type-only · 1 extends/implements" and "node:fs" showing "1 runtime · 0 type-only · 0 extends/implements"
      When I uncheck "External packages"
      Then the "node:fs" box is gone and the panel no longer shows "node:fs"

    Scenario: The README lists the new routes beside the old ones
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route         | status |
        | `/api/tree`   | live   |
        | `/api/file`   | live   |
        | `/api/graph`  | live   |
        | `/api/rescan` | live   |
        | `/api/layout` | live   |
        | `/api/detail` | live   |
