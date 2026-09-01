## Why

Request chat already receives much of the active request and response context, but it can become stale or mixed when the visible Repeater content comes from a resend or selected Bulk Replay result. Chat also cannot turn an attack suggestion into a safely reviewable Bulk Replay workflow, forcing users to recreate the configuration manually.

## What Changes

- Make the visible edited request and visible response the authoritative context for each new chat turn, including when the user selects a Bulk Replay result, while preserving per-request conversation history.
- Capture an immutable visible-context snapshot when chat proposes an action so later selection or editor changes cannot silently retarget it.
- Allow chat to prepare a draft configuration for the existing Sniper, Battering Ram, Pitchfork, and Cluster Bomb Bulk Replay modes from an explicit user request.
- Present every chat-created attack as a local review step showing its target, mode, payload inputs, projected request count, and relevant safety controls before execution.
- Require a separate user confirmation and the existing host-permission preflight before starting network traffic, then hand execution and results to the existing Bulk Replay workflow.
- Reject incomplete, invalid, stale, or unsupported attack drafts without sending requests and keep the user in control of cancellation and configuration edits.
- Do not add autonomous model tools, direct execution from a typed prompt, new attack modes, cross-request transcript sharing, or durable storage of HTTP context or attack drafts.

## Capabilities

### New Capabilities

- `chat-repeater-context`: Defines how request chat derives, snapshots, labels, and retains the visible Repeater request/response context without mixing data from another request or result.
- `chat-bulk-replay-drafts`: Defines creation, validation, review, confirmation, permission checking, and execution handoff for chat-prepared drafts of existing Bulk Replay modes.

### Modified Capabilities

None.

## Impact

- Affects request-chat context construction and action rendering, Repeater and Bulk Replay selection state, Bulk Replay configuration APIs, permission preflight, and focused chat/Bulk Replay tests.
- Sensitive request and response data continues to be disclosed only to the AI provider selected by the user for chat; action snapshots and drafts remain local to the DevTools panel and are not sent to an additional service or stored durably.
- Reuses the existing optional host permission and requires explicit review and confirmation before attack traffic; it does not broaden extension permissions or treat model output as authorization.
- No new dependency, external API, licensing, NOTICE, or production-package-content change is expected. OpenSpec and development files remain excluded from the extension archive.
