## Why

Bulk Replay positions come from `§` markers typed into the request editor. The configuration modal lists the positions but cannot change them, so dropping one or correcting its value means closing the modal, editing the markers by hand in the request text, and reopening. Because the template changed, the payload settings already entered for the other positions are reset.

## What Changes

- Add a Remove control to every position card. It drops that position, leaves its text in the request without markers, and keeps the payload settings of the other positions.
- Add an editable value field to every position card. Changing it replaces the text between that position's markers in the template.
- Keep the request editor in sync: when the editor still shows the marked text the configuration came from, removing or editing a position updates the editor as well, so reopening the modal does not reset the configuration.
- Update the position count, card numbering, and projected request count immediately. With no positions left, Start is disabled and the modal explains why.
- Disable the position controls while a chat-prepared draft is under review, since a reviewed draft is frozen; discard the review to change positions.
- Non-goals: adding or reordering positions from the modal, changing the marker character, or changing how attack requests are generated.

## Capabilities

### New Capabilities

- `bulk-replay-payload-positions`: Defines removing and editing payload positions from the Bulk Replay configuration, how that stays in sync with the request editor, and how it behaves during a draft review.

### Modified Capabilities

None.

## Impact

- Affects the position cards in the Bulk Replay module, a new helper module for marker-aware template edits, request editor sync, styling, and focused tests.
- Only the in-memory template and the editor text change. No storage, permissions, network destinations, or dependencies are added.
- No licensing, NOTICE, or production-package changes.
