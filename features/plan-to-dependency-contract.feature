Feature: turn a plan into a dependency contract the gate can enforce
  A developer with a plan open presses Contract, sees the dependency-cruiser
  rules that would freeze the planned shape, unticks any they do not want, and
  saves the rest on the plan. Nothing in the repository is written. The merged
  text is what a later run would put in .dependency-cruiser.cjs.

  The served tree is the checked-in four-file layered fixture, not the tree in
  features/plan-moves-and-edges.feature. version stays 1. "bindweed" is "node
  <bindweed dir>/src/cli.ts". /tmp/qa is fresh. bindweed serves /tmp/qa/layered
  on port 5000 unless a scenario says otherwise. {token} is that process's
  token. "with the token" sends "Authorization: Bearer {token}". Requests carry
  "Host: 127.0.0.1:5000" unless a scenario sets another. JSON is compared as
  JSON. A key a body omits is absent. In a table cell or a quoted step string
  \n is a newline. A doc string that holds a file or a "text" ends in one
  newline after its last line. Each scenario starts from the Background
  again. "The plan "Gate" has <edits>" means POST /api/plans {"name":"Gate"}
  made the plan, slug gate, and a PUT stored those edits with redo []. "The
  package cut" is
  {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]},
  "the file cut" is
  {"kind":"cut-edge","from":"src/app/a.ts","to":"src/app/b.ts","files":[["src/app/a.ts","src/app/b.ts"]]},
  and "the two cuts" are both, in that order. A pattern is written here as the
  regular expression itself, one backslash per escape; JSON and the file's
  quoted strings write each backslash twice. A rule "from P to Q" has from
  {"path":"P"} and to {"path":"Q"}. The panel is the dialog labelled
  "Contract"; its diff region is labelled "diff" and its snippet region
  "snippet".

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

  Rule: the planned graph becomes forbidden rules
    GET /api/plans/<slug>/contract answers {"rules":[...]}: the cut rules, then
    the direction rules, then bindweed:no-circular. A rule has exactly name,
    severity "error", comment, from and to.
    Cuts. Each non-stale cut-edge in edits gives one rule, in edit order; redo
    is ignored. Its ends are the cut's "from" and "to", each carried through
    every later non-stale edit that moves that path: move-file and rename-file
    move exactly their file, rename-package and merge-packages move the package
    and every path inside it, split-package moves each file a part lists into
    that part, and a fold moves the folded file onto its "into". Notes,
    creates, deletes, cuts and added edges move nothing. An end that is a file
    of the planned scan has the pattern "^<end>$"; any other end is a package
    with the pattern "^<end>/", so a cut between a file and a package mixes the
    two. A cut whose ends end up equal, or one inside the other, gives no rule.
    A rule equal to an earlier rule is not repeated.
    Direction. A package is a directory, not the root, that holds a non-test
    file of the planned scan at any depth, or that the plan declares (a created
    package or a split part). It counts even where the view hides it after a
    split. Packages with the same parent directory are siblings; no other pair
    gives a direction rule. An edge runs from P to Q when its importing end is
    P or inside P and its imported end is Q or inside Q. Every file edge of the
    planned scan counts, from test files and files marked for deletion too, and
    so does every non-stale added edge, on the ends the planned graph gives it
    (as in 005, a move does not carry an added edge). A sibling pair with an
    edge one way and none the other way gives exactly one rule, forbidding the
    other way.
    Direction rules are sorted by name in code-unit order, the order
    JavaScript's < gives strings.
    Cycles. bindweed:no-circular is left out only when the cruiser file can be
    merged and one of its kept elements (see the merge rule) has a "to" object
    whose "circular" is true. With no file it is there.
    Words. A name spells each path with every "/" and "." replaced by "-"; all
    other characters stay. A pattern puts a backslash in front of each of
    \ ^ $ . * + ? ( ) [ ] { } | in the path and escapes nothing else, so "/"
    and "-" stay as they are.
      | kind      | name                                | comment                     | from and to                                  |
      | cut       | bindweed:no-<from>-to-<to>          | <from> must not import <to> | from <from>'s pattern to <to>'s pattern      |
      | direction | bindweed:<used>-does-not-use-<user> | <used> does not use <user>  | from ^<used>/ to ^<user>/                    |
      | cycles    | bindweed:no-circular                | No circular dependencies    | from {} and to {"circular":true}             |
    <user> is the package the one-way edges leave and <used> the one they enter.

    Scenario: An empty plan freezes the three one-way pairs and cycles
      Given the plan "Gate" has no edits
      When I send "GET /api/plans/gate/contract" with the token
      Then the status is 200 and "rules" is exactly, in order:
        | name                                       | comment                           | from                    | to                     |
        | bindweed:src-domain-does-not-use-src-app   | src/domain does not use src/app   | {"path":"^src/domain/"} | {"path":"^src/app/"}   |
        | bindweed:src-domain-does-not-use-src-infra | src/domain does not use src/infra | {"path":"^src/domain/"} | {"path":"^src/infra/"} |
        | bindweed:src-infra-does-not-use-src-app    | src/infra does not use src/app    | {"path":"^src/infra/"}  | {"path":"^src/app/"}   |
        | bindweed:no-circular                       | No circular dependencies          | {}                      | {"circular":true}      |
      And every rule has severity "error"

    Scenario: A later rename uses the planned paths
      Given the plan "Gate" has the edits, in order: the package cut, {"kind":"rename-package","from":"src/domain","to":"src/core"}, the file cut, {"kind":"rename-file","from":"src/app/b.ts","to":"c.ts"}
      When I send "GET /api/plans/gate/contract" with the token
      Then the rule names are exactly, in order:
        | name                                     |
        | bindweed:no-src-app-to-src-core          |
        | bindweed:no-src-app-a-ts-to-src-app-c-ts |
        | bindweed:src-core-does-not-use-src-infra |
        | bindweed:src-infra-does-not-use-src-app  |
        | bindweed:no-circular                     |
      And "bindweed:no-src-app-to-src-core" has comment "src/app must not import src/core" and is from "^src/app/" to "^src/core/"
      And "bindweed:no-src-app-a-ts-to-src-app-c-ts" has comment "src/app/a.ts must not import src/app/c.ts" and is from "^src/app/a\.ts$" to "^src/app/c\.ts$"
      And "bindweed:src-core-does-not-use-src-infra" is from "^src/core/" to "^src/infra/"
      And no rule's name, comment or pattern contains "src/domain" or "b.ts"

    Scenario Outline: A later move, split or fold carries the file cut's ends
      Given the plan "Gate" has the edits, in order: the file cut, <later>
      When I send "GET /api/plans/gate/contract" with the token
      Then the rule names are exactly <names>, in that order
      And the first rule is from "<from>" to "<to>"
      And every rule whose comment is "X does not use Y" is from "^X/" to "^Y/"
      Examples:
        | later | names | from | to |
        | {"kind":"move-file","file":"src/app/b.ts","to":"src/infra"} | bindweed:no-src-app-a-ts-to-src-infra-b-ts, bindweed:src-domain-does-not-use-src-app, bindweed:src-domain-does-not-use-src-infra, bindweed:no-circular | ^src/app/a\.ts$ | ^src/infra/b\.ts$ |
        | {"kind":"split-package","package":"src/app","parts":[{"name":"x","files":["src/app/a.ts"]},{"name":"y","files":["src/app/b.ts"]}]} | bindweed:no-src-app-x-a-ts-to-src-app-y-b-ts, bindweed:src-app-x-does-not-use-src-app-y, bindweed:src-domain-does-not-use-src-app, bindweed:src-domain-does-not-use-src-infra, bindweed:src-infra-does-not-use-src-app, bindweed:no-circular | ^src/app/x/a\.ts$ | ^src/app/y/b\.ts$ |
        | {"kind":"fate","file":"src/app/b.ts","fate":"fold","into":"src/infra/db.ts"} | bindweed:no-src-app-a-ts-to-src-infra-db-ts, bindweed:src-domain-does-not-use-src-app, bindweed:src-domain-does-not-use-src-infra, bindweed:no-circular | ^src/app/a\.ts$ | ^src/infra/db\.ts$ |

    Scenario: A cut from a file to a package matches the file exactly and the package by prefix
      Given "/tmp/qa/layered/src/main.ts" contains "import { a } from './app/a';\nexport const main = a;\n"
      And I send "POST /api/rescan" with the token
      And the plan "Gate" has the only edit {"kind":"cut-edge","from":"src/main.ts","to":"src/app","files":[["src/main.ts","src/app/a.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then the first rule is "bindweed:no-src-main-ts-to-src-app" with comment "src/main.ts must not import src/app", from "^src/main\.ts$" to "^src/app/"
      And the other four names are those of "An empty plan freezes the three one-way pairs and cycles", in that order

    Scenario: A plus in a path is escaped in the pattern and kept in the name
      Given "/tmp/qa/layered/src/c++/plus.ts" contains "import { a } from '../app/a';\nexport const plus = a;\n"
      And I send "POST /api/rescan" with the token
      And the plan "Gate" has the only edit {"kind":"cut-edge","from":"src/c++/plus.ts","to":"src/app/a.ts","files":[["src/c++/plus.ts","src/app/a.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then the first rule is "bindweed:no-src-c++-plus-ts-to-src-app-a-ts" with comment "src/c++/plus.ts must not import src/app/a.ts", from "^src/c\+\+/plus\.ts$" to "^src/app/a\.ts$"
      And the other four names are those of "An empty plan freezes the three one-way pairs and cycles", in that order

    Scenario: An edge both ways drops the pair, and a stale, redone or merged-away cut adds no rule
      Given the plan "Gate" has the only edit {"kind":"add-edge","from":"src/domain","to":"src/app"}
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are exactly "bindweed:src-domain-does-not-use-src-infra", "bindweed:src-infra-does-not-use-src-app" and "bindweed:no-circular", in that order
      Given the plan "Gate" has the only edit {"kind":"cut-edge","from":"src/missing","to":"src/domain","files":[["src/missing/a.ts","src/domain/model.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are the four of the empty plan
      Given the plan "Gate" has edits [] and redo [the package cut]
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are the four of the empty plan
      Given the plan "Gate" has the edits, in order: the package cut, {"kind":"merge-packages","packages":["src/app","src/domain"],"into":"src/core"}
      When I send "GET /api/plans/gate/contract" with the token
      Then the names are exactly "bindweed:no-circular"

  Rule: the merged file is only previewed
    POST /api/plans/<slug>/contract with exactly {"names":[strings]} answers
    200 {"text","diff"}, or 200 {"error","snippet"} when the file cannot be
    merged, and writes nothing. The selection is the generated rules whose names
    are listed, in generated order; other names are ignored and [] is legal. Any
    other body answers 400 {"error":"bad contract"}. On GET and POST a slug that
    fails ^[a-z0-9][a-z0-9-]*$ or names no plan answers 404 {"error":"no such
    plan"}, before the body is read. Another method, or another path segment
    after the slug or after "contract", answers 404 {"error":"not found"}. The
    cruiser file is the served repository root's .dependency-cruiser.cjs, read
    on every request, so no rescan is needed. With no file, "text" is the
    canonical file: the layout in the next scenario with the selected rules, and
    without the tsConfig line when the root has no tsconfig.json. A "'" or "\"
    inside a generated string gets a backslash in front. "diff" starts with the
    two header lines "--- a/.dependency-cruiser.cjs" and
    "+++ b/.dependency-cruiser.cjs", with no timestamps. When "text" equals the
    file's bytes (empty when there is no file), "diff" is exactly those two
    lines, each ending in a newline. Otherwise it is a unified diff under those
    headers whose "+" lines are lines of "text" and whose "-" lines are lines
    of the file.

    Scenario: Two cuts preview the canonical file and do not touch the repo
      Given the plan "Gate" has the two cuts
      When I send "GET /api/plans/gate/contract" with the token
      Then the status is 200 and the rule names are exactly, in order:
        | name                                       |
        | bindweed:no-src-app-to-src-domain          |
        | bindweed:no-src-app-a-ts-to-src-app-b-ts   |
        | bindweed:src-domain-does-not-use-src-infra |
        | bindweed:src-infra-does-not-use-src-app    |
        | bindweed:no-circular                       |
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
      And "diff" starts with the two header lines and contains "+      name: 'bindweed:no-src-app-to-src-domain',"
      And "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      When I send the same POST again
      Then "text" and "diff" are unchanged

    Scenario: Workspace siblings give one rule, and a repo with no tsconfig omits tsConfig
      Given "/tmp/qa/workspace" is a copy of bindweed's qa/fixtures/workspace, committed as a git repository, with no tsconfig.json
      And bindweed is serving "/tmp/qa/workspace" on port 5000
      And the plan "Gate" has no edits
      When I send "GET /api/plans/gate/contract" with the token
      Then "rules" is exactly, in order:
        | name                                             | comment                                 | from                       | to                        |
        | bindweed:packages-core-does-not-use-packages-web | packages/core does not use packages/web | {"path":"^packages/core/"} | {"path":"^packages/web/"} |
        | bindweed:no-circular                             | No circular dependencies                | {}                         | {"circular":true}         |
      When I send "POST /api/plans/gate/contract" with the token and both names
      Then "text" is exactly:
        """
        module.exports = {
          forbidden: [
            {
              name: 'bindweed:packages-core-does-not-use-packages-web',
              severity: 'error',
              comment: 'packages/core does not use packages/web',
              from: { path: '^packages/core/' },
              to: { path: '^packages/web/' }
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
            tsPreCompilationDeps: true
          }
        };
        """
      When I send "POST /api/plans/gate/contract" with the token and the names []
      Then "text" is that file with everything from "  forbidden: [" through its closing "  ]," replaced by the one line "  forbidden: [],"

  Rule: an existing cruiser file keeps every byte that is not a bindweed rule
    The file is read as JavaScript with the TypeScript compiler API. Its object
    is the object literal assigned to module.exports, or the one after export
    default when there is no such assignment. "forbidden" must be a property of
    that object whose value is an array literal of object literals. Anything
    else, such as a spread, a variable, a call, an element that is not an
    object literal, no "forbidden" key, no such object, or a file that does not
    parse, is refused: the body is
    {"error":"bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array","snippet":"<rules>"}
    and "snippet" is the selected rules, each laid out with a four-space indent
    as in the canonical file, joined by ",\n", plus a final newline, or "" when
    none is selected.
    A bindweed element is one whose "name" is a string literal starting with
    "bindweed:". Every other element is kept byte for byte. Removing a bindweed
    element deletes the bytes from the end of the nearest kept element before
    it to the end of the bindweed element; with no kept element before it, from
    just after "[" to the end of the comma that follows it, or to its own end
    when no comma follows. So its comma, line breaks, indent and any comment in
    front of it go with it. The selected rules are then inserted right after
    the last kept element, each as ",", a line break, that element's indent and
    the rule laid out at that indent. The bytes after that element, a trailing
    comma included, stay. The indent is the spaces and tabs that start the line
    on which that element starts. When no element is kept, the array literal
    becomes "[", each rule on its own line at a four-space indent joined by ",",
    a line break and "  ]"; or "[]" when nothing is selected. Merging the result
    again with the same selection gives the same bytes.

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

    Scenario: An existing circular rule leaves bindweed:no-circular out
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
      Then the names are the three "-does-not-use-" names of the empty plan, in that order, and not "bindweed:no-circular"
      When I send "POST /api/plans/gate/contract" with the token and those three names plus "bindweed:no-circular"
      Then "text" holds the three rules after the "no-circular" object and does not contain "bindweed:no-circular"
      And the "no-circular" object occupies the same bytes as in the original file

    Scenario: Old bindweed rules are removed with what sits in front of them, and do not leave cycles out
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly:
        """
        const note = 'leave me';
        module.exports = {
          forbidden: [
            // made by bindweed
            {
              name: 'bindweed:old',
              severity: 'error',
              comment: 'gone',
              from: {},
              to: { circular: true }
            },
            {
              name: 'keep-me',
              severity: 'warn',
              from: {},
              to: { path: '^keep' }
            },
            { name: 'bindweed:older', severity: 'error', comment: 'gone too', from: {}, to: { path: '^x' } }
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
      Then "text" is exactly:
        """
        export default {
          forbidden: [
            { name: 'keep-me', severity: 'warn', from: {}, to: { path: '^keep' } },
            {
              name: 'bindweed:no-circular',
              severity: 'error',
              comment: 'No circular dependencies',
              from: {},
              to: { circular: true }
            }
          ]
        };
        """

    Scenario Outline: A forbidden list we cannot read is refused, and the file stays
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "<source>"
      When I send "POST /api/plans/gate/contract" with the token and the names ["bindweed:no-circular"]
      Then the status is 200 and "error" is "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array"
      And "snippet" is exactly "    {\n      name: 'bindweed:no-circular',\n      severity: 'error',\n      comment: 'No circular dependencies',\n      from: {},\n      to: { circular: true }\n    }\n"
      And there is no "text" and no "diff"
      And the file's bytes are unchanged
      When I send "POST /api/plans/gate/contract" with the token and the names []
      Then "snippet" is ""
      Examples:
        | source |
        | const base = [];\nmodule.exports = { forbidden: [...base] };\n |
        | const base = [];\nmodule.exports = { forbidden: base };\n |
        | function make() { return []; }\nmodule.exports = { forbidden: make() };\n |
        | const rule = {};\nmodule.exports = { forbidden: [rule] };\n |
        | module.exports = { options: {} };\n |
        | module.exports = {\n |

  Rule: contract is optional on the plan, and the old routes stay
    "contract" is {"rules":[...]} and nothing else. A rule has exactly name,
    severity, comment, from and to. severity is "error". name starts with
    "bindweed:". comment is a non-empty string. from is {} or {"path":string}.
    to is {"path":string} or {"circular":true}. The key is absent when the plan
    has no contract, and {"rules":[]} is a saved contract. PUT of a bad
    contract answers 400 {"error":"bad plan"} and leaves the bytes. A document
    with a key outside the 005 keys and "contract" is still bad. GET /api/plans
    summaries have no contract and editCount is the edits length. GET of the
    document returns the saved rules. No graph, detail, pairs, tree, file or
    layout body gains a contract key.

    Scenario: A 005 or 006 plan file loads with no contract, and a bad contract is refused
      Given "/tmp/qa/layered/.bindweed/plans/split-app.json" contains exactly {"version":1,"name":"Split app","slug":"split-app","createdAt":"2026-10-01T00:00:00.000Z","baseCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","edits":[{"kind":"move-file","file":"src/app/b.ts","to":"src/infra"},{"kind":"rename-package","from":"src/domain","to":"src/core"}],"redo":[]}
      When I send "GET /api/plans/split-app" with the token
      Then the status is 200 and the body is that document, with no contract key
      When I send "GET /api/graph?at=src&plan=split-app" with the token
      Then the status is 200, there is no contract key and "stale" is [null,null]
      When I send "GET /api/plans" with the token
      Then the only summary has editCount 2 and no contract key
      When I send "PUT /api/plans/split-app" with the token and that document plus "contract":{"rules":[{"name":"no-circular","severity":"error","comment":"No circular dependencies","from":{},"to":{"circular":true}}]}
      Then the status is 400 and the body is {"error":"bad plan"}
      And the file's bytes are unchanged
      When I send "PUT /api/plans/split-app" with the token and that document plus "extra":1
      Then the status is 400 and the body is {"error":"bad plan"}

    Scenario: Save stores the chosen rules and an empty list is not absence
      Given the plan "Gate" has the two cuts
      When I send "PUT /api/plans/gate" with the token and that document plus the canonical file's five rules as "contract"
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
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario Outline: The new route refuses what it cannot answer, and the guards still hold
      Given the plan "Gate" has no edits
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                            | credentials                                        | status | body                               |
        | GET /api/plans/gate/contract       | no header of my own                                | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/contract      | no header of my own                                | 401    | {"error":"missing or wrong token"} |
        | GET /api/plans/gate/contract       | the header "Host: evil.example:5000" and the token | 403    | {"error":"bad host"}               |
        | POST /api/plans/gate/contract      | the body {"names":"no"} and the token              | 400    | {"error":"bad contract"}           |
        | POST /api/plans/gate/contract      | the body {"names":[],"extra":1} and the token      | 400    | {"error":"bad contract"}           |
        | POST /api/plans/nope/contract      | the body {"names":"no"} and the token              | 404    | {"error":"no such plan"}           |
        | GET /api/plans/Gate/contract       | the token                                          | 404    | {"error":"no such plan"}           |
        | PUT /api/plans/gate/contract       | the body {"names":[]} and the token                | 404    | {"error":"not found"}              |
        | GET /api/plans/gate/contract/extra | the token                                          | 404    | {"error":"not found"}              |
        | GET /api/plans/gate/nope           | the token                                          | 404    | {"error":"not found"}              |
        | GET /api/graph?at=src              | no header of my own                                | 401    | {"error":"missing or wrong token"} |

    Scenario: The README lists the contract route beside the old ones
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route                        | status |
        | `/api/tree`                  | live   |
        | `/api/file`                  | live   |
        | `/api/graph`                 | live   |
        | `/api/rescan`                | live   |
        | `/api/layout`                | live   |
        | `/api/detail`                | live   |
        | `/api/plans`                 | live   |
        | `/api/pairs`                 | live   |
        | `/api/plans/<slug>/contract` | live   |

  Rule: the page lists the rules, the diff follows the ticks, and Save keeps them on the plan
    "Contract" is in the plan toolbar only while a plan is open, and opens the
    panel. Each opening fetches the rules again. Each row shows the comment,
    then the name, and a checkbox whose accessible name is the rule name. With
    no saved contract every box is checked. With a saved contract a box is
    checked exactly when a saved rule equals that rule in all five fields, so a
    new or changed rule starts unchecked. The diff is the POST for the checked
    names and follows every tick; ticking does not PUT. "Save to plan" PUTs the
    open plan with "contract" {"rules": the checked rules in list order} and
    closes the panel. Later edits, Undo, Redo and Remove keep that contract.
    "Close" and Escape close the panel without a PUT and drop unsaved ticks.
    When the merge is refused the panel shows the refusal and the snippet in
    place of the diff, and "Copy" copies the snippet; otherwise "Copy" copies
    "text". The address bar never gains a contract parameter.

    Scenario: Contract lists the five rules, and the ticks change only the diff until Save
      Given the plan "Gate" has the two cuts and is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      Then the address bar shows "http://127.0.0.1:5000/#at=src&plan=gate"
      When I click "Contract"
      Then the panel shows these rows, in order, each checkbox checked:
        | comment                                   | name                                       |
        | src/app must not import src/domain        | bindweed:no-src-app-to-src-domain          |
        | src/app/a.ts must not import src/app/b.ts | bindweed:no-src-app-a-ts-to-src-app-b-ts   |
        | src/domain does not use src/infra         | bindweed:src-domain-does-not-use-src-infra |
        | src/infra does not use src/app            | bindweed:src-infra-does-not-use-src-app    |
        | No circular dependencies                  | bindweed:no-circular                       |
      And the diff contains "+      name: 'bindweed:no-circular',"
      When I uncheck "bindweed:no-circular"
      Then the diff does not contain "bindweed:no-circular" and still contains "+      name: 'bindweed:no-src-app-to-src-domain',"
      And "GET /api/plans/gate" has no contract key
      When I click "Close" and click "Contract" again
      Then "bindweed:no-circular" is checked
      When I uncheck "bindweed:no-circular" and click "Save to plan"
      Then the panel is closed
      And "GET /api/plans/gate" has the two cuts as edits and, under contract, the first four rules of the canonical file, in order
      When I reload the page and click "Contract"
      Then "bindweed:no-circular" is unchecked and the other four are checked
      When I click "Copy"
      Then the clipboard is the POST "text" for the four checked names, and it does not contain "bindweed:no-circular"
      And the address bar shows "http://127.0.0.1:5000/#at=src&plan=gate"
      And "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: A saved contract survives a later cut and Undo without a reload
      Given the plan "Gate" has the two cuts and is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      When I click "Contract", uncheck "bindweed:no-circular" and click "Save to plan"
      And I click the arrow from "infra" to "domain" and press Delete, without reloading
      Then "GET /api/plans/gate" has three edits, the last {"kind":"cut-edge","from":"src/infra","to":"src/domain","files":[["src/infra/db.ts","src/domain/model.ts"]]}, and under contract the same four rules
      When I click "Undo"
      Then "GET /api/plans/gate" has the two cuts as edits, that infra cut as the only redo, and under contract the same four rules
      When I click "Contract"
      Then "bindweed:no-circular" is unchecked and the other four are checked

    Scenario: With no plan there is no Contract button
      When I open "http://127.0.0.1:5000/?token={token}#at=src" in a browser
      Then "Contract" is not shown
      And the "app" box reads "2 files", the "infra" box reads "1 file" and the "domain" box reads "1 file"

    Scenario: A saved rule that still matches stays ticked, and a new one does not
      Given the plan "Gate" has no edits and its contract is the four empty-plan rules, except that the first has comment "old"
      When I open "http://127.0.0.1:5000/?token={token}#at=src&plan=gate" and click "Contract"
      Then "bindweed:src-domain-does-not-use-src-app" is unchecked
      And the other three are checked
      Given the plan "Gate" now has the package cut as its only edit, with the contract unchanged
      When I reload the page and click "Contract"
      Then "bindweed:no-src-app-to-src-domain" is unchecked
      And "bindweed:src-domain-does-not-use-src-app" is not in the list
      And "bindweed:src-domain-does-not-use-src-infra", "bindweed:src-infra-does-not-use-src-app" and "bindweed:no-circular" are checked

    Scenario: A spread is refused in the panel, Copy copies the snippet, and Save still saves
      Given the plan "Gate" has the two cuts
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "const base = [];\nmodule.exports = { forbidden: [...base] };\n"
      When I open "http://127.0.0.1:5000/?token={token}#at=src&plan=gate" and click "Contract"
      Then the panel shows "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array"
      And the snippet contains "name: 'bindweed:no-src-app-to-src-domain'"
      And the diff region is not shown
      When I click "Copy"
      Then the clipboard equals the snippet
      When I click "Save to plan"
      Then the file's bytes are unchanged
      And "GET /api/plans/gate" has the five rule names under contract, in list order

  Rule: the merged file is what dependency-cruiser enforces
    Scenario: The canonical text fails the imports the plan cuts
      Given a copy of the layered sources and tsconfig at "/tmp/qa/cruise" with the canonical "text" saved as ".dependency-cruiser.cjs"
      When I run "npx depcruise --config .dependency-cruiser.cjs src" there, using bindweed's installed dependency-cruiser, with that directory as the working directory
      Then the exit status is 3
      And stdout contains "  error bindweed:no-src-app-to-src-domain: src/app/a.ts → src/domain/model.ts"
      And stdout contains "  error bindweed:no-src-app-a-ts-to-src-app-b-ts: src/app/a.ts → src/app/b.ts"
      And stdout contains "error bindweed:no-circular:"
      And stdout contains "x 3 dependency violations (3 errors, 0 warnings). 4 modules, 6 dependencies cruised."
      And stdout does not contain "db.ts"
      And stdout does not contain "does-not-use"

    Scenario: Test files count both ways, so the gate does not fail on them
      Given "/tmp/qa/layered/src/infra/db.test.ts" contains "import { a } from '../app/a';\nexport const t = a;\n"
      And "/tmp/qa/layered/src/extra/t.test.ts" contains "import { query } from '../infra/db';\nexport const t = query;\n"
      And I send "POST /api/rescan" with the token
      And the plan "Gate" has the two cuts
      When I send "GET /api/plans/gate/contract" with the token
      Then the rule names are exactly "bindweed:no-src-app-to-src-domain", "bindweed:no-src-app-a-ts-to-src-app-b-ts", "bindweed:src-domain-does-not-use-src-infra" and "bindweed:no-circular", in that order
      And no rule's name, comment or pattern contains "extra"
      Given a copy of /tmp/qa/layered's tsconfig and src, both test files included, at "/tmp/qa/cruise", with the POST "text" for those four names saved as ".dependency-cruiser.cjs"
      When I run "npx depcruise --config .dependency-cruiser.cjs src" there, as in the previous scenario
      Then the exit status is 3
      And stdout contains "x 3 dependency violations (3 errors, 0 warnings). 6 modules, 8 dependencies cruised."
      And stdout does not contain "db.test.ts" and does not contain "t.test.ts"
