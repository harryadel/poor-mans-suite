## Purpose

Ensure request chat reasons about the request and response actually visible in Repeater while retaining only correctly scoped conversation and response history for follow-up analysis and actions.

## ADDED Requirements

### Requirement: Each chat turn uses the visible Repeater context
When a user submits a request-chat message, the system SHALL provide the configured AI provider with the exact edited request and response currently visible in the Repeater panes. The context SHALL identify its source and SHALL NOT substitute request or response data left over from another selection.

#### Scenario: Submit a message after editing and resending a request
- **WHEN** the user edits the visible request, sends it, receives a response, and submits a chat message
- **THEN** the new chat turn includes the edited request and its visible response as the current context
- **AND** it does not label the original captured request or an older response as current

#### Scenario: Submit a message for a selected Bulk Replay result
- **WHEN** the user selects a Bulk Replay result so its generated request and response are visible and then submits a chat message
- **THEN** the selected result's visible request and response are supplied as the current context
- **AND** context from the previously visible result is not supplied as current

#### Scenario: Submit a message with no visible response
- **WHEN** the visible request has no response in the response pane
- **THEN** the new chat turn identifies that no current response is available
- **AND** it does not reuse a response from another request, resend, or Bulk Replay result

### Requirement: Repeater response history remains scoped and labeled
The system SHALL retain session-scoped response observations only for the request conversation that produced them. When prior responses are included for comparison, the system SHALL distinguish them from the currently visible response and SHALL clear them when the owning request conversation changes or is removed.

#### Scenario: Compare repeated calls for one request
- **WHEN** the user receives multiple responses from repeated calls within the same request conversation and asks chat to compare them
- **THEN** the available responses for that request are included with labels that distinguish the current response from prior observations

#### Scenario: Switch to another captured request
- **WHEN** the user switches from one captured request to another
- **THEN** response observations from the previous request are excluded from new chat turns for the newly selected request

#### Scenario: Remove the owning request
- **WHEN** the captured request that owns a chat conversation is removed or all requests are cleared
- **THEN** its retained response observations and pending action snapshots are discarded

### Requirement: Conversation history is isolated while live context refreshes
The system SHALL retain each captured request's user and assistant conversation separately for the current DevTools panel session. A follow-up turn SHALL include that request's prior conversation plus a newly captured visible Repeater context, and switching requests SHALL save and restore only the corresponding conversation.

#### Scenario: Follow up after the response changes
- **WHEN** the user continues a request conversation after another resend changes the visible response
- **THEN** the model receives the prior conversation and the newly visible response

#### Scenario: Return to an earlier request conversation
- **WHEN** the user switches away from a captured request and later returns to it
- **THEN** that request's prior conversation is restored
- **AND** messages from other request conversations are not inserted into it

### Requirement: Chat actions bind to an immutable visible snapshot
When chat presents an action derived from Repeater context, the system SHALL bind the action to an immutable snapshot of the visible request and response used to create it. The review SHALL identify that source, and later editor, result, or request selection changes SHALL NOT silently alter the action target or contents.

#### Scenario: Change selection after an action is proposed
- **WHEN** chat presents an action and the user then edits the request or selects another request or result
- **THEN** the proposed action remains bound to its original labeled snapshot
- **AND** the newly visible context is not used unless the user requests a new action

#### Scenario: Snapshot source is no longer available
- **WHEN** the request or result owning a pending action snapshot is removed or invalidated before confirmation
- **THEN** the action can no longer be confirmed
- **AND** no network request is sent from that action

### Requirement: Context disclosure and retention do not expand silently
Request and response context SHALL be disclosed only to the AI provider configured by the user when the user submits a chat turn. Response observations, conversation state, and action snapshots SHALL remain local to the DevTools panel session, SHALL NOT be sent to an additional service for action execution, and SHALL NOT be restored after the panel session ends.

#### Scenario: Create an action from a chat response
- **WHEN** the configured AI provider returns content that can form a local action
- **THEN** validating, reviewing, and executing that action does not disclose the snapshot to another external service

#### Scenario: End the panel session
- **WHEN** the DevTools panel session ends and a new session begins
- **THEN** prior response observations, conversations, and pending action snapshots are not restored
