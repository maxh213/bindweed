# bindweed

See a TypeScript repo's architecture, reshape it on a canvas, and turn the new shape into [marestail](https://github.com/maxh213/marestail) tasks or a [slop-cannon](https://github.com/maxh213/slop-cannon) brief.

Run `bindweed` inside a repo. It serves a page on 127.0.0.1 that shows the repo's packages and files as boxes and its imports as arrows, laid out in layers the way Uncle Bob's architecture viewer does: high-level code at the top, leaves at the bottom, rule-breaking arrows in red. You drag, cut and redraw the arrows to say how the code should be shaped; bindweed writes that intent down as refactor tasks and a dependency contract the gate enforces, and can launch the run in its own worktree.

Status: being built by marestail, one slice per file in `tasks/`.

## Develop

- `npm install`
- `npm start` runs `node src/cli.ts`
- `npm test` runs the unit tests
- `npm run build` builds the browser app into `dist/ui`
- `npm run qa` runs the Playwright end-to-end checks in `qa/`
- unit tests that listen on TCP take their ports from a 70-port block above 20000, chosen by `STRYKER_MUTATOR_WORKER`, so parallel Stryker workers never bind the same port

## Routes

| route | status |
|---|---|
| `/` | live |
| `/assets/` | live |
| `/api/tree` | live |
| `/api/file` | live |

## Environment

| name | meaning |
|---|---|
| `BINDWEED_PORT` | first port to try (default 4477); tries up to N+20 unless `--port` is set |
