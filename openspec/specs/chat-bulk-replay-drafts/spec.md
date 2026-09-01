# Chat Bulk Replay Drafts Specification

## Purpose

Let users ask request chat to prepare existing Bulk Replay attacks while keeping model output non-executable until a complete local review, explicit confirmation, and permission check succeed.

## Requirements

### Requirement: Explicit chat requests can produce supported Bulk Replay drafts
The system SHALL allow an explicit user chat request to produce a local draft for Sniper, Battering Ram, Pitchfork, or Cluster Bomb using the action's immutable Repeater snapshot. Model output SHALL be treated as untrusted draft input and SHALL NOT itself send requests.

#### Scenario: Produce a supported attack draft
- **WHEN** the user explicitly asks chat to prepare one of the supported Bulk Replay modes and the returned draft is valid
- **THEN** the system presents a local Bulk Replay draft bound to the action snapshot
- **AND** no attack request is sent before review and confirmation

#### Scenario: Assistant mentions an attack without an explicit request
- **WHEN** an assistant response merely recommends or explains an attack technique
- **THEN** the system does not treat that response as authorization to create or execute an attack

#### Scenario: Draft requests an unsupported operation
- **WHEN** model output names an unsupported attack mode or an operation outside Bulk Replay
- **THEN** the unsupported operation is not made confirmable
- **AND** no network request is sent

### Requirement: Drafts are validated before review
Before presenting a confirmable draft, the system SHALL validate the attack mode, immutable request snapshot, payload markers and inputs, projected request count, response matchers, continuation guards, and other mode-specific configuration. Invalid, incomplete, or internally inconsistent drafts SHALL identify the problem and SHALL NOT be executable.

#### Scenario: Validate a complete draft
- **WHEN** a draft contains a supported mode and all configuration required by that mode
- **THEN** the system computes its projected request count and makes it available for review

#### Scenario: Required payload configuration is missing
- **WHEN** a draft lacks a payload marker, payload set, or other input required by its selected mode
- **THEN** the draft identifies the missing configuration
- **AND** confirmation remains unavailable

#### Scenario: Projected request count cannot be determined safely
- **WHEN** a draft's request count is invalid, exceeds a supported bound, or cannot be computed
- **THEN** the draft is not confirmable
- **AND** no attack request is sent

### Requirement: Every draft requires complete review and separate confirmation
The system SHALL show the draft's target, request snapshot identity, attack mode, payload inputs, projected request count, response matchers, continuation guards, and applicable safety controls before execution. The user SHALL be able to edit the configuration, cancel it, or separately confirm it; the typed chat command and model response SHALL NOT count as execution confirmation.

#### Scenario: Review a chat-prepared draft
- **WHEN** a valid draft is presented
- **THEN** the review displays the target and all attack configuration that will affect generated requests or stopping behavior
- **AND** no network request is sent while the draft is only being reviewed

#### Scenario: Edit a reviewed draft
- **WHEN** the user edits payloads, mode, matchers, guards, or another execution-relevant field
- **THEN** the system revalidates the draft and updates the projected request count before confirmation is available

#### Scenario: Cancel a reviewed draft
- **WHEN** the user cancels or dismisses a chat-prepared draft
- **THEN** the draft is discarded without sending a network request

### Requirement: Confirmation preserves permission and large-run safeguards
After separate confirmation, the system SHALL perform the existing optional host-permission preflight and all applicable Bulk Replay safeguards before sending the first request. Denial, cancellation, or failure of any required check SHALL result in zero attack requests and SHALL leave the user with a clear outcome.

#### Scenario: User confirms and permission is available
- **WHEN** the user confirms a valid reviewed draft and required host permission is already granted or subsequently granted
- **THEN** the system may hand the immutable draft to Bulk Replay execution

#### Scenario: Host permission is denied or dismissed
- **WHEN** the required host-permission request is denied or dismissed after confirmation
- **THEN** no attack request is sent
- **AND** the review reports that execution did not start

#### Scenario: Existing large-run confirmation is required
- **WHEN** a confirmed draft meets the existing condition for an additional large-run warning
- **THEN** that warning remains required before execution
- **AND** canceling it sends no attack requests

### Requirement: Confirmed drafts use the existing Bulk Replay lifecycle
The system SHALL execute a confirmed draft against its immutable request snapshot through the existing Bulk Replay engine and SHALL expose the existing progress, pause, cancellation, continuation-guard, terminal-reason, result-selection, and error behavior. A chat action SHALL NOT start a second attack while another Bulk Replay is active and SHALL NOT automatically retry a failed or canceled run.

#### Scenario: Start a confirmed draft
- **WHEN** review, confirmation, permissions, and safeguards all succeed and no Bulk Replay is active
- **THEN** the attack starts with the reviewed configuration and snapshot
- **AND** progress and results appear in the existing Bulk Replay interface

#### Scenario: Visible Repeater content changes before execution
- **WHEN** the user confirms a still-valid draft after another request or result becomes visible
- **THEN** execution uses the reviewed immutable snapshot rather than the newly visible content

#### Scenario: Another Bulk Replay is active
- **WHEN** the user attempts to confirm a chat-prepared draft while another Bulk Replay is active
- **THEN** the new attack does not start
- **AND** the existing attack remains under the user's control

#### Scenario: Execution fails or is canceled
- **WHEN** a confirmed attack fails or the user cancels it
- **THEN** the existing Bulk Replay results and terminal reason report the outcome
- **AND** chat does not automatically retry the attack

### Requirement: Draft state remains local and session-scoped
Chat-prepared drafts and their request snapshots SHALL remain local to the DevTools panel, SHALL NOT require a model-native execution tool or an additional external service, and SHALL NOT persist after the panel session ends. Removing the owning request SHALL invalidate any pending draft.

#### Scenario: Provider returns malformed action data
- **WHEN** model output cannot be parsed into a valid supported draft
- **THEN** it is treated as non-executable assistant content or a validation error
- **AND** no network request is sent

#### Scenario: End the panel session with a pending draft
- **WHEN** the DevTools panel session ends before a draft is confirmed
- **THEN** the draft and its snapshot are discarded
