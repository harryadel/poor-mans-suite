## Context

See `proposal.md` for motivation and `specs/bulk-replay-results-sorting/spec.md` for observable behavior. Bulk Replay currently creates each `<tr>` inside `setupBulkReplay()`, stores the completed response in a sparse `bulkResults` array keyed by execution index, and binds each row's click handler to that index. Headers in `panel.html` are static text and the table body remains in append order.

The extension uses browser-native modules and jsdom tests, so the solution should use DOM APIs and existing state rather than add a table library. Sorting must not duplicate or disclose request/response content outside the existing page.

## Goals / Non-Goals

**Goals:**
- Keep one local, explicit sort state per initialized Bulk Replay table.
- Use raw numeric result values instead of parsing formatted cell labels.
- Reorder existing row nodes so click handlers, selection, and result identity remain intact.
- Make header interaction correct for pointer, keyboard, visual, and assistive-technology users.

**Non-Goals:**
- Generalize a reusable table framework for unrelated extension tables.
- Mutate `attackRequests`, `bulkResults`, or attack scheduling to match display order.
- Store sort state in global state or browser storage.

## Decisions

### Use native buttons inside column headers

Each `<th>` will identify its sort key and contain a native button. `aria-sort` will live on the column header, with `none` on inactive headers and `ascending` or `descending` on the active header. CSS will provide hover/focus treatment and a direction glyph driven by the active state.

Native buttons provide Enter and Space activation without custom keyboard event handling. Making each `<th>` itself clickable was considered, but it would require recreating button semantics and focus behavior.

### Keep sorting state and comparison logic inside Bulk Replay setup

`setupBulkReplay()` will own `{ key, direction }`, register the six header controls once, and reset the state when a new attack clears the table. A single row-sorting function will collect current row nodes, compare their values, and append them back to the same `<tbody>` in sorted order.

This stays close to the only consumer and avoids adding global state for a transient view preference. A generic sorting utility was considered, but no other current table shares the same live, partially complete result model.

### Store canonical sort values on each row

Rows will retain their original execution index and canonical values for ID and payload when created. Completion will update canonical status, byte size, elapsed milliseconds, and displayed match text. Numeric comparisons will operate on numbers, text comparisons will be case-insensitive, and the execution ID will be the final tie-breaker.

Keeping canonical values avoids incorrect lexical ordering such as `100ms` before `20ms` or formatted byte labels crossing units. Reading all values back from cell text was considered, but it would couple sorting to formatting and placeholder labels.

### Reapply only an active sort after row changes

The active sort will run after a row is appended and after its pending values are replaced by success or error values. Without an active sort, rows remain in execution order. Moving the existing row node preserves its click closure and selected class, while progress continues to use the completed request count.

Rebuilding the entire table from `bulkResults` was considered, but it would recreate listeners, selection, and response-match markup on every update.

## Risks / Trade-offs

- [Rows can move while an attack is running] -> Keep the sort indicator visible and only reorder when the user has explicitly activated sorting.
- [Pending or error rows do not have every numeric value] -> Represent unavailable numeric values explicitly and place them after available values for ascending sorts, as required by the spec.
- [Multiple matched-response badges need one text key] -> Use the same text exposed by the Matches cell so ordering matches what the user can inspect.
- [Global table CSS could affect unrelated tables] -> Scope all new header styles to `#bulk-results-table`.

## Migration Plan

No data migration or rollout step is required. Deploy the HTML, JavaScript, CSS, and tests together. Rollback consists of reverting those changes; no persisted sort state remains after rollback.
