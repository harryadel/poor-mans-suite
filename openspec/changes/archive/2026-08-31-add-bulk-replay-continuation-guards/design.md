## Context

See `proposal.md` for motivation and `specs/bulk-replay-continuation-guards/spec.md` for observable behavior. Bulk Replay is implemented inside `setupBulkReplay()` in `js/features/bulk-replay/index.js`. It reads panel-local configuration, eagerly generates requests, then performs one complete `fetch()` and response-body read before advancing to the next execution index.

Response Matcher configuration is stored in `state.responseMatchers`, normalized by `js/features/bulk-replay/response-matches.js`, and rendered as dynamic rows in Bulk Replay Configuration. Completed responses currently use overlap-aware matching for badges and highlights: longer phrases claim overlapping ranges, and only the winning matchers are returned for display. Results are held in a sparse local array keyed by execution index, while result-table sorting only moves existing row nodes.

The sequential loop provides a natural termination boundary after a result and progress update but before the next request begins. There is no backend execution service, worker boundary, durable Bulk Replay storage, timeout, or run-scoped cancellation model to extend.

## Goals / Non-Goals

**Goals:**
- Preserve a continuation-guard flag as part of each panel-local Response Matcher configuration.
- Keep display matching and continuation decisions separate so overlap suppression cannot produce a false stop.
- Stop only the current sequential run after its terminal result and progress have been recorded.
- Keep the terminal result identifiable after table sorting and expose an accessible run-level stop reason.
- Preserve existing behavior and data flow when no guard is selected.

**Non-Goals:**
- Build a generic matcher-expression or Boolean-group editor.
- Change response badge, highlighting, or longer-overlap priority behavior.
- Add status-code, header, redirect, or streaming-body predicates.
- Add request concurrency, lazy attack generation, timeouts, or broader manual cancellation behavior.
- Support multiple overlapping Bulk Replay runs as a new execution mode.
- Persist matcher or guard configuration outside the current DevTools panel session.

## Decisions

### Store guard selection on the matcher object

Extend the normalized matcher shape from `{ text, mode }` to `{ text, mode, isContinuationGuard }`, with the new Boolean defaulting to `false`. `readResponseMatchers()`, `appendResponseMatcherRow()`, and `renderResponseMatcherConfig()` will round-trip the flag so closing and reopening the configuration preserves it with the existing panel-local matcher state. Matchers added through the button or response context menu will remain display-only until explicitly marked.

Keeping the flag on the matcher avoids a second collection that would need to identify mutable matchers by text and mode. Stable matcher IDs were considered, but the configuration is transient, currently has no IDs, and does not require identity outside the rendered list. Normalization will continue to treat mode and text as matcher identity; if duplicate input is normalized, a marked duplicate must not silently lose its guard selection.

Each dynamic matcher row will expose a native checkbox with a concise visible or adjacent column label and a matcher-specific accessible name. Configuration help text will state the OR rule: replay continues while any checked guard matches and stops after recording the first response matching none. A single global stop checkbox was considered, but it could not distinguish display-only matchers from continuation guards.

### Snapshot continuation guards when the run starts

`startBulkReplay()` already snapshots normalized matchers and case sensitivity before requesting permission and entering the loop. The run will derive its marked guard list from that same snapshot and use it for the entire invocation.

This keeps a running replay deterministic and follows the existing matcher behavior. Reading mutable global state after each response was considered, but configuration edits outside the hidden modal could otherwise alter the condition midway through an attack.

### Evaluate guard truth independently from display matches

The response-matching module will provide or expose a single-matcher Boolean evaluation using the existing Contains, Whole Response, and case-sensitivity semantics. The run will apply that predicate independently to every marked guard and use `some()` semantics for the continuation decision.

The existing overlap-aware `getMatchedResponseMatchers()` path will remain authoritative for badges and highlights only. Reusing its returned subset for control flow was rejected because a longer overlapping phrase can suppress a shorter guard even though the shorter text is present. Calling the complete overlap-aware renderer separately for every guard would produce the correct Boolean result but would obscure the distinction between independent condition evaluation and display-range allocation.

