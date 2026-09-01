## Why

Long conversations and streamed answers are difficult to navigate because the chat pane does not reliably present a usable scroll area. After submitting a prompt, the current feedback can also make the chat appear idle or stalled before response content arrives.

## What Changes

- Make the chat message history reliably scrollable within the available pane height while keeping the header and composer accessible.
- Keep new messages and active streamed output visible when the user is following the latest content without preventing deliberate scrolling through earlier messages.
- Show a clear, accessible processing state immediately after submission and transition it cleanly to streamed content, completion, or an error.
- Keep duplicate-submission protection and relevant chat controls visually consistent with the processing state.
- Do not change AI providers, prompt/context construction, chat actions, request execution, conversation persistence, or model-response trust boundaries.

## Capabilities

### New Capabilities

- `chat-conversation-ux`: Defines chat history scrolling, follow-to-latest behavior, and visible processing feedback for pending and streaming answers.

### Modified Capabilities

None.

## Impact

- Affects the chat pane structure and presentation in `panel.html` and `css/panel.css`, plus interaction state in `js/features/llm-chat/index.js`.
- Adds focused UI tests for overflow, scroll behavior, and processing-state transitions.
- Adds no permissions, external data disclosure, durable storage, provider calls, dependencies, or breaking API changes.
- Licensing and production packaging remain unchanged; OpenSpec artifacts and tests remain excluded from the extension archive.
