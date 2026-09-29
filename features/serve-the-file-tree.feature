Feature: bindweed serves a repository's file tree on localhost
  A developer runs bindweed in a git repository, opens the printed link and browses the
  files: the folder tree on the left, the chosen file's numbered text on the right.

  Conventions: "bindweed" is "node <bindweed dir>/src/cli.ts"; /tmp/qa is a fresh temporary
  directory; bindweed serves /tmp/qa/demo-repo on port 4477 unless a scenario says otherwise;
  {token} is the token it printed and {wrong} is 32 zeros; "with the token" means with the
  header "Authorization: Bearer {token}"; requests carry "Host: 127.0.0.1:4477" unless a
  scenario sets another. An error message is one line on stderr and stdout stays empty.
  JSON bodies are compared as JSON and sent as "application/json; charset=utf-8".
  In a table cell \n is a newline.

  Background:
    Given bindweed's ui was built with "npm run build"
    And "/tmp/qa/plain" is an empty directory outside any git repository
    And "/tmp/qa/demo-repo" is a git repository with these files committed:
      | path            | content               |
      | .gitignore      | *.log                 |
      | README.md       | # demo                |
      | Zebra.txt       | z                     |
      | apple.txt       | a                     |
      | docs/guide.md   | # guide               |
      | src/a.ts        | the three lines below |
      | src/lib/util.ts | export const id = 1;  |
    And "src/a.ts" holds these three lines, each ended by a newline:
      """
      export const a = 1;
      export const name = 'żółw';
      export const sum = a + 2;
      """
    And its working tree also holds the git-ignored files "debug.log" and "build/out.log"

  Rule: bindweed starts in a git repository and leaves it as it found it
    Start-up checks run in this order: command line, repository, ui, port.

    Scenario Outline: Starting prints the link and the served root
      When I run "<command>" in "<directory>"
      Then stdout holds exactly these two lines, {token} being 32 lowercase hex characters:
        """
        bindweed: http://127.0.0.1:4477/?token={token}
        serving /tmp/qa/demo-repo
        """
      And bindweed keeps serving, and however many requests it answers stdout holds only those two lines
      And the folder "/tmp/qa/demo-repo/.bindweed" exists and "/tmp/qa/demo-repo/.git/info/exclude" holds the line ".bindweed/" exactly once
      And nothing else was created under "/tmp/qa"
      Examples:
        | directory                 | command                    |
        | /tmp/qa/demo-repo         | bindweed                   |
        | /tmp/qa/demo-repo/src/lib | bindweed                   |
        | /tmp/qa                   | bindweed demo-repo/src     |
        | /tmp/qa/plain             | bindweed /tmp/qa/demo-repo |

    Scenario Outline: A path outside any git repository is refused
      When I run "<command>" in "<directory>"
      Then stderr is "bindweed: <shown> is not inside a git repository" and the exit status is 2
      And nothing was created in "/tmp/qa/plain" or at "/tmp/qa/missing"
      Examples:
        | directory         | command                  | shown           |
        | /tmp/qa/plain     | bindweed                 | /tmp/qa/plain   |
        | /tmp/qa/demo-repo | bindweed /tmp/qa/plain   | /tmp/qa/plain   |
        | /tmp/qa/demo-repo | bindweed ../plain        | ../plain        |
        | /tmp/qa/demo-repo | bindweed /tmp/qa/missing | /tmp/qa/missing |

    Scenario: An unbuilt ui is reported
      Given a copy of bindweed at "/tmp/qa/unbuilt" without "dist/ui/index.html"
      And "/tmp/qa/demo-repo" holds its own "dist/ui/index.html"
      When I run "node /tmp/qa/unbuilt/src/cli.ts" in "/tmp/qa/demo-repo"
      Then stderr is "bindweed: the ui is not built; run npm run build in /tmp/qa/unbuilt" and the exit status is 1
      When I run "node /tmp/qa/unbuilt/src/cli.ts" in "/tmp/qa/plain"
      Then stderr is "bindweed: /tmp/qa/plain is not inside a git repository" and the exit status is 2

    Scenario: The installed bindweed command finds its own ui
      Given "/tmp/qa/bin/bindweed" is a symlink to "<bindweed dir>/src/cli.ts"
      When I run "node /tmp/qa/bin/bindweed" in "/tmp/qa/demo-repo"
      Then stdout holds exactly these two lines, {token} being 32 lowercase hex characters:
        """
        bindweed: http://127.0.0.1:4477/?token={token}
        serving /tmp/qa/demo-repo
        """
      When I send "GET /?token={token}"
      Then the status is 200, the content type is "text/html; charset=utf-8" and the body is the index.html from bindweed's own dist/ui

    Scenario: Two starts leave one exclude line and change nothing else
      Given I noted every file under "/tmp/qa/demo-repo", ".git" included
      When I start bindweed, open "src/a.ts" in the page, stop bindweed and start it again
      Then the two printed tokens differ
      And the only new path outside ".git" is the folder ".bindweed"
      And ".git/info/exclude" is what "git init" wrote followed by the one line ".bindweed/"
      And every other file, inside ".git" too, is byte for byte what it was
      And after that check "git status --porcelain" in "/tmp/qa/demo-repo" prints nothing

    Scenario Outline: The exclude line is added only when it is missing
      Given "/tmp/qa/demo-repo/.git/info/exclude" <before>
      When I start bindweed
      Then that file holds exactly "<after>"
      Examples:
        | before                                 | after                                |
        | is missing, and so is ".git/info"      | .bindweed/\n                         |
        | is empty                               | .bindweed/\n                         |
        | holds "*.tmp" with no newline after it | *.tmp\n.bindweed/\n                  |
        | holds "*.tmp\n.bindweed/\n*.bak\n"     | *.tmp\n.bindweed/\n*.bak\n           |
        | holds ".bindweed\n#.bindweed/\n"       | .bindweed\n#.bindweed/\n.bindweed/\n |

    Scenario: A linked worktree is excluded through the main repository
      Given "/tmp/qa/demo-wt" is a linked worktree of "/tmp/qa/demo-repo"
      When I run "bindweed" in "/tmp/qa/demo-wt"
      Then the second stdout line is "serving /tmp/qa/demo-wt"
      And the folder "/tmp/qa/demo-wt/.bindweed" exists and "/tmp/qa/demo-wt/.git" is still the file git wrote
      And "/tmp/qa/demo-repo/.git/info/exclude" holds the line ".bindweed/" exactly once
      And "git status --porcelain" in "/tmp/qa/demo-wt" prints nothing

  Rule: The port comes from --port, else BINDWEED_PORT, else 4477
    Only --port is final. Any other first port N is followed by N+1 up to N+20.

    Scenario Outline: bindweed serves on the first free port it may use
      Given BINDWEED_PORT is <env> and these ports are taken on 127.0.0.1: <taken>
      When I run "<command>" in "/tmp/qa/demo-repo"
      Then the first stdout line starts with "bindweed: http://127.0.0.1:<port>/?token="
      Examples:
        | command              | env   | taken        | port |
        | bindweed             | unset | none         | 4477 |
        | bindweed             | unset | 4477         | 4478 |
        | bindweed             | unset | 4477 to 4496 | 4497 |
        | bindweed             | 4600  | none         | 4600 |
        | bindweed             | 4600  | 4600 to 4619 | 4620 |
        | bindweed --port 4555 | unset | none         | 4555 |
        | bindweed --port 4555 | 4600  | none         | 4555 |

    Scenario Outline: bindweed gives up when no port is left to try
      Given BINDWEED_PORT is <env> and these ports are taken on 127.0.0.1: <taken>
      When I run "<command>" in "/tmp/qa/demo-repo"
      Then stderr is "<message>" and the exit status is 1
      Examples:
        | command              | env   | taken        | message                                      |
        | bindweed             | unset | 4477 to 4497 | bindweed: no free port between 4477 and 4497 |
        | bindweed             | 4600  | 4600 to 4620 | bindweed: no free port between 4600 and 4620 |
        | bindweed --port 4555 | unset | 4555         | bindweed: port 4555 is in use                |
        | bindweed --port 4477 | unset | 4477         | bindweed: port 4477 is in use                |

    Scenario Outline: A malformed command line is refused
      Given BINDWEED_PORT is <env>
      When I run "<command>" in "/tmp/qa/demo-repo"
      Then stderr is "<message>" and the exit status is 2
      Examples:
        | command               | env   | message                                              |
        | bindweed --port abc   | unset | bindweed: port abc is not a number from 1 to 65535   |
        | bindweed --port 0     | unset | bindweed: port 0 is not a number from 1 to 65535     |
        | bindweed --port 65536 | unset | bindweed: port 65536 is not a number from 1 to 65535 |
        | bindweed              | abc   | bindweed: port abc is not a number from 1 to 65535   |
        | bindweed --port       | unset | bindweed: usage: bindweed [path] [--port N]          |
        | bindweed --watch      | unset | bindweed: usage: bindweed [path] [--port N]          |
        | bindweed one two      | unset | bindweed: usage: bindweed [path] [--port N]          |

    Scenario: bindweed listens on 127.0.0.1 only
      When bindweed is serving on port 4477
      Then the only address listening on port 4477 is 127.0.0.1
      And a connection to "[::1]:4477" is refused

    Scenario Outline: A signal stops bindweed with status 0
      Given a browser has the page open
      When I send <signal> to bindweed
      Then bindweed exits with status 0 within 2 seconds and "127.0.0.1:4477" refuses connections
      Examples:
        | signal  |
        | SIGINT  |
        | SIGTERM |

  Rule: The Host header is checked first, then the token, then the address
    The token is compared in constant time. No scenario can observe that; it is checked in the code.

    Scenario Outline: A request with a foreign Host header is refused
      When I send "<request>" with the header "Host: <host>"
      Then the status is 403 and the body is {"error":"bad host"}
      Examples:
        | request                     | host              |
        | GET /api/tree?token={token} | evil.example:4477 |
        | GET /api/tree               | evil.example:4477 |
        | GET /?token={token}         | evil.example:4477 |
        | GET /assets/app.js          | evil.example:4477 |
        | GET /api/tree?token={token} | 127.0.0.1:9999    |
        | GET /api/tree?token={token} | 127.0.0.1         |

    Scenario Outline: The API needs the token, in the header or in the address
      When I send "<request>" with <header>
      Then the status is <status>, and a 401 has the body {"error":"missing or wrong token"}
      Examples:
        | request                     | header                          | status |
        | GET /api/tree               | no header of my own             | 401    |
        | GET /api/tree               | "Authorization: Bearer {wrong}" | 401    |
        | GET /api/tree?token={wrong} | no header of my own             | 401    |
        | GET /api/tree?token=abc     | no header of my own             | 401    |
        | GET /api/tree?token=        | no header of my own             | 401    |
        | GET /api/file?path=src/a.ts | no header of my own             | 401    |
        | POST /api/nope              | no header of my own             | 401    |
        | GET /api/tree               | "Authorization: Bearer {token}" | 200    |
        | GET /api/tree?token={token} | no header of my own             | 200    |
        | GET /api/tree?token={token} | "Host: localhost:4477"          | 200    |

    Scenario Outline: The page is served only to the link with the token
      Given "/tmp/qa/demo-repo" holds its own "dist/ui/index.html"
      When I send "<request>"
      Then the status is <status>, the content type is "<type>" and the body is <body>
      Examples:
        | request             | status | type                      | body                                                               |
        | GET /?token={token} | 200    | text/html; charset=utf-8  | the index.html from bindweed's own dist/ui                         |
        | GET /               | 401    | text/plain; charset=utf-8 | the line "bindweed: use the link bindweed printed in the terminal" |
        | GET /?token={wrong} | 401    | text/plain; charset=utf-8 | that same line                                                     |

    Scenario Outline: Assets are served without a token
      Given bindweed's "dist/ui/assets" holds "<file>"
      When I send "GET /assets/<file>" with no token
      Then the status is 200, the content type is "<type>" and the body is that file's content
      Examples:
        | file    | type                           |
        | app.js  | text/javascript; charset=utf-8 |
        | app.css | text/css; charset=utf-8        |

    Scenario Outline: Any other address is not found
      When I send "<request>", exactly as written, with <credentials>
      Then the status is 404 and the body is {"error":"not found"}
      Examples:
        | request                                 | credentials |
        | GET /nope                               | no token    |
        | GET /assets/missing.js                  | no token    |
        | GET /assets/../index.html               | no token    |
        | GET /assets/..%2F..%2F..%2Fpackage.json | no token    |
        | GET /api/nope                           | the token   |
        | POST /api/tree                          | the token   |

  Rule: The API serves what git lists in the working tree, and nothing else
    Of what git lists, only a regular file on disk counts: a symlink, a submodule, a nested
    repository and a file deleted from disk are left out of the tree and answer 404.

    Scenario: The tree lists folders first and then files in byte order
      When I send "GET /api/tree" with the token
      Then the status is 200 and the body is this JSON, with no ignored file, "build", ".git" or ".bindweed":
        """
        {"root":"demo-repo","entries":[
          {"name":"docs","path":"docs","kind":"dir","children":[
            {"name":"guide.md","path":"docs/guide.md","kind":"file"}]},
          {"name":"src","path":"src","kind":"dir","children":[
            {"name":"lib","path":"src/lib","kind":"dir","children":[
              {"name":"util.ts","path":"src/lib/util.ts","kind":"file"}]},
            {"name":"a.ts","path":"src/a.ts","kind":"file"}]},
          {"name":".gitignore","path":".gitignore","kind":"file"},
          {"name":"README.md","path":"README.md","kind":"file"},
          {"name":"Zebra.txt","path":"Zebra.txt","kind":"file"},
          {"name":"apple.txt","path":"apple.txt","kind":"file"}]}
        """

    Scenario: An empty repository lists no entries
      Given "/tmp/qa/empty-repo" is a fresh git repository with no committed or untracked files
      When I run "bindweed" in "/tmp/qa/empty-repo"
      Then stdout holds exactly these two lines, {token} being 32 lowercase hex characters:
        """
        bindweed: http://127.0.0.1:4477/?token={token}
        serving /tmp/qa/empty-repo
        """
      When I send "GET /api/tree" with the token
      Then the status is 200 and the body is {"root":"empty-repo","entries":[]}
      When I open "http://127.0.0.1:4477/?token={token}" in a browser
      Then the left side shows exactly the row "empty-repo/"
      And the right side shows "select a file"

    Scenario: The tree follows the working tree
      Given bindweed is already serving
      When I create the untracked file "notes.txt" and delete "apple.txt" from disk without committing
      And I send "GET /api/tree" with the token
      Then the files at the top level are, in order, ".gitignore", "README.md", "Zebra.txt", "notes.txt"
      And "GET /api/file?path=apple.txt" with the token answers 404 {"error":"no such file"}

    Scenario Outline: What is not a regular file is left out
      Given "/tmp/qa/plain/outside.txt" exists and the working tree also holds <entry>
      When I send "GET /api/tree" with the token
      Then no entry is named "<name>"
      And "GET /api/file?path=<path>" with the token answers 404 {"error":"no such file"}
      Examples:
        | entry                                                         | name     | path         |
        | the symlink "link.txt" to "README.md"                         | link.txt | link.txt     |
        | the symlink "out.txt" to "/tmp/qa/plain/outside.txt"          | out.txt  | out.txt      |
        | the symlink "linkdir" to "/tmp/qa/plain"                      | linkdir  | linkdir      |
        | the folder "vendor", a git repository of its own with "v.txt" | vendor   | vendor/v.txt |

    Scenario: A file name with spaces and non-ASCII letters is listed and read
      Given the working tree also holds "notes/żółw i zając.md" with the one line "cześć"
      When I send "GET /api/tree" with the token
      Then the folder "notes" holds a file named "żółw i zając.md" with the path "notes/żółw i zając.md"
      When I send "GET /api/file?path=notes%2F%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md" with the token
      Then the body is {"path":"notes/żółw i zając.md","text":"cześć\n"}

    Scenario: A text file is returned whole
      When I send "GET /api/file?path=src/a.ts" with the token
      Then the status is 200
      And the body is {"path":"src/a.ts","text":"export const a = 1;\nexport const name = 'żółw';\nexport const sum = a + 2;\n"}

    Scenario Outline: A path that is not in the tree is not served
      Given "/tmp/qa/plain/outside.txt" exists
      When I send "GET /api/file<query>" with the token
      Then the status is 404 and the body is {"error":"no such file"}
      Examples:
        | query                             | why                   |
        |                                   | no path given         |
        | ?path=                            | empty path            |
        | ?path=nope.ts                     | not there             |
        | ?path=src                         | a folder              |
        | ?path=debug.log                   | git-ignored           |
        | ?path=.git/config                 | inside .git           |
        | ?path=../plain/outside.txt        | leaves the repository |
        | ?path=src/../README.md            | holds ..              |
        | ?path=/tmp/qa/demo-repo/README.md | absolute              |

    Scenario Outline: Large and binary files are not returned as text
      Given the working tree also holds "<file>" made of <content>
      When I send "GET /api/file?path=<file>" with the token
      Then the status is <status> and the body is <body>
      Examples:
        | file      | content                    | status | body                                      |
        | exact.txt | 1048576 bytes "x"          | 200    | "path" and a "text" of 1048576 characters |
        | big.txt   | 1048577 bytes "x"          | 413    | {"error":"file too large to show"}        |
        | huge.bin  | 1048577 NUL bytes          | 413    | {"error":"file too large to show"}        |
        | blob.bin  | the three bytes 61 00 62   | 200    | {"path":"blob.bin","binary":true}         |
        | edge.bin  | 8191 bytes "x", then a NUL | 200    | {"path":"edge.bin","binary":true}         |
        | late.txt  | 8192 bytes "x", then a NUL | 200    | "path" and a "text" of 8193 characters    |
        | empty.txt | no bytes                   | 200    | {"path":"empty.txt","text":""}            |

    Scenario: The README lists every route
      When I read the "## Routes" table in bindweed's README.md
      Then it holds these rows:
        | route       | status |
        | `/`         | live   |
        | `/assets/`  | live   |
        | `/api/tree` | live   |
        | `/api/file` | live   |

  Rule: The page shows the tree on the left and the chosen file on the right
    Folder rows end in "/". The first row is the root, which starts expanded. A folder row carries
    aria-expanded "true" or "false" and shows its rows only when expanded; the row of the
    selected file carries aria-current "true".

    Scenario: The page opens with every folder collapsed
      When I open "http://127.0.0.1:4477/?token={token}" in a browser
      Then the tab title is "bindweed — demo-repo"
      And the left side shows exactly these rows, top to bottom:
        | demo-repo/ | docs/ | src/ | .gitignore | README.md | Zebra.txt | apple.txt |
      And the right side shows "select a file"

    Scenario: The token leaves the address bar and travels in a header
      When I open "http://127.0.0.1:4477/?token={token}" in a browser
      Then the address bar shows "http://127.0.0.1:4477/"
      And the tab's sessionStorage holds {token} under the key "bindweed.token"
      And every "/api/" request the page sends carries "Authorization: Bearer {token}" and no token in its address

    Scenario: Clicking a folder toggles it
      Given the page is open
      When I click "src/"
      Then "lib/" and "a.ts" appear under "src/" in that order, and "util.ts" stays hidden
      When I click "src/" again
      Then "lib/" and "a.ts" are hidden
      When I click "demo-repo/"
      Then "demo-repo/" is the only row left

    Scenario: Clicking a file shows its text with line numbers
      Given the page is open and "src/" is expanded
      When I click "a.ts"
      Then the right side shows the header "src/a.ts"
      And under it, in a monospaced font, exactly these numbered lines:
        | 1 | export const a = 1;         |
        | 2 | export const name = 'żółw'; |
        | 3 | export const sum = a + 2;   |
      And the row "a.ts" is marked as selected
      And the address bar shows "http://127.0.0.1:4477/#file=src/a.ts"

    Scenario: Selecting a non-ASCII path writes the encoded hash
      Given the working tree also holds "notes/żółw i zając.md" with the one line "cześć"
      And the page is open and "notes/" is expanded
      When I click "żółw i zając.md"
      Then the address bar shows "http://127.0.0.1:4477/#file=notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md"

    Scenario Outline: A final newline does not start another numbered line
      Given the working tree also holds "<file>" with the content "<content>"
      When I click "<file>" in the page
      Then the right side shows the header "<file>" and <lines>
      Examples:
        | file      | content      | lines                              |
        | bare.txt  | one\ntwo     | 2 numbered lines: "one", "two"     |
        | gap.txt   | one\n\ntwo\n | 3 numbered lines: "one", "", "two" |
        | empty.txt |              | no numbered line                   |

    Scenario Outline: A deep link opens the file and its folders
      Given the working tree also holds "notes/żółw i zając.md" with the one line "cześć"
      When I open "http://127.0.0.1:4477/?token={token}#file=<hash>" in a browser
      Then the right side shows the header "<path>" and that file's numbered lines
      And the row of that file is marked as selected
      And the folders expanded below the root are exactly: <open>
      And the address bar shows "http://127.0.0.1:4477/#file=<hash>"
      Examples:
        | hash                                          | path                  | open              |
        | src/a.ts                                      | src/a.ts              | "src/"            |
        | src/lib/util.ts                               | src/lib/util.ts       | "src/" and "lib/" |
        | README.md                                     | README.md             | none              |
        | notes/%C5%BC%C3%B3%C5%82w%20i%20zaj%C4%85c.md | notes/żółw i zając.md | "notes/"          |

    Scenario Outline: A file that cannot be shown says why
      When I <action>
      Then the right side shows the header "<path>" and the text "<message>", and no numbered line
      Examples:
        | action                                                          | path      | message                |
        | click "blob.bin", which holds the three bytes 61 00 62          | blob.bin  | binary file, not shown |
        | click "big.txt", which holds 1048577 bytes                      | big.txt   | file too large to show |
        | open the link with "#file=nope.ts" added                        | nope.ts   | no such file           |
        | click "README.md" after bindweed was restarted on the same port | README.md | missing or wrong token |
        | click "README.md" after bindweed was stopped                    | README.md | cannot reach bindweed  |
