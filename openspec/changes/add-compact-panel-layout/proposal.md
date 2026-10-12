## Why

The panel always lays itself out as three permanent columns: the request list, the Request editor, and the Response viewer, with the AI chat as an optional fourth. Each column has a minimum width and a 48px header plus a tab row. With DevTools docked to the bottom of a single laptop screen, which is how most users run it, the panel is wide but only 300 to 450px tall. The three columns squeeze to a couple hundred pixels each and show almost nothing useful. The existing vertical toggle stacks Request over Response and is worse in that dock, and hiding the sidebar throws away the request list entirely. Today the only real fix is undocking DevTools into a second window, which is the dual-screen workaround this change exists to remove.

## What Changes

- Add a compact layout mode in which the panel gives one pane the whole dock: the Request editor, Response viewer, AI chat, and Bulk Replay results become tabs of a single pane, and the request list becomes a drawer that slides over the pane instead of owning a column.
- Choose the mode automatically from the panel's own size, with a persisted manual override of automatic, wide, or compact, so wide, tall panels keep the current three-column layout unchanged.
- In compact mode, show the selected request in the pane header so context survives with the list closed, switch to the Response tab after Send, and show the latest status on the Request tab.
- Collapse the pane header and view tabs into a single compact row, moving actions that do not fit into one overflow menu, so no action is lost.
- Persist the sidebar width and the Request/Response split ratio in wide mode, which are lost on every reload today.
- Preserve editor text, the current response, the selected request, chat history, and Bulk Replay state when the mode changes.
- Non-goals: no change to the request editor, response viewers, chat, or Bulk Replay behavior themselves; no new DevTools dock positions; no new storage beyond local layout preferences; no telemetry.

## Capabilities

### New Capabilities

- `panel-layout`: Defines how the panel selects between the wide and compact layouts, what the compact layout contains, how the request list drawer and pane tabs behave, which layout preferences persist, and what survives a mode switch.

### Modified Capabilities

None.

## Impact

- Affects `panel.html`, `css/panel.css`, the layout code in `js/ui/request-editor.js`, `js/ui/sidebar.js`, and `js/ui/ui-utils.js`, a new layout-mode module, small hooks in the chat and Bulk Replay modules so their panes can host as tabs, and focused tests.
- Layout preferences are stored in `localStorage` next to the existing layout and sidebar keys. No request or response data is written. No new permissions, network destinations, or dependencies.
- No licensing, NOTICE, or production-package changes.
