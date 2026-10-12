## Purpose

Let the panel stay useful in a single-screen, bottom-docked DevTools by giving one pane the whole dock when space is short, while keeping the familiar wide layout when there is room.

## ADDED Requirements

### Requirement: The panel selects a layout mode from its own size
The panel SHALL offer a wide layout and a compact layout. By default it SHALL select the layout from the panel's current width and height and SHALL re-evaluate whenever the panel is resized. The user SHALL be able to override the selection with a persisted preference of automatic, wide, or compact.

#### Scenario: Short panel chooses compact
- **WHEN** the panel is shorter than the compact height threshold or narrower than the compact width threshold and the preference is automatic
- **THEN** the panel uses the compact layout

#### Scenario: Large panel chooses wide
- **WHEN** the panel is at least the compact height threshold tall and at least the compact width threshold wide and the preference is automatic
- **THEN** the panel uses the wide layout

#### Scenario: Panel is resized across a threshold
- **WHEN** the DevTools dock is resized or moved so the panel crosses a threshold while the preference is automatic
- **THEN** the panel switches layout without reloading

#### Scenario: Manual override
- **WHEN** the user sets the preference to wide or compact
- **THEN** the panel uses that layout regardless of its size
- **AND** the preference is restored the next time the panel opens

#### Scenario: Preference storage is missing or invalid
- **WHEN** no preference is stored, the stored value is not recognized, or storage is unavailable
- **THEN** the panel behaves as if the preference were automatic

### Requirement: Compact layout hosts panes as tabs
In the compact layout the Request editor, Response viewer, AI chat, and Bulk Replay results SHALL be presented as tabs of one pane that fills the main area, with exactly one tab visible at a time. The Chat and Bulk Replay tabs SHALL be present only while those features are open. Hidden tabs SHALL keep their content and keep running.

#### Scenario: Switch tabs
- **WHEN** the user activates a tab by clicking it or using its keyboard shortcut
- **THEN** that pane fills the main area
- **AND** the other panes are hidden without losing their content

#### Scenario: Send a request
- **WHEN** the user sends the request from the Request tab
- **THEN** the panel activates the Response tab when the response arrives
- **AND** the Request tab shows the response status code

#### Scenario: Bulk Replay starts in compact layout
- **WHEN** the user starts a Bulk Replay attack
- **THEN** a Bulk Replay tab appears and becomes active

#### Scenario: Open a Bulk Replay result
- **WHEN** the user selects a result row on the Bulk Replay tab
- **THEN** the Request tab becomes active showing the request as it was sent
- **AND** the Response tab shows that result's response

#### Scenario: Hidden editor text stays intact
- **WHEN** the Request tab is hidden and the request text is saved or read
- **THEN** the text keeps its line breaks exactly as shown on the Request tab

#### Scenario: Work continues on a hidden tab
- **WHEN** a chat turn is streaming or a Bulk Replay attack is running and the user activates a different tab
- **THEN** the streaming or attack continues
- **AND** returning to that tab shows its current state

#### Scenario: A hosted feature is closed
- **WHEN** the user closes the chat or the Bulk Replay results
- **THEN** its tab is removed
- **AND** the Request tab becomes active if the closed tab was active

### Requirement: Compact layout presents the request list as a drawer
In the compact layout the request list SHALL open as a drawer over the main pane instead of occupying a column. The drawer SHALL be opened with a visible control and a keyboard shortcut, SHALL offer the same filtering as the wide layout, and SHALL close when a request is selected, when Escape is pressed, or when the user clicks outside it. The pane header SHALL show the method and URL of the selected request while the drawer is closed.

#### Scenario: Open and filter the list
- **WHEN** the user opens the drawer and types a filter
- **THEN** the drawer lists the matching requests over the main pane
- **AND** the main pane keeps its content behind the drawer

#### Scenario: Select a request
- **WHEN** the user selects a request in the drawer
- **THEN** the request loads into the editor
- **AND** the drawer closes
- **AND** the pane header shows the selected request's method and URL

#### Scenario: Dismiss the drawer
- **WHEN** the user presses Escape or clicks outside the open drawer
- **THEN** the drawer closes without changing the selected request

#### Scenario: Request list hidden preference
- **WHEN** the wide layout's hidden-sidebar preference is set and the panel is in the compact layout
- **THEN** the drawer is closed and can still be opened

### Requirement: Compact layout keeps every action reachable in one header row
In the compact layout the pane header and view tabs SHALL fit in a single row. Actions that do not fit SHALL move into one overflow menu rather than wrapping or being hidden, and every action available in the wide layout SHALL remain available.

#### Scenario: Header is too narrow for all actions
- **WHEN** the header cannot fit every action in one row
- **THEN** the actions that do not fit appear in an overflow menu
- **AND** activating an item in the menu performs the same action as its button

#### Scenario: Header has room again
- **WHEN** the panel widens enough to fit the actions
- **THEN** the actions return to the header row

### Requirement: Layout preferences persist across sessions
The panel SHALL persist the layout mode preference, the wide layout's sidebar width, the wide layout's Request/Response split ratio, the horizontal or vertical arrangement, and the hidden-sidebar state, and SHALL restore them when the panel opens.

#### Scenario: Resize the sidebar and reopen
- **WHEN** the user resizes the sidebar in the wide layout and later reopens the panel
- **THEN** the sidebar has the width the user set

#### Scenario: Resize the split and reopen
- **WHEN** the user drags the Request/Response divider in the wide layout and later reopens the panel
- **THEN** the panes have the ratio the user set

### Requirement: Switching layout preserves work
Changing between the wide and compact layouts, by resize or by preference, SHALL preserve the editor contents, the current response, the selected request, the chat conversation, and Bulk Replay results and progress.

#### Scenario: Dock moved while editing
- **WHEN** the user has edited the request and the layout changes
- **THEN** the edited request text, the current response, the selected request, and the undo history are unchanged

#### Scenario: Attack running during a layout change
- **WHEN** a Bulk Replay attack is running and the layout changes
- **THEN** the attack continues and its results remain visible in the new layout
