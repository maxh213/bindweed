Feature: say what you dislike and review the proposed reshaping on the canvas
  A developer with a plan open types what bothers them and presses Propose. An LLM
  proposes edits. Valid ones are drawn in purple on the planned view; the rest are
  listed as dropped and not drawn. Accept appends an edit to the plan, one undo
  step each. Reject drops it. Nothing reaches the plan until Accept. A later
  message replaces the open proposals. The conversation is kept beside the plan.

  The tree, server, token, {head}, Host header and JSON comparison are the
  Background of features/plan-to-dependency-contract.feature. "bindweed" is
  "node <bindweed dir>/src/cli.ts" on port 5000. \n in a quoted step is a newline.
  The en dash in a metric is U+2013. The arrow in a cycle is U+2192. The dash in
  a dropped line is U+2014. The proposal colour is #7c3aed. Each scenario starts
  from the Background again.

  "The plan "Gate" has <edits>" is as in features/flesh-out-into-tasks-and-brief.feature.
  "The package cut" is {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}.
  "The cut", "the package", "the move" and "the missing" are, in this order, the
  package cut, {"kind":"create-package","path":"src/ports"},
  {"kind":"move-file","file":"src/app/b.ts","to":"src/ports"} and
  {"kind":"move-file","file":"src/no-such.ts","to":"src/ports"}. "The four edits"
  are those four. "The keep edit" is {"kind":"add-edge","from":"src/domain","to":"src/app"}.
  Their sentences are "src/app must not import src/domain (1 import)",
  "Create package src/ports", "Move src/app/b.ts to src/ports",
  "Move src/no-such.ts to src/ports" and "src/domain should use src/app".
  "The jobs edits" are, in this order,
  {"kind":"split-package","package":"src/app","parts":[{"name":"scan","files":["src/app/a.ts"]},{"name":"jobs","files":["src/app/b.ts"]}]},
  {"kind":"move-file","file":"src/app/scan/a.ts","to":"src/infra"},
  {"kind":"fate","file":"src/infra/db.ts","fate":"delete"} and
  {"kind":"note","target":{"node":"src/app"},"text":"three jobs"}. Their
  sentences are "Split src/app into src/app/scan (1 file) and src/app/jobs (1 file)",
  "Move src/app/scan/a.ts to src/infra", "Delete src/infra/db.ts" and
  "Note on src/app: \"three jobs\"".

  "The fake" is the 008 fake from features/flesh-out-into-tasks-and-brief.feature,
  with three rows checked after the SLEEP-NOW and BAD-ONCE rows and before
  "Reply with slices now.". A row matches the current dislike only: the prompt
  contains the two-line needle "## What they dislike\n<phrase>\n". History is
  quoted as "They said:" and does not match. "keep scan where it is" is checked
  before "the ui knows about the scanner". The proposals reply is prose, a fenced
  json block {"example":1}, the line "Proposed.", then a fenced json block of
  {"summary":"Pull scanning out of the ui so app has one job.","edits":<the four edits>}.
  The keep reply is a fenced json block of
  {"summary":"Leave scanning in app.","edits":[<the keep edit>]}. The jobs
  reply, for "app is doing three jobs", is a fenced json block of
  {"summary":"Give each job its own package.","edits":<the jobs edits>}.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed four-file fixture of features/plan-to-dependency-contract.feature and /tmp/qa/log is empty
    And bindweed is serving it with "/tmp/qa/layered/.bindweed/config.json" holding {"llm":{"backend":"command","command":"<the fake>"}}

  Rule: Propose asks through the 008 backend and saves a chat beside the plan
    An unknown slug on propose, chat (GET or PUT) or review answers 404
    {"error":"no such plan"} before the body is read, and writes nothing.
    POST /api/plans/<slug>/propose takes exactly {"text":T,"at":A}. T is a
    non-blank string and may hold "\n". A is "" or a directory for which this
    plan's planned graph (its edits, not redo, tests and external off) has a
    view, the same answer GET /api/graph?at=A&plan=<slug> gives. Anything else,
    including a blank T or an A that is not a view, answers 400
    {"error":"bad propose"} and does not run the LLM. The backend, its 15 minute
    limit, the route fallback, Cancel, the retry and the error bodies are the
    Generate rule of features/flesh-out-into-tasks-and-brief.feature. Propose
    shares that plan's one run with generate, so the other answers 409
    {"error":"already running"}. "One paragraph" is a string with a
    non-whitespace character and no "\n" or "\r". The reply is the last fenced
    json block, else all of stdout. Its reason, checked in this order: text that
    does not parse is "it is not valid JSON"; a value that is not an object
    with exactly the keys "summary" and "edits", with a string summary and an
    array edits, is "it needs a summary and an edits array"; a summary that is
    not one paragraph (empty, blank, or holding "\n" or "\r") is "the summary
    must be one paragraph". Anything else is usable. A first unusable reply is
    retried once. A usable reply does not change the plan. It appends
    one turn to .bindweed/plans/<slug>.chat.json and answers 200
    {"ran","summary","edits","stale","chat"} plus "note" when the Generate rule
    would add one. "stale" has one entry per edit: null when it applies, a
    reason when it does not. An element that is not a 005/006 edit has the
    reason "not an edit". Any other element is checked by the same code that
    applies plan edits, in order, against the plan's edits (not redo) with each
    earlier applicable proposal applied. A proposal that does not apply is not
    applied for the ones after it. Errors, Cancel, a time limit, a non-zero
    exit and a signal write no turn.
    The prompt's sections, joined by a blank line, are:
    - You are proposing edits to the plan "<name>". The developer says what they dislike; you propose edits they will accept or reject. You change nothing yourself.
    - ## What they dislike, then the text
    - ## Current view, then the at, or "(root)" when at is ""
    - ## Planned graph, then the current planned view and one level below.
      The first heading is "### <at>" or "### (root)". Then one "### <id>" per
      package node of that view, ids sorted by code unit, and no further level.
      The lines of this section are single-spaced.
      In each section, nodes then edges, in the planned graph's order, then
      "cycles none" or "cycles " plus that view's distinct cycle texts, the
      smaller text of each unordered pair, sorted by code unit and joined with
      " | ". A node line is "node <id> <kind> <name>" plus " files <n>" when
      the node has files, then " ca <ca> ce <ce> i <i> a <a> d <d>", then
      " zone <zone>" when it has a zone, then " crap <crap>", " coverage
      <coverage>" and " mutants <mutants>", in that order, for each of those
      fields the planned graph gives the node: crap is "–" or the number as
      String() writes it, coverage is the graph's two-decimal text. Only these
      three are added; the graph's crapMax and its "coverage" and "mutation"
      flags ("on", "stale", "off") are not. Then " cycle <true|false>". An edge line is "edge <from> -> <to> runtime <n>
      type <n>", then " heritage <n>" when heritage is greater than 0, then
      " cycle <true|false>", then " text <cycleText>" when the edge has one.
      Tests and external packages are off. Redo is not applied.
    - ## The plan's edits so far, then "none", or one line per edit with its
      sentence, then one line JSON.stringify(edits) of the whole array
    - ## Edit JSON, then these lines, word for word:
      {"kind":"move-file","file":"<path>","to":"<dir>"}
      {"kind":"cut-edge","from":"<box>","to":"<box>","files":[["<file>","<file>"]]}
      {"kind":"add-edge","from":"<box>","to":"<box>"}
      {"kind":"note","target":{"node":"<box>"},"text":"<text>"}
      {"kind":"note","target":{"edge":["<box>","<box>"]},"text":"<text>"}
      {"kind":"create-package","path":"<path>"}
      {"kind":"rename-package","from":"<path>","to":"<path>"}
      {"kind":"rename-file","from":"<path>","to":"<name>"}
      {"kind":"merge-packages","packages":["<path>"],"into":"<path>"}
      {"kind":"split-package","package":"<path>","parts":[{"name":"<name>","files":["<path>"]}]}
      {"kind":"fate","file":"<path>","fate":"delete"}
      {"kind":"fate","file":"<path>","fate":"fold","into":"<path>"}
    - ## Conversation so far, then "none", or each saved turn in order, with
      no blank line inside the section: "They said: <first line of text>",
      then each further line of the text (split on "\n") after two spaces,
      then "Summary: <summary>", then one line per edit
      "<index> <accepted|rejected|open>: <sentence>". A missing decision is
      "open". A value that is not an edit uses JSON.stringify of that value as
      its sentence. A chat file that is not a chat document counts as no turns.
    - ## What to reply, then "Reply with exactly one JSON object, in a fenced json block."
      and {"summary":"<one paragraph>","edits":[<edit>]}
    GET /api/plans/<slug>/chat answers the array, or 200 [] when the file is
    missing or is not a chat document, and does not create or change it. A
    usable reply over such a file writes a new file holding only the new
    turn. PUT replaces the file with a chat
    document: an array of turns with exactly the keys at, text, summary, edits
    and decisions. at matches the plan createdAt pattern. text is non-empty.
    summary is one paragraph. edits is an array. decisions maps the decimal
    index of an edit, with no leading zero, to "accepted" or "rejected".
    Anything else answers 400 {"error":"bad chat"} and leaves the bytes.
    POST /api/plans/<slug>/review takes exactly {"edits":[...]} and answers
    {"stale":[...]} by the same check, and writes nothing. Any other body
    answers 400 {"error":"bad review"}. The chat file is not
    a plan: the list skips it and GET /api/plans/<slug> has no chat key.
    DELETE /api/plans/<slug> removes <slug>.json and, when present,
    <slug>.chat.json, and answers as before.

    Scenario: The dislike is sent with the view, the schema and no plan change
      Given the plan "Gate" has no edits
      When I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src"}
      Then the status is 200 and "ran" is "command: <the fake>"
      And "summary" is "Pull scanning out of the ui so app has one job."
      And "edits" is the four edits and "stale" is [null, null, null, "no such file src/no-such.ts"]
      And "chat" is one turn whose text, summary and edits are that text, that summary and the four edits, whose decisions are {} and whose at matches the ISO pattern
      And "/tmp/qa/layered/.bindweed/plans/gate.chat.json" parses as that chat
      And "GET /api/plans/gate" has edits [] and redo [] and no chat, interview, tasks or brief key
      And "GET /api/plans" lists one plan, "Gate", with editCount 0
      And /tmp/qa/log/1.prompt contains "## What they dislike\nthe ui knows about the scanner\n", "## Current view\nsrc\n" and "You are proposing edits to the plan \"Gate\"."
      And it contains this block, word for word:
        """
        ## Planned graph
        ### src
        node src/app package app files 2 ca 0 ce 2 i 1.00 a 0.00 d 0.00 zone healthy cycle false
        node src/infra package infra files 1 ca 2 ce 1 i 0.33 a 0.00 d 0.67 zone pain cycle false
        node src/domain package domain files 1 ca 2 ce 0 i 0.00 a 0.00 d 1.00 zone pain cycle false
        edge src/app -> src/domain runtime 0 type 1 cycle false
        edge src/app -> src/infra runtime 2 type 0 cycle false
        edge src/infra -> src/domain runtime 1 type 0 cycle false
        cycles none
        ### src/app
        node src/app/a.ts file a.ts ca 1 ce 3 i 0.75 a 0.00 d 0.25 cycle true
        node src/app/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 cycle true
        edge src/app/a.ts -> src/app/b.ts runtime 1 type 0 cycle true text a.ts → b.ts → a.ts
        edge src/app/b.ts -> src/app/a.ts runtime 1 type 0 cycle true text b.ts → a.ts → b.ts
        cycles a.ts → b.ts → a.ts
        ### src/domain
        node src/domain/model.ts file model.ts ca 2 ce 0 i 0.00 a 0.00 d 1.00 cycle false
        cycles none
        ### src/infra
        node src/infra/db.ts file db.ts ca 2 ce 1 i 0.33 a 0.00 d 0.67 cycle false
        cycles none
        """
      And it contains the twelve Edit JSON lines and the two What to reply lines of the rule, word for word
      And it contains "## The plan's edits so far\nnone" and "## Conversation so far\nnone"
      And it does not contain "Reply with slices now." or "crap" or "To ask, reply"
      And /tmp/qa/log/1.env.json is {"cwd":"/tmp/qa/layered","root":"/tmp/qa/layered","claudecode":null,"entrypoint":null}
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: One level below the root is src, and a saved cut is the planned graph
      Given the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":""}
      Then /tmp/qa/log/1.prompt contains "## Current view\n(root)\n" and "### (root)\nnode src package src files 4 ca 0 ce 0 i – a 0.00 d – cycle false"
      And it contains "### src\nnode src/app package app" and it does not contain "node src/app/a.ts" or "edge src/app -> src/domain"
      And it contains "src/app must not import src/domain (1 import)" and JSON.stringify of the edits
      And "GET /api/plans/gate" still has the one package cut and redo []

    Scenario: A package that exists only in the plan is a view
      Given the plan "Gate" has the package and the move
      When I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src/ports"}
      Then the status is 200
      And /tmp/qa/log/1.prompt contains "## Current view\nsrc/ports\n" and this block, followed by a blank line and "## The plan's edits so far":
        """
        ## Planned graph
        ### src/ports
        node src/ports/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 cycle false
        cycles none
        """

    Scenario: Health from the reports and every saved edit are in the prompt
      Given the plan "Gate" has the package and the move
      And "/tmp/qa/layered/src/domain/rule.ts" holds "export function rule(n: number): number {\n  if (n > 0) return 1;\n  return 0;\n}\n"
      And then "/tmp/qa/layered/.marestail/ts-coverage/coverage-final.json" holds {"src/app/a.ts":{"statementMap":{"0":{"start":{"line":4}}},"s":{"0":1}},"src/domain/rule.ts":{"statementMap":{"0":{"start":{"line":2}},"1":{"start":{"line":3}}},"s":{"0":1,"1":0}}}
      And "/tmp/qa/layered/reports/mutation/mutation.json" holds {"files":{"src/app/a.ts":{"mutants":[{"status":"Survived"},{"status":"Killed"},{"status":"NoCoverage"}]},"src/domain/rule.ts":{"mutants":[{"status":"Survived"}]}}}
      And both reports are newer than every source file and I send "POST /api/rescan" with the token
      When I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src"}
      Then the status is 200
      And /tmp/qa/log/1.prompt contains this block, followed by a blank line and "## The plan's edits so far":
        """
        ## Planned graph
        ### src
        node src/app package app files 1 ca 1 ce 1 i 0.50 a 0.00 d 0.50 zone healthy coverage 1.00 mutants 2 cycle true
        node src/ports package ports files 1 ca 1 ce 1 i 0.50 a 0.00 d 0.50 zone healthy crap – mutants 0 cycle true
        node src/infra package infra files 1 ca 2 ce 1 i 0.33 a 0.00 d 0.67 zone pain crap – mutants 0 cycle false
        node src/domain package domain files 2 ca 2 ce 0 i 0.00 a 0.00 d 1.00 zone pain crap 2.5 coverage 0.50 mutants 1 cycle false
        edge src/app -> src/domain runtime 0 type 1 cycle false
        edge src/app -> src/infra runtime 1 type 0 cycle false
        edge src/app -> src/ports runtime 1 type 0 cycle true text app → ports → app
        edge src/infra -> src/domain runtime 1 type 0 cycle false
        edge src/ports -> src/app runtime 1 type 0 cycle true text ports → app → ports
        edge src/ports -> src/infra runtime 1 type 0 cycle false
        cycles app → ports → app
        ### src/app
        node src/app/a.ts file a.ts ca 1 ce 3 i 0.75 a 0.00 d 0.25 coverage 1.00 mutants 2 cycle false
        cycles none
        ### src/domain
        node src/domain/model.ts file model.ts ca 2 ce 0 i 0.00 a 0.00 d 1.00 crap – mutants 0 cycle false
        node src/domain/rule.ts file rule.ts ca 0 ce 0 i – a 0.00 d – crap 2.5 coverage 0.50 mutants 1 cycle false
        cycles none
        ### src/infra
        node src/infra/db.ts file db.ts ca 2 ce 1 i 0.33 a 0.00 d 0.67 crap – mutants 0 cycle false
        cycles none
        ### src/ports
        node src/ports/b.ts file b.ts ca 1 ce 2 i 0.67 a 0.00 d 0.33 crap – mutants 0 cycle false
        cycles none
        """
      And it contains this block, followed by a blank line and "## Edit JSON":
        """
        ## The plan's edits so far
        Create package src/ports
        Move src/app/b.ts to src/ports
        [{"kind":"create-package","path":"src/ports"},{"kind":"move-file","file":"src/app/b.ts","to":"src/ports"}]
        """
      And it does not contain "crapMax", "coverage on" or "mutation on"

    Scenario: Review uses the same check and writes nothing
      Given the plan "Gate" has no edits
      When I send "POST /api/plans/gate/review" with the token and {"edits":<the four edits>}
      Then the body is {"stale":[null, null, null, "no such file src/no-such.ts"]}
      When I send "POST /api/plans/gate/review" with the token and {"edits":[<the move>]}
      Then the body is {"stale":["no such directory src/ports"]}
      When I send "POST /api/plans/gate/review" with the token and {"edits":[{"kind":"fold","file":"src/app/a.ts"}]}
      Then the body is {"stale":["not an edit"]}
      And no file exists under "/tmp/qa/layered/.bindweed/plans"

    Scenario: The prompt quotes the plan's edits and every earlier turn
      Given the plan "Gate" has the package cut
      And I send "PUT /api/plans/gate/chat" with the token and these two turns:
        | at                       | text                           | summary                                         | edits                                                         | decisions                                                 |
        | 2026-10-21T09:00:00.000Z | the ui knows about the scanner | Pull scanning out of the ui so app has one job. | the four edits                                                | {"0":"accepted","1":"rejected","2":"rejected","3":"rejected"} |
        | 2026-10-21T09:05:00.000Z | split it\nby job               | Split app.                                      | [<the keep edit>,{"kind":"fold","file":"src/app/a.ts"}]       | {"0":"rejected"}                                          |
      When I send "POST /api/plans/gate/propose" with the token and {"text":"keep scan where it is","at":"src"}
      Then the status is 200 and "chat" has three turns, the first two as sent
      And /tmp/qa/log/1.prompt contains this block, followed by a blank line and "## Edit JSON":
        """
        ## The plan's edits so far
        src/app must not import src/domain (1 import)
        [{"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}]
        """
      And it contains this block, followed by a blank line and "## What to reply":
        """
        ## Conversation so far
        They said: the ui knows about the scanner
        Summary: Pull scanning out of the ui so app has one job.
        0 accepted: src/app must not import src/domain (1 import)
        1 rejected: Create package src/ports
        2 rejected: Move src/app/b.ts to src/ports
        3 rejected: Move src/no-such.ts to src/ports
        They said: split it
          by job
        Summary: Split app.
        0 rejected: src/domain should use src/app
        1 open: {"kind":"fold","file":"src/app/a.ts"}
        """
      And it contains "## What they dislike\nkeep scan where it is\n"

    Scenario: Deleting a plan deletes its chat, so a new plan of the same name starts clean
      Given the plan "Gate" has no edits
      And I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src"}
      When I send "DELETE /api/plans/gate" with the token
      Then the body is {"ok":true} and neither "gate.json" nor "gate.chat.json" exists under "/tmp/qa/layered/.bindweed/plans"
      When I send "POST /api/plans" with the token and {"name":"Gate"}
      Then its slug is "gate" and "GET /api/plans/gate/chat" is []
      And opening "http://127.0.0.1:5000/?token={token}#at=src&plan=gate" shows no "Conversation" button, no proposals region and no element with data-proposal "true"

    Scenario: A chat file that is not a chat document reads as empty and is replaced by the next turn
      Given the plan "Gate" has no edits
      And "/tmp/qa/layered/.bindweed/plans/gate.chat.json" holds "{not json"
      When I send "GET /api/plans/gate/chat" with the token
      Then the status is 200 and the body is [] and the file still holds "{not json"
      And opening the src planned view of "Gate" shows no "Conversation" button, no proposals region and no error
      When I send "POST /api/plans/gate/propose" with the token and {"text":"keep scan where it is","at":"src"}
      Then /tmp/qa/log/1.prompt contains "## Conversation so far\nnone"
      And "gate.chat.json" parses as one turn with text "keep scan where it is" and the keep edit

    Scenario: A bad reply is retried once and Cancel kills the run
      Given the plan "Gate" has no edits
      When I send "POST /api/plans/gate/propose" with the token and {"text":"BAD-ONCE","at":"src"}
      Then the body has "error" "the LLM's reply was not usable: it needs a summary and an edits array" and "raw" containing "\"questions\"" and the fake ran twice
      And /tmp/qa/log/2.prompt is the bytes of /tmp/qa/log/1.prompt, then "\n\nYour last reply was not usable: it is not valid JSON"
      And no chat file exists and "GET /api/plans/gate" has no interview key
      Given the backend command is "echo nope"
      When I send "POST /api/plans/gate/propose" with the token and {"text":"hello","at":"src"}
      Then the body has "error" "the LLM's reply was not usable: it is not valid JSON", "raw" "nope\n" and "ran" "command: echo nope"
      Given the backend command is the shell text: node -e 'console.log(JSON.stringify({summary:"one"+String.fromCharCode(10)+"two",edits:[]}))'
      When I send "POST /api/plans/gate/propose" with the token and {"text":"hello","at":"src"}
      Then the body has "error" "the LLM's reply was not usable: the summary must be one paragraph"
      And no chat file exists
      Given the backend command is "echo half; exit 3"
      When I send "POST /api/plans/gate/propose" with the token and {"text":"hello","at":"src"}
      Then the body has "error" "the LLM command exited with code 3" and "raw" "half\n"
      Given the backend command is "<the fake>"
      When I send "POST /api/plans/gate/propose" with the token and {"text":"SLEEP-NOW","at":"src"} and wait for /tmp/qa/log/sleep.pids
      And I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src"}
      Then the second answers 409 {"error":"already running"}
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then the status is 409 and the body is {"error":"already running"}
      When I send "POST /api/plans/gate/cancel" with the token
      Then within 2 seconds neither pid in sleep.pids is alive
      And the first POST answers 200 {"error":"cancelled","ran":"command: <the fake>"}
      And no chat file exists

    Scenario Outline: Propose, chat and review are guarded
      Given the plan "Gate" has no edits
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                       | credentials                                              | status | body                               |
        | POST /api/plans/gate/propose  | {"text":"hi","at":"src"} and no header of my own         | 401    | {"error":"missing or wrong token"} |
        | GET /api/plans/gate/chat      | no header of my own                                      | 401    | {"error":"missing or wrong token"} |
        | PUT /api/plans/gate/chat      | [] and no header of my own                               | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/review   | {"edits":[]} and the header "Host: evil.example:5000" and the token | 403 | {"error":"bad host"}          |
        | POST /api/plans/nope/propose  | {"text":"hi","at":"src"} and the token                   | 404    | {"error":"no such plan"}           |
        | POST /api/plans/gate/propose  | {"text":"  ","at":"src"} and the token                   | 400    | {"error":"bad propose"}            |
        | POST /api/plans/gate/propose  | {"text":"hi","at":"notes"} and the token                 | 400    | {"error":"bad propose"}            |
        | POST /api/plans/gate/propose  | {"text":"hi"} and the token                              | 400    | {"error":"bad propose"}            |
        | GET /api/plans/gate/propose   | the token                                                | 404    | {"error":"not found"}              |
        | GET /api/plans/gate/chat      | the token                                                | 200    | []                                 |
        | POST /api/plans/gate/review   | {"edits":[]} and the token                               | 200    | {"stale":[]}                       |
        | PUT /api/plans/gate/chat      | [{"text":"x"}] and the token                             | 400    | {"error":"bad chat"}               |
        | GET /api/plans/gate/chat      | the token, with gate.chat.json holding "[{\"at\":1}]"    | 200    | []                                 |
        | GET /api/plans/nope/chat      | the token                                                | 404    | {"error":"no such plan"}           |
        | PUT /api/plans/nope/chat      | [] and the token, and then no file "nope.chat.json" exists | 404  | {"error":"no such plan"}           |
        | POST /api/plans/nope/review   | {"edits":[]} and the token                               | 404    | {"error":"no such plan"}           |
        | POST /api/plans/gate/review   | {"edits":{}} and the token                               | 400    | {"error":"bad review"}             |
        | POST /api/plans/gate/review   | {"edits":[],"x":1} and the token                         | 400    | {"error":"bad review"}             |

    Scenario: A 008 plan loads unchanged and the old routes still answer
      Given "/tmp/qa/layered/.bindweed/plans/old.json" holds a 008 plan with the package cut and a contract of one rule, plus "interview" [], "tasks" [] and "brief" "b"
      When I send "GET /api/plans/old" with the token
      Then the body is that document
      When I send "GET /api/tree" with the token
      Then the status is 200 and the top-level entries include "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then the status is 200 and "text" is "export class Model { id = 0; }\n"
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200 and the node ids are "src/app", "src/infra" and "src/domain"
      When I send "GET /api/graph?at=src&plan=old" with the token
      Then the status is 200 and "stale" is [null] and no edge has from "src/app" and to "src/domain"
      When I send "GET /api/detail?id=src/app&at=src" with the token
      Then the status is 200 and "files" is 2
      When I send "GET /api/pairs?from=src/app&to=src/domain&at=src" with the token
      Then the body is {"pairs":[["src/app/a.ts","src/domain/model.ts"]]}
      When I send "GET /api/plans/old/contract" with the token
      Then the status is 200 and "rules" has the cut rule of that plan
      When I send "GET /api/layout" with the token
      Then the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      When I send "GET /api/config" with the token
      Then the body is {"llm":{"backend":"command","command":"<the fake>"}}
      When I send "GET /api/repo" with the token
      Then the body is {"root":"/tmp/qa/layered"}
      When I send "POST /api/rescan" with the token
      Then the status is 200 and "files" is 4
      When I send "GET /" with the token
      Then the status is 200 and the body contains "<title>bindweed</title>"
      When I send "POST /api/plans/old/files" with the token
      Then the status is 200 and the body is {"dir":"/tmp/qa/layered/.bindweed/plans/old"}
      When I send "POST /api/plans/old/generate" with the token and {"step":"ask"}
      Then "plan.interview" has one round of the two fake questions and no chat file exists
      And "GET /api/plans" lists "Old" and not a chat

    Scenario: The README lists the new routes
      When I read bindweed's README.md
      Then "## Routes" has the rows `/api/plans/<slug>/propose`, `/api/plans/<slug>/chat` and `/api/plans/<slug>/review`, each "live", beside the old rows

  Rule: the planned view shows the proposals and Ask sits under the changes
    The column order is the proposals region (labelled "proposals"), the changes
    region, the "Conversation" button, then the ask region (labelled "ask"). A
    missing region is omitted and the rest keep this order. Proposals is hidden
    when the latest turn has no undecided edit. Conversation is hidden when
    there is no turn. Ask is shown only while a plan is open: a textarea
    labelled "Ask" and a button "Propose". Typing, including Enter, sends
    nothing. Propose sends {"text","at"} for the current view. A blank box
    shows "write what you dislike" and sends nothing.
    While a run is alive the ask region shows "running for N s" and "Cancel",
    and Propose, Generate and Just write it are disabled. Afterwards it shows
    "ran" and any note. An error shows the error and, when present, "Raw
    output"; the open proposals stay. A usable reply clears the textarea.
    The proposals region shows the summary, then each undecided edit in order.
    An applicable edit is its sentence with "Accept <sentence>" and
    "Reject <sentence>". A dropped edit is the line
    "dropped: <sentence> — <reason>" and "Reject <sentence>" only. An element
    that is not an edit has JSON.stringify of that element as its sentence,
    here, in its labels and in Conversation. Then
    "Accept all" and "Reject all". Hovering a row sets data-highlight "true"
    on that edit's marks only; leaving clears it.
    Marks are drawn only while Planned is shown, in #7c3aed, with
    data-proposal "true" and no data-ghost. Real boxes, rows and arrows stay
    where they are. The proposal view is the planned graph of this view with
    every applicable open proposal applied after the plan's edits, in order.
    New box: a node id the proposal view has and the planned view lacks (a
    created package, a split part, a renamed package, a file moved into this
    file view) is a dashed box, data-id that id, labelled with its last
    segment. New boxes are placed in the proposal view's node order. Each
    starts at the spot the canvas layout gives it in the proposal view (its
    pin, else x = order × 260, y = row × 140) and moves right by 260 while a
    real box or an earlier new box holds that 260 × 140 cell. data-x and
    data-y are the result. New row: a file the proposal view has directly
    inside a box of this view, at a path the planned view lacks, is a dashed
    row in that box, data-path that path. A cut whose ends are both in view is
    a "✂" (U+2702), data-from and data-to set. An added edge in view is a
    dashed arrow. Strike: the name of a deleted or folded file, of a
    rename-file's old file, and of the box of a renamed package, of a merged
    package other than "into", and of a split package, carries data-strike
    "true" and a #7c3aed line-through. A move strikes nothing. A note is
    listed and not drawn. A mark belongs to the proposal at which it first
    appears when the proposals are applied in order.
    Each open row is applicable or dropped as the last check left it. A check
    is the review rule over the open rows in index order. The page checks on
    load, after a reply, and after every Accept, Reject, Undo and Redo.
    Accept first checks the edit against the saved plan alone. If it applies,
    the edit is appended with the same write as a canvas edit (redo becomes
    [], interview, tasks, brief and contract stay), the decision is
    "accepted", the row leaves the list, and the rest are checked. If it does
    not, nothing is written and no decision is recorded; that row alone
    becomes dropped with that reason, keeps its place, and is not drawn or
    applied for the rows after it until the next check, which may make it
    applicable again. Reject records "rejected", removes the row and checks
    the rest. Accept all accepts, in index order, each row that is applicable
    when reached, one undo step each, and leaves dropped rows. Reject all
    records "rejected" for every remaining index and clears the region, and
    does not change the plan.
    Undo and Redo do not restore a proposal. A new message appends a turn and
    the open list becomes that turn's undecided edits. Earlier undecided
    indexes stay undecided in the chat and are not shown. On load, the open
    list is the latest turn's undecided edits, checked. Conversation starts
    aria-expanded "false"; activating it sets aria-expanded "true" and shows
    the lines of the prompt's "## Conversation so far" section, one element per
    line whose text content is that line, leading spaces kept: per turn in
    order, "They said: <first line of text>", each further line of the text
    after two spaces, "Summary: <summary>" and one line
    "<index> <accepted|rejected|open>: <sentence>" per edit.

    Scenario: Propose, accept the cut, undo it, and reject the rest
      Given the plan "Gate" has no edits and is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      Then "Ask" is shown and "Propose" is shown and "Conversation" is not shown
      When I click "Propose" with "Ask" empty
      Then the ask region shows "write what you dislike" and no file exists under /tmp/qa/log
      When I type "the ui knows about the scanner" in "Ask" and press Enter
      Then no file exists under /tmp/qa/log
      When I click "Propose"
      Then the proposals region shows "Pull scanning out of the ui so app has one job."
      And it lists "src/app must not import src/domain (1 import)", "Create package src/ports" and "Move src/app/b.ts to src/ports", each with Accept and Reject
      And it shows "dropped: Move src/no-such.ts to src/ports — no such file src/no-such.ts" with "Reject Move src/no-such.ts to src/ports" and no Accept for it
      And the changes region lists no sentence
      And the planned canvas shows a #7c3aed "✂" with data-proposal "true", data-from "src/app" and data-to "src/domain", and the real arrow from "app" to "domain" remains
      And it shows a dashed #7c3aed box "ports" with data-proposal "true", data-id "src/ports", data-x "260" and data-y "0" and, inside it, a dashed row "b.ts" with data-path "src/ports/b.ts"
      And the real boxes keep data-x "0" and data-y "0" for "app", "0" and "140" for "infra", "0" and "280" for "domain"
      And "app" still lists "a.ts" and "b.ts", nothing carries data-strike, and nothing is drawn for "src/no-such.ts"
      When I hover "src/app must not import src/domain (1 import)"
      Then that "✂" has data-highlight "true" and the "ports" box does not
      When I click "Accept src/app must not import src/domain (1 import)"
      Then the changes region lists that sentence and the proposals region does not
      And "GET /api/plans/gate" has that one edit and redo []
      When I click "Undo"
      Then the changes region lists no sentence and "GET /api/plans/gate" has edits [] and redo of that one cut
      And the proposals region still does not list that sentence
      When I click "Redo"
      Then the changes region lists that sentence again
      When I click "Undo"
      Then the changes region lists no sentence
      When I click "Reject all"
      Then the proposals region is not shown and the changes region lists no sentence
      And the chat turn's decisions are {"0":"accepted","1":"rejected","2":"rejected","3":"rejected"}
      And "GET /api/plans/gate" has edits [] and redo of that one cut
      When I type "keep scan where it is" in "Ask" and click "Propose"
      Then the proposals region lists only "src/domain should use src/app"
      And the canvas has a dashed #7c3aed arrow from "domain" to "app" and no proposal "✂", no "ports" box and no "src/ports/b.ts" row
      And the chat has two turns, the first decisions unchanged, the second with that text, summary "Leave scanning in app.", the keep edit and decisions {}
      When I reload the page
      Then "Conversation" has aria-expanded "false"
      When I click "Conversation"
      Then "Conversation" has aria-expanded "true" and shows these lines, in order:
        """
        They said: the ui knows about the scanner
        Summary: Pull scanning out of the ui so app has one job.
        0 accepted: src/app must not import src/domain (1 import)
        1 rejected: Create package src/ports
        2 rejected: Move src/app/b.ts to src/ports
        3 rejected: Move src/no-such.ts to src/ports
        They said: keep scan where it is
        Summary: Leave scanning in app.
        0 open: src/domain should use src/app
        """
      And the dashed purple arrow from "domain" to "app" is shown
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: Accept all takes the three applicable edits, one undo each
      Given the plan "Gate" has no edits and is open on the src planned view
      When I type "the ui knows about the scanner" in "Ask" and click "Propose"
      And I click "Accept all"
      Then the changes region lists the cut sentence, "Create package src/ports" and "Move src/app/b.ts to src/ports", in that order
      And the only edit line in the proposals region is the dropped line for "src/no-such.ts"
      And "GET /api/plans/gate" has those three edits and redo []
      When I click "Undo"
      Then the changes region lists only the cut sentence and "Create package src/ports"
      And the move is not back in the proposals region

    Scenario: Accepting the move before its package writes nothing until the package is accepted
      Given the plan "Gate" has no edits and the proposals for "the ui knows about the scanner" are open on the src planned view
      When I click "Accept Move src/app/b.ts to src/ports"
      Then "GET /api/plans/gate" has edits [] and redo []
      And the proposals region shows "dropped: Move src/app/b.ts to src/ports — no such directory src/ports" with "Reject Move src/app/b.ts to src/ports" and no Accept for it, between "Create package src/ports" and the "src/no-such.ts" line
      And the chat turn's decisions are {}
      And the "ports" box is still drawn and no "src/ports/b.ts" row is drawn
      When I click "Accept Create package src/ports"
      Then "GET /api/plans/gate" has edits [the package] and the chat turn's decisions are {"1":"accepted"}
      And the proposals region lists "Move src/app/b.ts to src/ports" with "Accept Move src/app/b.ts to src/ports" and "Reject Move src/app/b.ts to src/ports"
      When I click "Accept Move src/app/b.ts to src/ports"
      Then "GET /api/plans/gate" has edits [the package, the move] and the decisions are {"1":"accepted","2":"accepted"}

    Scenario: Conversation shows a two-line text as the prompt does
      Given the plan "Gate" has the package cut
      And "PUT /api/plans/gate/chat" stored the two turns of "The prompt quotes the plan's edits and every earlier turn"
      When I open "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      Then the proposals region shows "Split app." and "dropped: {"kind":"fold","file":"src/app/a.ts"} — not an edit"
      When I click "Conversation"
      Then it shows these lines, one element each, in order, with leading spaces kept:
        """
        They said: the ui knows about the scanner
        Summary: Pull scanning out of the ui so app has one job.
        0 accepted: src/app must not import src/domain (1 import)
        1 rejected: Create package src/ports
        2 rejected: Move src/app/b.ts to src/ports
        3 rejected: Move src/no-such.ts to src/ports
        They said: split it
          by job
        Summary: Split app.
        0 rejected: src/domain should use src/app
        1 open: {"kind":"fold","file":"src/app/a.ts"}
        """

    Scenario: A reply element that is not an edit is shown by its JSON
      Given the plan "Gate" has no edits
      And "PUT /api/plans/gate/chat" stored one turn with text "x", summary "y", edits [{"kind":"fold","file":"src/app/a.ts"}] and decisions {}
      When I open "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      Then the proposals region shows "dropped: {"kind":"fold","file":"src/app/a.ts"} — not an edit" with "Reject {"kind":"fold","file":"src/app/a.ts"}" and no Accept for it
      And no element has data-proposal "true"
      When I click "Conversation"
      Then it shows "0 open: {"kind":"fold","file":"src/app/a.ts"}"
      When I click "Reject {"kind":"fold","file":"src/app/a.ts"}"
      Then the proposals region is not shown and the chat turn's decisions are {"0":"rejected"}

    Scenario: Rejecting the new package drops the move, and Now draws no proposal
      Given the plan "Gate" has no edits and the proposals for "the ui knows about the scanner" are open on the src planned view
      When I click "Reject Create package src/ports"
      Then the plan's edits are still []
      And the proposals region shows "dropped: Move src/app/b.ts to src/ports — no such directory src/ports"
      And the cut sentence still has Accept
      And no "ports" box is drawn
      When I choose "Now" in "Shown graph"
      Then the canvas has no element with data-proposal "true"
      When I choose "Planned"
      Then the #7c3aed "✂" from "src/app" to "src/domain" is shown

    Scenario: A split, a move into an existing package, a deletion and a note
      Given the plan "Gate" has no edits and is open on the src planned view
      When I type "app is doing three jobs" in "Ask" and click "Propose"
      Then the proposals region shows "Give each job its own package." and lists the four jobs sentences, in order, each with Accept and Reject, and no dropped line
      And the canvas shows dashed #7c3aed boxes "jobs" (data-id "src/app/jobs", data-x "260", data-y "0") and "scan" (data-id "src/app/scan", data-x "260", data-y "140"), both with data-proposal "true"
      And "jobs" holds a dashed row "b.ts" with data-path "src/app/jobs/b.ts" and "scan" holds no row
      And "infra" holds a dashed row "a.ts" with data-path "src/infra/a.ts" after its real row "db.ts"
      And the name "db.ts" in "infra" and the name of the box "app" carry data-strike "true" and a #7c3aed line-through, and both stay in place
      And "app" still lists "a.ts" and "b.ts", and those rows carry no data-strike
      And no element with data-proposal "true" holds the text "three jobs"
      When I hover "Note on src/app: \"three jobs\""
      Then no element has data-highlight "true"
      When I hover "Split src/app into src/app/scan (1 file) and src/app/jobs (1 file)"
      Then exactly "jobs", "scan", the "src/app/jobs/b.ts" row and the "app" strike have data-highlight "true"
      When I hover "Move src/app/scan/a.ts to src/infra"
      Then exactly the "src/infra/a.ts" row has data-highlight "true"
      When I click "Reject all"
      Then the canvas has no element with data-proposal "true" and "GET /api/plans/gate" has edits []

    Scenario Outline: Renames, merges, folds and moves into a file view are drawn
      Given the plan "Gate" has no edits
      And "PUT /api/plans/gate/chat" stored one turn with text "x", summary "y", edits [<edit>] and decisions {}
      When I open "http://127.0.0.1:5000/?token={token}#at=<at>&plan=gate"
      Then the proposals region lists "<sentence>" with Accept and Reject
      And the marks with data-proposal "true" are exactly: <marks>
      Examples:
        | edit                                                                       | at      | sentence                                       | marks                                                                                                                |
        | {"kind":"rename-package","from":"src/infra","to":"src/store"}              | src     | Rename src/infra to src/store                  | the struck name of "infra"; a dashed box "store" (data-id "src/store", data-x "260", data-y "140") holding a dashed row "db.ts" with data-path "src/store/db.ts" |
        | {"kind":"merge-packages","packages":["src/infra","src/domain"],"into":"src/domain"} | src | Merge src/infra and src/domain into src/domain | the struck name of "infra"; a dashed row "db.ts" with data-path "src/domain/db.ts" in "domain"                         |
        | {"kind":"rename-file","from":"src/infra/db.ts","to":"store.ts"}            | src     | Rename src/infra/db.ts to store.ts             | the struck row "db.ts" in "infra"; a dashed row "store.ts" with data-path "src/infra/store.ts" in "infra"              |
        | {"kind":"fate","file":"src/app/b.ts","fate":"fold","into":"src/app/a.ts"}  | src     | Fold src/app/b.ts into src/app/a.ts            | the struck row "b.ts" in "app"                                                                                         |
        | {"kind":"move-file","file":"src/infra/db.ts","to":"src/app"}               | src/app | Move src/infra/db.ts to src/app                | a dashed box "db.ts" (data-id "src/app/db.ts", data-x "0", data-y "140")                                               |

    Scenario: No plan means no Ask, and a failed reply leaves the proposals
      Given no plan is open on "http://127.0.0.1:5000/?token={token}#at=src"
      Then "Ask" is not shown and the changes region is not shown
      Given the plan "Gate" has no edits and the proposals for "keep scan where it is" are open
      And the backend command is "echo nope"
      When I type "hello" in "Ask" and click "Propose"
      Then the ask region shows "the LLM's reply was not usable: it is not valid JSON" and "Raw output" holding "nope"
      And the proposals region still lists "src/domain should use src/app"
      And the textarea still holds "hello"

    Scenario: Generate still interviews, and Cancel stops a proposal
      Given the plan "Gate" has the package cut and is open with the proposals for "the ui knows about the scanner"
      When I click "Tasks" and "Generate"
      Then I see "Must a.ts keep exporting a?" and the chat file is unchanged
      When I close the dialog and type "SLEEP-NOW" in "Ask" and click "Propose"
      Then "running for" is shown and "Propose" is disabled
      When I click "Cancel"
      Then within 2 seconds the page shows "cancelled" and the proposals region still shows "dropped: src/app must not import src/domain (1 import) — src/app/a.ts no longer imports src/domain/model.ts", since the plan already holds that cut
