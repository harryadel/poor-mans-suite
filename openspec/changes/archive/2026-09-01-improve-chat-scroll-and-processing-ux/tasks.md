## 1. Chat Pane Foundation

- [x] 1.1 Add message-log semantics, keyboard focusability, and initial busy-state attributes to the chat markup, and verify the chat controller fixture asserts the resulting accessibility contract.
- [x] 1.2 Harden the chat-specific flex sizing and overflow chain so the message history owns vertical scrolling while the header and composer remain fixed, and verify the pane remains usable at reduced heights and after Bulk Replay resizing.
- [x] 1.3 Add pending/streaming indicator styles with a reduced-motion fallback, and verify the indicator remains visible beside partial answer content without obscuring it.

## 2. Follow-to-Latest Behavior

- [x] 2.1 Add near-bottom detection and transient follow-to-latest state to the chat controller, and verify focused tests cover leaving and re-entering the bottom tolerance.
- [x] 2.2 Route new-message, pending-answer, streamed-content, completion, error, and history-render scrolling through one coalesced helper, and verify tests show active output follows at the bottom but preserves deliberate scrollback.

## 3. Processing Lifecycle

- [x] 3.1 Give each active turn a stable identity, owner, phase, and partial response state, and verify tests can switch away and back while the correct pending or streaming answer is reconstructed.
- [x] 3.2 Centralize processing presentation and submission-control state from the active turn, and verify pending, streaming, successful, and cross-request states expose the correct `aria-busy`, status text, disabled controls, and visual classes.
- [x] 3.3 Finalize matching turns idempotently on success, failure, cancellation, owner invalidation, request clearing, and panel teardown, and verify tests restore controls, retain owner-scoped errors or completions, and ignore late canceled output.

## 4. Integration Verification

- [x] 4.1 Run `npm test -- tests/llm-chat.test.js` and manually exercise a long conversation, pane resizing, scrollback during streaming, request switching, completion, cancellation, and provider failure in DevTools.
- [x] 4.2 Run `npm test`, `openspec validate improve-chat-scroll-and-processing-ux --strict`, and `git diff --check`, and verify no manifest permissions, external data flows, dependencies, licensing files, or production packaging rules changed.
