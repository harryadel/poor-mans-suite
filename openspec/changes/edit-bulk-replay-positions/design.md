## Context

The Bulk Replay module renders one position card per `§…§` match in the saved template and binds it to the matching entry of `state.positionConfigs`. When the modal opens, the button handler reads the editor text if it still contains markers and rebuilds the template and configs whenever that text differs from the saved template. The chat draft review path freezes the draft and validates every live edit against the source snapshot, which only tolerates marker insertions.

## Approach

- Put the template arithmetic in `js/features/bulk-replay/positions.js` as pure functions: `findTemplatePositions(template)` lists each marker pair with its offsets and inner value, `removeTemplatePosition(template, index)` strips one pair, and `setTemplatePositionValue(template, index, value)` rewrites the inner text. Nothing in these functions touches the DOM, so they are tested directly.
- Position cards gain a value input and a Remove button. Both go through one `applyTemplateChange(nextTemplate, nextConfigs)` routine in the Bulk Replay module that updates the saved template and configs, reindexes the configs, re-renders the cards and count, and refreshes review validation.
- Editor sync lives in the same routine: if the editor's current text equals the template before the change, the editor receives the new template through the existing highlight path and an input event, so undo history and the raw textarea stay consistent. If the user edited the request since, the editor is left alone.
- With zero positions the count reads 0, Start is disabled, and a note replaces the cards. The Bulk Replay button's own marker check already handles reopening.
- During a review session the value inputs and Remove buttons are disabled with a title explaining that the draft is frozen. Validation against the snapshot therefore never sees a non-marker byte change from these controls.

## Security boundaries

- Values entered in the card are inserted into the template as text and rendered through the existing escaped card markup, never as HTML.
- No request is sent by these controls; starting an attack still goes through the existing confirmation and permission path.
