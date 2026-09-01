## Purpose

Make HTML response bodies easier to inspect in the Response pane's Pretty view while keeping captured markup inert, lossless, and compatible with existing response workflows.

## ADDED Requirements

### Requirement: Pretty view distinguishes HTML syntax
The system SHALL apply syntax coloring to HTML markup in response bodies displayed in the Response pane's Pretty view. Element names, attribute names, attribute values, comments, and markup punctuation SHALL be visually distinguishable from surrounding text, while the HTTP status line and headers retain their existing syntax coloring.

#### Scenario: Display an HTML document
- **WHEN** the Pretty view displays an HTTP response whose body is an HTML document containing elements, attributes, comments, and text
- **THEN** the HTML markup categories are syntax-colored and visually distinguishable from the document text
- **AND** the response status line and headers remain syntax-colored

#### Scenario: Display an HTML fragment
- **WHEN** the Pretty view displays an HTTP response whose body is an HTML fragment rather than a complete document
- **THEN** the fragment's recognizable HTML markup is syntax-colored

### Requirement: HTML highlighting is inert and lossless
The system SHALL treat highlighted HTML as response text rather than live document markup. Applying or reapplying highlighting SHALL preserve the response's textual content and SHALL NOT execute scripts, event handlers, embedded resources, or other HTML behavior.

#### Scenario: Display active HTML content
- **WHEN** an HTML response body contains script elements, event-handler attributes, or resource-loading elements
- **THEN** the Pretty view displays those constructs as syntax-colored text without executing them or loading their resources

#### Scenario: Use response text after highlighting
- **WHEN** a user copies, searches, or adds a response matcher from a syntax-colored HTML response
- **THEN** those actions operate on the original response text without syntax-highlighting markup changing the content

#### Scenario: Reapply highlighting
- **WHEN** the Pretty view reapplies syntax highlighting after a response search or another view refresh
- **THEN** the displayed response text remains unchanged and the HTML syntax coloring is restored

### Requirement: Existing response presentation remains compatible
The system SHALL preserve existing presentation behavior for non-HTML response bodies and for response views other than Pretty. HTML syntax coloring SHALL remain readable in every supported Poor Man's Suite theme without changing the underlying response data.

#### Scenario: Display a non-HTML response
- **WHEN** the Pretty view displays a JSON, form-encoded, or plain-text response body
- **THEN** the body retains its existing applicable syntax coloring or plain-text presentation
- **AND** it is not treated as HTML solely because it contains angle-bracket characters

#### Scenario: Use another response view
- **WHEN** a user opens the Raw, Hex, Json, Preview, or Diff view for a response with an HTML body
- **THEN** that view retains its existing behavior and source response data

#### Scenario: Change the extension theme
- **WHEN** a user selects any supported theme while an HTML response is shown in Pretty view
- **THEN** the HTML syntax categories remain visually distinguishable from surrounding text in that theme
