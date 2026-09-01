## Context

See `proposal.md` for motivation and the capability specs for required behavior. Today `js/features/llm-chat/index.js` keys conversation history to `state.selectedRequest`, reads the request editor at submission time, and derives response context from the global `state.currentResponse` plus one global response-history array. That breaks down when the visible response was restored, diff-rendered, resent, or selected from `js/features/bulk-replay/index.js`, because the rendered panes and global state do not share an explicit source identity.

Bulk Replay already owns the four supported attack modes, payload configuration UI, response matchers and continuation guards, optional host-permission preflight, execution controls, and result table. Its configuration is held in the session-only Bulk Replay state, while `generateAttackRequests` currently materializes the full request array before the large-run warning and permission check. Chat actions currently parse request modifications from assistant text and render user-clicked apply buttons, but there is no structured Bulk Replay action or safe handoff API.

The implementation must remain browser-native ES modules, add no dependency or permission, keep sensitive HTTP data inside the DevTools panel except for the user's existing disclosure to the configured AI provider, and preserve manual Bulk Replay behavior.

## Goals / Non-Goals

**Goals:**

- Establish one session-scoped source of truth for the Repeater content currently shown and the captured request conversation that owns it.
- Capture each chat turn's current context once and reuse that immutable snapshot for prompting, action validation, review, and execution.
- Treat assistant-produced attack configuration as untrusted data behind explicit intent, strict validation, an editable review, and a separate execution confirmation.
- Reuse the existing Bulk Replay modal and runner while preventing stale targets, oversized chat-created runs, duplicate starts, and permission prompts before confirmation.
- Keep pure parsing, validation, and request-count logic independently testable.

**Non-Goals:**

- Replacing the existing chat provider API, Bulk Replay engine, fetch loop, or result presentation.
- Persisting conversations, response observations, snapshots, or drafts outside the current panel session.
- Allowing assistant output to invoke code, network APIs, extension permissions, or modes other than the four existing Bulk Replay modes.
- Redesigning manual payload marking or imposing the chat-specific 1,000-request ceiling on manually configured attacks.

## Decisions

### 1. Model visible Repeater context explicitly

Add a small session-only Repeater context controller and use the existing event bus to notify consumers when the visible source changes. Request selection/restoration in `js/ui/request-editor.js`, successful or failed resends in `js/network/handler.js`, and Bulk Replay result selection in `js/features/bulk-replay/index.js` will activate a source with:

- the owning captured-request object;
- a session-unique source ID and kind (`captured`, `resend`, or `bulk-result`);
- a user-facing source label;
- the unrendered raw response, or an explicit no-response value; and
- validity state for pending actions.

The request text remains live-editable, so the controller captures it directly from the raw request editor when chat is submitted. The raw response is retained separately from `rawResponseDisplay.textContent`: diff rendering contains both baseline and current lines, and highlighted Bulk Replay results currently do not update `state.currentResponse`. Each writer therefore supplies the raw response at the same point it updates the panes. Selecting a request with no response explicitly clears the active response rather than inheriting the previous value.

The context owner, not merely `state.selectedRequest`, selects the chat conversation. This matters when a Bulk Replay result belongs to request A but request B was selected after the run was prepared. Activating that result restores request A's chat history without treating B's transcript or response as current. Existing request-selection behavior remains the normal way to activate captured and resend context.

Alternative considered: continue inferring context from the editor DOM and `state.currentResponse`. This cannot distinguish highlighted or diff-rendered text, cannot label Bulk Replay result ownership, and cannot reliably invalidate result-backed actions.

### 2. Capture once at the start of every chat turn

Before constructing provider messages, chat will capture a frozen snapshot containing the owner token, source ID/kind/label, exact raw request, exact current raw response or `null`, HTTPS setting, locally derived target label, and a session-only snapshot ID. The prompt builder accepts this snapshot rather than reading mutable global state. The same snapshot is attached to the in-flight turn and is the only snapshot from which an assistant action on that turn may be created.

The provider receives the exact current request and response on every turn. It does not receive a stale captured response as a fallback. Prior response observations remain bounded and are stored in a map keyed by the owning request and source ID; when included, they are truncated and labeled as prior observations, while the current response is never silently truncated or relabeled as prior. Conversation messages remain keyed by owner and are reduced to provider `{ role, content }` records so local action metadata is not sent back to the provider.

