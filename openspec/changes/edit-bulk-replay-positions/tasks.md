## 1. Template Helpers

- [x] 1.1 Add `js/features/bulk-replay/positions.js` with `findTemplatePositions`, `removeTemplatePosition`, and `setTemplatePositionValue`.
- [x] 1.2 Add `tests/bulk-replay-positions.test.js` covering multi-line values, adjacent markers, out-of-range indexes, and values containing the marker character.

## 2. Position Cards

- [x] 2.1 Render a value input and a Remove button on each position card, styled for every theme.
- [x] 2.2 Implement `applyTemplateChange` so removal and value edits update the template, reindex configs while keeping payload settings, re-render the count and cards, and refresh review validation.
- [x] 2.3 Sync the request editor when its text still matches the previous template, and show the empty-positions note with Start disabled when no positions remain.
- [x] 2.4 Disable the controls during a draft review with an explanatory title.

- [x] 2.5 Carry payload settings over by marked value when the configuration opens from a changed request.

## 3. Verification

- [x] 3.1 Add configuration UI tests for removing a position, editing a value, editor sync and non-sync, the empty state, reopening without a reset, and the review lock.
- [x] 3.2 Document the controls in the README, run `npm test`, and run `openspec validate edit-bulk-replay-positions --strict`.
