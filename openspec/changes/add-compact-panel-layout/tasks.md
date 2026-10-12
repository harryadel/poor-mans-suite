## 1. Layout Mode

- [x] 1.1 Add `js/ui/layout-mode.js` with `resolveLayoutMode()` and `setupLayoutMode()`, persist the override in `poor_mans_suite_layout_mode`, and set `data-layout` on `.container` from the observed panel size.
- [x] 1.2 Add a layout mode control (Automatic, Wide, Compact) next to the existing layout toggle and wire it from `main.js`.
- [x] 1.3 Add tests for mode resolution at the thresholds, override persistence, invalid or unavailable storage falling back to automatic, and mode changes preserving pane content.

## 2. Compact Pane Tabs

- [x] 2.1 Add the compact tab strip and `data-tab` names to the Request, Response, Chat, and Bulk Replay panes, and style `[data-layout="compact"]` so only the active pane is visible and fills the main area.
- [x] 2.2 Implement tab switching with the keyboard shortcuts from the design, switch to Response after Send, show the latest status code on the Request tab, and show the Chat and Bulk Replay tabs only while those panes are open.
- [ ] 2.3 Confirm a streaming chat turn and a running Bulk Replay continue while their tabs are hidden, and that opening Bulk Replay or Chat in compact mode activates its tab.
- [x] 2.4 Add tests for tab visibility, switching, the Send-to-Response switch, the status chip, and hidden panes keeping their content.

## 3. Request List Drawer

- [x] 3.1 Style the sidebar as an overlay drawer with a backdrop in compact mode and add the open and close handling for the toggle button, keyboard shortcut, request selection, Escape, and backdrop clicks.
- [x] 3.2 Add the selected request summary to the pane header and update it whenever a request is loaded into the editor.
- [x] 3.3 Add tests for drawer open and close paths, filtering inside the drawer, and the summary reflecting the selected request.

## 4. Compact Chrome and Persistence

- [x] 4.1 Merge the pane header and view tabs into one compact row and move actions that do not fit into a single overflow menu while keeping every action reachable.
- [x] 4.2 Persist the sidebar width and the wide-mode split ratio from the existing resize handlers and restore them on load.
- [x] 4.3 Add tests for overflow menu contents and for width and ratio persistence.

## 5. Verification

- [ ] 5.1 Check the layout by hand in Chromium with DevTools docked to the bottom at about 350px tall, docked to the right, and undocked, in light and dark themes.
- [x] 5.2 Document the compact layout and shortcuts in the README, run `npm test`, and run `openspec validate add-compact-panel-layout --strict`.