If the visible source changes while a response is streaming, completion is recorded against the turn's original owner and snapshot. It does not retarget an action to the new panes; the currently visible conversation is rerendered only when its owner is active.

Alternative considered: capture context only after the provider returns. That would bind actions to whichever request happens to be visible at completion and violate snapshot immutability.

### 3. Converge three explicit entry points on one gated draft turn

Chat will expose all three requested entry points:

- a `/bulk-replay` command followed by natural-language instructions;
- a dedicated **Prepare Bulk Replay** chat control, which submits the current input (or a default preparation request) with draft intent; and
- a narrow local natural-language classifier requiring an imperative preparation/configuration verb together with `Bulk Replay` or a supported mode name.

All three set the same per-turn `bulkDraftRequested` flag. The flag is not stored as general authorization and expires with that provider turn. Only a flagged turn receives the structured-action instructions and a session-unique correlation ID; only its assistant response is eligible for draft parsing. An assistant merely mentioning an attack on another turn cannot create an action. The command or model response never sets execution confirmation.

The natural-language classifier intentionally favors false negatives over broad security-keyword matching. Users can always use the command or button when wording is not recognized.

Alternative considered: parse every assistant response for attack-shaped content. Request and response bodies are untrusted prompt content, so unconditional parsing would let incidental or injected output create misleading action controls.

### 4. Use a strict, non-executable assistant draft contract

For a gated turn, the system prompt asks the provider for at most one fenced JSON action block with a version, correlation ID, supported mode, marked request template, mode-specific payload configurations, response matchers, continuation flags, and case-sensitivity setting. The model does not supply a target, scheme, permission result, execution instruction, or arbitrary function/tool name; those values are derived locally from the snapshot and existing UI.

A focused chat Bulk Replay draft module will extract the single block with a size bound, parse it with `JSON.parse`, reject duplicate/unknown/unsupported structures, and normalize only allowlisted primitives. It will never evaluate model text or inject unescaped draft values through `innerHTML`. Prose remains ordinary assistant content; malformed structured output becomes a local validation result and never a runnable object.

The marked template is accepted only when markers are balanced and stripping payload-marker delimiters yields exactly the snapshot's request bytes after applying the same marker normalization to a snapshot that was already manually marked. This lets the model choose or reuse payload positions but prevents it from changing the request line, host, headers, or body outside those reviewed positions. The HTTPS setting and raw response baseline always come from the snapshot.

Alternative considered: accept a complete target and request from model JSON. Even with review, that would make retargeting easy to overlook and would weaken the immutable-snapshot boundary.

### 5. Validate and count before materializing requests

Move payload cardinality calculation into a pure helper beside `generateAttackRequests` so validation and execution use the same mode semantics:

- Sniper sums each position's payload count.
- Battering Ram uses the shared payload count.
- Pitchfork uses the shortest position count.
- Cluster Bomb multiplies position counts with overflow and limit checks at each step.

Simple-list payloads count non-empty lines. Numeric payloads require finite integers, a positive step, and an ascending range before calculating the count. Marker count, position configuration count, required payload inputs, supported mode, matcher shape, continuation flags, and target parseability are validated together.

Chat-created drafts have a hard projected maximum of 1,000 requests, including after edits in review. A draft above the limit is shown as invalid and cannot request permission or generate requests; exceptional runs remain available through manual Bulk Replay configuration. Manual Cluster Bomb's existing additional warning above 1,000 remains intact. Computing the count before `generateAttackRequests` also moves the manual warning ahead of potentially expensive Cartesian-product materialization without changing its threshold.

Alternative considered: generate the request array and use its length as validation. The current Cluster Bomb implementation constructs the Cartesian product eagerly, so an untrusted draft could consume substantial memory before any warning or permission check.

### 6. Extend the existing modal into the review boundary

`setupBulkReplay()` will return a small controller to `js/main.js`; that controller is passed into `setupLLMChat()` rather than introducing a circular feature import. Its `reviewDraft` operation creates an ephemeral review session, backs up the existing manual Bulk Replay configuration, loads the validated chat draft, and opens the existing modal.

Chat first renders a local action card with the snapshot label, target, mode, projected count, and **Review in Bulk Replay** and **Discard** controls. The card is not confirmation. The prefilled modal adds a chat-draft banner that displays the immutable snapshot identity and target, projected request count, validation errors, the 1,000-request cap, scheme, permission preflight notice, and whether continuation guards are configured. Existing controls remain the editable source for mode, payloads, response matchers, guards, and case sensitivity. Every relevant input reruns validation and count calculation; **Start Attack** is disabled while invalid or stale.