### Terminate locally after completing the terminal result

For a successful response, the loop will first create the normal result, update its row and match display, and update completed progress. If marked guards exist and none matches independently, it will attach a `guard-mismatch` terminal reason to that result and break before the next loop iteration.

For a request parse, fetch, or response-body read failure, the existing error result will still be created. If marked guards exist, that result will receive a distinct `guard-check-failed` reason and the loop will break after updating progress. Without marked guards, the catch path and continuation behavior remain unchanged.

The guard condition will use local run data and a direct loop termination rather than setting `state.shouldStopBulk`. That shared flag belongs to the existing Close behavior and can be reset by another invocation. Local termination makes the automatic stop apply only to the run whose response was evaluated and avoids conflating mismatch, verification failure, and manual close.

Breaking before storing the result or incrementing progress was considered, but it would discard the evidence the user is trying to find and leave progress one request behind. Aborting `fetch()` is unnecessary for this condition because the response must complete before its matcher verdict is known and the loop has no later request in flight.

### Keep terminal identity on the result and row

The terminal reason will be retained with the local result and reflected by a row class or data attribute on that result's existing `<tr>`. The Bulk Replay header will gain a status region that distinguishes normal completion, guard mismatch, and guard-check failure while preserving progress as `completed/planned`. The stop message will include the original execution ID, for example `Stopped at #3: no continuation guard matched`.

Attaching terminal state to the existing result identity ensures that sorting cannot transfer the marker to a different row. Inferring termination from the last DOM row was rejected because active sorting deliberately decouples visual position from execution order. Relying only on the existing red no-match indicator was also rejected because it neither proves that the run stopped nor distinguishes an uncheckable response.

The status region will use native text with polite live announcement semantics. It will be reset when a new attack clears results. No separate results column is needed for a single terminal event.

### Keep evaluation inside the DevTools panel

Guard configuration and response-body evaluation will remain in the existing Bulk Replay modules. No message will be sent to `background.js`, no new host or optional permission will be requested, and no matcher or response content will be written to browser storage.

This preserves the current sensitive-data boundary: generated target requests and their responses stay in the DevTools panel except for the target network call the user already authorized. No dependency is needed; browser DOM APIs and the existing Vitest/jsdom test setup are sufficient.

## Risks / Trade-offs

- [A transient request or body-read error stops a guarded run early] -> Retain the error and show a verification-failure reason distinct from a meaningful mismatch so the user can retry knowingly.
- [Display badges may omit a guard that independently matched because of overlap priority] -> Keep guard truth separate from display-range allocation and cover the overlap case at both matcher-helper and replay-loop boundaries.
- [Adding a checkbox can crowd narrow matcher rows] -> Use the existing compact control styling, a concise column label, and a matcher-specific accessible name rather than verbose text inside every row.
- [A fetch that never settles cannot reach guard evaluation] -> Preserve the current request lifecycle and leave timeouts or in-flight cancellation to a separate change.
- [Cluster Bomb still allocates every generated request before the first response] -> Treat reduced network traffic, not reduced request-generation memory, as the benefit of early termination.
- [The existing UI can start overlapping Bulk Replay invocations] -> Keep guard snapshots and automatic termination local so one run does not toggle another run's stop flag; supporting or comprehensively isolating overlapping runs remains out of scope.
- [Older in-memory matcher objects and tests omit the new field] -> Normalize missing guard flags to `false`, preserving unguarded behavior by default.

## Migration Plan

No persisted data migration or staged rollout is required. Deploy the HTML, JavaScript, CSS, and focused tests together; existing matcher objects normalize to unguarded matchers and existing Bulk Replay behavior remains the default.

Rollback consists of reverting the guard controls, matcher flag handling, independent guard evaluation, and terminal status UI. No browser storage, service data, permission, or dependency remains to clean up. The existing packaging process continues to include runtime extension files and exclude OpenSpec and other development files.
