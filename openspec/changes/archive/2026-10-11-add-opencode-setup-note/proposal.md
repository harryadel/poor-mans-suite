## Why

Selecting the OpenCode provider in Settings shows connection fields but no hint that a local OpenCode server must already be running, or how to start one. Users who pick OpenCode instead of a hosted provider currently have to leave DevTools and find the README to learn the `opencode serve` command.

## What Changes

- Show a short setup note inside the OpenCode provider settings that explains a local server is required and gives the copyable launch command on the default loopback origin with a server password.
- Link the note to the README's OpenCode Setup section for the longer isolated-home launch variant.
- Do not change connection behavior, defaults, permissions, storage, or any other provider's settings.

## Capabilities

### New Capabilities

- `opencode-provider-setup-guidance`: Defines the in-panel guidance shown when the OpenCode provider is selected so users can start a compatible local server without leaving DevTools.

### Modified Capabilities

None.

## Impact

- Affects only the OpenCode section of the Settings modal markup, its styling, and a focused markup test.
- No new permissions, storage, network calls, dependencies, licensing, NOTICE, or production-package changes. The note is static text; it does not read or send any data.
