# opencode-provider-setup-guidance Specification

## Purpose
Help users who choose the OpenCode provider start a compatible local OpenCode server without leaving the Settings modal.

## Requirements

### Requirement: OpenCode settings explain how to start the local server
When the OpenCode provider is selected, the Settings modal SHALL display a setup note stating that a local OpenCode server is required and SHALL show the launch command that starts the server on the default loopback origin with a server password. The note SHALL link to the project's OpenCode Setup documentation for the extended isolated-home variant.

#### Scenario: Select the OpenCode provider
- **WHEN** the user selects OpenCode in the AI Provider list
- **THEN** the OpenCode settings show a note explaining that a local OpenCode server must be running
- **AND** the note includes a copyable `opencode serve` command using `127.0.0.1`, port `4096`, and `OPENCODE_SERVER_PASSWORD`
- **AND** the note links to the OpenCode Setup section of the README

#### Scenario: Select a different provider
- **WHEN** the user selects a provider other than OpenCode
- **THEN** the OpenCode setup note is not shown

### Requirement: The setup note is informational only
The setup note SHALL NOT change connection defaults, stored settings, extension permissions, or network behavior, and SHALL NOT read or transmit any user data.

#### Scenario: Note is present without interaction
- **WHEN** the OpenCode settings are shown and the user does not change any field
- **THEN** the configured server URL, username, password, and model remain unchanged
- **AND** no request is sent because of the note
