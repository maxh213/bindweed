Feature: turn a plan into a dependency contract the gate can enforce
  A developer with a plan open presses Contract, sees the dependency-cruiser
  rules that would freeze the planned shape, unticks any they do not want, and
  saves the rest on the plan. Nothing in the repository is written. The merged
  text is what a later run would put in .dependency-cruiser.cjs.

  The served tree is the checked-in four-file layered fixture, not the tree in
  features/plan-moves-and-edges.feature. version stays 1. A plan from 005 or 006
  has no "contract" key and still parses. "bindweed" is "node <bindweed
  dir>/src/cli.ts". /tmp/qa is fresh. bindweed serves /tmp/qa/layered on port
  5000 unless a scenario says otherwise. {token} is that process's token.
  "with the token" sends "Authorization: Bearer {token}". Requests carry
  "Host: 127.0.0.1:5000" unless a scenario sets another. JSON is compared as
  JSON. A key a body omits is absent. In a table cell \n is a newline. Each
  scenario starts from the Background again. The panel is the dialog labelled "Contract". The diff region is
  labelled "diff". The snippet region is labelled "snippet".

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

  Rule: the plan becomes forbidden rules, and the cruiser file is only previewed
    GET /api/plans/<slug>/contract returns {"rules":[...]} in the order below.
    POST /api/plans/<slug>/contract with {"names":[...]} returns {"text","diff"}
    or {"error","snippet"} and writes nothing. Names not in "rules" are ignored.
    Names may arrive in any order; "text" uses the order below. An empty names
    array is legal. A body that is not {"names":[strings]} answers 400
    {"error":"bad contract"}. An unknown slug, or a slug that fails
    ^[a-z0-9][a-z0-9-]*$, answers 404 {"error":"no such plan"}. A further path
    segment answers 404 {"error":"not found"}.
    Only non-stale cut-edge edits become cut rules, one rule each, in edit
    order. Redo is ignored. Both rewritten ends are files in the planned scan:
    a file rule, from {"path":"^<importer>$"} and to {"path":"^<imported>$"}.
    Neither end is a file: a package rule, from {"path":"^<from>/"} and to
    {"path":"^<to>/"}. Ends are rewritten by later non-stale edits the way the
    planned graph rewrites a path. A mixed pair is skipped.
    Then direction rules. At the root and at every directory that contains a
    scanned file or a declared package, with tests off and external off, every
    pair of package nodes that view would draw with an edge in one direction
    only becomes one rule forbidding the reverse. An added edge counts. A cut
    edge does not, because it is gone. Parents are visited in path order, and
    the rules inside one parent are sorted by name. Then bindweed:no-circular,
    unless a forbidden element that is not removed as a bindweed rule has an
    object "to" with a boolean "circular" of true. No file means the rule is
    included. A test-only edge does not count.
    A name spells each planned path with "/" and "." replaced by "-". Other
    characters stay. Regex metacharacters in a path are escaped with a
    backslash. Every rule has severity "error" and a comment:
      | kind      | name                                      | comment                          |
      | file cut  | bindweed:no-<from>-to-<to>                | <from> must not import <to>      |
      | package   | bindweed:no-<from>-to-<to>                | <from> must not import <to>      |
      | direction | bindweed:<used>-does-not-use-<user>       | <used> does not use <user>       |
      | cycles    | bindweed:no-circular                      | No circular dependencies         |
    <user> is the package the edge leaves and <used> is the package it enters.
    The direction rule's "from" path is <used> and its "to" path is <user>.
    no-circular has from {} and to {"circular":true}.
    A missing .dependency-cruiser.cjs previews this file, with a final newline,
    and without the tsConfig line when the repo root has no tsconfig.json.
    Rule objects use the indent and quotes shown. "diff" has no timestamps:
      """
      --- a/.dependency-cruiser.cjs
      +++ b/.dependency-cruiser.cjs
      """
    When "text" equals the file's bytes (empty when there is no file), "diff"
    is exactly those two lines, each ending in a newline, and no third line.
    Otherwise it is a unified diff with those headers. A "+" line is a result
    line; a "-" line is a current line.

    Scenario: Two cuts preview the canonical file and do not touch the repo
      Given the plan "Gate" has these edits, in order, and redo []:
        | kind     | body                                                                                          |
        | cut-edge | {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]} |
        | cut-edge | {"kind":"cut-edge","from":"src/app/a.ts","to":"src/app/b.ts","files":[["src/app/a.ts","src/app/b.ts"]]} |
      When I send "GET /api/plans/gate/contract" with the token
      Then the status is 200 and "rules" has these names, in order:
        | name                                      |
        | bindweed:no-src-app-to-src-domain         |
        | bindweed:no-src-app-a-ts-to-src-app-b-ts  |
        | bindweed:src-domain-does-not-use-src-infra |
        | bindweed:src-infra-does-not-use-src-app   |
        | bindweed:no-circular                      |
      And no rule name contains "does-not-use-src-app" except "bindweed:src-infra-does-not-use-src-app"
      When I send "POST /api/plans/gate/contract" with the token and those five names in reverse order
      Then the status is 200 and "text" is exactly:
        """
        module.exports = {
          forbidden: [
            {
              name: 'bindweed:no-src-app-to-src-domain',
              severity: 'error',
              comment: 'src/app must not import src/domain',
              from: { path: '^src/app/' },
              to: { path: '^src/domain/' }
            },
            {
              name: 'bindweed:no-src-app-a-ts-to-src-app-b-ts',
              severity: 'error',
              comment: 'src/app/a.ts must not import src/app/b.ts',
              from: { path: '^src/app/a\\.ts$' },
              to: { path: '^src/app/b\\.ts$' }
            },
            {
              name: 'bindweed:src-domain-does-not-use-src-infra',
              severity: 'error',
              comment: 'src/domain does not use src/infra',
              from: { path: '^src/domain/' },
              to: { path: '^src/infra/' }
            },
            {
              name: 'bindweed:src-infra-does-not-use-src-app',
              severity: 'error',
              comment: 'src/infra does not use src/app',
              from: { path: '^src/infra/' },
              to: { path: '^src/app/' }
            },
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ],
          options: {
            doNotFollow: { path: 'node_modules' },
            tsPreCompilationDeps: true,
            tsConfig: { fileName: 'tsconfig.json' }
          }
        };
        """
      And "diff" starts with the two headers above and contains "+      name: 'bindweed:no-src-app-to-src-domain',"
      And "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      When I send the same POST again
      Then "text" and "diff" are unchanged

    Scenario: An empty plan still freezes the one-way pairs and cycles
      Given the plan "Gate" has no edits
      When I send "GET /api/plans/gate/contract" with the token
      Then "rules" has these names, in order:
        | name                                        | from path     | to path      |
        | bindweed:src-domain-does-not-use-src-app    | ^src/domain/  | ^src/app/    |
        | bindweed:src-domain-does-not-use-src-infra  | ^src/domain/  | ^src/infra/  |
        | bindweed:src-infra-does-not-use-src-app     | ^src/infra/   | ^src/app/    |
        | bindweed:no-circular                        |               |              |
      And the first rule's comment is "src/domain does not use src/app"
      And the last rule has from {} and to {"circular":true} and comment "No circular dependencies"
      When I send "POST /api/plans/gate/contract" with the token and those four names
      Then "text" is the canonical file of the previous scenario with its first two rules removed and the domain-does-not-use-app rule inserted first, in that same formatting

    Scenario: A later rename uses the planned paths
      Given the plan "Gate" has these edits, in order:
        | kind           | body                                                                                          |
        | cut-edge       | {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]} |
        | rename-package | {"kind":"rename-package","from":"src/domain","to":"src/core"}                                |
        | cut-edge       | {"kind":"cut-edge","from":"src/app/a.ts","to":"src/app/b.ts","files":[["src/app/a.ts","src/app/b.ts"]]} |
        | rename-file    | {"kind":"rename-file","from":"src/app/b.ts","to":"c.ts"}                                     |
      When I send "GET /api/plans/gate/contract" with the token
      Then the rule names are, in order:
        | name                                     |
        | bindweed:no-src-app-to-src-core          |
        | bindweed:no-src-app-a-ts-to-src-app-c-ts |
        | bindweed:src-core-does-not-use-src-infra |
        | bindweed:src-infra-does-not-use-src-app  |
        | bindweed:no-circular                     |
      And the package rule's comment is "src/app must not import src/core" and its "to" path is "^src/core/"
      And the file rule's "to" path is "^src/app/c\\.ts$" and its comment is "src/app/a.ts must not import src/app/c.ts"
      And the core rule's "from" path is "^src/core/" and its "to" path is "^src/infra/"
      And no rule's name, comment or path contains "src/domain" or "b.ts"

    Scenario: A plus in a path is escaped in the regex and kept in the name
      Given "/tmp/qa/layered/src/c++/plus.ts" contains "import { a } from '../app/a';\nexport const plus = a;\n"
      And I send "POST /api/rescan" with the token
      And the plan "Gate" has the only edit {"kind":"cut-edge","from":"src/c++/plus.ts","to":"src/app/a.ts","files":[["src/c++/plus.ts","src/app/a.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then one rule has name "bindweed:no-src-c++-plus-ts-to-src-app-a-ts", comment "src/c++/plus.ts must not import src/app/a.ts", from path "^src/c\\+\\+/plus\\.ts$" and to path "^src/app/a\\.ts$"
      And no other rule name contains "c++"
      And no rule name contains "c-plus"

    Scenario: A test-only package does not add a direction rule
      Given "/tmp/qa/layered/src/extra/t.test.ts" contains "import { query } from '../infra/db';\nexport const t = query;\n"
      And I send "POST /api/rescan" with the token
      And the plan "Gate" has no edits
      When I send "GET /api/plans/gate/contract" with the token
      Then the rule names are the four names of "An empty plan still freezes the one-way pairs and cycles"
      And no rule name, comment or path contains "extra"

    Scenario: Both directions drop that pair, and a stale or redone cut adds none
      Given the plan "Gate" has the only edit {"kind":"add-edge","from":"src/domain","to":"src/app"}
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are exactly "bindweed:src-domain-does-not-use-src-infra", "bindweed:src-infra-does-not-use-src-app" and "bindweed:no-circular", in that order
      Given the plan "Gate" has the only edit {"kind":"cut-edge","from":"src/missing","to":"src/domain","files":[["src/missing/a.ts","src/domain/model.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are the four names of the empty plan
      Given the plan "Gate" has edits [] and redo [{"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}]
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are the four names of the empty plan

    Scenario: A repo with no tsconfig omits tsConfig, and an empty selection is an empty array
      Given "/tmp/qa/plain" contains "only.ts" with "export const n = 1;\n", is a git repository with that file committed, and has no tsconfig.json
      And bindweed is serving "/tmp/qa/plain" on port 5000
      And the plan "Gate" has no edits
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then "text" is exactly:
        """
        module.exports = {
          forbidden: [
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ],
          options: {
            doNotFollow: { path: 'node_modules' },
            tsPreCompilationDeps: true
          }
        };
        """
      When I send "POST /api/plans/gate/contract" with the token and the names []
      Then "text" is that same file with the one rule removed, so the line is "  forbidden: [],"

  Rule: an existing cruiser file keeps every byte that is not a bindweed rule
    The file is read as JavaScript with the TypeScript compiler API. The object
    is the one assigned to module.exports, or export default when that
    assignment is absent. When both exist, only module.exports is changed.
    "forbidden" must be a property of that object whose value is an array
    literal of object literals, with no spread. Otherwise the status is 200 and
    the body is {"error":"bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array","snippet":"<rules>"}
    with no "text" and no "diff". The same body is used when the file does not
    parse or has no such object. "snippet" is the selected rules in preview
    order, formatted as in the canonical file, joined by ",\n", with no trailing
    comma, and a final newline. The file's bytes stay.
    A kept element is an object literal whose "name" is not a string literal
    starting with "bindweed:". Removing a bindweed element also removes the
    comma that separated it and the whitespace that belonged only to it.
    Comments outside the element stay. The kept elements' own bytes stay,
    including their quotes. Appended rules use the last kept element's
    opening-brace indent, two spaces inside the braces, single quotes, and the
    key order name, severity, comment, from, to. A comma is inserted only when
    the last kept element has none after it. When no element remains, the array
    literal is replaced by the canonical array, or by [] when nothing is
    selected, and every byte outside that array stays. A "'" or "\" inside a
    generated string is escaped. POSTing the resulting text's rules again
    returns the same text.

    Scenario: A kept rule and its options stay byte for byte
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly:
        """
        // kept
        module.exports = {
          forbidden: [
            {
              name: 'keep-me',
              severity: 'warn',
              from: {},
              to: { path: '^keep' }
            }
          ],
          options: { doNotFollow: { path: 'node_modules' }, extra: true }
        };
        """
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then "text" is exactly:
        """
        // kept
        module.exports = {
          forbidden: [
            {
              name: 'keep-me',
              severity: 'warn',
              from: {},
              to: { path: '^keep' }
            },
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ],
          options: { doNotFollow: { path: 'node_modules' }, extra: true }
        };
        """
      And the file's bytes are unchanged
      When I write that "text" over the file and send the same POST
      Then "text" equals the file and "diff" is the two header lines and no third line

    Scenario: An existing circular rule suppresses bindweed:no-circular
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly:
        """
        module.exports = {
          forbidden: [
            {
              name: 'no-circular',
              severity: 'error',
              comment: 'No circular dependencies allowed',
              from: {},
              to: { circular: true }
            }
          ]
        };
        """
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are the three direction names and do not include "bindweed:no-circular"
      When I send "POST /api/plans/gate/contract" with the token and those three names plus "bindweed:no-circular"
      Then "text" still contains "name: 'no-circular'" and "No circular dependencies allowed" and does not contain "bindweed:no-circular"
      And the "no-circular" object occupies the same bytes as in the original file

    Scenario: A bindweed rule in the middle is removed and does not suppress cycles
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly:
        """
        const note = 'leave me';
        module.exports = {
          forbidden: [
            {
              name: 'bindweed:old',
              severity: 'error',
              comment: 'gone',
              from: { path: '^a/' },
              to: { path: '^b/' }
            },
            {
              name: 'keep-me',
              severity: 'warn',
              from: {},
              to: { path: '^keep' }
            }
          ],
          options: { note }
        };
        """
      When I send "GET /api/plans/gate/contract" with the token
      Then the names include "bindweed:no-circular"
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then "text" is exactly:
        """
        const note = 'leave me';
        module.exports = {
          forbidden: [
            {
              name: 'keep-me',
              severity: 'warn',
              from: {},
              to: { path: '^keep' }
            },
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ],
          options: { note }
        };
        """
      And "text" does not contain "bindweed:old"
      When I write that "text" over the file and send the same POST
      Then "text" is unchanged

    Scenario: An empty forbidden array and an export default keep the other bytes
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "module.exports = {\n  forbidden: [],\n  options: { extra: 1 }\n};\n"
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then "text" is exactly:
        """
        module.exports = {
          forbidden: [
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ],
          options: { extra: 1 }
        };
        """
      Given the file instead contains exactly "export default {\n  forbidden: [\n    { name: 'keep-me', severity: 'warn', from: {}, to: { path: '^keep' } }\n  ]\n};\n"
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then "text" starts with "export default {" and contains the original one-line keep-me element unchanged
      And the added rule's opening brace is indented four spaces

    Scenario Outline: A forbidden list we cannot read is refused, and the file stays
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "<source>"
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then the status is 200 and "error" is "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array"
      And "snippet" is the no-circular object from the canonical file, with its indent, and a final newline
      And there is no "text" and no "diff"
      And the file's bytes are unchanged
      Examples:
        | source |
        | const base = [];\nmodule.exports = { forbidden: [...base] };\n |
        | const base = [];\nmodule.exports = { forbidden: base };\n |
        | function make() { return []; }\nmodule.exports = { forbidden: make() };\n |
        | module.exports = {\n |

  Rule: contract is optional on the plan, and the old routes stay
    "contract" is {"rules":[...]} and nothing else. A rule has exactly name,
    severity, comment, from and to. severity is "error". name starts with
    "bindweed:". comment is a non-empty string. from is {} or {"path":string}.
    to is {"path":string} or {"circular":true}. No other key. The key is absent
    when the plan has no contract. {"rules":[]} is a saved contract. PUT of a
    bad contract answers 400 {"error":"bad plan"} and leaves the bytes. A
    document with a key other than the 005 keys plus "contract" is still bad.
    GET /api/plans summaries have no contract and editCount is the edits
    length. GET of the document returns the saved rules. No graph, detail,
    pairs, tree, file or layout body gains a contract key.

    Scenario: A 005 plan loads with no contract, and a bad contract is refused
      Given "PUT /api/plans/split-app" has saved {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"move-file","file":"src/app/b.ts","to":"src/infra"}],"redo":[]}
      When I send "GET /api/plans/split-app" with the token
      Then the status is 200 and the only edit is that move and there is no contract key
      And the sentence is "Move src/app/b.ts to src/infra"
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the status is 200 and there is no contract key and "stale" is [null]
      When I send "GET /api/plans" with the token
      Then the only summary has editCount 1 and no contract key
      When I send "PUT /api/plans/split-app" with the token and that document plus "contract":{"rules":[{"name":"no-circular","severity":"error","comment":"No circular dependencies","from":{},"to":{"circular":true}}]}
      Then the status is 400 and the body is {"error":"bad plan"}
      And the file's bytes are unchanged
      When I send "PUT /api/plans/split-app" with the token and that document plus "extra":1
      Then the status is 400 and the body is {"error":"bad plan"}

    Scenario: Save stores the chosen rules and an empty list is not absence
      Given the plan "Gate" has the two cuts of "Two cuts preview the canonical file and do not touch the repo"
      When I send "PUT /api/plans/gate" with the token and the document plus the canonical file's five rules as "contract"
      Then the status is 200 and GET returns those five rules under contract, in that order
      And "GET /api/plans" shows editCount 2
      When I send "PUT /api/plans/gate" with the token and the same document with "contract":{"rules":[]}
      Then GET returns contract {"rules":[]} and does not omit the key
      And the two cuts are still the edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist

    Scenario: The old routes still answer on this tree
      When I send "GET /api/tree" with the token
      Then the status is 200 and the top-level entries are "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then the body is {"path":"src/domain/model.ts","text":"export class Model { id = 0; }\n"}
      When I send "GET /api/graph?at=src" with the token
      Then "app" has files 2, "infra" has files 1 and "domain" has files 1
      And the edges are app to infra, app to domain, and infra to domain
      And there is no contract key, no "stale" key and no "warnings" key
      When I send "GET /api/graph" with the token
      Then the only node is "src" and it has files 4
      When I send "GET /api/detail?id=src/domain&at=src" with the token
      Then the status is 200
      When I send "GET /api/pairs?from=src/app&to=src/domain&at=src" with the token
      Then the body is {"pairs":[["src/app/a.ts","src/domain/model.ts"]]}
      When I send "GET /api/layout" with the token
      Then the status is 200 and the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      When I send "POST /api/rescan" with the token
      Then the status is 200 and the body holds "files" 4
      When I send "GET /api/plans" with the token
      Then the body is {"plans":[]}
      When I send "GET /api/plans/gate/nope" with the token
      Then the status is 404 and the body is {"error":"not found"}
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario Outline: Host and token still guard the new route and the old one
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                                  | credentials                                      | status | body                               |
        | GET /api/plans/gate/contract         | no header of my own                              | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/contract        | no header of my own                              | 401    | {"error":"missing or wrong token"} |
        | GET /api/plans/gate/contract         | the header "Host: evil.example:5000" and the token | 403 | {"error":"bad host"}               |
        | POST /api/plans/gate/contract        | the body {"names":"no"} and the token            | 400    | {"error":"bad contract"}           |
        | GET /api/graph?at=src                    | no header of my own                              | 401    | {"error":"missing or wrong token"} |

    Scenario: The README lists the contract route beside the old ones
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route                            | status |
        | `/api/tree`                      | live   |
        | `/api/file`                      | live   |
        | `/api/graph`                     | live   |
        | `/api/rescan`                    | live   |
        | `/api/layout`                    | live   |
        | `/api/detail`                    | live   |
        | `/api/plans`                     | live   |
        | `/api/pairs`                     | live   |
        | `/api/plans/<slug>/contract`     | live   |

  Rule: the page lists the rules, the diff follows the ticks, and save stays on the plan
    "Contract" is in the plan toolbar only while a plan is open. It opens the
    panel. The list is the generated rules, comment then name, each with a
    checkbox whose accessible name is the rule name. With no saved contract
    every box is checked. With a saved contract a box is checked exactly when
    one saved rule equals that generated rule. A new rule is unchecked. Close
    and Escape close without a PUT. The diff is the POST for the checked names.
    Unticking updates it and does not PUT and does not write the cruiser file.
    "Save to plan" PUTs "contract.rules" as the checked rules in list order.
    "Copy" copies "text", or the snippet when the merge was refused. The
    address bar does not gain a contract parameter.

    Scenario: Contract lists the five rules, and unticking one changes only the diff
      Given the plan "Gate" has the two cuts and is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=gate"
      And "Contract" is shown
      When I click "Contract"
      Then the panel shows these rows, in order, each checkbox checked:
        | comment                              | name                                     |
        | src/app must not import src/domain   | bindweed:no-src-app-to-src-domain        |
        | src/app/a.ts must not import src/app/b.ts | bindweed:no-src-app-a-ts-to-src-app-b-ts |
        | src/domain does not use src/infra    | bindweed:src-domain-does-not-use-src-infra |
        | src/infra does not use src/app       | bindweed:src-infra-does-not-use-src-app  |
        | No circular dependencies             | bindweed:no-circular                     |
      And the diff contains "+      name: 'bindweed:no-circular',"
      And the address bar is unchanged
      When I uncheck "bindweed:no-circular"
      Then the diff does not contain "bindweed:no-circular" and still contains "bindweed:no-src-app-to-src-domain"
      And "GET /api/plans/gate" has no contract key
      And "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist
      When I click "Close" and click "Contract" again
      Then "bindweed:no-circular" is checked
      When I uncheck "bindweed:no-circular" and click "Save to plan"
      Then "GET /api/plans/gate" has contract rules with the other four names and without "bindweed:no-circular"
      When I reload the page and click "Contract"
      Then "bindweed:no-circular" is unchecked and the other four are checked
      When I click "Copy"
      Then the clipboard is the merged text, and it does not contain "bindweed:no-circular"
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: With no plan there is no Contract button
      When I open "http://127.0.0.1:5000/?token={token}#at=src" in a browser
      Then "Contract" is not shown
      And the "app" box reads "2 files", the "infra" box reads "1 file" and the "domain" box reads "1 file"

    Scenario: A saved rule that still matches stays ticked, and a new one does not
      Given the plan "Gate" has no edits and contract rules are the four empty-plan rules, except the first comment is "old"
      When I open the panel
      Then "bindweed:src-domain-does-not-use-src-app" is unchecked
      And the other three are checked
      Given the plan also has the package cut of app to domain, and the contract is unchanged
      When I open the panel
      Then "bindweed:no-src-app-to-src-domain" is unchecked
      And "bindweed:src-domain-does-not-use-src-app" is not in the list
      And "bindweed:src-domain-does-not-use-src-infra", "bindweed:src-infra-does-not-use-src-app" and "bindweed:no-circular" are checked

    Scenario: A spread is refused in the panel and Copy copies the snippet
      Given the plan "Gate" has the two cuts
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "const base = [];\nmodule.exports = { forbidden: [...base] };\n"
      When the panel is open
      Then it shows "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array"
      And the snippet contains "name: 'bindweed:no-src-app-to-src-domain'"
      And the diff region is not shown
      When I click "Copy"
      Then the clipboard equals the snippet
      When I click "Save to plan"
      Then the file's bytes are unchanged
      And "GET /api/plans/gate" has the five rule names under contract, in list order

  Rule: the merged file is what dependency-cruiser enforces
    Scenario: The canonical text fails the layered imports and ignores the kept ones
      Given a copy of the layered sources and tsconfig at "/tmp/qa/cruise" with the canonical "text" saved as ".dependency-cruiser.cjs"
      When I run "npx depcruise --config .dependency-cruiser.cjs src" there, using bindweed's installed dependency-cruiser, with that directory as the working directory
      Then the exit status is 3
      And stdout contains "  error bindweed:no-src-app-to-src-domain: src/app/a.ts → src/domain/model.ts"
      And stdout contains "  error bindweed:no-src-app-a-ts-to-src-app-b-ts: src/app/a.ts → src/app/b.ts"
      And stdout contains "error bindweed:no-circular:"
      And stdout contains "x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised."
      And stdout does not contain "db.ts"
      And stdout does not contain "does-not-use"
