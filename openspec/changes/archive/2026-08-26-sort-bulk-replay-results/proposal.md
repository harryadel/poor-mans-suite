## Why

Bulk Replay can produce enough results that finding outliers by status, payload, response size, duration, or response matches is difficult in execution order alone. Sortable columns let users inspect and compare results directly in the existing table without exporting or manually scanning every row.

## What Changes

- Make every Bulk Replay Results table header interactive and keyboard accessible.
- Sort ID, status, size, and time by their underlying numeric values and sort payload and matches as text.
- Toggle between ascending and descending order, with a visible and accessible active-sort indicator.
- Preserve execution order for equal values and keep the selected result associated with its row after reordering.
- Keep an active sort applied while an attack is still adding or completing results.
- Non-goals: filtering results, multi-column sorting, persisting sort preferences between attacks, or changing Bulk Replay execution order.

## Capabilities

### New Capabilities
- `bulk-replay-results-sorting`: Type-aware, accessible single-column sorting of the Bulk Replay Results table.

### Modified Capabilities

None.

## Impact

- `panel.html`: marks Bulk Replay result headers with sort metadata and accessible controls.
- `js/features/bulk-replay/index.js`: tracks sort state, compares result values, and reorders result rows without changing result identity.
- `css/panel.css`: styles sortable headers and active sort direction indicators across existing themes.
- `tests/`: adds focused jsdom coverage for sorting behavior, accessibility state, ties, and results that complete while sorted.
- Permissions, privacy, data flow, storage, external APIs, dependencies, licensing, and packaged file scope are unchanged.
