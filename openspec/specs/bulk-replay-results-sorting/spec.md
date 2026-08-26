# Bulk Replay Results Sorting Specification

## Purpose

Enable users to reorder Bulk Replay results by any displayed column so response patterns and outliers can be identified without changing attack execution.

## Requirements

### Requirement: Sort controls are available for every results column
The Bulk Replay Results table SHALL provide a keyboard-accessible sort control for ID, Payload, Status, Size, Time, and Matches. The table SHALL expose the active column and direction to assistive technology and SHALL display a visual direction indicator on the active column.

#### Scenario: Activate sorting from a column header
- **WHEN** the user activates a result column's sort control by pointer or keyboard
- **THEN** the table reorders its rows by that column in ascending order
- **AND** the activated column exposes an ascending sort state and visual indicator
- **AND** every other column exposes no active sort state

#### Scenario: Reverse the active sort
- **WHEN** the user activates the currently sorted column again
- **THEN** the table reorders its rows in descending order
- **AND** the active column exposes a descending sort state and visual indicator

#### Scenario: Change the active sort column
- **WHEN** the user activates a different column while another column is sorted
- **THEN** the table sorts the new column in ascending order
- **AND** the previous column no longer exposes an active sort state or indicator

### Requirement: Columns use type-appropriate sort values
The table SHALL compare ID, numeric HTTP status, response size in bytes, and elapsed time in milliseconds numerically. It SHALL compare Payload and Matches using their displayed text. Nonnumeric error statuses and unavailable numeric values SHALL sort after available numeric values in ascending order.

#### Scenario: Sort numeric columns
- **WHEN** the user sorts ID, Status, Size, or Time in ascending order
- **THEN** values are ordered by their underlying numeric values rather than their formatted text
- **AND** unavailable or nonnumeric values appear after numeric values

#### Scenario: Sort text columns
- **WHEN** the user sorts Payload or Matches
- **THEN** rows are ordered by a case-insensitive comparison of the text displayed in that column

#### Scenario: Preserve deterministic order for equal values
- **WHEN** two or more results have equal sort values
- **THEN** those results remain ordered by their original execution ID

### Requirement: Sorting preserves result behavior and live updates
Sorting SHALL only change the displayed row order. It SHALL NOT change attack execution order or the result opened by selecting a row, and an active sort SHALL remain applied as pending results are added or completed.

#### Scenario: Open a result after sorting
- **WHEN** the user selects a row after sorting the table
- **THEN** the request and response details for that row's original result are opened
- **AND** the selected styling remains attached to that result if the table is reordered again

#### Scenario: Result completes while a sort is active
- **WHEN** an attack adds or completes a result while a column sort is active
- **THEN** the table reapplies the active sort using the result's latest value
- **AND** attack execution and progress reporting continue unchanged

#### Scenario: Start a new attack
- **WHEN** the user starts a new Bulk Replay attack
- **THEN** the previous result rows and active sort state are cleared
- **AND** new results initially appear in execution order until the user activates a sort control
