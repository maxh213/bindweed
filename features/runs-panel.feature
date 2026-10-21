Feature: a Runs panel shows where every launched run stands
  A developer opens the Runs tab beside Files and Architecture and sees every
  run in ".bindweed/runs.json": plan, tool, branch, worktree, start and
  elapsed time, a state pill, a position line and a log tail. The badge counts
  running runs. The panel is read-only, except Forget on a removed worktree.

  The tree, token, {token}, Host header, JSON comparison and \n are the
  Background of features/plan-to-dependency-contract.feature. "bindweed" is
  "node <bindweed dir>/src/cli.ts" on port 5000.

  "A live pid" is the pid of a "sleep 900" the test spawned. "A dead pid" is
  the pid of a "true" the test spawned and waited for. "Entry <name>" is the
  runs.json object {"slug":"plan-<name>","tool":<tool>,"worktree":"/tmp/qa/runs/wt-<name>","branch":"bindweed/plan-<name>","pid":<pid>,"startedAt":<startedAt>,"out":"/tmp/qa/layered/.bindweed/runs/plan-<name>.out","settings":{},"tasks":<tasks>},
  without the "tasks" key when <tasks> is "none".
  "At HH:MM" is that time on 2026-10-21 UTC: an mtime set with touch, or a
  startedAt "2026-10-21THH:MM:00.000Z". Under "/tmp/qa/runs/wt-<name>", "log
  <id>" is ".marestail/runs/<id>/pipeline.log" and "summary" is
  ".marestail/runs/overnight-20261021T1230.md", mtime at 12:30.
  "<file> is a plan named X" means <file> is {"version":1,"name":X,
  "slug":<its slug>,"createdAt":"2026-10-21T12:00:00.000Z","baseCommit":
  <the fixture's 40-hex HEAD>,"edits":[],"redo":[]}, a plan bindweed loads.

  The marestail worktrees, tool "marestail":
  | name       | files                                                                                                                                  | tasks | pid  | startedAt |
  | done       | tasks/001-a.md, tasks/002-b.md; log 001-a and log 002-b "== qa (09-qa) attempt 1\npipeline complete\n" at 12:10 and 12:20; summary "001-a ok\n002-b ok\nall tasks complete 2026-10-21 12:30:00\n" | ["tasks/001-a.md","tasks/002-b.md"] | dead | 12:01 |
  | stopped    | tasks/001-w.md, tasks/002-x.md; log 001-w "pipeline complete\n" at 12:10; log 002-x "== coder (03-coder) attempt 2\ngate failed\nstopping for a human\n" at 12:20; summary "stopped: tasks/002-x.md exited 1\n" | ["tasks/001-w.md","tasks/002-x.md"] | dead | 12:02 |
  | failed     | tasks/001-f.md; log 001-f "== coder (03-coder) attempt 1\nnpm ERR! boom\n" at 12:10; summary "stopped: tasks/001-f.md exited 2\n" | ["tasks/001-f.md"] | dead | 12:03 |
  | running    | tasks/README.md, tasks/000-old.md, tasks/001-init.md, tasks/002-step.md, tasks/003-later.md; log 000-old "pipeline complete\n" at 12:25; log 001-init "pipeline complete\n" at 12:10; log 002-step "starting\n== coder (07-coder) attempt 2\n== hardener (07-hardener) attempt 1\n" at 12:20; ".marestail/runs/direct-001-20261021T1226.log" "x\n" at 12:26 | ["tasks/001-init.md","tasks/002-step.md","tasks/003-later.md"] | live | 12:04 |
  | dead       | tasks/README.md, tasks/001-task.md; log 001-task "starting\n" at 12:10                                                                  | none  | dead | 12:05 |
  | between    | tasks/001-a.md, tasks/002-b.md; log 001-a "== qa (09-qa) attempt 1\npipeline complete\n" at 12:10                                      | ["tasks/001-a.md","tasks/002-b.md"] | live | 12:06 |
  | fresh      | tasks/001-a.md and no ".marestail" directory                                                                                           | ["tasks/001-a.md"] | dead | 12:07 |
  | unverified | tasks/001-a.md; log 001-a "== qa (09-qa) attempt 1\npipeline complete, NOT verified by eye\n" at 12:10                                 | ["tasks/001-a.md"] | live | 12:08 |
  | removed    | no directory at all                                                                                                                    | []    | dead | 12:00 |

  The slop-cannon worktrees, tool "slop-cannon". The fake "sc" in
  "/tmp/qa/fakes/bin", given "status --repo <dir> --json", sleeps 15 seconds
  when "<dir>/sc-status.slow" exists, prints "<dir>/sc-status.err" to stderr
  and exits 1 when that exists, and otherwise prints "<dir>/sc-status.json"
  and exits 0. "The sc out" is "[sc] line 1\n" to "[sc] line 25\n" in that
  entry's "out" file.
  Their <tasks> is [].
  | name     | files                                                                                                                                                                                                  | out        | pid  | startedAt |
  | sc       | sc-status.json {"state":{"phase":"running"},"agents":[{"alive":true},{"alive":true},{"alive":true},{"alive":true},{"alive":false}],"beads":{"open":7,"done":3},"prs":[{"url":"https://example.test/pull/41"},{"url":"https://example.test/pull/42"}]} | the sc out | live | 12:09 |
  | sc-one   | sc-status.json {"state":{"phase":"planning"},"agents":[{"alive":true}],"beads":{},"prs":[{"url":"https://example.test/pull/7"}]}                                                                     | no file    | live | 12:10 |
  | sc-done  | sc-status.json {"state":{"phase":"complete"},"agents":[],"beads":{"done":5},"prs":[]}                                                                                                                | no file    | dead | 12:11 |
  | sc-err   | sc-status.err "no slop-cannon state here\nsecond line\n"                                                                                                                                               | no file    | dead | 12:12 |
  | sc-slow  | sc-status.slow                                                                                                                                                                                         | no file    | live | 12:13 |
  | sc-junk  | sc-status.json "null"                                                                                                                                                                                  | no file    | live | 12:14 |
  | sc-text  | sc-status.json "nope"                                                                                                                                                                                  | no file    | live | 12:15 |

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/layered" is the committed four-file fixture of features/plan-to-dependency-contract.feature
    And "/tmp/qa/runs" holds the worktrees above and "/tmp/qa/fakes/bin" holds the fake "sc"
    And bindweed is serving "/tmp/qa/layered" with "/tmp/qa/fakes/bin" first on PATH

  Rule: GET /api/runs reports every run's state, position and log tail
    GET /api/runs answers {"runs":[...]}, [] when runs.json is missing, not
    JSON or not a list. An element is left out unless it is an object with
    string "slug", "worktree" and "startedAt" and "tool" "marestail" or
    "slop-cannon". Runs are newest "startedAt" first; on a tie the later
    element comes first. Each run is exactly {"slug","planName","planExists",
    "tool","branch","worktree","worktreeExists","pid","startedAt","state",
    "position","prs","logTail"}. When ".bindweed/plans/<slug>.json" is a
    plan bindweed loads (the same check as GET /api/plans and
    GET /api/plans/<slug>/contract), "planName" is its "name" and
    "planExists" true; otherwise, missing, not JSON or not a valid plan,
    "planName" is the slug and "planExists" false. "branch" and "pid"
    are the entry's string branch and numeric pid, else null. A pid is alive
    as in features/launch-the-run.feature. "prs" is [] except for sc.
    "logTail" is the last 20 lines of its file, without newlines, [] when the
    file is missing. GET /api/runs never writes runs.json.

    A missing worktree: state "worktree removed", position "worktree removed",
    worktreeExists false, logTail [], prs [], whatever the tool.

    Marestail. The run's tasks are the entry's "tasks" when it is a list of
    strings (launch records it), else the worktree's "tasks/*.md" files
    except "tasks/README.md". A task "tasks/<id>.md" logs to
    ".marestail/runs/<id>/pipeline.log"; other files in ".marestail/runs" and
    logs of tasks not in the run are ignored. A task is done when its log has
    a line starting "pipeline complete" (real logs may end "pipeline
    complete, NOT verified by eye"). The current task is the run's task whose
    log has the newest mtime. The summary is the newest-mtime
    ".marestail/runs/overnight-*.md"; its verdict is its last line that
    starts "all tasks complete" (overnight.sh appends the date) or starts
    "stopped: <path> exited <code>". State: "done" on "all tasks complete";
    on "stopped:", "stopped for a human" when the last line of <path>'s log
    contains "stopping for a human", else "failed"; with no verdict,
    "running" when the pid is alive, else "dead". A log's last line ignores
    the final newline. The role and attempt are the first word and the
    number after "attempt" of the current log's last line starting "== ".
    Position is the first of these that applies, with <done> and <total> the
    task counts and "tasks" always plural:
    - state done: "all tasks complete · <done> of <total> tasks"
    - no current task: "no task started · <done> of <total> tasks"
    - the current log's last line starts "pipeline complete": "task <id> · finished · <done> of <total> tasks"
    - the current log has an "== " line: "task <id> · <role> · attempt <n> · <done> of <total> tasks"
    - otherwise: "task <id> · <done> of <total> tasks"
    logTail is the current task's log.

    Slop-cannon. bindweed runs "sc status --repo <worktree> --json" with a
    10-second timeout. From its JSON: phase is "state.phase"; agents is the
    number of "agents" elements with "alive" true; beads are the entries of
    the "beads" object, in its key order; "prs" is the "url" of each "prs"
    element. A missing or wrongly typed field counts as "", 0 or empty. State: "done" when
    phase is "done" or "complete", else "running" when the pid is alive, else
    "dead". Position: "<phase> · <agents> agent(s) · <n> <bead state>… · <n>
    PR(s)", singular only for exactly 1, with no bead parts when beads is
    empty. When sc fails, state follows the pid and position is "sc status
    failed: <reason> · pid alive" or "… · pid gone". <reason> is the first
    line of stderr, "exited <code>" when stderr is empty, "timed out after
    10s", "not JSON" (stdout is not a JSON object: also null, [] or "x"),
    or "sc is not on PATH". logTail is the entry's "out" file.

    Scenario Outline: Each run reports its state and position
      Given runs.json holds only entry <name>
      When I send "GET /api/runs" with the token
      Then the status is 200 and run 0 has state "<state>", position "<position>" and logTail <tail>
      And runs.json's bytes are unchanged

      Examples:
        | name    | state               | position                                            | tail                                                                           |
        | done    | done                | all tasks complete · 2 of 2 tasks                   | ["== qa (09-qa) attempt 1","pipeline complete"]                                |
        | stopped | stopped for a human | task 002-x · coder · attempt 2 · 1 of 2 tasks       | ["== coder (03-coder) attempt 2","gate failed","stopping for a human"]         |
        | failed  | failed              | task 001-f · coder · attempt 1 · 0 of 1 tasks       | ["== coder (03-coder) attempt 1","npm ERR! boom"]                              |
        | running | running             | task 002-step · hardener · attempt 1 · 1 of 3 tasks | ["starting","== coder (07-coder) attempt 2","== hardener (07-hardener) attempt 1"] |
        | dead    | dead                | task 001-task · 0 of 1 tasks                        | ["starting"]                                                                   |
        | between | running             | task 001-a · finished · 1 of 2 tasks                | ["== qa (09-qa) attempt 1","pipeline complete"]                                |
        | fresh   | dead                | no task started · 0 of 1 tasks                      | []                                                                             |
        | unverified | running          | task 001-a · finished · 1 of 1 tasks                | ["== qa (09-qa) attempt 1","pipeline complete, NOT verified by eye"]           |
        | removed | worktree removed    | worktree removed                                    | []                                                                             |
        | sc      | running             | running · 4 agents · 7 open · 3 done · 2 PRs        | "[sc] line 6" to "[sc] line 25"                                                |
        | sc-one  | running             | planning · 1 agent · 1 PR                           | []                                                                             |
        | sc-done | done                | complete · 0 agents · 5 done · 0 PRs                | []                                                                             |
        | sc-err  | dead                | sc status failed: no slop-cannon state here · pid gone | []                                                                          |
        | sc-slow | running             | sc status failed: timed out after 10s · pid alive   | []                                                                             |
        | sc-junk | running             | sc status failed: not JSON · pid alive              | []                                                                             |
        | sc-text | running             | sc status failed: not JSON · pid alive              | []                                                                             |

    Scenario: One run carries every field, and slop-cannon PRs are listed
      Given runs.json holds entry sc then entry running
      And ".bindweed/plans/plan-sc.json" is a plan named "Plan SC"
      And ".bindweed/plans/plan-running.json" is {"name":"Bad"}
      When I send "GET /api/runs" with the token
      Then run 0 is {"slug":"plan-sc","planName":"Plan SC","planExists":true,"tool":"slop-cannon","branch":"bindweed/plan-sc","worktree":"/tmp/qa/runs/wt-sc","worktreeExists":true,"pid":<its pid>,"startedAt":"2026-10-21T12:09:00.000Z","state":"running","position":"running · 4 agents · 7 open · 3 done · 2 PRs","prs":["https://example.test/pull/41","https://example.test/pull/42"],"logTail":<lines 6 to 25>}
      And run 1 has slug "plan-running", planName "plan-running", planExists false and prs []

    Scenario: Runs are ordered newest first and malformed elements are left out
      Given runs.json is [entry done, 7, {"slug":"x"}, entry dead, entry removed]
      When I send "GET /api/runs" with the token
      Then the slugs are "plan-dead", "plan-done", "plan-removed"

    Scenario: A slow sc does not hold the answer past its timeout
      Given runs.json holds only entry sc-slow
      When I send "GET /api/runs" with the token
      Then it answers 200 within 12 seconds

    Scenario: sc missing from PATH is reported on the card
      Given runs.json holds only entry sc-one
      And bindweed is restarted with PATH holding only node, git, sh, sleep and true
      When I send "GET /api/runs" with the token
      Then run 0 has state "running" and position "sc status failed: sc is not on PATH · pid alive"

    Scenario Outline: Missing or malformed runs.json answers no runs
      Given runs.json is <file>
      When I send "GET /api/runs" with the token
      Then the status is 200 and the body is {"runs":[]}

      Examples:
        | file       |
        | missing    |
        | "not json" |
        | {"a":1}    |
        | []         |

    Scenario: GET /api/runs checks host and token
      When I send "GET /api/runs" without authorization
      Then the status is 401 and the body is {"error":"missing or wrong token"}
      When I send "GET /api/runs" with Host "evil.example:5000" and the token
      Then the status is 403 and the body is {"error":"bad host"}

  Rule: Forget removes a run whose worktree is gone, and nothing else writes
    DELETE /api/runs?worktree=<path> rewrites runs.json without the elements
    whose "worktree" equals <path>, keeping the others in order, and answers
    {"ok":true}. It answers 400 {"error":"missing worktree"} without the
    parameter, 400 {"error":"worktree still exists"} when <path> exists, and
    404 {"error":"no such run"} when no element matches or runs.json is not a
    list; in those cases runs.json is unchanged. Host and token are checked
    first, as for every route.

    Scenario: Forget drops the removed run and keeps the rest
      Given runs.json is [entry done, entry removed, entry dead]
      When I send "DELETE /api/runs?worktree=/tmp/qa/runs/wt-removed" with the token
      Then the status is 200 and the body is {"ok":true}
      And runs.json is [entry done, entry dead]

    Scenario Outline: Forget refuses and leaves runs.json unchanged
      Given runs.json is [entry done, entry removed]
      When I send "DELETE <url>" with the token
      Then the status is <status> and the body is <body>
      And runs.json's bytes are unchanged

      Examples:
        | url                                          | status | body                                |
        | /api/runs                                    | 400    | {"error":"missing worktree"}        |
        | /api/runs?worktree=/tmp/qa/runs/wt-done      | 400    | {"error":"worktree still exists"}   |
        | /api/runs?worktree=/tmp/qa/runs/wt-elsewhere | 404    | {"error":"no such run"}             |

    Scenario: Forget checks host and token
      Given runs.json is [entry removed]
      When I send "DELETE /api/runs?worktree=/tmp/qa/runs/wt-removed" without authorization
      Then the status is 401 and the body is {"error":"missing or wrong token"}
      When I send "DELETE /api/runs?worktree=/tmp/qa/runs/wt-removed" with Host "evil.example:5000" and the token
      Then the status is 403 and the body is {"error":"bad host"}
      And runs.json's bytes are unchanged

  Rule: The Runs tab shows one card per run and polls only while seen
    The tab bar is "Files", "Architecture", "Runs". "#runs" opens the Runs
    tab, and clicking it pushes "#runs". The Runs tab holds a badge, class
    "badge" and never "pill", with the number of runs in state "running";
    with none there is no badge. The page fetches GET /api/runs once on load
    for the badge. While the Runs tab is shown and
    document.visibilityState is "visible", it fetches at once, then every 5
    seconds, never starting one while the last has not answered. Opening at
    "#runs" makes one request on load, which is also the "at once" one.
    Otherwise it does not fetch, and the badge keeps its last count.
    Each run is a card in the order of GET /api/runs, showing: planName, a
    link to "#at=<at>&plan=<slug>" when planExists (<at> is the Architecture
    view's current at, "" if never set), else plain text; tool; branch;
    worktree with a "Copy worktree" button; "started <startedAt> ·
    <elapsed>"; the state pill; the position line; one link per "prs" URL,
    its text the URL; and a closed "Log tail" disclosure holding logTail.
    Elapsed is now minus startedAt, on every refresh and in every state:
    "<s>s" under a minute, "<m>m" under an hour, "<h>h <m>m" under a day,
    else "<d>d <h>h". The pill has class "pill" and one of these, white text:
    | state               | class        | background |
    | running             | pill-running | #2563eb    |
    | stopped for a human | pill-stopped | #d97706    |
    | failed              | pill-failed  | #dc2626    |
    | done                | pill-done    | #16a34a    |
    | dead                | pill-dead    | #6b7280    |
    | worktree removed    | pill-removed | #9ca3af    |
    Only "worktree removed" cards have a "Forget" button. A 200 removes the
    card at once. Any other answer keeps the card and shows "Forget failed:
    <error>" on it. With no runs the panel says "No runs launched from this
    repository yet."

    Scenario: The panel shows every run with its state and badge
      Given runs.json is [entry removed, entry done, entry stopped, entry failed, entry running, entry dead, entry sc-err, entry sc]
      And ".bindweed/plans/plan-running.json" is a plan named "Plan Running"
      When I open bindweed at "#runs"
      Then the Runs tab is selected and its badge is "2"
      And the cards' titles are "plan-sc-err", "plan-sc", "plan-dead", "Plan Running", "plan-failed", "plan-stopped", "plan-done", "plan-removed"
      And each card's pill and position are those of the outline above, and its pill has that state's class and background
      And the "plan-sc" card has links "https://example.test/pull/41" and "https://example.test/pull/42"
      And only "plan-removed" has a "Forget" button

    Scenario: A plan file bindweed cannot load gives a plain title
      Given runs.json is [entry dead]
      And ".bindweed/plans/plan-dead.json" is {"name":"Bad"}
      When I open bindweed at "#runs"
      Then the card's title is the plain text "plan-dead", with no link

    Scenario: A card's log tail, copy and plan link
      Given runs.json is [entry running]
      And ".bindweed/plans/plan-running.json" is a plan named "Plan Running"
      When I open bindweed at "#at=src", click "Runs" and open "Log tail" on "Plan Running"
      Then it shows "starting", "== coder (07-coder) attempt 2" and "== hardener (07-hardener) attempt 1"
      When I click "Copy worktree"
      Then the clipboard is "/tmp/qa/runs/wt-running"
      When I click "Plan Running"
      Then the hash is "#at=src&plan=plan-running" and the Architecture tab shows plan "Plan Running"

    Scenario Outline: Elapsed time
      Given runs.json is [entry dead] with startedAt <age> before now
      When I open bindweed at "#runs"
      Then the card shows "started <startedAt> · <elapsed>"

      Examples:
        | age        | elapsed |
        | 42 seconds | 42s     |
        | 90 seconds | 1m      |
        | 3h 5m      | 3h 5m   |
        | 2d 3h 1m   | 2d 3h   |

    Scenario: Forget removes the card, and a refused Forget keeps it
      Given runs.json is [entry done, entry removed]
      When I open bindweed at "#runs" and the next DELETE /api/runs answers 400 {"error":"worktree still exists"}
      And I click "Forget" on "plan-removed"
      Then the card stays and shows "Forget failed: worktree still exists"
      When I click "Forget" on "plan-removed" again
      Then the card is gone before the next refresh
      And runs.json is [entry done]

    Scenario: No runs, no badge
      Given runs.json is missing
      When I open bindweed at "#runs"
      Then the Runs tab has no badge and the panel says "No runs launched from this repository yet."

    Scenario: Polling stops on another tab and in a hidden browser tab
      Given runs.json is [entry running]
      When I open bindweed at "#runs"
      Then GET /api/runs is requested once at load and then every 5 seconds
      When I click "Files"
      Then no GET /api/runs is requested for 15 seconds
      When I click "Runs"
      Then GET /api/runs is requested at once
      When document.visibilityState becomes "hidden"
      Then no GET /api/runs is requested for 15 seconds
      When document.visibilityState becomes "visible"
      Then GET /api/runs is requested at once and then every 5 seconds

  Rule: Launch (010) and every existing route keep working
    Record adds one key, "tasks", as features/launch-the-run.feature says;
    everything else launch writes or answers is unchanged.

    Scenario: A launch records the 010 fields plus "tasks" and shows as running
      Given the Background, fakes and launch plan of features/launch-the-run.feature
      When I send a marestail launch
      Then the steps are all ok
      And runs.json is a one-element array whose object's keys are exactly "slug", "tool", "worktree", "branch", "pid", "startedAt", "out", "settings" and "tasks"
      And "tasks" is ["tasks/005-add-core.md","tasks/006-move-b.md","tasks/007-cut-app-domain.md"]
      When I send "GET /api/plans/gate/launch" with the token
      Then "alive" is true, "worktree" is "/tmp/qa/layered-bw-gate", "branch" is "bindweed/gate" and "watch" is "marestail watch"
      When I send "GET /api/runs" with the token
      Then run 0 has slug "gate", planName "Gate", tool "marestail", state "running" and position "no task started · 0 of 3 tasks"

    Scenario: Old routes still answer and README lists /api/runs
      When I send "GET /api/tree" with the token
      Then the status is 200
      When I send "GET /api/graph?at=src" with the token
      Then the status is 200
      When I send "GET /api/plans" with the token
      Then the status is 200
      When I send "GET /api/config" with the token
      Then the status is 200
      When I read bindweed's README.md
      Then "## Routes" has a row `/api/runs` with status "live", beside the rows already there
