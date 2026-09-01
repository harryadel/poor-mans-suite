## Context

See `proposal.md` for the user-visible motivation and `specs/chat-conversation-ux/spec.md` for the behavior contract.

The chat pane already uses a flex-column hierarchy and gives `.llm-chat-messages` vertical overflow, but the available-height chain is fragile and stream callbacks assign `scrollTop = scrollHeight` unconditionally. The active request is allowed to change while a provider response is still streaming; `activeChat` owns that provider call, while the rendered conversation can switch to another request. The current loading bubble is tied to one DOM node and displays only a lightly styled `Thinking...` state.

The implementation must remain browser-native JavaScript, HTML, and CSS. Processing and scroll-follow state are transient panel UI state and must not alter provider payloads, request context, conversation retention, or action execution.

## Goals / Non-Goals

**Goals:**

- Establish an unbroken flex sizing chain so only the message history scrolls.
- Follow pending and streamed output only while the user is viewing the latest content.
- Represent active-turn state consistently in the message view, accessibility attributes, and submission controls.
- Preserve request ownership when the user switches conversations during a stream.
- Cover state transitions and scroll decisions with deterministic Vitest/jsdom tests.

**Non-Goals:**

- Redesigning the chat pane, transcript format, model integration, or markdown renderer.
- Persisting scroll position, partial answers, or processing state across panel sessions.
- Allowing concurrent provider turns or changing how request-scoped chat history is retained.
- Adding a new UI framework, animation library, or extension permission.

## Decisions

### Keep the composer outside a single constrained message scroller

The existing pane structure will remain: header, chat body, message history, and composer. Chat-specific CSS will make every flex ancestor that participates in vertical sizing shrinkable with `min-height: 0`, keep the header/reference/composer non-growing, and let `.llm-chat-messages` own `overflow-y: auto`. The chat pane will rely on flex stretching rather than an explicit height that can exceed its parent. The message region will remain keyboard-focusable and retain a stable scrollbar gutter.

This is smaller and safer than scrolling the entire chat pane, which would move the composer and header out of reach. A fixed pixel or viewport height was rejected because DevTools dimensions and the Bulk Replay split are user-controlled.

### Track follow-to-latest intent instead of scrolling on every update

The chat controller will maintain a transient `followLatest` flag for the rendered conversation. A scroll listener will compare the distance from the bottom against a small tolerance so normal rounding and incremental layout changes still count as being at the latest content.

Submitting a new message or rendering a newly selected conversation will explicitly return to the latest content. Pending-state insertion and stream updates will request a bottom scroll only when `followLatest` remains true. A user scroll above the tolerance sets it false; returning to the bottom sets it true again. DOM updates that can change message height, including markdown rendering and syntax highlighting, will coalesce their follow-up scroll into one scheduled animation frame.

This replaces the current unconditional writes to `scrollTop`. Intersection observers were considered but rejected because the geometry calculation is simpler, works with the existing single scroll container, and is easier to test in jsdom.

### Make active-turn state request-owned and renderable

`activeChat` will remain the single-concurrency guard and will carry the owning request plus enough transient presentation state to render the active answer independently of the original DOM node: a stable turn identifier, phase (`pending` or `streaming`), and current partial text. Stream callbacks will update that state first and then update the active bubble only when its owner is the conversation currently rendered.

`renderChatHistory()` will append the active bubble when the selected conversation owns `activeChat`. Switching to another request therefore removes the previous request's busy bubble from the current view without changing ownership or allowing late output into the wrong conversation. Returning to the owner while the call is active recreates the bubble from the stored phase and partial text. The existing behavior of storing a completed answer on its original owner remains unchanged.

Keeping the callback bound only to the initially created element was rejected because that element is disconnected whenever conversation history is re-rendered. Canceling every stream on a request switch was also rejected because it would change existing request-scoped completion behavior and discard useful work.

### Use one processing-state synchronizer for messages and controls

A controller helper will derive UI state from `activeChat` rather than maintaining an independent loading boolean that can drift. It will:

- set `aria-busy` on the message log only when the rendered conversation owns the active turn;
- render a visible status row and lightweight CSS activity indicator in the active assistant bubble;
- retain the status row while streamed content grows, then remove it at a terminal state;
- disable the send and Prepare Bulk Replay controls while any turn is active;
- restore each control according to its normal eligibility when the turn ends; and
- identify disabled controls as waiting for the active conversation when another request is selected.

The message history will use log/status semantics and a stable text label so assistive technology receives a state transition without announcing every streamed token. Motion will be decorative, CSS-only, and disabled under `prefers-reduced-motion`.

A spinner only in the send button was rejected because it is easy to miss and does not associate progress with the assistant answer. Replacing the entire assistant bubble with a spinner was rejected because it would obscure partial streamed content.

### Finalize every turn through one idempotent terminal path

Success, provider error, explicit cancellation, owner invalidation, request clearing, and panel teardown will all finalize the matching active turn through a shared state transition. Finalization will check the stable turn identity before clearing state so a late callback cannot clear or overwrite a newer turn. It will remove busy attributes, restore applicable controls, preserve a completed or failed message for the correct owner, and ignore late output after cancellation.

This retains the existing `AbortController` boundary while preventing `activeChat`, control state, and accessibility state from being cleared in different places.

### Extend existing integration tests without introducing browser-only tooling

`tests/llm-chat.test.js` will use deferred provider mocks to inspect pending, streaming, completed, failed, canceled, and request-switch states. Scroll tests will define deterministic `scrollHeight`, `clientHeight`, and `scrollTop` values on the jsdom message element, dispatch scroll events, and verify whether subsequent updates preserve or advance the position. Static pane markup and accessibility attributes will be exercised through the same controller fixture.

Focused tests will run during implementation, followed by the full `npm test` suite. A production archive is not required because packaging behavior is unchanged.

## Risks / Trade-offs

- [Near-bottom detection can flip because of rounding or late content layout] -> Use a small bottom-distance tolerance and schedule at most one scroll adjustment per frame.
- [Replacing markdown during streaming can create unnecessary layout work] -> Reuse the existing streaming cadence and coalesce only the scroll write; do not add observers over each message.
- [Request switching can leave stale busy UI or let an old callback affect a newer turn] -> Key all presentation and terminal updates by stable turn identity and request owner.
- [Live-region updates can become noisy during token streaming] -> Announce stable processing and terminal labels while using `aria-busy` for the changing content region.
- [Flex sizing changes can affect neighboring panes] -> Scope sizing overrides to the chat pane hierarchy and verify request, response, and Bulk Replay resizing in regression tests.

## Migration Plan

No data or settings migration is required. Ship the HTML, CSS, controller, and tests together. Rollback consists of reverting those static assets; no stored state or permission cleanup is needed.
