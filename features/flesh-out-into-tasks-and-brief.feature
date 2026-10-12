Feature: flesh a plan out into ordered marestail task files and a slop-cannon brief
  A developer with a plan open presses Tasks, then Generate. An LLM asks a few
  questions about the gaps, or the developer presses Just write it. They get
  numbered task files they can edit, reorder, merge, split and delete, and a
  slop-cannon brief. Everything is saved on the plan and can be saved as files
  under .bindweed/. The target's tasks/ folder is read, never written.

  The served tree is the layered fixture of features/plan-to-dependency-contract.feature
  with two more committed files: tasks/004-x.md holding "# 004 — x\n" and
  tasks/README.md holding "# Our guide\n\nOne slice per step.\n". "bindweed"
  is "node <bindweed dir>/src/cli.ts", started in /tmp/qa/layered with
  CLAUDECODE=1 and CLAUDE_CODE_ENTRYPOINT=cli in its environment. It serves on
  port 5000. {token}, "with the token", the Host header, JSON comparison and \n
  are as in that feature. "The plan "Gate" has <edits>" means POST /api/plans
  {"name":"Gate"} and a PUT of those edits with redo []. "The package cut" is
  {"kind":"cut-edge","from":"src/app","to":"src/domain","files":[["src/app/a.ts","src/domain/model.ts"]]}.
  A note "X" is {"kind":"note","target":{"node":"src/domain"},"text":"X"}.

  "The fake" is the command "node <bindweed dir>/qa/fixtures/fake-llm.mjs /tmp/qa/log".
  Each call reads stdin, saves it as /tmp/qa/log/<n>.prompt (n counts from 1)
  and saves {"cwd","root","claudecode","entrypoint"} as /tmp/qa/log/<n>.env.json:
  its working directory, BINDWEED_ROOT, CLAUDECODE and CLAUDE_CODE_ENTRYPOINT,
  null when unset. Then the first match wins:
    | the prompt contains                  | the fake                                                                  |
    | SLEEP-NOW                            | starts "sleep 600", writes its own pid and that child's pid to /tmp/qa/log/sleep.pids, and waits |
    | BAD-ONCE, and log/bad.done is absent | creates log/bad.done and prints "```json\n{\"slices\": [\n```\n"          |
    | Reply with slices now.               | prints the slices reply                                                   |
    | ASK-AGAIN                            | prints the questions reply                                                |
    | a line starting "A: "                | prints the slices reply                                                   |
    | anything else                        | prints the questions reply                                                |
  The questions reply is prose, then a fenced json block holding
  {"questions":[{"id":"q1","text":"Must a.ts keep exporting a?","why":"Other code may import it."},{"id":"q2","text":"Should b.ts move before the cut?","why":"The order decides which slice breaks the build."}]}.
  The slices reply is a fenced json block holding {"example":1}, prose, then a
  fenced json block holding
  {"slices":[{"title":"Add the core package","slug":"add-core","body":"Create src/core.\n"},{"title":"Move b into infra","slug":"move-b","body":"Move src/app/b.ts to src/infra.\n"},{"title":"Cut app from domain","slug":"cut-app-domain","body":"# Cut\nNo behaviour changes.\n"}],"brief":"# Reshape layered\n\nMove b, then cut app from domain.\n"}.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed fixture described above and /tmp/qa/log is an empty folder
    And bindweed is serving it with "/tmp/qa/layered/.bindweed/config.json" holding {"llm":{"backend":"command","command":"<the fake>"}}

  Rule: the backend is chosen in .bindweed/config.json
    GET /api/config answers {"llm":{"backend":"route"}} when the file is
    missing or is not a valid config. PUT /api/config takes exactly
    {"llm":{"backend":B}} or {"llm":{"backend":B,"command":C}}, B one of
    "route", "claude", "command" and C a string, with C non-blank when B is
    "command". It writes the body as the file and answers it. Anything else
    answers 400 {"error":"bad config"} and leaves the file. Every backend gets
    the prompt on stdin, runs in the repository root without CLAUDECODE and
    CLAUDE_CODE_ENTRYPOINT, and has its process group killed after 15 minutes
    (its time limit). "command" runs
    "sh -c C" with BINDWEED_ROOT set to the root; "ran" is "command: C".
    "claude" runs "claude -p --model claude-opus-5-5 --effort high
    --output-format text --allowedTools Read,Grep,Glob"; "ran" is "claude:
    claude-opus-5-5, effort high". "route" first runs "marestail route --high"
    (killed after 60 seconds, its time limit) and reads "<model> <effort>
    <provider>" from its one line of stdout. Unit tests inject shorter limits;
    the rows and steps below that say "past its time limit" use one of 1 second.
    A backend that cannot start, or a route fallback whose claude cannot
    start, answers 200 {"error":"claude is not on PATH","ran"} (plus "note"),
    with no "raw" and no retry. An LLM past its time limit answers 200
    {"error":"the LLM ran past its time limit and was stopped","raw":<stdout so
    far>,"ran"} with no retry. Errors leave the plan unchanged.

    Scenario: The config round-trips and a bad one is refused
      When I send "PUT /api/config" with the token and {"llm":{"backend":"claude"}}
      Then the status is 200 and "/tmp/qa/layered/.bindweed/config.json" holds {"llm":{"backend":"claude"}}
      When I send "PUT /api/config" with the token and {"llm":{"backend":"command","command":"  "}}
      Then the status is 400, the body is {"error":"bad config"} and the file still holds {"llm":{"backend":"claude"}}
      When I write "not json" over the file and send "GET /api/config" with the token
      Then the body is {"llm":{"backend":"route"}}

    Scenario: A missing claude and an LLM past its time limit give errors, not retries
      Given the backend is "claude" and bindweed's PATH holds no "claude"
      And the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then the status is 200 and the body is {"error":"claude is not on PATH","ran":"claude: claude-opus-5-5, effort high"}
      Given the backend command is "echo $$ >> /tmp/qa/log/runs; echo part; exec sleep 600" and the LLM is past its time limit after 1 second
      When I send the same POST
      Then within 3 seconds the body is {"error":"the LLM ran past its time limit and was stopped","raw":"part\n","ran":"command: echo $$ >> /tmp/qa/log/runs; echo part; exec sleep 600"}
      And /tmp/qa/log/runs holds one pid, and it is not alive
      And "GET /api/plans/gate" has no "interview" key

    Scenario Outline: route picks the claude model, or falls back and says why
      Given "marestail" and "claude" on bindweed's PATH are fakes: marestail <marestail>; claude records its arguments, CLAUDE_CONFIG_DIR and stdin, then prints the questions reply
      And the backend is "route" and the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then "ran" is "<ran>" and "note" is <note>
      And claude saw "-p --model <model> --effort <effort> --output-format text --allowedTools Read,Grep,Glob" and CLAUDE_CONFIG_DIR <config dir>
      Examples:
        | marestail                                | ran                                                      | note                                                                                  | model            | effort | config dir           |
        | prints "claude-fable-5-1 max claude"     | route: claude-fable-5-1, effort max, provider claude     | absent                                                                                | claude-fable-5-1 | max    | unset                |
        | prints "claude-opus-5-5 max claude-work" | route: claude-opus-5-5, effort max, provider claude-work | absent                                                                                | claude-opus-5-5  | max    | "$HOME/.claude-work" |
        | prints "grok-5 high grok"                | claude: claude-opus-5-5, effort high                     | route picked grok; bindweed speaks to claude only, so it used claude-opus-5-5         | claude-opus-5-5  | high   | unset                |
        | prints "just one"                        | claude: claude-opus-5-5, effort high                     | marestail route printed "just one", which bindweed can't read, so it used claude-opus-5-5 | claude-opus-5-5 | high | unset              |
        | exits 2                                  | claude: claude-opus-5-5, effort high                     | marestail route exited with code 2, so bindweed used claude-opus-5-5                  | claude-opus-5-5  | high   | unset                |
        | is not on PATH                           | claude: claude-opus-5-5, effort high                     | marestail is not on PATH, so bindweed used claude-opus-5-5                            | claude-opus-5-5  | high   | unset                |
        | sleeps 600 s, past its time limit        | claude: claude-opus-5-5, effort high                     | marestail route ran past its time limit, so bindweed used claude-opus-5-5             | claude-opus-5-5  | high   | unset                |

  Rule: Generate interviews, then writes numbered slices and a brief
    POST /api/plans/<slug>/generate takes exactly one of {"step":"ask"},
    {"step":"answer","answers":[strings]} and {"step":"write","answers":[strings]}.
    "ask" empties "interview" and asks round 1. "answer" needs a pending round
    (the last round, with "answers" []) and one answer per question; "write"
    needs one per pending question, or [] with none pending. A blank answer is
    stored as "your call". "answer" and "write" keep the rounds already there
    and fill the pending round's answers; "write" sets "interview" to [] when
    the key is absent. After "answer", round 4 is never asked: when the
    third round was just answered, the prompt demands slices, as "write" does.
    Any other body answers 400 {"error":"bad generate"}; a second run on the
    same plan while one is alive answers 409 {"error":"already running"}.
    A usable reply answers 200 {"plan","ran"} (plus "note" for a route
    fallback) and saves the plan: questions are appended as
    {"round":n,"questions":[...],"answers":[]}; slices replace "tasks" and
    "brief". The reply is the last fenced json block of stdout, else all of
    stdout. Questions: 1 to 5, each with non-empty id, text and why. Slices: 1
    or more, each a non-empty title, a slug matching ^[a-z0-9][a-z0-9-]*$ and a
    body, plus a string brief. Questions when slices were demanded are wrong.
    A first unusable reply is retried once with the first prompt, a blank line
    and "Your last reply was not usable: <reason>". A second answers 200
    {"error":"the LLM's reply was not usable: <reason>","raw":<stdout>,"ran"}.
    Cancel answers the run's POST 200 {"error":"cancelled","ran"} (plus
    "note"), with no "raw". A non-zero exit answers {"error":"the LLM command exited with code N","raw","ran"},
    and a stop by a signal S not sent by bindweed {"error":"the LLM command was
    stopped by S","raw","ran"} (S as Node names it, e.g. SIGTERM); neither retries.
    Numbering: the target's tasks/ names starting with three digits and "-"
    give the highest NNN; the first slice is NNN + 1 (001 when there is none),
    then consecutive. Numbers never pass 999: slices that would need 1000 or
    more answer 200 {"error":"task numbers would pass 999","raw","ran"}, with
    no retry. A task is {"file":"NNN-<slug>.md","title","body"}; its
    body is "# NNN — <title>", a blank line, then the reply's body without a
    first line that starts with "# " and without leading blank lines.
    The prompt holds, in this order:
    - each edit's change-list sentence, and the edits as JSON.stringify writes them;
    - each planned-graph warning as the Changes list words it in 006: "<path>
      is empty", "this plan adds a cycle: <cycle>", "1 file still imports <f>,
      which this plan deletes" or "N files still import <f>, which this plan deletes";
    - each rule of the saved "contract" as a line "<name>: <comment>";
    - the files the plan touches, each once, sorted, as the lines "<file>
      imports <a>, <b>" and "<file> is imported by <c>" (repository files
      only, sorted, "nothing" when empty). The paths an edit names are: move-file
      and fate "file", plus a fold's "into"; rename-file "from"; cut-edge every
      file of "files"; add-edge "from" and "to"; a note its node or both ends
      of its edge; rename-package "from"; merge-packages each of "packages";
      split-package "package"; create-package none. A path that is a file of
      the repository now is that file; a directory of the repository now is
      every file inside it at any depth; any other path adds nothing;
    - the target's tasks/README.md (else bindweed's copy of marestail's
      tasks-README.md), and the names in the target's tasks/;
    - every answered question as a line "Q: <text>" followed by "A: <answer>";
    - these sentences, word for word: "Order the slices so each leaves the
      repository working: leaves and new packages first, then moves, then
      cuts, then the contract.", "A slice that changes no behaviour says so in
      its first line and freezes everything else.", "Each slice names the
      files it touches, the imports that must be gone when it ends, the
      contract rules it makes pass, and what must not change." and "Write one
      thin slice per logical step.";
    - the line "Reply with exactly one JSON object, in a fenced json block.";
    - only when slices are not demanded, the line
      To ask, reply {"questions":[{"id":"<id>","text":"<question>","why":"<why you ask>"}]} with at most 5 questions.
    - the line
      To write, reply {"slices":[{"title":"<title>","slug":"<slug>","body":"<markdown>"}],"brief":"<markdown>"}.
    - "Reply with slices now." exactly when slices are demanded.

    Scenario: Two questions, one left blank, then three slices after 004
      Given the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then "ran" is "command: <the fake>"
      And "plan.interview" is [{"round":1,"questions":[{"id":"q1","text":"Must a.ts keep exporting a?","why":"Other code may import it."},{"id":"q2","text":"Should b.ts move before the cut?","why":"The order decides which slice breaks the build."}],"answers":[]}]
      And /tmp/qa/log/1.prompt contains "src/app must not import src/domain (1 import)", the edits' JSON, "# Our guide" and "004-x.md"
      And it contains the four instruction sentences of the rule and the "Reply with exactly one", "To ask, reply" and "To write, reply" lines, word for word
      And it contains the lines "src/app/a.ts imports src/app/b.ts, src/domain/model.ts, src/infra/db.ts", "src/app/a.ts is imported by src/app/b.ts" and "src/domain/model.ts imports nothing"
      And it does not contain "Reply with slices now."
      And /tmp/qa/log/1.env.json is {"cwd":"/tmp/qa/layered","root":"/tmp/qa/layered","claudecode":null,"entrypoint":null}
      When I send "POST /api/plans/gate/generate" with the token and {"step":"answer","answers":["Yes, keep it.","  "]}
      Then /tmp/qa/log/2.prompt contains "Q: Must a.ts keep exporting a?\nA: Yes, keep it." and "Q: Should b.ts move before the cut?\nA: your call"
      And "plan.interview[0].answers" is ["Yes, keep it.","your call"]
      And "plan.tasks" is:
        | file                   | title                | body                                                     |
        | 005-add-core.md        | Add the core package | # 005 — Add the core package\n\nCreate src/core.\n       |
        | 006-move-b.md          | Move b into infra    | # 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n |
        | 007-cut-app-domain.md  | Cut app from domain  | # 007 — Cut app from domain\n\nNo behaviour changes.\n   |
      And "plan.brief" is "# Reshape layered\n\nMove b, then cut app from domain.\n"
      And "GET /api/plans/gate" returns the same interview, tasks and brief
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: Just write it at once, with no tasks folder, starts at 001
      Given "tasks/" is removed from the fixture and committed
      And the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/generate" with the token and {"step":"write","answers":[]}
      Then the task files are "001-add-core.md", "002-move-b.md" and "003-cut-app-domain.md"
      And /tmp/qa/log/1.prompt contains "Reply with slices now.", "**Slice vertically.**" and the "Reply with exactly one" and "To write, reply" lines of the rule
      And it does not contain "To ask, reply"
      And "plan.interview" is []

    Scenario: The prompt carries the saved contract, the warnings and every touched file
      Given the plan "Gate" has {"kind":"fate","file":"src/domain/model.ts","fate":"delete"} and {"kind":"rename-package","from":"src/app","to":"src/core"}
      And the plan is PUT again with "contract":{"rules":[{"name":"bindweed:no-src-app-to-src-domain","severity":"error","comment":"src/app must not import src/domain","from":{"path":"^src/app/"},"to":{"path":"^src/domain/"}}]}
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then /tmp/qa/log/1.prompt contains the line "bindweed:no-src-app-to-src-domain: src/app must not import src/domain"
      And it contains "2 files still import src/domain/model.ts, which this plan deletes"
      And it contains the lines "src/app/b.ts imports src/app/a.ts, src/infra/db.ts", "src/app/b.ts is imported by src/app/a.ts" and "src/domain/model.ts is imported by src/app/a.ts, src/infra/db.ts"
      And no line starts "src/infra/db.ts imports"

    Scenario: Numbers never pass 999
      Given "tasks/998-y.md" holding "# 998 — y\n" is added to the fixture and committed
      And the plan "Gate" has the package cut
      When I send "POST /api/plans/gate/generate" with the token and {"step":"write","answers":[]}
      Then the status is 200 and "error" is "task numbers would pass 999", "raw" is the slices reply and the fake ran once
      And "GET /api/plans/gate" has no "tasks" key

    Scenario: After three rounds the prompt demands slices
      Given the plan "Gate" has the package cut and the note "ASK-AGAIN"
      When I send {"step":"ask"}, then {"step":"answer","answers":["a","b"]} twice
      Then "plan.interview" has rounds 1, 2 and 3, the first two answered and the third pending
      When I send {"step":"answer","answers":["c",""]}
      Then /tmp/qa/log/4.prompt contains "Reply with slices now." and "plan.tasks" has three tasks

    Scenario: Just write it after a round keeps the interview and fills the pending answers
      Given the plan "Gate" has the package cut and the note "ASK-AGAIN"
      When I send {"step":"ask"}, then {"step":"answer","answers":["a","b"]}
      And I send {"step":"write","answers":["c",""]}
      Then /tmp/qa/log/3.prompt contains "A: a", "A: b", "A: c", "A: your call" and "Reply with slices now."
      And "plan.interview" has rounds 1 and 2 with answers ["a","b"] and ["c","your call"]
      And "plan.tasks" has three tasks

    Scenario: A bad reply is retried once, and two bad replies show the raw output
      Given the plan "Gate" has the package cut and the note "BAD-ONCE"
      When I send "POST /api/plans/gate/generate" with the token and {"step":"write","answers":[]}
      Then the status is 200 and "plan.tasks" has three tasks
      And /tmp/qa/log/2.prompt starts with the bytes of /tmp/qa/log/1.prompt, then "\n\nYour last reply was not usable: "
      Given the backend command is "echo nope"
      When I send the same POST
      Then the body has "error" starting "the LLM's reply was not usable: ", "raw" "nope\n" and "ran" "command: echo nope"
      And "GET /api/plans/gate" still has those three tasks
      Given the backend command is "echo half; exit 3"
      When I send the same POST
      Then the body has "error" "the LLM command exited with code 3" and "raw" "half\n"
      Given the backend command is "echo half; kill -TERM $$"
      When I send the same POST
      Then the body has "error" "the LLM command was stopped by SIGTERM" and "raw" "half\n"

    Scenario: Cancel kills the process group within 2 seconds
      Given the plan "Gate" has the package cut and the note "SLEEP-NOW"
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"} and wait for /tmp/qa/log/sleep.pids
      And I send it again
      Then the second answers 409 {"error":"already running"}
      When I send "POST /api/plans/gate/cancel" with the token
      Then the body is {"cancelled":true} and within 2 seconds neither pid in sleep.pids is alive
      And the first POST answers 200 {"error":"cancelled","ran":"command: <the fake>"}
      And "GET /api/plans/gate" has no "interview" key
      When I send "POST /api/plans/gate/cancel" with the token
      Then the body is {"cancelled":false}

  Rule: Save as files writes only under .bindweed/plans/<slug>/
    POST /api/plans/<slug>/files empties .bindweed/plans/<slug>/tasks/, writes
    each task's body as tasks/<file>, writes the brief as brief.md (removing
    brief.md when the plan has none), and answers {"dir":"<root>/.bindweed/plans/<slug>"}.

    Scenario: Saved files match the plan, and the target's tasks/ is untouched
      Given the plan "Gate" has three tasks and the brief from the fake
      And "/tmp/qa/layered/.bindweed/plans/gate/tasks/old.md" exists
      When I send "POST /api/plans/gate/files" with the token
      Then the body is {"dir":"/tmp/qa/layered/.bindweed/plans/gate"}
      And that tasks folder holds exactly 005-add-core.md, 006-move-b.md and 007-cut-app-domain.md, each byte-equal to its body
      And brief.md is byte-equal to the brief
      And "/tmp/qa/layered/tasks" holds exactly 004-x.md and README.md with their committed bytes
      And "GET /api/plans" lists one plan, "Gate", with editCount 1

  Rule: plan files gain optional interview, tasks and brief, and old routes stay
    A round is exactly {"round","questions","answers"}; a task exactly
    {"file","title","body"}, file matching ^\d{3}-[a-z0-9][a-z0-9-]*\.md$;
    brief a string. Absent keys stay absent, apart from "interview" as the
    Generate rule says. A bad value answers PUT 400
    {"error":"bad plan"}. Summaries gain nothing.

    Scenario: A 007 plan loads unchanged and a bad task file name is refused
      Given "/tmp/qa/layered/.bindweed/plans/old.json" holds a 007 plan with one cut and a contract of one rule
      When I send "GET /api/plans/old" with the token
      Then the body is that document, with no interview, tasks or brief key
      When I PUT it back plus "tasks":[{"file":"5-x.md","title":"x","body":"x"}]
      Then the status is 400, the body is {"error":"bad plan"} and the file's bytes are unchanged
      When I PUT it back plus "brief":"b" and "tasks":[]
      Then the status is 200 and GET returns "brief" "b" and "tasks" []

    Scenario Outline: The new routes are guarded and the old ones still answer
      Given the plan "Gate" has no edits
      When I send "<request>" with <credentials>
      Then the status is <status> and the body is <body>
      Examples:
        | request                         | credentials                                        | status | body                               |
        | GET /api/config                 | no header of my own                                | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/generate   | no header of my own                                | 401    | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/cancel     | no header of my own                                | 401    | {"error":"missing or wrong token"} |
        | PUT /api/config                 | the body {"llm":{"backend":"claude"}} and no header of my own | 401 | {"error":"missing or wrong token"} |
        | POST /api/plans/gate/files      | the header "Host: evil.example:5000" and the token | 403    | {"error":"bad host"}               |
        | POST /api/plans/nope/generate   | the body {"step":"ask"} and the token              | 404    | {"error":"no such plan"}           |
        | POST /api/plans/gate/generate   | the body {"step":"answer","answers":[]} and the token, with no pending round | 400 | {"error":"bad generate"} |
        | POST /api/plans/gate/generate   | the body {"step":"go"} and the token               | 400    | {"error":"bad generate"}           |
        | GET /api/plans/gate/generate    | the token                                          | 404    | {"error":"not found"}              |
        | GET /api/plans/gate/contract    | the token                                          | 200    | the four rules of the empty plan in 007 |
        | GET /api/pairs?from=src/app&to=src/domain&at=src | the token                         | 200    | {"pairs":[["src/app/a.ts","src/domain/model.ts"]]} |

    Scenario: The README lists the new routes and BINDWEED_ROOT
      When I read bindweed's README.md
      Then "## Routes" has the rows `/api/config`, `/api/plans/<slug>/generate`, `/api/plans/<slug>/cancel` and `/api/plans/<slug>/files`, each "live", beside the old rows
      And "## Environment" has a row for `BINDWEED_ROOT`

  Rule: the Tasks panel drives it from the page
    "Settings" (a gear button, always in the toolbar) opens a dialog labelled
    "Settings" with a "Backend" select and a "Command" box, filled from GET
    /api/config (a missing command is a blank box). Save PUTs
    {"llm":{"backend":B}} plus "command" when the box is not blank, and closes
    the dialog; with backend command and a blank box it shows "write a
    command", stays open and saves nothing.
    "Tasks" is in the plan toolbar while a plan is open and opens the dialog
    labelled "Tasks", showing the saved interview, slices and brief. While a
    run is alive it shows "running for N s", counting up, and "Cancel"; the
    other buttons are disabled. After a run it shows "ran" and any note; after
    an error it shows the error and, when there is one, the raw output in a
    block labelled "Raw output", and the slices stay as they were. Each
    pending question shows its text, its why, and a box named by its text.
    Each slice shows its file name and has controls named "Title of F", "Body
    of F", "Preview F", "Move F up", "Move F down", "Merge F with next",
    "Split F", "Delete F" and "Copy F". Every list change and every edited
    field (on leaving it) PUTs the plan. A change renumbers the files from the
    lowest number before it, and each body's first line is always
    "# NNN — <title>". Editing a title rewrites that line; the file keeps its
    slug. "Preview F" (aria-pressed) hides "Body of F" and shows the body as
    markdown: a line "# T" is an h1 "T", "## T" an h2 "T", and other lines
    are paragraphs split at blank lines; pressing it again shows the box.
    Merge keeps the first title and makes the body the first
    body without trailing line breaks, a blank line, then the next body without
    its first line and leading blank lines. Split inserts a copy after it,
    with the same title and slug, and is disabled when the last number is 999.
    "Copy F" copies the body. Under the slices the "Brief" box, and the line
    sc --repo <root> --safety on -m "$(cat <root>/.bindweed/plans/<slug>/brief.md)"
    with "Copy command". "Save as files" shows "saved to <dir>/tasks/".

    Scenario: Interview, edit and save from the page
      Given the plan "Gate" has the package cut and is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      When I click "Tasks" and "Generate"
      Then I see "Must a.ts keep exporting a?" with "Other code may import it." and "Should b.ts move before the cut?" with "The order decides which slice breaks the build."
      When I type "Yes, keep it." for the first, leave the second blank and click "Continue"
      Then the slices read 005-add-core.md, 006-move-b.md, 007-cut-app-domain.md and "ran" shows "command: <the fake>"
      When I click "Move 007-cut-app-domain.md up"
      Then the slices read 005-add-core.md, 006-cut-app-domain.md, 007-move-b.md and "Body of 006-cut-app-domain.md" starts "# 006 — Cut app from domain"
      When I click "Merge 005-add-core.md with next"
      Then the slices read 005-add-core.md, 006-move-b.md and the first body is "# 005 — Add the core package\n\nCreate src/core.\n\nNo behaviour changes.\n"
      When I click "Delete 006-move-b.md" and "Save as files"
      Then the page shows "saved to /tmp/qa/layered/.bindweed/plans/gate/tasks/"
      And that folder holds exactly 005-add-core.md and brief.md sits beside it
      And the brief box holds "# Reshape layered\n\nMove b, then cut app from domain.\n" and the command reads sc --repo /tmp/qa/layered --safety on -m "$(cat /tmp/qa/layered/.bindweed/plans/gate/brief.md)"
      When I reload the page and click "Tasks"
      Then the one slice and the brief are still there
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: Cancel from the page
      Given the plan "Gate" has the package cut and the note "SLEEP-NOW" and is open with the Tasks dialog
      When I click "Just write it"
      Then "running for" shows and "Generate" is disabled
      When I click "Cancel"
      Then within 2 seconds the fake and its sleep are gone and the page shows "cancelled"

    Scenario: Settings opens with the saved config and refuses a blank command
      When I click "Settings"
      Then "Backend" shows "command" and "Command" holds the fake
      When I choose "claude" in "Backend", clear "Command" and click "Save"
      Then the dialog closes and "/tmp/qa/layered/.bindweed/config.json" holds {"llm":{"backend":"claude"}}
      When I click "Settings", choose "command", leave "Command" blank and click "Save"
      Then the dialog shows "write a command", stays open, and the file still holds {"llm":{"backend":"claude"}}
      When I type "echo hi" in "Command" and click "Save"
      Then the dialog closes and the file holds {"llm":{"backend":"command","command":"echo hi"}}

    Scenario: Rename, split, move down, preview and copy from the page
      Given the plan "Gate" has three tasks and the brief from the fake and is open with the Tasks dialog
      When I type "Add src/core" over "Title of 005-add-core.md" and leave the box
      Then "Body of 005-add-core.md" starts "# 005 — Add src/core\n\nCreate src/core." and the file name is still 005-add-core.md
      When I click "Split 005-add-core.md"
      Then the slices read 005-add-core.md, 006-add-core.md, 007-move-b.md, 008-cut-app-domain.md and "Body of 006-add-core.md" is "# 006 — Add src/core\n\nCreate src/core.\n"
      When I click "Move 006-add-core.md down"
      Then the slices read 005-add-core.md, 006-move-b.md, 007-add-core.md, 008-cut-app-domain.md
      When I click "Preview 005-add-core.md"
      Then "Body of 005-add-core.md" is not shown, the slice shows an h1 "005 — Add src/core" and a paragraph "Create src/core.", and "Preview 005-add-core.md" has aria-pressed "true"
      When I click "Preview 005-add-core.md" again
      Then "Body of 005-add-core.md" shows again
      When I click "Copy 008-cut-app-domain.md"
      Then the clipboard is "# 008 — Cut app from domain\n\nNo behaviour changes.\n"
      And "GET /api/plans/gate" has those four tasks in that order with those bodies
      When I type "Just cut it." over "Brief" and leave the box
      Then "GET /api/plans/gate" has "brief" "Just cut it." and the command line is unchanged
      When I click "Save as files"
      Then "/tmp/qa/layered/.bindweed/plans/gate/brief.md" holds "Just cut it."

    Scenario: An unusable reply shows the error and the raw output on the page
      Given the plan "Gate" has three tasks and the brief from the fake and the backend command is "echo nope"
      And the plan is open with the Tasks dialog
      When I click "Generate"
      Then the page shows text starting "the LLM's reply was not usable: ", "Raw output" holding "nope", and "command: echo nope"
      And the slices still read 005-add-core.md, 006-move-b.md, 007-cut-app-domain.md
