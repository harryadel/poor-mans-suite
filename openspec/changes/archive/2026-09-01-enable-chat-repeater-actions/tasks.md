## 1. Context And Draft Foundations

- [x] 1.1 Implement a session-only Repeater context controller with source activation, immutable snapshot capture, owner/source invalidation, and no durable storage, and verify focused unit tests cover captured, resend, Bulk Replay result, no-response, and invalidated-source snapshots.
- [x] 1.2 Add pure payload cardinality calculation beside the Bulk Replay engine for all four modes, including numeric-range and overflow validation, and verify unit tests match `generateAttackRequests` counts without materializing oversized Cluster Bomb combinations.
- [x] 1.3 Implement the strict fenced-JSON Bulk Replay draft parser and validator with correlation checks, allowlisted fields, balanced marker validation, exact snapshot-template equivalence, matcher/guard normalization, and the 1,000-request chat limit, and verify focused tests reject malformed, unsupported, mismatched, incomplete, ambiguous, and oversized drafts.

## 2. Visible Repeater Context Integration

- [x] 2.1 Activate accurate raw context during captured-request selection/restoration and resend success or failure, explicitly clearing absent responses, and verify request-editor and chat tests do not reuse a response from the previous selection.
- [x] 2.2 Attach run owner, raw response, and source identity to Bulk Replay results and invalidate replaced result sources, and verify selecting consecutive results exposes only the selected generated request/response and invalidates actions from cleared results.
- [x] 2.3 Refactor chat prompt construction to consume one frozen turn snapshot, include the exact current request/response with a source label, and keep bounded prior response observations keyed by owner/source, and verify `tests/llm-chat.test.js` covers edits, resends, no-response context, prior-response labels, and request isolation.
- [x] 2.4 Make active Repeater context choose the request-scoped conversation and ensure streaming completions remain attached to their original owner, and verify tests cover switching captured requests, selecting a result owned by another request, returning to prior history, and removing or clearing the owner.

## 3. Explicit Chat Draft Flow

- [x] 3.1 Add the `/bulk-replay` command, dedicated Prepare Bulk Replay control, and narrow natural-language intent classifier so all three produce the same one-turn draft-intent flag, and verify UI tests exercise each path plus an unrecognized informational message.
- [x] 3.2 Add the correlation-scoped Bulk Replay action contract only to flagged provider turns and parse structured output only for that turn's captured snapshot, and verify tests show ordinary assistant attack mentions, stale correlation IDs, and injected action-shaped context never create a confirmable draft.
- [x] 3.3 Render valid drafts as safely escaped local action cards with snapshot label, target, mode, projected count, Review, and Discard controls; retain local action metadata per owner without returning it to the provider, and verify cards restore on conversation return and become non-confirmable after discard or invalidation.
- [x] 3.4 Surface malformed or invalid assistant action data as non-executable assistant content or a clear validation outcome, and verify no review control or network request appears for parser and validator failures.

## 4. Bulk Replay Review And Execution Handoff

- [x] 4.1 Return a Bulk Replay controller from `setupBulkReplay()`, wire it through `js/main.js` into chat, and implement chat review sessions that back up manual configuration and prefill the existing modal, and verify opening a draft preserves the immutable template while cancel restores the previous manual configuration.
- [x] 4.2 Add the modal's chat-draft review banner, snapshot target/source, scheme, projected count, matcher/guard and permission notices, validation errors, and explicit cancel behavior, and verify edits revalidate live, update the count, and disable Start Attack whenever the draft is invalid, stale, or above 1,000 requests.
- [x] 4.3 Reorder Bulk Replay startup to count before generation, add a starting/running lock, recheck source validity at confirmation, and preserve manual large-run warnings and optional permission preflight, and verify denial, warning cancellation, double confirmation, active-run conflict, invalidation, and oversized chat drafts all send zero requests.
- [x] 4.4 Freeze the final reviewed configuration and execute it with the snapshot's template, scheme, owner, and raw-response baseline through the existing Bulk Replay lifecycle, and verify visible editor changes cannot retarget the run while progress, pause, cancellation, guards, terminal reasons, errors, and result selection continue to work without automatic retry.

## 5. Verification And Safeguards

- [x] 5.1 Run the focused chat, draft, Bulk Replay configuration, sorting, response-matcher, network, and permission test files and verify all new context, review, and zero-request safety scenarios pass.
- [x] 5.2 Run `npm test` and verify the complete Vitest suite passes without regressions.
- [x] 5.3 Audit the final diff for no new manifest permissions, dependencies, durable HTTP/draft storage, licensing changes, or production-package inclusion of OpenSpec files; run `git diff --check` and `openspec validate "enable-chat-repeater-actions" --strict` and verify both pass.