Closing, canceling, or discarding a chat review clears its pending action and restores the backed-up manual configuration. Starting a valid review commits the reviewed configuration as the last-used Bulk Replay configuration. Local action metadata is stored with the request's session chat history so switching away and back can restore a still-valid card without sending that metadata to the provider.

Alternative considered: implement a second full configuration editor inside chat. That would duplicate mode-specific UI, matcher behavior, validation, accessibility, and future Bulk Replay changes.

### 7. Freeze reviewed execution input and reuse the Bulk Replay lifecycle

Clicking **Start Attack** is the separate confirmation. At that point Bulk Replay will:

1. reject an active or already-starting run;
2. recheck source/owner validity and clone the final reviewed configuration;
3. recompute and enforce the projected count and chat limit;
4. apply any existing manual large-run warning that remains applicable;
5. request the existing optional replay permission;
6. materialize requests from the immutable template; and
7. run the existing progress, pause, stop, matcher, guard, result, and terminal-reason flow.

A module-local `starting`/`running` lock is set before asynchronous confirmation and permission work so double clicks or a second chat action cannot race into another run. Denial, dismissal, invalidation, or generation failure releases the lock and sends zero attack requests. The chat snapshot's scheme and raw response are used for target construction and the result diff baseline, even if another request is visible by then. Results retain the run owner and source IDs so selecting one activates the correct chat context. Chat never retries a failed or canceled run.

Alternative considered: copy the fetch loop into chat. That would bypass existing permissions and safeguards and create a second execution lifecycle.

### 8. Keep ownership, invalidation, and data retention session-local

Snapshots and draft records use in-memory maps keyed by captured-request objects and session IDs. Request removal and clear-all events delete that owner's observations, local action metadata, and validity records. Clearing or replacing Bulk Replay results invalidates result source IDs. Confirmation always consults the validity registry, so a card may remain visible with an expired state but cannot execute after its owner or source is gone.

No snapshot or draft is written to `localStorage`, extension storage, exports, or OpenCode conversation metadata. The only remote disclosure remains the existing provider call initiated by the user; parsing, review, permission checks, generation, and execution are local.

## Risks / Trade-offs

- [Exact current responses can exceed a provider's context limit] -> Do not silently substitute or truncate the current response; retain existing bounds for prior observations and surface the provider error so the user can reduce the visible data deliberately.
- [Natural-language intent classification can miss valid wording] -> Keep the classifier narrow and provide deterministic command and button paths.
- [Prompt injection may persuade the model to emit a syntactically valid draft] -> Require explicit per-turn intent and correlation, exact snapshot-template equivalence, strict local validation, visible review, separate confirmation, and permission preflight; model output never executes directly.
- [Marker normalization can be ambiguous when literal section signs appear in request data] -> Require balanced marker pairs and show the exact marked template/positions in review; reject malformed or ambiguous templates rather than guessing.
- [Backing up modal state adds another transient state boundary] -> Centralize open, cancel, and commit behavior in the Bulk Replay controller and test that cancel restores manual configuration.
- [A selected result may belong to a request other than the sidebar selection] -> Carry the run owner explicitly and let active Repeater context, rather than incidental global selection, choose chat history and action ownership.
- [The existing runner eagerly stores up to 1,000 generated requests and results] -> Count before generation and enforce the chat limit; redesigning the engine as a lazy iterator is unnecessary for this bounded change.

## Migration Plan

1. Add pure snapshot/draft validation and cardinality helpers with focused unit tests.
2. Introduce visible-context activation at request selection, resend completion/error, and Bulk Replay result selection; update chat prompting and per-owner histories to consume captured snapshots.
3. Add the three gated draft entry points and local action-card parsing without enabling Bulk Replay handoff yet.
4. Add the Bulk Replay review-session controller, review metadata, live validation/count display, cancellation restoration, source invalidation, and active-run lock.
5. Connect confirmed reviews to the existing execution path and add integration coverage proving zero requests occur before confirmation or after invalidation, denial, cancellation, oversize validation, or an active-run conflict.
6. Run focused chat and Bulk Replay tests followed by `npm test`.

Rollback is removal of the new entry points, context/draft controller, and review-session integration. Existing manual Bulk Replay configuration and runner remain the fallback and require no persisted-data migration.
