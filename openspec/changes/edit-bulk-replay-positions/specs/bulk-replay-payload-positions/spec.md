## Purpose

Let users remove or correct Bulk Replay payload positions from the configuration modal without hand-editing markers in the request, while keeping the request editor and the rest of the configuration consistent.

## ADDED Requirements

### Requirement: Positions can be removed from the configuration
Each payload position in the Bulk Replay configuration SHALL offer a Remove control. Removing a position SHALL drop its markers from the template while keeping the marked text, SHALL keep the payload settings of the remaining positions, and SHALL renumber the remaining positions and update the position count and projected request count.

#### Scenario: Remove a middle position
- **WHEN** the configuration has three positions and the user removes the second
- **THEN** the template keeps the second position's text without markers
- **AND** the remaining two cards keep their payload lists and number ranges
- **AND** the position count shows 2

#### Scenario: Remove the last remaining position
- **WHEN** the user removes the only position
- **THEN** the position count shows 0
- **AND** the modal explains that at least one position is required
- **AND** the Start control is disabled until a position exists again

### Requirement: Position values can be edited from the configuration
Each payload position SHALL show its current value in an editable field. Changing the field SHALL replace the text between that position's markers in the template and SHALL leave every other position and payload setting unchanged.

#### Scenario: Edit a value
- **WHEN** the user changes the value of a position
- **THEN** the template contains the new value between that position's markers
- **AND** the position's payload settings are unchanged

#### Scenario: Value contains the marker character
- **WHEN** the user enters a value containing the marker character
- **THEN** the marker character is not accepted into the value
- **AND** the position count is unchanged

### Requirement: Position changes stay in sync with the request editor
When the request editor still holds the exact marked text the configuration was built from, removing or editing a position SHALL update the editor with the new template. When the editor text differs from that template, the editor SHALL be left unchanged.

#### Scenario: Editor still shows the marked request
- **WHEN** the editor text equals the template and the user removes or edits a position
- **THEN** the editor shows the updated template
- **AND** reopening the configuration keeps the current payload settings

#### Scenario: Editor was changed since the configuration was built
- **WHEN** the editor text differs from the template and the user removes a position
- **THEN** the editor text is unchanged

### Requirement: Positions are locked while a draft is under review
While a chat-prepared Bulk Replay draft is under review, the Remove controls and value fields SHALL be disabled and SHALL explain that the draft is frozen. After the review is discarded, the controls SHALL be enabled for the restored manual configuration.

#### Scenario: Review in progress
- **WHEN** a draft review is open
- **THEN** every position's Remove control and value field is disabled

#### Scenario: Review discarded
- **WHEN** the user cancels the review
- **THEN** the restored configuration's position controls are enabled

### Requirement: Reopening with a changed request keeps matching payload settings
When the Bulk Replay configuration opens from a marked request whose text differs from the saved template, positions whose marked value is still present SHALL keep their payload settings, in order of appearance, and only positions with new values SHALL start empty. When no marked value matches, the configuration SHALL start fresh.

#### Scenario: Request edited outside the positions
- **WHEN** the user changes a header in a marked request and reopens the configuration
- **THEN** every position keeps its payload list and number range

#### Scenario: Return to the request after viewing results
- **WHEN** the user opens a Bulk Replay result, returns to the marked request, and reopens the configuration
- **THEN** the payload settings entered before the attack are still present

#### Scenario: A new position is added
- **WHEN** the user marks an additional value and reopens the configuration
- **THEN** the existing positions keep their settings
- **AND** the new position starts with an empty payload list
