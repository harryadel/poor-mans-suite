## 1. Core HTML Highlighting

- [x] 1.1 Add focused `highlightHTTP` tests for `text/html` and `application/xhtml+xml` responses, media-type parameters and casing, complete documents and fragments, plain-text angle brackets, existing JSON highlighting, and exact rendered text preservation; run the focused test file and verify the new HTML-coloring assertions expose the current missing behavior.
- [x] 1.2 Extend `highlightHTTP` with conservative response Content-Type routing and a guarded Highlight.js `xml` body-highlighting helper that falls back to escaped text when the library or grammar is unavailable or throws; verify all focused highlighting tests pass.
- [x] 1.3 Add safety cases containing scripts, event-handler attributes, resource elements, comments, entities, and quoted `>` characters; render the highlighted output in jsdom and verify no active response elements are created and `textContent` exactly matches the original raw response.

## 2. Response Presentation And Interactions

- [x] 2.1 Add response-scoped Highlight.js token mappings and CSS custom-property palettes for the default, light, modern-dark, modern-light, blue, high-contrast, and terminal themes; verify tags, names, attributes, values, comments, and punctuation remain distinguishable in each theme without changing chat code-block colors.
- [x] 2.2 Add focused integration coverage for reapplying highlighting after response search and wrapping response matcher results across HTML syntax spans; verify search, matcher, and copied/text content use the original response text while HTML coloring is restored after refresh.
- [x] 2.3 Exercise an HTML response in Pretty, Raw, Hex, Json, Preview, and Diff views and verify only Pretty gains HTML syntax coloring while all views retain the same source response data and existing behavior.

## 3. Verification

- [x] 3.1 Run the focused response-highlighting, search, and response-matcher tests and verify all targeted scenarios pass without console errors or unexpected resource activity.
- [x] 3.2 Run `npm test` and strict OpenSpec validation for `colorize-response-html`; verify the full suite and change validation pass with no dependency, permission, storage, licensing, NOTICE, or production-package changes.
