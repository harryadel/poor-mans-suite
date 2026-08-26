## 1. Sortable Table Controls

- [x] 1.1 Replace the six static Bulk Replay result headings with native sort controls, add sort-key metadata and initial `aria-sort="none"` states, and verify a focused jsdom test can discover one accessible control for every displayed column.
- [x] 1.2 Add styles scoped to `#bulk-results-table` for sortable-header hover, keyboard focus, and active ascending/descending indicators, and verify the focused UI test observes the active header state without changing unrelated table markup.

## 2. Sorting Behavior

- [x] 2.1 Add local single-column sort state and header activation handling in `setupBulkReplay()`, including ascending-first, descending-toggle, and new-column reset behavior; verify focused tests assert row order and `aria-sort` updates for each transition.
- [x] 2.2 Store and compare canonical row values for numeric and text columns, use original execution ID as the tie-breaker, and verify focused tests cover numeric ordering across formatted units, case-insensitive text ordering, error or unavailable values, and equal-value stability.
- [x] 2.3 Reapply the active sort when rows are added or completed, reset sorting when a new attack starts, and preserve row selection and result identity while moving DOM nodes; verify focused tests select a sorted row, complete live results, and start a replacement attack.

## 3. Verification

- [x] 3.1 Run `npx vitest run tests/bulk-replay-sorting-ui.test.js` and verify all dedicated sorting and accessibility scenarios pass.
- [x] 3.2 Run `npm test` and verify the complete extension test suite passes without regressions.
