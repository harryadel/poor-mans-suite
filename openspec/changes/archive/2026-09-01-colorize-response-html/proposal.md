## Why

HTML response bodies in the Response pane's Pretty view are currently rendered as plain text even though HTTP headers and JSON bodies receive syntax coloring. Highlighting HTML structure will make large markup responses easier to scan without changing the captured response or executing its contents.

## What Changes

- Recognize HTML response bodies displayed in the Response pane's Pretty view and apply syntax coloring to their markup structure.
- Escape response content before adding presentation markup so HTML remains inert and the displayed, copied, searched, and matched text remains unchanged.
- Provide theme-aware colors that remain readable across the extension's supported themes while preserving the existing HTTP header and JSON highlighting.
- Keep the Raw, Hex, Json, Preview, and Diff views behaviorally unchanged; this change does not render or execute HTML and does not add general-purpose highlighting for other response languages.

## Capabilities

### New Capabilities

- `response-html-syntax-highlighting`: Defines safe, readable HTML syntax coloring for response bodies in the Response pane's Pretty view while preserving the underlying response text and existing response interactions.

### Modified Capabilities

None.

## Impact

- Affects response highlighting and theme styling, primarily under `js/core/utils/network.js` and `css/panel.css`, plus focused syntax-highlighting tests.
- Does not change extension APIs, network behavior, permissions, response-data flow, storage, or user-consent requirements.
- Introduces no anticipated dependency, licensing, NOTICE, or production-package-content changes; OpenSpec artifacts remain excluded from the extension archive.
- Delivery is intended directly on the `develop` integration branch as requested; `main` remains release-only.
