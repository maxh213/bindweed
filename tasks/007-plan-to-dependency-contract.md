# 007 — turn a plan into a dependency contract the gate enforces

After this task the developer can press **Contract** on a plan and see the dependency-cruiser rules that would make the planned shape binding: each cut becomes a forbidden import, each one-way relationship between sibling packages becomes a direction rule, and there is always a no-cycles rule. They see exactly how their `.dependency-cruiser.cjs` would change, choose which rules to keep, and the chosen rules are saved with the plan, ready for the run branch (010). This is Uncle Bob's "specification file the agents cannot violate": marestail's `ts.deps` gate runs dependency-cruiser, and coders cannot edit `.dependency-cruiser.cjs`.

## Rules generated from the planned graph (pure, in `src/domain`)

Every rule's `name` starts with `bindweed:` and every rule has `severity: 'error'` and a `comment` in plain words.

- **Cut file edge** (a `cut-edge` whose files are single file pairs): `bindweed:no-<from>-to-<to>` with `from: { path: '^<importer path>$' }`, `to: { path: '^<imported path, as planned>$' }`. Path parts in names are the paths with `/` and `.` replaced by `-`; regex special characters in paths are escaped.
- **Cut package edge** (a cut between two package nodes): one rule `from: { path: '^<a>/' }`, `to: { path: '^<b>/' }`.
- **Direction**: for every directory holding two or more packages in the planned graph, and every pair of those sibling packages with at least one planned edge between them in one direction and none in the other, a rule forbidding the reverse direction: `bindweed:<b>-does-not-use-<a>`.
- **No cycles**: `bindweed:no-circular` (`to: { circular: true }`), unless the existing file already has a rule with `circular: true`.
- Paths are the **planned** paths, because the rules must hold after the refactor.

## Merging into `.dependency-cruiser.cjs`

- No file: a new file exporting `{ forbidden: [ ...rules ], options: { doNotFollow: { path: 'node_modules' }, tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } } }` (drop `tsConfig` when the repo has no `tsconfig.json`).
- An existing file: parse it with the TypeScript compiler API as JavaScript, find the `forbidden` array literal in the object assigned to `module.exports` (or `export default`), remove every element that is an object literal whose `name` is a string starting with `bindweed:`, and append the new rules at the end of the array. Every other byte of the file stays as it was. Re-running on a merged file with the same rules gives an identical file.
- When `forbidden` is not a plain array literal in that object (a spread, a variable, a function call), do not guess: show `bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array` and offer the rules as a snippet to copy.
- Output formatting: two-space indentation inside rule objects, single-quoted strings, matching the style of the seed file in this repository.

## Page

- **Contract** in the plan toolbar opens a panel with a list of generated rules (checkbox each, all ticked by default, sentence plus rule name) and a unified diff of `.dependency-cruiser.cjs` before and after, updated as rules are ticked.
- **Save to plan** stores the ticked rules as `"contract": { "rules": [...] }` in the plan file. The contract is regenerated from the plan each time the panel opens; ticks for rules that still exist are kept.
- **Copy** copies the merged file text.
- Nothing is written to the repository.

## QA

Using the `layered` fixture with a plan that cuts `app → domain` (package edge) and cuts one file edge: the panel lists the package cut, the file cut, direction rules for the sibling pairs under `src`, and `bindweed:no-circular`; unticking a rule removes it from the diff. Then, outside the browser, write the merged text to a copy of the fixture and run `npx depcruise --config .dependency-cruiser.cjs src` from bindweed's own dev dependencies: it reports the existing `app → domain` imports under `bindweed:` rule names and exits non-zero, which is what makes the gate hold the plan. Merge twice, compare, and see identical files. A fixture whose `forbidden` is `[...base]` shows the refusal message and the snippet.

## Must not change

- Plan files from 005/006 load unchanged (`contract` is optional). No file in the target repository changes.
