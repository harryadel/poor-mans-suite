## Purpose

Allow users to stop a sequential Bulk Replay at the first response that diverges from known response patterns while preserving the terminal evidence and reason.

## ADDED Requirements

### Requirement: Response matchers can be selected as continuation guards
The system SHALL allow users to independently mark or unmark each configured Response Matcher as a continuation guard. A guard selection SHALL remain associated with its matcher while that matcher configuration is retained in the current DevTools panel session.

#### Scenario: Mark a matcher as a continuation guard
- **WHEN** the user marks a configured Response Matcher as a continuation guard
- **THEN** the configuration identifies that matcher as controlling whether the Bulk Replay continues
- **AND** other configured matchers remain display-only unless they are also marked

#### Scenario: Reopen the configuration during the same panel session
- **WHEN** the user closes and reopens Bulk Replay Configuration while its Response Matcher configuration is retained
- **THEN** each retained matcher preserves whether it is marked as a continuation guard

#### Scenario: Remove a marked matcher
- **WHEN** the user removes a Response Matcher that is marked as a continuation guard
- **THEN** that matcher no longer participates in the continuation condition

### Requirement: Any matching guard permits replay to continue
After each response is available for checking, the system SHALL evaluate every marked continuation guard independently against the response body using that matcher's configured mode and the shared case-sensitivity setting. The system SHALL permit the next generated request to run when at least one marked guard matches.

#### Scenario: One of multiple guards matches
- **WHEN** a response matches at least one marked continuation guard but does not match every marked guard
- **THEN** the Bulk Replay continues with the next generated request

#### Scenario: Overlapping guard text is present
- **WHEN** a marked continuation guard matches text that overlaps a longer configured Response Matcher
- **THEN** the marked guard is considered matched independently of which overlapping phrase is displayed or highlighted
- **AND** the Bulk Replay continues

#### Scenario: Guard matching honors matcher configuration
- **WHEN** a response is checked against a marked continuation guard
- **THEN** Contains or Whole Response behavior and the configured case-sensitivity setting determine whether that guard matches

#### Scenario: Every checked response satisfies a guard
- **WHEN** every generated request completes with a response matching at least one marked continuation guard
- **THEN** the Bulk Replay completes normally without a continuation-guard stop reason

### Requirement: The first response missing all guards terminates replay
When a checked response matches none of the marked continuation guards, the system SHALL retain that response as a result, identify it as the terminal mismatch, expose an explicit mismatch stop reason, and stop before sending the next generated request. The terminal response SHALL be determined by request execution order rather than the displayed result sort order.

#### Scenario: First divergent response is retained
- **WHEN** a response matches none of the marked continuation guards
- **THEN** its request and response details remain available in Bulk Replay Results
- **AND** the results identify that request as the continuation-guard mismatch
- **AND** no later generated request is sent

#### Scenario: Results are sorted during replay
- **WHEN** the results table is sorted and the next completed response matches none of the marked continuation guards
- **THEN** the replay stops on that response's execution ID regardless of its displayed row position

#### Scenario: Empty response misses all nonempty guards
- **WHEN** a checked response has an empty body and every marked continuation guard contains nonempty text
- **THEN** the response is retained as the terminal mismatch
- **AND** no later generated request is sent

### Requirement: An uncheckable response terminates guarded replay distinctly
When at least one continuation guard is marked and a request fails before its response body can be checked, the system SHALL retain the error result, expose a verification-failure stop reason distinct from a response mismatch, and stop before sending the next generated request.

#### Scenario: Request fails before a response is received
- **WHEN** a guarded Bulk Replay request fails before producing a response body
- **THEN** the request error remains available in Bulk Replay Results
- **AND** the replay reports that the continuation condition could not be checked
- **AND** no later generated request is sent

#### Scenario: Response body cannot be read
- **WHEN** a guarded Bulk Replay receives a response but cannot read its body for matcher evaluation
- **THEN** the error remains available in Bulk Replay Results
- **AND** the replay reports that the continuation condition could not be checked
- **AND** no later generated request is sent

### Requirement: Runs without continuation guards preserve existing behavior
When no Response Matcher is marked as a continuation guard, the system SHALL NOT stop a Bulk Replay because of matcher misses or matcher-checking errors and SHALL preserve existing result matching and execution behavior.

#### Scenario: Display-only matchers do not stop replay
- **WHEN** Response Matchers are configured but none is marked as a continuation guard
- **AND** a response matches none of those matchers
- **THEN** the result displays its existing no-match state
- **AND** the Bulk Replay continues with the next generated request

#### Scenario: Unguarded request error does not introduce new stop behavior
- **WHEN** no continuation guard is marked and a request fails before matchers can be checked
- **THEN** the result displays its existing not-checked error state
- **AND** the continuation-guard capability does not prevent the next generated request from running

### Requirement: Continuation guards do not expand response-data handling
The system SHALL evaluate continuation guards using response bodies already available to Bulk Replay and SHALL NOT require an additional external service, extension permission, or durable storage of matcher configuration or response contents.

#### Scenario: Evaluate a continuation guard
- **WHEN** the system checks a response against marked continuation guards
- **THEN** the check does not send the matcher configuration or response body to an additional service
- **AND** the check does not request an additional extension permission
