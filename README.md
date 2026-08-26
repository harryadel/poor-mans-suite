<p align="center">
  <!-- Chrome Supported -->
  <img src="https://img.shields.io/badge/Chrome-Supported-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Supported">

  <!-- AppSec Tool -->
  <img src="https://img.shields.io/badge/AppSec-Tool-blueviolet" alt="AppSec Tool">

  <!-- Bug Bounty Friendly -->
  <img src="https://img.shields.io/badge/Bug%20Bounty-Friendly-orange" alt="Bug Bounty Friendly">

  <!-- Stars -->
  <a href="https://github.com/harryadel/poor-mans-suite/stargazers">
    <img src="https://img.shields.io/github/stars/harryadel/poor-mans-suite?style=social" alt="GitHub Stars">
  </a>
</p>

# Poor Man's Suite

Poor Man's Suite is a lightweight Chrome DevTools extension inspired by Burp Suite's Repeater. It captures, modifies, and replays HTTP requests in a focused browser workflow, with optional integrated LLM support.

> **Attribution:** Poor Man's Suite is a derivative of [rep+](https://github.com/repplus/rep-chrome). The combined project is distributed under GPL-3.0-or-later; the upstream MIT copyright and permission notice are preserved in [LICENSES/MIT-upstream.txt](LICENSES/MIT-upstream.txt) and [NOTICE](NOTICE).

## Install Poor Man's Suite

Poor Man's Suite does not currently have a Chrome Web Store listing. Install it from this repository as an unpacked extension by following [Installation](#installation).


