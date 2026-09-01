## Context

See `proposal.md` for motivation and `specs/response-html-syntax-highlighting/spec.md` for the behavioral contract.

Pretty-view response rendering already converges on `highlightHTTP` in `js/core/utils/network.js`, including captured requests, replayed requests, Bulk Replay result selection, response search refreshes, and response-history navigation. The helper separates the status line, headers, and body, but currently attempts only JSON body highlighting for responses. Highlight.js is already vendored, licensed, loaded by `panel.html`, and includes the XML grammar used for HTML; its existing use is limited to chat code blocks.

The response source must remain inert and text-identical because copy, search, response matchers, screenshots, and subsequent refreshes consume the rendered Pretty view. Theme selection is implemented with body classes and existing response syntax colors are overridden per theme in `css/panel.css`.

## Goals / Non-Goals

**Goals:**

- Extend the shared Pretty-view highlighting path so every existing response workflow receives the same HTML coloring.
- Select HTML highlighting conservatively from HTTP response metadata rather than from arbitrary angle brackets in body text.
- Preserve a pure escaped-text fallback when Highlight.js is unavailable or rejects input.
- Scope HTML token colors to the response Pretty view and make them readable in each supported theme.
- Cover routing, safety, text preservation, and non-HTML compatibility with focused automated tests.

**Non-Goals:**

- Replacing `highlightHTTP` or adopting Highlight.js for request lines, headers, JSON bodies, or form parameters.
- Parsing HTML into a DOM, validating markup, formatting indentation, or rendering the body outside the existing Preview view.
- Adding syntax coloring to Raw, Hex, Json, Preview, or Diff views.
- Adding a new dependency, language grammar, permission, storage path, or response-data flow.

## Decisions

### Route HTML bodies by response Content-Type

`highlightHTTP` will derive the response media type from headers before highlighting the body. Responses identified as `text/html` or `application/xhtml+xml`, including media-type parameters and case variations, will take the HTML path. Other response bodies will continue through the current JSON or escaped-text behavior.

This uses the server's explicit representation metadata and satisfies the requirement that plain text is not classified as HTML solely because it contains angle brackets. HTML fragments remain supported when delivered with an HTML media type.

Alternative considered: sniff the body for tags or a doctype. This could color headerless HTML, but it would also create ambiguous false positives for logs, templates, and plain text containing markup-like strings. Conservative metadata routing is the smaller and more predictable change.

### Reuse the bundled Highlight.js XML grammar

The HTML body path will call the existing global Highlight.js instance with its `xml` grammar and insert the returned escaped source plus token spans into the already controlled Pretty-view `innerHTML` assignment. A small helper will first verify that the highlighter and grammar are available, catch highlighting failures, and return `escapeHtml(body)` as the fallback.

Highlight.js already handles complete documents, fragments, comments, declarations, quoted attributes, script/style element source, and malformed input more reliably than a new local regular-expression tokenizer. It emits markup for presentation without creating elements from the response source, preserving the current inert-text security boundary. Reusing the vendored library introduces no package or licensing change.

Alternative considered: implement a custom HTML lexer in `network.js`. That would keep the helper independent of a browser global, but correctly handling comments, declarations, raw-text elements, quoted `>` characters, and malformed markup would add substantial code and security-sensitive edge cases for no user-visible benefit. The guarded escaped fallback covers contexts where the panel's global library is absent, including unit tests that do not install a highlighter.

### Keep integration centralized in `highlightHTTP`

No response-rendering call site will gain format-specific logic. The body dispatch inside `highlightHTTP` will preserve the existing status-line and header output, choose HTML before the current JSON attempt for recognized HTML media types, and otherwise leave the current request/response paths intact.

This ensures response search can reconstruct the same syntax markup after clearing search marks, and existing text-node-based search and response-matcher highlighting can continue wrapping matches across syntax spans. Diff rendering remains unchanged because call sites already bypass `highlightHTTP` while Diff view is active.

Alternative considered: apply Highlight.js directly to `#raw-response-display` after each render. That would require updating several event and replay paths, risk double-highlighting during search refreshes, and couple core behavior to one DOM element.

### Scope token colors with response-specific CSS variables

`css/panel.css` will map the Highlight.js XML token classes used for tags, names, attributes, strings, and comments to response-specific CSS custom properties. The selectors will be scoped under `#raw-response-display` so chat code blocks retain their existing Highlight.js stylesheet. Default values and overrides for all six non-default body theme classes will follow the contrast patterns already used by HTTP and JSON syntax tokens.

Using scoped custom properties avoids repeating each token selector for every theme while retaining explicit theme palettes. It also gives the response selectors enough specificity to override the globally loaded GitHub Highlight.js theme without changing chat presentation.

Alternative considered: rely entirely on `css/github-dark.min.css`. Its fixed dark palette is not suitable for the light and high-contrast extension themes and would violate the cross-theme readability requirement.

## Risks / Trade-offs

- [HTML served with a missing or incorrect Content-Type remains plain text] -> Prefer predictable MIME-based classification; body sniffing can be proposed separately if real responses demonstrate a need.
- [The global Highlight.js object or XML grammar is unavailable] -> Catch capability and runtime failures and return the existing escaped plain-text body instead of failing response rendering.
- [Highlight.js output could alter text consumed by response tools] -> Test the rendered `textContent` against the original raw response and exercise HTML containing scripts, entities, comments, and quoted attributes.
- [Global Highlight.js theme rules could override extension palettes] -> Use response-ID-scoped selectors and verify each supported body theme class in focused styling checks.
- [Very large HTML bodies add highlighting cost] -> Keep one synchronous body-highlighting pass in the existing render cycle with no DOM parsing or additional reprocessing; search refreshes already invoke the same centralized render path.

## Migration Plan

No data, settings, permission, or dependency migration is required. Implement the helper routing, scoped styles, and focused tests directly on the requested `develop` integration branch, then run the focused test file and the full `npm test` suite. Rollback consists of reverting the body dispatch and scoped CSS additions; responses will return to the current escaped plain-text presentation without affecting stored state.
