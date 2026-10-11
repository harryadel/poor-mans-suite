## 1. Settings Guidance

- [x] 1.1 Add a setup note at the top of the OpenCode provider settings with the required-server explanation, the copyable `opencode serve` launch command, and a link to the README OpenCode Setup section.
- [x] 1.2 Style the note so the command renders as a compact, wrappable, selectable code block in every theme.

## 2. Verification

- [x] 2.1 Add a focused test asserting the note lives inside the OpenCode settings, names the launch command, loopback origin, password variable, and README link.
- [x] 2.2 Run the focused test and `openspec validate add-opencode-setup-note --strict`.