## Table of Contents
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Permissions & Privacy](#permissions--privacy)
- [Limitations](#-limitations)
- [Star History](#star-history)
- [Found a Bug or Issue?](#found-a-bug-or-issue)
- [Attribution & License](#attribution--license)

## Features

### Capture & Replay
- No proxy setup; works directly in Chrome (no CA certs needed).
- Capture every HTTP request and replay with modified method, headers, or body.
- Multi-tab capture (optional permission) with visual indicators 🌍 and deduplication.
- Clear workspace quickly; export/import requests as JSON for sharing or later reuse.

### Organization & Filtering
- Hierarchical grouping by page and domain (first-party prioritized).
- Third-party detection and collapsible groups; domain badges for quick context.
- Starring for requests, pages, and domains (auto-star for new matches).
- Timeline view (flat, chronological) to see what loaded before a request.
- Filters: method, domain, color tags, text search, regex mode.

### Views & Editing
- Pretty / Raw / Hex views; layout toggle (horizontal/vertical).
- Converters: Base64, URL encode/decode, JWT decode, Hex/UTF-8.
- History, undo/redo, and syntax highlighting for requests/responses.
- Context menu helpers on the request editor:
  - Convert selected text (Base64, URL encode/decode, JWT decode).
  - **Copy as** full HTTP request in multiple languages: `curl`, PowerShell (`Invoke-WebRequest`), Python (`requests`), and JavaScript `fetch`.
- Screenshot editor for request/response pairs: full-content capture, side‑by‑side or stacked layout, zoom, highlight and black-box redaction, resizable/movable annotations, keyboard delete, and undo/redo for all edits.

### Bulk & Automation
- Bulk replay with 4 attack modes: Sniper, Battering Ram, Pitchfork, Cluster Bomb.
- Mark positions with `§`, configure payloads, pause/resume long runs.
- Response diff view to spot changes between baseline and attempts.

### Extractors & Search
- Unified Extractor: secrets, endpoints, and parameters from captured JS.
- **Secret Scanner**: entropy + patterns with confidence scores; pagination and domain filter.
  - Powered by [Kingfisher](https://github.com/mongodb/kingfisher) rules for comprehensive secret detection
  - Supports AWS, GitHub, Google, Slack, Stripe, Twilio, Azure, and many more service providers
  - Rules stored locally in `rules/` directory for offline use
  - **Note**: Secret scanning only analyzes JavaScript files from the **current inspected tab**.
  - **Export**: Export all secrets to CSV for analysis and reporting
- **Endpoint Extractor**: full URLs, relative paths, GraphQL; method detection; one-click copy (rebuilds base URL).
  - **Export**: Export all endpoints to CSV with method, endpoint path, confidence, and source file
- **Parameter Extractor**: passive JavaScript parameter discovery with intelligent grouping and risk assessment.
  - **Parameter Types**: Extracts query, body, header, and path parameters from JavaScript files
  - **Grouped by Endpoint**: Parameters are organized by endpoint with expandable/collapsible groups
  - **Risk Classification**: Automatically identifies high-risk parameters (auth, admin, debug flags, IDOR, feature flags)
  - **Confidence Scoring**: Stricter confidence model than endpoints to reduce false positives
  - **Smart Filtering**: Suppresses common false positives (webpack, React, jQuery, DOM events, telemetry)
  - **Copy as cURL**: One-click copy generates curl commands with all parameters properly formatted
  - **Location Badges**: Visual indicators for parameter location (query/body/header/path)
  - **Domain Filtering**: Filter parameters by source domain with accurate counts
  - **Column Sorting**: Sort by parameter name, location, endpoint, method, risk level, or confidence
  - **Export Options**:
    - **CSV Export**: Export all parameters with location, endpoint, method, risk level, and confidence
    - **Postman Collection Export**: Generate ready-to-import Postman collection JSON with all endpoints and parameters
      - Automatically groups parameters by endpoint
      - Includes query, body, and header parameters
      - Uses Postman variable syntax (`{{paramName}}`) for easy testing
      - Perfect for security testers who want to quickly import discovered APIs into Postman
- **Response Search**: regex support, match preview, pagination, domain filter.

### AI Assistance

#### Poor Man's Suite AI Assistance (Interactive LLM Chat)
- **Interactive Chat Interface**: Real-time conversation with AI about your HTTP requests and responses
  - Streaming responses with live markdown rendering
  - Syntax highlighting for code blocks (supports multiple languages)
  - Copy-to-clipboard for code blocks with visual feedback
  - Token usage counter with color-coded warnings
- **Per-Request Chat History**: Each request maintains its own conversation history
  - Automatically saves chat when switching between requests
  - Restores previous conversations when returning to a request
  - Clear chat button resets only the current request's conversation
- **Cross-Reference Previous Requests**: Reference investigations from other requests
  - "Reference previous requests" UI with collapsible/expandable list
  - Select which previous requests to include in context
  - AI receives summaries of previous investigations for referenced requests
  - Perfect for multi-step testing scenarios (e.g., login → authenticated request)
- **Request Modification**: AI can modify requests directly in the editor
  - "Apply modifications" button appears when AI suggests changes
  - Smart detection: only shows when modifications are actually suggested
  - Preserves request structure (headers, formatting, HTTP version)
  - Animated application with visual feedback
  - Supports header updates, body modifications, and new header additions
- **Response History Tracking**: Tracks multiple responses from resends
  - Maintains chronological history of all responses (original + resends)
  - AI has context on all responses when analyzing changes
  - Conditional inclusion: only includes full history when relevant (token optimization)
- **Smart Context Management**: Intelligent token optimization
  - Response truncation for large responses (~1,500 tokens max)
  - Chat history compression (summarizes older messages)
  - Conditional response inclusion (only when asked about)
  - Limits response history to last 2-3 responses
  - Keeps last 15 messages in conversation history
- **Multi-Provider Support**: Works with Claude, Gemini, OpenAI Codex, OpenCode, and local Ollama models
  - Automatic model detection for Anthropic, Gemini, OpenAI Codex, and OpenCode
  - Manual URL/model configuration for local models
  - Streaming support for all providers
- **Use Cases**:
  - Security testing and penetration testing guidance
  - Request/response explanation and debugging
  - Automated request modification for testing
  - Bug bounty report generation
  - Vulnerability identification and attack vector suggestions
  - Multi-step attack chain planning with cross-request context

#### Other AI Features
- **Explain Request** and **Suggest Attack Vectors** use the configured Claude, Gemini, OpenAI Codex, OpenCode, or Ollama provider and open directly in the request chat, preserving context for follow-up questions.
- **Context menu "Explain with AI"** sends selected request or response text into the same conversation.
- **Attack Surface Analysis** per domain: categorization (Auth/Payments/Admin/etc.), color-coded icons, toggle between list and attack-surface view.
- **Export AI conversations** as Markdown or print them to PDF.

### Productivity & Theming
- **7 Beautiful Themes**: Choose from a variety of modern, carefully crafted themes:
  - 🌙 **Dark (Default)**: Classic dark theme optimized for long sessions
  - ☀️ **Light**: Clean light theme for bright environments
  - 🎨 **Modern Dark**: VS Code Dark+ inspired theme with enhanced contrast
  - ✨ **Modern Light**: GitHub-style light theme with crisp colors
  - 💙 **Blue**: Cool blue/cyan color scheme for a fresh look
  - 🔆 **High Contrast**: Accessibility-focused theme with maximum contrast
  - 🖥️ **Terminal**: Green-on-black terminal aesthetic for retro vibes
- **Theme Selector**: Easy dropdown menu to switch themes instantly
- **Smooth Transitions**: Animated theme switching for a polished experience
- **Optimized Syntax Highlighting**: All themes include carefully tuned colors for:
  - HTTP methods, paths, headers, and versions
  - JSON keys, strings, numbers, booleans, and null values
  - Parameters and cookies
  - Request method badges (GET, POST, PUT, DELETE, PATCH)
- **Theme Persistence**: Your theme preference is saved and restored automatically
- Request color tags and filters.
- Syntax highlighting for JSON/XML/HTML.

## Quick Start
1) Open Chrome DevTools → **Poor Man's Suite** tab.
2) Browse: requests auto-capture.  
3) Click a request: see raw request/response immediately.  
4) Edit and “Send” to replay; use AI buttons for explain/attack suggestions.  
5) Use timeline, filters, and bulk replay for deeper testing.

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/harryadel/poor-mans-suite.git
   ```
2. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/` in your browser.
   - Enable **Developer mode** (toggle in the top right corner).
3. **Load the Extension**:
   - Click **Load unpacked**.
   - Select the `poor-mans-suite` folder you just cloned.
4. **Open DevTools**:
   - Press `F12` or right-click -> Inspect.
   - Look for the **Poor Man's Suite** tab (you might need to click the `>>` overflow menu).

This combo makes Poor Man's Suite handy for bug bounty hunters and vulnerability researchers who want Burp-like iteration without the heavyweight UI. Install the extension, open DevTools, head to the Poor Man's Suite panel, and start testing. 😎

### Local Model (Ollama) Setup
If you use a local model (e.g., Ollama) you must allow Chrome extensions to call it, otherwise you’ll see 403/CORS errors.

1. Stop any running Ollama instance.
2. Start Ollama with CORS enabled (pick one):
   - Allow only Chrome extensions:
     ```bash
     OLLAMA_ORIGINS="chrome-extension://*" ollama serve
     ```
   - Allow everything (easier for local dev):
     ```bash
     OLLAMA_ORIGINS="*" ollama serve
     ```
3. Verify your model exists (e.g., `gemma3:4b`) with `ollama list`.
4. Reload the extension and try again. If you still see 403, check Ollama logs for details.

### OpenCode Setup

Poor Man's Suite can use a local [OpenCode](https://opencode.ai/) server as a gateway to any model already connected in OpenCode.

1. Start OpenCode from a dedicated empty directory on a stable loopback port. A password is strongly recommended:
   ```bash
   mkdir -p ~/.local/share/poor-mans-suite/opencode
   cd ~/.local/share/poor-mans-suite/opencode
   OPENCODE_SERVER_PASSWORD="choose-a-password" opencode serve --hostname 127.0.0.1 --port 4096
   ```
   OpenCode also loads global `~/.config/opencode/AGENTS.md` or `~/.claude/CLAUDE.md` instructions. If those may contain sensitive information, launch with an isolated home while retaining your OpenCode authentication data:
   ```bash
   ORIGINAL_HOME="$HOME"
   POOR_MANS_SUITE_OPENCODE_HOME="$HOME/.local/share/poor-mans-suite/opencode/home"
   mkdir -p "$POOR_MANS_SUITE_OPENCODE_HOME" "$HOME/.local/share/poor-mans-suite/opencode/work"
   cd "$HOME/.local/share/poor-mans-suite/opencode/work"
   HOME="$POOR_MANS_SUITE_OPENCODE_HOME" \
     XDG_DATA_HOME="$ORIGINAL_HOME/.local/share" \
     OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1 \
     OPENCODE_SERVER_PASSWORD="choose-a-password" \
     opencode serve --hostname 127.0.0.1 --port 4096
   ```
2. Open Poor Man's Suite Settings and select **OpenCode**.
3. Poor Man's Suite automatically connects to `http://127.0.0.1:4096` as `opencode` and loads models available from that server configuration.
4. If your server uses `OPENCODE_SERVER_PASSWORD` or a custom loopback port, enter those advanced connection details and retry, then save.

OpenCode sessions are kept while their Poor Man's Suite request chat is active and deleted when that chat or request is cleared. All OpenCode tools are disabled for these sessions. OpenCode itself runs locally, but request and response data may still be sent to the cloud provider backing the model you select.

### OpenAI Codex Setup

1. Open Poor Man's Suite Settings and select **OpenAI (Codex)**.
2. Enter an OpenAI API key and click **Load Codex models**.
3. Select a model available to the API key and save. Poor Man's Suite uses the OpenAI Responses API with response storage disabled.


## Permissions & Privacy
- **Required**: `storage` keeps OpenCode cleanup retries durable across service-worker and browser restarts.
- **Optional**: `webRequest` for multi-tab capture; `<all_urls>` for multi-tab capture, cross-origin replay, and approved loopback OpenCode access.
- **Optional**: `https://api.openai.com/*` when you configure the direct OpenAI Codex provider.
- **Data**: Stored locally; no tracking/analytics.  
- **AI**: Your credentials stay local; request/response content is sent only to the provider you choose when you invoke AI features. When using OpenCode, the selected OpenCode model may be backed by a cloud provider.


## ⚠️ Limitations

Poor Man's Suite runs inside Chrome DevTools, so:

- No raw HTTP/1 or malformed requests (fetch() limitation)
- Some headers can’t be overridden (browser sandbox)
- No raw TCP sockets (no smuggling/pipelining tests)
- DevTools panel constraints limit certain UI setups

Poor Man's Suite is best for quick testing, replaying, and experimenting — not full low-level HTTP work.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=harryadel/poor-mans-suite&type=date&legend=top-left)](https://www.star-history.com/#harryadel/poor-mans-suite&type=date&legend=top-left)

## Found a Bug or Issue?

If you encounter bugs, unexpected behavior, or have feature requests, please [open an issue in the Poor Man's Suite repository](https://github.com/harryadel/poor-mans-suite/issues).

## Contributors 🤝

<a href="https://github.com/harryadel/poor-mans-suite/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=harryadel/poor-mans-suite" alt="Contributors" />
</a>

## Attribution & License

Poor Man's Suite is maintained at <https://github.com/harryadel/poor-mans-suite> and is a derivative of [rep+](https://github.com/repplus/rep-chrome).

Poor Man's Suite is free software distributed under the [GNU General Public License version 3 or later](LICENSE). It comes with no warranty. Source code for each release is available from the maintained repository.

Portions derived from rep+ remain attributed to Bour Abdelhadi under the original MIT terms. See [NOTICE](NOTICE) and [LICENSES/MIT-upstream.txt](LICENSES/MIT-upstream.txt). Bundled third-party libraries retain their own license notices.
