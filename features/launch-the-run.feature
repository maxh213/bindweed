Feature: launch a plan as a marestail or slop-cannon run in its own worktree
  A developer with a plan open presses Launch, picks marestail or slop-cannon,
  and bindweed creates a worktree beside the repository, commits the plan's
  task files and contract there, and starts the run detached. The repository
  they are browsing is not committed to. Closing bindweed does not stop the run.

  The tree, token, {token}, Host header, JSON comparison and \n are the
  Background of features/plan-to-dependency-contract.feature. "bindweed" is
  "node <bindweed dir>/src/cli.ts" on port 5000. "The package cut" is
  the one in features/flesh-out-into-tasks-and-brief.feature. Its sentence is
  "src/app must not import src/domain (1 import)". The em dash in a task body
  is U+2014. A note "X" is {"kind":"note","target":{"node":"src/domain"},"text":"X"}.
  In a quoted step, \" is one double quote.

  "The three tasks" are, in order, {"file":"005-add-core.md","title":"Add the core package","body":"# 005 — Add the core package\n\nCreate src/core.\n"},
  {"file":"006-move-b.md","title":"Move b into infra","body":"# 006 — Move b into infra\n\nMove src/app/b.ts to src/infra.\n"}
  and {"file":"007-cut-app-domain.md","title":"Cut app from domain","body":"# 007 — Cut app from domain\n\nNo behaviour changes.\n"}.
  "The brief" is "# Reshape layered\n\nMove b, then cut app from domain.\n".
  "The launch plan" is the plan "Gate", slug gate, whose only edit is the
  package cut, with these three tasks, this brief, and "contract" the rules
  GET /api/plans/gate/contract returns for that edit. "The launch plan and
  the note X" is that plan with the note appended after the package cut;
  its tasks, brief and contract stay. "The worktree" is
  "/tmp/qa/layered-bw-gate". "The branch" is "bindweed/gate".

  Fakes, all executable, never a real agent. "/tmp/qa/fakes/bin" holds
  "marestail", "sc" and "systemd-inhibit". "/tmp/qa/fakes/tools/overnight.sh"
  is the sibling tools script. "marestail" appends its arguments, joined by one
  space, as a line to "/tmp/qa/log/marestail.log". When the first argument is
  "install" and "/tmp/qa/log/fail-install" exists, it prints "install failed"
  to stderr and exits 1. When the first argument is "install" and
  "/tmp/qa/log/fail-install-quiet" exists, it exits 1 and prints nothing.
  When "/tmp/qa/log/install.wait" exists, that install waits until
  "/tmp/qa/log/install.go" exists. Otherwise an install writes
  "installed=1\n" as "marestail.toml", writes "qa tasks\n" as
  "tasks/README.md", appends "qa-ignore\n" to ".gitignore" (creating it
  when it is absent), and exits 0. Any other invocation exits 0.
  "overnight.sh" writes "/tmp/qa/log/overnight.json". When
  "/tmp/qa/log/overnight.quick" exists it then exits 3 and does not sleep.
  Otherwise it sleeps 30 seconds. The JSON holds "argv"
  (its arguments), "cwd", "model", "scope", "focus", "stop", "claudecode",
  "entrypoint", "configDir" and "pathHead": the environment values MODEL,
  SCOPE, FOCUS, STOP_AT, CLAUDECODE, CLAUDE_CODE_ENTRYPOINT and
  CLAUDE_CONFIG_DIR, null when unset, and the first PATH entry. "sc" writes
  "/tmp/qa/log/sc.json" {"argv","cwd"}, prints "started\n" and sleeps 30
  seconds. "systemd-inhibit" drops leading arguments that start with "--" and
  execs the rest. "A marestail launch" is POST /api/plans/gate/launch with
  {"tool":"marestail","model":"dandelion/route-best","scope":"hard","focus":"<focus>","stopAt":"qa"}
  and "<focus>" the GET focus unless the scenario sets the fields. "An sc
  launch" is that POST with {"tool":"slop-cannon","safety":"on","ammo":"","cartridge":""}.
  Each scenario starts from the Background again, which deletes
  "/tmp/qa/layered-bw-gate" when it is present, and kills any pid it launched.
  "The nosystemd directory" is "/tmp/qa/fakes/nosystemd", holding only
  symlinks "node", "git", "bash", "setsid", "sh" and "sleep" to the normalized
  realpaths those commands had before the restart, plus executable copies of
  the fake "marestail" and the fake "sc", and no "systemd-inhibit". "The bash
  realpath" is the absolute target of that "bash" symlink, saved when the
  directory is built. Restarting bindweed on it sets PATH to exactly that
  directory.

  In a table, "(empty)" is the empty string and a written \n is a newline.
  "<baseCommit>" is that plan's baseCommit. "The marestail body" is
  {"tool":"marestail","model":"dandelion/route-best","scope":"hard","focus":"src/app/a.ts src/domain/model.ts","stopAt":"qa"}.
  "The sc body" is {"tool":"slop-cannon","safety":"on","ammo":"","cartridge":""}.
  "The fakes" puts "/tmp/qa/fakes/bin" first on PATH with all three executables.
  "No marestail" is a PATH with no executable named marestail, and "no sc" one
  with no executable named sc. "Missing" means runs.json does not exist. "One
  live entry for gate" means runs.json is [{"slug":"gate","pid":<n>}] where
  kill -0 of n succeeds, and that object has no other keys. "Unchanged" means
  the file's bytes after the POST are its bytes before. A plan cell other than
  "the launch plan" is a plan "Gate" with only the pieces it names. "No tasks
  key", "no brief key" and "no contract" omit that key. "Tasks" [] is an empty
  array, "brief" "  " is three spaces, and "no edits" is "edits" []. "Except
  <thing>" is the launch plan without that thing. "And a live pid" adds one
  live entry for gate. "The brief" as one argv element is the brief text.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed four-file fixture of features/plan-to-dependency-contract.feature, where "git config user.name qa" and "git config user.email qa@example.test" were run in the repository before its commit, so they are its own config and not only "-c" on that commit
    And "/tmp/qa/log" is empty and the fakes above are in place
    And bindweed is serving it with "/tmp/qa/fakes/bin" first on PATH, and with CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT=cli and CLAUDE_CONFIG_DIR=/tmp/qa/claude

  Rule: Launch asks for a tool and refuses before it changes anything
    GET /api/plans/<slug>/launch answers {"marestail","sc","alive","focus"}.
    "marestail" is true when an executable named marestail is on PATH, and
    "sc" likewise. "alive" is true when ".bindweed/runs.json" is a JSON array
    containing an object whose "slug" is this slug and whose "pid" is a number
    that is alive. A pid is alive when kill -0 exits 0, or fails because
    permission is denied. A missing file, a file that is not a JSON array, a
    non-object element, a pid that is not a number, and a dead pid are not
    alive. Another slug does not count. When the last such alive object also
    has string "worktree" and "tool" "marestail" or "slop-cannon", the body
    also has "worktree" (that string) and "watch": "marestail watch", or
    "sc status --repo <worktree>". "branch" is that object's "branch" when
    it is a string, and it is never computed. When "branch" is missing or
    not a string, the body has no "branch" key and still has "worktree" and
    "watch". Otherwise "worktree", "branch" and "watch" are all absent.
    "focus" is the plan's focus string. A slug that fails ^[a-z0-9][a-z0-9-]*$
    or names no plan answers 404 {"error":"no such plan"}. Another method, or
    another path segment, answers 404 {"error":"not found"}.
    Focus. Redo is ignored. The paths an edit names are the 008 list, and a
    create-package names nothing there: move-file and a fate "file", plus a
    fold's "into"; rename-file "from"; cut-edge every file of "files";
    add-edge "from" and "to"; a note its node or both ends; rename-package
    "from"; merge-packages each of "packages"; split-package "package".
    A named path that is a file of the current scan contributes that file. A
    named path that is a directory of that scan contributes every scanned file
    under it. Stale edits still name paths. Anything else adds no current file.
    Each current file is then carried through the edits to a planned path. A
    stale edit leaves the path. A non-stale fate delete of that path, or a
    non-stale edit whose pathAfter is null, drops it, so it has no planned
    path. Any other non-stale edit replaces it with pathAfter. A non-stale
    create-package also contributes its path as a planned path. Focus is the
    current files plus the planned paths, deduplicated, sorted by code unit
    (the same order as "<"), joined by one space, or "" when there are none.
    A file a non-stale delete drops stays in focus: it is still a current file.
    POST /api/plans/<slug>/launch takes exactly one shape. Marestail:
    {"tool":"marestail","model","scope","focus","stopAt"}, every value a
    string. Slop-cannon: {"tool":"slop-cannon","safety","ammo","cartridge"},
    safety "on" or "off" and the other three strings. Strings other than
    safety are trimmed. Anything else answers 400 {"error":"bad launch"} and
    writes nothing. Blank scope, ammo and cartridge stay blank.
    The dialog's Launch is disabled, and the POST answers 409 {"error":<reason>}
    and writes nothing, when a reason applies. The first reason wins, in this
    order: "<command> is not on PATH" (marestail, or sc), "a run for this plan
    is still alive", then "this plan has no tasks" (marestail, when "tasks" is
    missing or []) or "this plan has no brief" (slop-cannon, when "brief" is
    missing or blank). A second POST for a launch that has not answered yet
    answers 409 {"error":"already running"} and does not start a second run.
    That lock is the launch only: a running generate or propose does not block
    a launch, and a launch does not block them. While a generate has not
    answered, a marestail launch still returns 200 and the steps are all ok.
    The note "SLEEP-NOW" is JSON in that generate prompt, and the 008 fake
    then writes "/tmp/qa/log/sleep.pids" and does not answer.
    While a launch has not answered and is held because
    "/tmp/qa/log/install.wait" exists, "POST /api/plans/gate/generate" with
    {"step":"ask"} still returns 200 and the questions, not 409. A launch
    that reaches the steps answers 200, including when a step stops the rest.
    The body has
    "steps" and no other key, plus "worktree" and "branch" when Worktree is
    ok, plus "watch" and "pid" when Start is ok. An ok step is exactly
    {"name":"<name>","ok":true} and has no "error" key. The step that stops
    the rest is exactly {"name":"<name>","ok":false,"error":"<text>"} and is
    the last element. "The steps are all ok" means "steps" is those five ok
    steps, in order, and the body's keys are exactly "steps", "worktree",
    "branch", "watch" and "pid". "pid" is the number the start line prints.

    Scenario Outline: Focus joins the current files and the planned paths
      Given the plan "Gate" has the only edits <edits>
      When I send "GET /api/plans/gate/launch" with the token
      Then "focus" is <focus> and "marestail" is true and "sc" is true and "alive" is false and the body has no "worktree" key
      Examples:
        | edits | focus |
        | [] | (empty) |
        | the package cut | src/app/a.ts src/domain/model.ts |
        | [{"kind":"move-file","file":"src/app/b.ts","to":"src/infra"}] | src/app/b.ts src/infra/b.ts |
        | [{"kind":"rename-package","from":"src/app","to":"src/core"}] | src/app/a.ts src/app/b.ts src/core/a.ts src/core/b.ts |
        | [{"kind":"create-package","path":"src/ports"}] | src/ports |
        | [{"kind":"fate","file":"src/domain/model.ts","fate":"delete"}] | src/domain/model.ts |
        | [{"kind":"fate","file":"src/app/b.ts","fate":"fold","into":"src/infra/db.ts"}] | src/app/b.ts src/infra/db.ts |
        | [{"kind":"add-edge","from":"src/domain","to":"src/app"}] | src/app/a.ts src/app/b.ts src/domain/model.ts |
        | [{"kind":"move-file","file":"src/missing.ts","to":"src/infra"}] | (empty) |

    Scenario: A live entry without a branch string does not invent one
      Given the launch plan and runs.json is [{"slug":"gate","tool":"marestail","worktree":"/tmp/qa/layered-bw-gate","pid":<n>}] where kill -0 of n succeeds, and that object has no "branch" key
      When I send "GET /api/plans/gate/launch" with the token
      Then "alive" is true and "worktree" is "/tmp/qa/layered-bw-gate" and "watch" is "marestail watch" and the body has no "branch" key

    Scenario Outline: Launch stays disabled and the reason is the first that applies
      Given the plan "Gate" has <plan> and bindweed's PATH <path> and runs.json <runs>
      When I send "GET /api/plans/gate/launch" with the token
      Then "marestail" is <marestail> and "sc" is <sc> and "alive" is <alive>
      When I send "POST /api/plans/gate/launch" with the token and <body>
      Then the status is 409 and the body is {"error":"<reason>"}
      And "/tmp/qa/layered-bw-gate" does not exist and "git branch" in "/tmp/qa/layered" has no "bindweed/gate"
      And "/tmp/qa/layered/.bindweed/runs.json" is <runs file>
      Examples:
        | plan | path | runs | marestail | sc | alive | body | reason | runs file |
        | the package cut and no tasks key | the fakes | missing | true | true | false | {"tool":"marestail","model":"dandelion/route-best","scope":"hard","focus":"src/app/a.ts src/domain/model.ts","stopAt":"qa"} | this plan has no tasks | missing |
        | the package cut and "tasks" [] | the fakes | missing | true | true | false | the marestail body | this plan has no tasks | missing |
        | the package cut, the three tasks and no brief key | the fakes | missing | true | true | false | the sc body | this plan has no brief | missing |
        | the package cut, the three tasks and "brief" "  " | the fakes | missing | true | true | false | the sc body | this plan has no brief | missing |
        | the launch plan | no marestail | missing | false | true | false | the marestail body | marestail is not on PATH | missing |
        | the launch plan | no sc | missing | true | false | false | the sc body | sc is not on PATH | missing |
        | the launch plan except no tasks key, and a live pid | the fakes | one live entry for gate | true | true | true | the marestail body | a run for this plan is still alive | unchanged |
        | the launch plan except no tasks key | no marestail | one live entry for gate | false | true | true | the marestail body | marestail is not on PATH | unchanged |

    Scenario: A bad body is refused and the guards still hold
      Given the launch plan
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"marestail","model":"dandelion/route-best","scope":"hard","focus":"src/app/a.ts src/domain/model.ts","stopAt":"qa","extra":1}
      Then the status is 400 and the body is {"error":"bad launch"}
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"slop-cannon","safety":"maybe","ammo":"","cartridge":""}
      Then the status is 400 and the body is {"error":"bad launch"}
      When I send "POST /api/plans/nope/launch" with the token and {"tool":"marestail","model":"m","scope":"","focus":"","stopAt":"qa"}
      Then the status is 404 and the body is {"error":"no such plan"}
      When I send "PUT /api/plans/gate/launch" with the token and {}
      Then the status is 404 and the body is {"error":"not found"}
      When I send "GET /api/plans/gate/launch" with no header of my own
      Then the status is 401 and the body is {"error":"missing or wrong token"}
      When I send "POST /api/plans/gate/launch" with the header "Host: evil.example:5000" and the token and {"tool":"marestail","model":"m","scope":"","focus":"","stopAt":"qa"}
      Then the status is 403 and the body is {"error":"bad host"}
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: A generate that has not answered does not block a launch
      Given the launch plan and the note "SLEEP-NOW"
      And "/tmp/qa/layered/.bindweed/config.json" holds {"llm":{"backend":"command","command":"node <bindweed dir>/qa/fixtures/fake-llm.mjs /tmp/qa/log"}}
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"} and wait for /tmp/qa/log/sleep.pids
      And I send a marestail launch with the token
      Then the launch status is 200 and the steps are all ok
      And within 5 seconds "/tmp/qa/log/overnight.json" exists and the generate POST has not answered
      When I send "POST /api/plans/gate/cancel" with the token
      Then the body is {"cancelled":true} and within 2 seconds neither pid in "/tmp/qa/log/sleep.pids" is alive

    Scenario: A launch held during install does not block generate
      Given the launch plan and "/tmp/qa/log/install.wait" exists
      And "/tmp/qa/layered/.bindweed/config.json" holds {"llm":{"backend":"command","command":"node <bindweed dir>/qa/fixtures/fake-llm.mjs /tmp/qa/log"}}
      When I send a marestail launch with the token and wait until the worktree exists
      And I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then the status is 200 and "plan.interview" has one round whose first question is "Must a.ts keep exporting a?"
      When "/tmp/qa/log/install.go" is created
      Then the launch answers 200 and the steps are all ok

  Rule: a launch makes one commit next door and starts the run detached
    The worktree path is "<parent of the served root>/<directory name>-bw-<slug>"
    and the branch is "bindweed/<slug>". The served root here is
    "/tmp/qa/layered", so the path is "/tmp/qa/layered-bw-<slug>". Before
    "git worktree add", an existing branch stops with "a branch named
    'bindweed/<slug>' already exists" and an existing directory, empty or not,
    stops with "<path> already exists". Git is not run in either case, so a
    failed add cannot create the branch. Otherwise the command is
    "git worktree add -b bindweed/<slug> <path> HEAD". Any other non-zero exit
    stops with git's stderr, the leading "fatal: " of its last line removed.
    Files, in the worktree, in this order. Marestail writes each task body as
    "tasks/<file>" and does not delete other files there. When the plan has a
    "contract" key, ".dependency-cruiser.cjs" becomes the "text" of
    POST /api/plans/<slug>/contract for the saved rules' names, the 007 merge.
    A merge error stops Files with that error and does not write the cruiser
    file. Marestail then runs "marestail install ." in the worktree when
    "marestail.toml" is absent. A non-zero exit stops Files with the first
    stderr line, or "marestail install exited with code N" when stderr is
    empty. Saying "the Files error is X" means the body has exactly the
    keys "steps", "worktree" and "branch", "steps" is
    {"name":"Worktree","ok":true} then {"name":"Files","ok":false,"error":X},
    and there is no later step. Slop-cannon skips the task files and the install.
    Commit, in the worktree, as the repository's git user.name and user.email,
    with commit.gpgsign false for this commit only. The message is
    "bindweed: <plan name>", a blank line, every edit's change-list sentence
    in order (stale ones too, not redo), then "Plan: <slug>" and
    "Base: <baseCommit>". No sentences leaves those two lines as the body.
    The commit adds the task files just written and the cruiser file when
    this launch wrote it. When "marestail install ." ran, it also adds every
    path "git status --porcelain -uall" lists in the worktree after the
    install that it did not list before the install. Plain porcelain is not
    enough: it hides a new file in an already untracked directory behind one
    directory line. The path is the text after the status, and a line that
    contains " -> " contributes both paths. When nothing is to be added,
    git add is skipped and the commit is made with --allow-empty and the same
    message. After a commit that succeeds, and before Start writes anything,
    "git status --porcelain" in the worktree is empty. A marestail Start then
    writes its script and ".out" under ".marestail/runs", so after a finished
    marestail launch that status is exactly "?? .marestail/"; bindweed makes
    no second commit. A slop-cannon launch writes its ".out" under the served
    root, so the worktree status stays empty. When git config
    --get user.name is unset or empty the step stops with "Author identity
    unknown" and does not commit; user.email is checked second, with that same
    error. Any other non-zero exit stops with git's stderr. The browsed
    repository's git config is left as it was.
    Start. The stamp is the local time "YYYYMMDDTHHMM". Marestail writes
    "<worktree>/.marestail/runs/launch-<stamp>.sh" and runs it with setsid
    and no --fork, stdin from /dev/null, and stdout and stderr to
    "launch-<stamp>.out" beside it. The spawned pid is the script. Bindweed
    collects that process's exit while it is still serving, so a script that
    has exited is not a zombie and kill -0 of its pid fails. When
    "<worktree>/.marestail" exists and is not a directory, Start is
    {"name":"Start","ok":false,"error":"could not create <worktree>/.marestail/runs"},
    there is no Record step, nothing is started, and runs.json is unchanged.
    The script puts the directory of the first "marestail" on PATH first on
    its own PATH, unsets CLAUDECODE, CLAUDE_CODE_ENTRYPOINT and
    CLAUDE_CONFIG_DIR, cds into the worktree, echoes
    "start pid=<pid> model=<model> scope=<scope or none> focus=<focus> stop=<stopAt>",
    runs the overnight command, then echoes
    "exit <code> <UTC YYYY-MM-DDTHH:MM:SSZ>" even when that command's status
    is not 0, and then exits. Every value bindweed writes into the script is
    single-quoted. A single quote inside a value is written as the four
    characters '\'' . Those values are the directory prepended to PATH, the
    worktree path, model, scope when present, focus, stopAt, the --why text,
    the overnight path, and each task path. The script does not double-quote
    them, so a space, "$", a backtick and either quote reach overnight.sh
    unchanged, and the printed start line contains those same characters.
    "<marestail dir>" is the directory of the real path of that marestail.
    The overnight path is the normalized absolute path of
    "<marestail dir>/../tools/overnight.sh", that real directory's sibling,
    not the sibling of the directory found on PATH.
    The overnight command sets MODEL, SCOPE, FOCUS and STOP_AT to those
    values, then runs "systemd-inhibit --what=idle --who=bindweed" with
    --why the text "bindweed <slug>", then bash and the overnight path, then
    the task paths in plan order. The script writes that bash path as its
    normalized absolute path, inside single quotes. A whitespace-delimited
    word is bounded by the start, the end or whitespace, so a path that only
    ends in bash is not the word bash. The directory put first
    on PATH is the directory of the first "marestail" on PATH, not the real
    path's directory. Blank scope omits SCOPE. When systemd-inhibit is not
    on PATH at launch, the same command omits systemd-inhibit and its three
    arguments. The recorded pid is the script pid, the one the start line
    prints, and it stays alive while overnight.sh sleeps. Slop-cannon runs
    "sc --repo <worktree> --headless --safety <on|off>" plus "--ammo <ammo>"
    when ammo is not blank, plus "--cartridge <cartridge>" when cartridge is
    not blank, plus "-m <brief>", detached the same way and exec'd with that
    argument vector, not through a shell, with the served root
    as its working directory, output to
    "<root>/.bindweed/runs/<slug>-<stamp>.out". The brief is one argument.
    Record appends one object to "<root>/.bindweed/runs.json", creating a
    one-element array when the file is missing. That object's keys are exactly
    "slug", "tool", "worktree", "branch", "pid", "startedAt", "out",
    "settings" and "tasks". "tasks" is the list of task paths passed to
    overnight.sh, in that order, and [] for slop-cannon. "startedAt" matches \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,
    the plan createdAt pattern. Marestail
    settings are {"model","scope","focus","stopAt"} with scope "" when blank.
    Slop-cannon settings are {"safety","ammo","cartridge"} with blanks kept.
    A file that is not a JSON array stops Record with "runs.json is not a list"
    and is left unchanged; the process is already running. Stopping bindweed
    does not stop the pid. The launch does not change the plan file.

    Scenario: Marestail commits the tasks, the contract and a fresh install, then sleeps detached
      Given the launch plan
      When I send "GET /api/plans/gate/launch" with the token
      Then "focus" is "src/app/a.ts src/domain/model.ts"
      When I save the "text" of "POST /api/plans/gate/contract" for the saved rule names as "/tmp/qa/preview.cjs"
      And I send a marestail launch with the token
      Then the status is 200 and the steps are all ok
      And "worktree" is "/tmp/qa/layered-bw-gate", "branch" is "bindweed/gate" and "watch" is "marestail watch"
      And the new commit's parent is the browsed HEAD, its author and committer are "qa" and "qa@example.test", and it is not signed
      And its message is "bindweed: Gate", a blank line, "src/app must not import src/domain (1 import)", "Plan: gate" and "Base: " plus the plan's baseCommit
      And the paths it adds are exactly, in this order, ".dependency-cruiser.cjs", ".gitignore", "marestail.toml", "tasks/005-add-core.md", "tasks/006-move-b.md", "tasks/007-cut-app-domain.md" and "tasks/README.md"
      And each task file equals its body, "marestail.toml" is "installed=1\n", "tasks/README.md" is "qa tasks\n", ".gitignore" is "qa-ignore\n" and ".dependency-cruiser.cjs" equals "/tmp/qa/preview.cjs"
      And "git status --porcelain" in the worktree is exactly "?? .marestail/"
      And "/tmp/qa/log/marestail.log" is the line "install ."
      And within 5 seconds "/tmp/qa/log/overnight.json" has "argv" ["tasks/005-add-core.md","tasks/006-move-b.md","tasks/007-cut-app-domain.md"], "cwd" the worktree, "model" "dandelion/route-best", "scope" "hard", "focus" "src/app/a.ts src/domain/model.ts", "stop" "qa", "pathHead" "/tmp/qa/fakes/bin" and "claudecode", "entrypoint" and "configDir" null
      And the launch script's first line of output is "start pid=<that pid> model=dandelion/route-best scope=hard focus=src/app/a.ts src/domain/model.ts stop=qa"
      And the script contains "systemd-inhibit --what=idle --who=bindweed", "--why='bindweed gate'" and "'/tmp/qa/fakes/tools/overnight.sh'"
      And "/tmp/qa/layered/.bindweed/runs.json" is a one-element array whose object's keys are exactly "slug", "tool", "worktree", "branch", "pid", "startedAt", "out", "settings" and "tasks"
      And "tasks" is ["tasks/005-add-core.md","tasks/006-move-b.md","tasks/007-cut-app-domain.md"]
      And "slug" is "gate", "tool" is "marestail", "worktree" is "/tmp/qa/layered-bw-gate", "branch" is "bindweed/gate", "pid" is the body's pid, "out" is the launch ".out" and "startedAt" matches \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z
      And "settings" is {"model":"dandelion/route-best","scope":"hard","focus":"src/app/a.ts src/domain/model.ts","stopAt":"qa"}
      And the plan file's bytes are unchanged and "/tmp/qa/layered/.dependency-cruiser.cjs" does not exist
      And "git rev-parse HEAD" in "/tmp/qa/layered" is unchanged and "git status --porcelain" there is empty
      And "git config --get commit.gpgsign" in "/tmp/qa/layered" is still unset
      When I send "GET /api/plans/gate/launch" with the token
      Then "alive" is true, "worktree" is "/tmp/qa/layered-bw-gate", "branch" is "bindweed/gate" and "watch" is "marestail watch"
      When bindweed's process is stopped
      Then that pid is still alive

    Scenario: The fields are what was sent, and a blank scope omits SCOPE
      Given the launch plan
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"marestail","model":"other","scope":"  ","focus":" src/only.ts ","stopAt":"coder"}
      Then the steps are all ok and the start line has "model=other scope=none focus=src/only.ts stop=coder"
      And "/tmp/qa/log/overnight.json" has "model" "other", "scope" null, "focus" "src/only.ts" and "stop" "coder"
      And the runs.json settings are {"model":"other","scope":"","focus":"src/only.ts","stopAt":"coder"}

    Scenario: Without systemd-inhibit the overnight command still runs
      Given the launch plan
      And bindweed is restarted on the nosystemd directory
      When I send a marestail launch with the token
      Then the steps are all ok and the launch script does not contain "systemd-inhibit"
      And the launch script contains a single quote, the bash realpath and a single quote, in that order with nothing between them, as the overnight interpreter
      And the launch script does not contain the whitespace-delimited word bash
      And "/tmp/qa/log/overnight.json" has "argv" the three task paths and "model" "dandelion/route-best"

    Scenario: Typed values reach overnight.sh unchanged
      Given the launch plan
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"marestail","model":"a b","scope":"hard","focus":"src/$HOME \"x\" 'y'","stopAt":"qa"}
      Then the steps are all ok
      And "/tmp/qa/log/overnight.json" has "model" "a b", "scope" "hard", "focus" "src/$HOME \"x\" 'y'" and "stop" "qa"
      And the first line of the launch ".out" is "start pid=<pid> model=a b scope=hard focus=src/$HOME \"x\" 'y' stop=qa" where <pid> is the body's "pid"
      And the launch script contains "MODEL='a b'", "SCOPE='hard'", "STOP_AT='qa'", "cd '/tmp/qa/layered-bw-gate'" and "'/tmp/qa/fakes/tools/overnight.sh'"
      And the launch script contains the text of this line:
        """
        FOCUS='src/$HOME "x" '\''y'\'''
        """

    Scenario: A run that exits by itself is not left alive
      Given the launch plan and "/tmp/qa/log/overnight.quick" exists
      When I send a marestail launch with the token
      Then the steps are all ok
      And within 5 seconds the launch ".out" file's last line is "exit 3 " plus a UTC timestamp "YYYY-MM-DDTHH:MM:SSZ", and kill -0 of the body's pid fails
      When I send "GET /api/plans/gate/launch" with the token
      Then "alive" is false and the body has no "worktree" key
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":false,"error":"a branch named 'bindweed/gate' already exists"}]}

    Scenario: The overnight script is the real marestail's sibling, and PATH gets the directory that was found
      Given "/tmp/qa/real-install/bin/marestail" is an executable copy of the fake and "/tmp/qa/real-install/tools/overnight.sh" is an executable copy of the recording overnight.sh
      And "/tmp/qa/fakes/bin/marestail" is a symlink to "/tmp/qa/real-install/bin/marestail"
      And the launch plan
      When I send a marestail launch with the token
      Then the launch script contains "'/tmp/qa/real-install/tools/overnight.sh'" and does not contain "/tmp/qa/fakes/tools/overnight.sh"
      And "/tmp/qa/log/overnight.json" has "pathHead" "/tmp/qa/fakes/bin"

    Scenario: An existing marestail.toml is left alone
      Given "marestail.toml" holding "kept\n" is committed in the fixture
      And the launch plan
      When I send a marestail launch with the token
      Then the steps are all ok and the worktree's "marestail.toml" is "kept\n"
      And "/tmp/qa/log/marestail.log" does not exist
      And the paths the new commit adds do not include "marestail.toml"

    Scenario Outline: The commit body is the sentences, then Plan and Base
      Given the plan "Gate" has <edits>, the three tasks, the brief and no contract
      When I send a marestail launch with focus "" and the token
      Then the commit message after the blank line is <body>
      Examples:
        | edits | body |
        | no edits | Plan: gate\nBase: <baseCommit>\n |
        | the package cut and the note "keep" | src/app must not import src/domain (1 import)\nNote on src/domain: "keep"\nPlan: gate\nBase: <baseCommit>\n |

    Scenario: Base is the plan's baseCommit even when that is not HEAD
      Given the launch plan with baseCommit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      When I send a marestail launch with the token
      Then the commit message contains "Base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      And the new commit's parent is the browsed HEAD, which is not that base

    Scenario: Slop-cannon commits the contract only and passes the brief through
      Given the launch plan
      When I save the contract "text" as in the marestail scenario
      And I send an sc launch with the token
      Then the steps are all ok, "watch" is "sc status --repo /tmp/qa/layered-bw-gate" and the only path the commit adds is ".dependency-cruiser.cjs", equal to that text
      And the worktree has no "tasks/005-add-core.md" and no "marestail.toml"
      And "/tmp/qa/log/sc.json" has "cwd" "/tmp/qa/layered" and "argv" ["--repo","/tmp/qa/layered-bw-gate","--headless","--safety","on","-m","# Reshape layered\n\nMove b, then cut app from domain.\n"]
      And within 5 seconds the run's ".out" under "/tmp/qa/layered/.bindweed/runs" contains "started"
      And the runs.json entry has tool "slop-cannon", settings {"safety":"on","ammo":"","cartridge":""} and tasks []
      And "git status --porcelain" in the worktree is empty
      And "/tmp/qa/log/overnight.json" does not exist and "git status --porcelain" in "/tmp/qa/layered" is empty
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"slop-cannon","safety":"off","ammo":"3","cartridge":"wide"}
      Then the status is 409 and the body is {"error":"a run for this plan is still alive"}

    Scenario: Ammo and cartridge are flags only when they are not blank
      Given the launch plan
      When I send "POST /api/plans/gate/launch" with the token and {"tool":"slop-cannon","safety":"off","ammo":"3","cartridge":"wide"}
      Then "/tmp/qa/log/sc.json" has "argv" ["--repo","/tmp/qa/layered-bw-gate","--headless","--safety","off","--ammo","3","--cartridge","wide","-m",the brief]

    Scenario: Slop-cannon with no contract still commits the message and starts
      Given the plan "Gate" has no edits, the three tasks, the brief and no contract
      When I send an sc launch with the token
      Then the steps are all ok and the commit adds no paths
      And the commit message after the blank line is "Plan: gate\nBase: <baseCommit>\n"
      And "/tmp/qa/log/sc.json" has "argv" ending "-m" and the brief

    Scenario: An existing branch stops at Worktree and changes nothing
      Given the launch plan and the branch "bindweed/gate" already exists
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":false,"error":"a branch named 'bindweed/gate' already exists"}]}
      And "/tmp/qa/layered-bw-gate" does not exist and "git worktree list" in "/tmp/qa/layered" has only the browsed repository
      And "/tmp/qa/log/marestail.log" does not exist and "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: An existing directory stops at Worktree and does not create the branch
      Given the launch plan and an empty directory at "/tmp/qa/layered-bw-gate"
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":false,"error":"/tmp/qa/layered-bw-gate already exists"}]}
      And "git branch" in "/tmp/qa/layered" has no "bindweed/gate" and that directory is still empty
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: A cruiser file that 007 cannot merge stops at Files, with no commit
      Given the launch plan
      And "/tmp/qa/layered/.dependency-cruiser.cjs" contains exactly "const base = [];\nmodule.exports = { forbidden: [...base] };\n" and is committed
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":true},{"name":"Files","ok":false,"error":"bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array"}],"worktree":"/tmp/qa/layered-bw-gate","branch":"bindweed/gate"}
      And the worktree's HEAD equals the browsed HEAD and its cruiser file still holds those two lines
      And the worktree contains the three task files and has no commit of its own
      And "/tmp/qa/layered/.bindweed/runs.json" does not exist and "/tmp/qa/log/overnight.json" does not exist

    Scenario: A failing install stops at Files and does not commit
      Given the launch plan and "/tmp/qa/log/fail-install" exists
      When I send a marestail launch with the token
      Then the Files error is "install failed"
      And the worktree's HEAD equals the browsed HEAD and it has no "marestail.toml"

    Scenario: An install that prints nothing names the exit code
      Given the launch plan and "/tmp/qa/log/fail-install-quiet" exists
      When I send a marestail launch with the token
      Then the Files error is "marestail install exited with code 1"
      And the worktree's HEAD equals the browsed HEAD

    Scenario: No git identity stops at Commit
      Given the launch plan, the repository has no user.name, and bindweed has GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_SYSTEM=/dev/null
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":true},{"name":"Files","ok":true},{"name":"Commit","ok":false,"error":"Author identity unknown"}],"worktree":"/tmp/qa/layered-bw-gate","branch":"bindweed/gate"}
      And the worktree's HEAD equals the browsed HEAD

    Scenario: A file named .marestail stops Start and records nothing
      Given ".marestail" holding "x\n" is committed in the fixture
      And the launch plan
      When I send a marestail launch with the token
      Then the status is 200 and the body is {"steps":[{"name":"Worktree","ok":true},{"name":"Files","ok":true},{"name":"Commit","ok":true},{"name":"Start","ok":false,"error":"could not create /tmp/qa/layered-bw-gate/.marestail/runs"}],"worktree":"/tmp/qa/layered-bw-gate","branch":"bindweed/gate"}
      And the worktree's ".marestail" is still the file "x\n" and ".marestail/runs" does not exist
      And the worktree has one commit of its own and "/tmp/qa/layered/.bindweed/runs.json" does not exist
      And "git status --porcelain" in the worktree is empty
      And "/tmp/qa/log/overnight.json" does not exist and "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: A second launch waits, and a recorded live pid blocks the next one
      Given the launch plan and "/tmp/qa/log/install.wait" exists
      When I send a marestail launch with the token and wait until the worktree exists
      And I send the same POST again
      Then the second status is 409 and its body is {"error":"already running"}
      When "/tmp/qa/log/install.go" is created
      Then the first answers 200 with all five steps ok and runs.json has one entry
      When I send the same POST again
      Then the status is 409 and the body is {"error":"a run for this plan is still alive"}
      And "git worktree list" in "/tmp/qa/layered" shows the browsed repository and one worktree

    Scenario: A runs.json that is not a list is left as it was
      Given the launch plan and "/tmp/qa/layered/.bindweed/runs.json" holds "not json\n"
      When I send a marestail launch with the token
      Then the status is 200 and the body has exactly the keys "steps", "worktree", "branch", "watch" and "pid"
      And "steps" is [{"name":"Worktree","ok":true},{"name":"Files","ok":true},{"name":"Commit","ok":true},{"name":"Start","ok":true},{"name":"Record","ok":false,"error":"runs.json is not a list"}]
      And "worktree" is "/tmp/qa/layered-bw-gate", "branch" is "bindweed/gate", "watch" is "marestail watch" and kill -0 of "pid" succeeds
      And that file is still "not json\n"

    Scenario: A later launch appends and another plan's pid does not block
      Given "/tmp/qa/layered/.bindweed/runs.json" holds one entry for slug "other" whose pid is 1
      And the launch plan
      When I send a marestail launch with the token
      Then the parsed runs.json is the original {"slug":"other","pid":1} entry, unchanged, followed by the gate entry

  Rule: the old routes still answer, and the plan is not a run
    Scenario: Every existing route still answers, and generate does not create a worktree
      Given the launch plan
      And "/tmp/qa/layered/.bindweed/config.json" holds {"llm":{"backend":"command","command":"node <bindweed dir>/qa/fixtures/fake-llm.mjs /tmp/qa/log"}}
      When I send "GET /api/tree" with the token
      Then the status is 200 and the top-level entries include "notes", "src" and "tsconfig.json"
      When I send "GET /api/file?path=src/domain/model.ts" with the token
      Then "text" is "export class Model { id = 0; }\n"
      When I send "GET /api/graph?at=src" with the token
      Then the node ids are "src/app", "src/infra" and "src/domain"
      When I send "GET /api/graph?at=src&plan=gate" with the token
      Then the status is 200 and no edge has from "src/app" and to "src/domain"
      When I send "GET /api/detail?id=src/app&at=src" with the token
      Then the status is 200 and "files" is 2
      When I send "GET /api/pairs?from=src/app&to=src/domain&at=src" with the token
      Then the body is {"pairs":[["src/app/a.ts","src/domain/model.ts"]]}
      When I send "GET /api/plans/gate/contract" with the token
      Then the status is 200 and the rule names start with "bindweed:no-src-app-to-src-domain"
      When I send "POST /api/plans/gate/contract" with the token and the names []
      Then the status is 200 and "text" contains "forbidden: []"
      When I send "GET /api/layout" with the token
      Then the body is {"version":1,"views":{},"settings":{"tests":false,"external":false}}
      When I send "PUT /api/layout" with the token and that body
      Then the status is 200 and the body is that document
      When I send "GET /api/config" with the token
      Then "llm.backend" is "command"
      When I send "PUT /api/config" with the token and {"llm":{"backend":"command","command":"node <bindweed dir>/qa/fixtures/fake-llm.mjs /tmp/qa/log"}}
      Then the status is 200
      When I send "GET /api/repo" with the token
      Then the body is {"root":"/tmp/qa/layered"}
      When I send "POST /api/rescan" with the token
      Then the status is 200 and "files" is 4
      When I send "GET /" with the token
      Then the status is 200 and the body contains "<title>bindweed</title>"
      When I send "GET /assets/missing.js" with the token
      Then the status is 404 and the body is {"error":"not found"}
      When I send "GET /api/plans" with the token
      Then the list contains "Gate" and the summary has no "contract" key
      When I send "POST /api/plans" with the token and {"name":"Side"}
      Then the status is 201 and "slug" is "side"
      When I send "DELETE /api/plans/side" with the token
      Then the body is {"ok":true}
      When I send "POST /api/plans/gate/files" with the token
      Then the body is {"dir":"/tmp/qa/layered/.bindweed/plans/gate"}
      When I send "GET /api/plans/gate/chat" with the token
      Then the body is []
      When I send "PUT /api/plans/gate/chat" with the token and []
      Then the status is 200 and the body is []
      When I send "POST /api/plans/gate/review" with the token and {"edits":[]}
      Then the body is {"stale":[]}
      When I send "GET /api/plans/gate" with the token
      Then the status is 200 and "name" is "Gate" and "slug" is "gate" and "edits" is the package cut as its one edit and "redo" is [] and "tasks" is the three tasks and "brief" is the brief
      And "contract.rules" equals the "rules" of "GET /api/plans/gate/contract" and the body has no "interview" key
      When I send "PUT /api/plans/gate" with the token and that same document
      Then the status is 200 and the body is that document
      And "git status --porcelain" in "/tmp/qa/layered" is empty
      When I send "POST /api/plans/gate/cancel" with the token
      Then the body is {"cancelled":false}
      When I send "POST /api/plans/gate/generate" with the token and {"step":"ask"}
      Then "plan.interview" has one round whose first question is "Must a.ts keep exporting a?"
      When I send "POST /api/plans/gate/propose" with the token and {"text":"the ui knows about the scanner","at":"src"}
      Then "summary" is "Pull scanning out of the ui so app has one job."
      And "/tmp/qa/layered-bw-gate" does not exist
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: The README lists the launch route beside the old ones
      When I read bindweed's README.md
      Then "## Routes" has a row `/api/plans/<slug>/launch` with status "live", beside the rows already there

  Rule: the Launch dialog shows the fields, the steps and the copy lines
    "Launch" is in the plan toolbar, after "Tasks", only while a plan is open.
    It opens the dialog labelled "Launch". "Tool" is a select of "marestail"
    (the default) and "slop-cannon". Marestail shows inputs "MODEL", "SCOPE",
    "FOCUS" and "STOP_AT", prefilled from "dandelion/route-best", "hard", the
    GET focus and "qa". Slop-cannon shows "Safety" ("on" or "off", default
    "on"), "Ammo" and "Cartridge", the last two blank. Switching tools keeps
    what was typed and hides the other tool's fields. Opening the dialog
    fills the fields from GET again. A value typed over a field does not
    survive Close: the next open shows the GET values. "Close" and Escape
    close it and launch nothing. The dialog's "Launch" is disabled, with the
    reason as text, when a reason applies. Otherwise it POSTs the visible
    fields. Until that POST answers, the dialog's "Launch" stays disabled,
    including while a GET would show no refusal reason, so this dialog does
    not send a second POST. The Tool select and every field stay in the
    dialog and stay editable after the answer. Steps are added under them and
    do not replace them. Then an ordered list "Steps" shows each returned
    step: "<name> ✓" when ok (✓ is U+2713), or "<name> <error>" with no ✓ for
    the one that stopped. Later steps are absent. After the answer, Launch
    follows the refusal reasons again, from the open plan and from GET,
    including a run this answer just recorded. A failed step is not a reason,
    so Launch is enabled when none applies. The dialog uses that same
    first-reason order. A 409 that is the only answer to the dialog's POST
    shows its "error" as text and no Steps list. A duplicate 409 does not
    replace the steps of a launch this dialog already sent: the steps that
    show are that 200's steps, not the 409 text.
    What was typed survives switching tools and survives the answer. "Copy
    worktree" is shown when GET included a worktree, or when this answer's
    Worktree step is ok. "Copy branch" is shown only when that same source
    has a string "branch", so a missing "branch" leaves it out. "Copy command"
    is shown when GET included a watch, or when this answer's Start step is ok.
    Each copy button copies that text and nothing more.

    Scenario: The dialog launches marestail and copies the worktree, the branch and the watch command
      Given the launch plan is open on "http://127.0.0.1:5000/?token={token}#at=src&plan=gate"
      When I click "Launch"
      Then the dialog shows Tool "marestail", MODEL "dandelion/route-best", SCOPE "hard", FOCUS "src/app/a.ts src/domain/model.ts" and STOP_AT "qa"
      And "Safety" is not shown
      When I click "Close"
      Then the dialog is gone and "/tmp/qa/layered-bw-gate" does not exist
      When I click "Launch", then press Escape
      Then the dialog is gone and the directory still does not exist
      When I click "Launch"
      And I type "mine" over "MODEL" and "narrow" over "SCOPE"
      And I click "Close"
      And I click "Launch"
      Then "MODEL" is "dandelion/route-best" and "SCOPE" is "hard" and "FOCUS" is "src/app/a.ts src/domain/model.ts" and "STOP_AT" is "qa"
      When I click the dialog's "Launch"
      Then the steps read "Worktree ✓", "Files ✓", "Commit ✓", "Start ✓" and "Record ✓"
      And "Tool" is still "marestail", "MODEL" is still "dandelion/route-best", "SCOPE" is still "hard", "FOCUS" is still "src/app/a.ts src/domain/model.ts" and "STOP_AT" is still "qa"
      And within 5 seconds "/tmp/qa/log/overnight.json" has "model" "dandelion/route-best", "scope" "hard", "focus" "src/app/a.ts src/domain/model.ts" and "stop" "qa"
      And the dialog's "Launch" is disabled and the dialog shows "a run for this plan is still alive"
      And the dialog shows "/tmp/qa/layered-bw-gate", "bindweed/gate" and "marestail watch"
      When I click "Copy worktree"
      Then the clipboard is "/tmp/qa/layered-bw-gate"
      When I click "Copy branch"
      Then the clipboard is "bindweed/gate"
      When I click "Copy command"
      Then the clipboard is "marestail watch"
      And "git status --porcelain" in "/tmp/qa/layered" is empty

    Scenario: Slop-cannon shows its own fields and its own watch command
      Given the launch plan is open with the Launch dialog
      When I type "mine" over "MODEL" and "narrow" over "SCOPE" and choose "slop-cannon" in "Tool"
      Then "MODEL" is not shown, "Safety" is "on", and "Ammo" and "Cartridge" are blank
      When I type "3" over "Ammo" and choose "marestail" in "Tool"
      Then "MODEL" is "mine", "SCOPE" is "narrow", "FOCUS" is "src/app/a.ts src/domain/model.ts" and "STOP_AT" is "qa"
      When I choose "slop-cannon" in "Tool"
      Then "Safety" is "on", "Ammo" is "3" and "Cartridge" is blank
      When I choose "off" in "Safety" and clear "Ammo"
      Then "Safety" is "off" and "Ammo" and "Cartridge" are blank
      When I click the dialog's "Launch"
      Then the steps are all ✓ and the dialog shows "sc status --repo /tmp/qa/layered-bw-gate"
      And "/tmp/qa/log/sc.json" has "argv" ["--repo","/tmp/qa/layered-bw-gate","--headless","--safety","off","-m",the brief]
      And "Tool" is still "slop-cannon", "Safety" is still "off", and "Ammo" and "Cartridge" are still blank
      When I click "Copy command"
      Then the clipboard is "sc status --repo /tmp/qa/layered-bw-gate"

    Scenario: No tasks, a live run and an existing branch are visible from the dialog
      Given a plan "Empty" with no edits is open on the planned view
      When I click "Launch"
      Then the dialog's "Launch" is disabled and the dialog shows "this plan has no tasks"
      When I choose "slop-cannon" in "Tool"
      Then the dialog shows "this plan has no brief" and "Launch" is disabled
      When I click "Close"
      Given the launch plan's marestail run is still alive and that plan is open
      When I click "Launch"
      Then the dialog shows "a run for this plan is still alive", its "Launch" is disabled, and the worktree path, "bindweed/gate" and "marestail watch" are shown
      When that pid is killed, the worktree and its branch are removed, the branch "bindweed/gate" is created, and I click "Close" and "Launch"
      Then the dialog's "Launch" is enabled
      When I click the dialog's "Launch"
      Then the steps show "Worktree a branch named 'bindweed/gate' already exists" and no ✓
      And there is no "Copy worktree" button
      And "Tool" is "marestail", "MODEL", "SCOPE", "FOCUS" and "STOP_AT" are still shown and editable, and the dialog's "Launch" is enabled
      And "/tmp/qa/layered-bw-gate" does not exist
      When the branch "bindweed/gate" is deleted and I choose "slop-cannon" in "Tool"
      Then "Safety" is "on", "Ammo" and "Cartridge" are blank, and the dialog's "Launch" is enabled
      When I click the dialog's "Launch"
      Then the steps read "Worktree ✓", "Files ✓", "Commit ✓", "Start ✓" and "Record ✓"
      And the dialog shows "sc status --repo /tmp/qa/layered-bw-gate"
      And "/tmp/qa/log/sc.json" has "argv" ["--repo","/tmp/qa/layered-bw-gate","--headless","--safety","on","-m",the brief]

    Scenario: The dialog's Launch stays disabled until the answer, then the steps are the five ticks
      Given the launch plan is open with the Launch dialog and "/tmp/qa/log/install.wait" exists
      When I click the dialog's "Launch"
      Then the dialog's "Launch" stays disabled until that launch answers, the dialog sends one POST to "/api/plans/gate/launch", and the dialog does not show "already running"
      When "/tmp/qa/log/install.go" is created
      Then the steps read "Worktree ✓", "Files ✓", "Commit ✓", "Start ✓" and "Record ✓"
      And the dialog does not show "already running"
