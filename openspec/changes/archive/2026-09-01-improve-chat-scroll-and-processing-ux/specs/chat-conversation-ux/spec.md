## Purpose

Ensure request chat remains navigable during long conversations and clearly communicates when an answer is waiting, streaming, complete, canceled, or failed.

## ADDED Requirements

### Requirement: Chat history remains independently scrollable
The system SHALL constrain the message history to the space available within the chat pane and SHALL allow users to scroll vertically through messages while the chat header and composer remain accessible.

#### Scenario: Conversation exceeds the visible height
- **WHEN** the rendered conversation is taller than the available message-history region
- **THEN** the user can scroll from the newest content to earlier messages and back
- **AND** the conversation does not push the header or composer out of the chat pane

#### Scenario: Chat pane height changes
- **WHEN** the available chat height changes while the conversation exceeds the new visible region
- **THEN** the message history remains scrollable within the resized pane
- **AND** the header and composer remain accessible

### Requirement: Latest-content following respects manual navigation
The system SHALL bring a newly submitted turn into view and SHALL follow appended response content while the user remains at the latest content. The system SHALL NOT repeatedly force the user to the bottom after the user deliberately scrolls to earlier messages.

#### Scenario: Follow an active response
- **WHEN** the user submits a message while viewing the latest conversation content and the answer grows as it streams
- **THEN** the latest response content remains visible as new content arrives

#### Scenario: Read earlier messages during streaming
- **WHEN** the user scrolls away from the latest content while an answer is streaming
- **THEN** subsequent streamed content does not override that manual scroll position
- **AND** the user can scroll back to the latest content at any time

### Requirement: Chat exposes an accessible processing state
The system SHALL present a visible and assistive-technology-accessible processing state immediately after accepting a prompt and SHALL keep that state accurate until the answer completes, is canceled, or fails. Controls that could start a duplicate chat turn SHALL be unavailable while that turn is active and SHALL visually communicate their unavailable state.

#### Scenario: Wait for the first response content
- **WHEN** a prompt has been accepted but no answer content has arrived yet
- **THEN** the chat visibly communicates that Poor Man's Suite is processing the answer
- **AND** assistive technology can identify that the chat is busy

#### Scenario: Receive streamed answer content
- **WHEN** response content begins streaming
- **THEN** the processing presentation transitions to the growing assistant answer without an empty or apparently idle interval
- **AND** the chat remains identified as busy until the turn reaches a terminal state

#### Scenario: Attempt a duplicate submission
- **WHEN** a chat turn is already active
- **THEN** controls that would submit another chat turn are unavailable
- **AND** no duplicate provider request is started

### Requirement: Processing feedback clears on every terminal path
The system SHALL remove the busy state and restore applicable chat controls when a turn completes, is canceled, becomes irrelevant because its conversation context changed, or fails. Failure feedback SHALL remain visible in the affected conversation without leaving the chat marked as processing.

#### Scenario: Answer completes successfully
- **WHEN** the provider finishes a response successfully
- **THEN** the completed answer remains visible
- **AND** the processing state ends and applicable chat controls become available

#### Scenario: Answer fails
- **WHEN** the provider request fails before or during streaming
- **THEN** the chat shows an error for the affected turn
- **AND** the processing state ends and applicable chat controls become available

#### Scenario: Active turn is canceled or context changes
- **WHEN** an active turn is canceled or the user changes to a different request conversation
- **THEN** the previous turn no longer presents an active processing state in the current conversation
- **AND** late output from the previous turn does not replace or append to the current conversation

#### Scenario: Start a new panel session
- **WHEN** the DevTools panel session ends and a new session starts
- **THEN** no prior processing indicator is restored as active
