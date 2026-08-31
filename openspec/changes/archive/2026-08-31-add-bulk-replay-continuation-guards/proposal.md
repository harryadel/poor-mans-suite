## Why

Bulk Replay users may recognize unsuccessful attempts by a repeated response such as "Invalid username" and need to stop as soon as a response diverges from that known pattern. Continuing through the remaining payloads can obscure the significant result and send unnecessary requests after a potentially valid candidate has already been found.

## What Changes

- Allow users to mark one or more Response Matchers as continuation guards for a Bulk Replay run.
- Continue replaying while at least one marked guard independently matches the completed response body using its configured matcher mode and the shared case-sensitivity setting.
- Record and retain the first response that matches none of the marked guards, then stop before sending the next generated request and show an explicit mismatch stop reason.
- When a request fails before its response can be checked, retain the error result and stop with a distinct verification-failure reason rather than reporting a response mismatch.
- Preserve existing Bulk Replay behavior when no continuation guards are marked.
- Keep "first" tied to request execution order; sorting the results table remains display-only.
- Treat generic Boolean matcher expressions, status/header predicates, concurrent replay scheduling, broader manual cancellation changes, and durable matcher configuration storage as explicit non-goals.

## Capabilities

### New Capabilities

- `bulk-replay-continuation-guards`: Configure response matchers that keep a Bulk Replay running while any guard matches, and expose the retained terminal result and reason when the condition cannot be satisfied or checked.

### Modified Capabilities

None.

## Impact

- Affects the Bulk Replay configuration and results UI, panel-local Bulk Replay state, response-matcher evaluation, sequential replay termination, and focused Vitest/jsdom coverage.
- Does not add a backend API, external data flow, dependency, extension permission, or browser storage. Matching continues to use response bodies already available inside the DevTools panel and does not transmit or persist them elsewhere.
- Does not change licensing obligations or packaging boundaries. Runtime source changes would be included through the existing extension packaging process, while OpenSpec and development files remain excluded from the production archive.
