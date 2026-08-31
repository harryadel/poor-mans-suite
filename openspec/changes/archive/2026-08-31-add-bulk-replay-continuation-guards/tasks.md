## 1. Matcher Model and Evaluation

- [x] 1.1 Extend Response Matcher normalization to retain `isContinuationGuard`, default missing flags to `false`, and preserve a marked selection when duplicate mode/text entries are collapsed; verify focused normalization tests pass in `tests/bulk-response-matches.test.js`.
- [x] 1.2 Add independent single-matcher Boolean evaluation for Contains, Whole Response, and case sensitivity without overlap suppression; verify unit tests cover matching, misses, empty bodies, and a shorter guard overlapping a longer display matcher.

## 2. Guard Configuration

- [x] 2.1 Add a native continuation-guard checkbox to each Response Matcher row, update the row layout and help text to explain any-match continuation, and round-trip the flag through matcher read/render state; verify UI tests cover accessible labels, checked state changes, and display-only defaults for button- and context-menu-added matchers.
- [x] 2.2 Preserve guard selections when Bulk Replay Configuration is reopened in the same panel session and remove the selection with its matcher; verify focused configuration tests cover reopen, edit, and removal behavior.

## 3. Replay Termination and Results

- [x] 3.1 Add an accessible Bulk Replay run-status region and terminal-result styling that reset on each new attack and remain attached to the original result row when sorted; verify DOM tests cover normal completion, reset behavior, live status text, and terminal row identity after sorting.
- [x] 3.2 Snapshot marked guards at attack start and apply independent OR evaluation after each successful response; verify replay-loop tests prove that any matching guard continues, all-guard misses and empty bodies retain the terminal result, progress includes that result, and no later request is sent.
- [x] 3.3 Record a distinct verification-failure terminal reason when guarded request parsing, fetch, or response-body reading fails, while preserving existing continuation for unguarded errors; verify focused tests assert retained error details, status text, progress, and fetch call counts for guarded and unguarded runs.
- [x] 3.4 Keep automatic guard termination local to the current invocation rather than the shared manual-stop flag; verify tests show a guard mismatch does not mutate manual pause/close state and execution order remains authoritative regardless of result sorting.

## 4. Verification and Impact Checks

- [x] 4.1 Run `npx vitest run tests/bulk-response-matches.test.js tests/bulk-response-matches-ui.test.js tests/bulk-replay-config-ui.test.js tests/bulk-replay-sorting-ui.test.js` and verify all focused matcher, configuration, execution, accessibility, and sorting tests pass.
- [x] 4.2 Run `npm test` and `npm run spec:validate`, then verify the complete test suite and strict OpenSpec validation pass.
- [x] 4.3 Review the final diff and verify it adds no extension permission, background/external data flow, browser-storage write, dependency, licensing-file change, or production-package inclusion of OpenSpec/development files; run `git diff --check` and record that no production archive build is required for this change.
