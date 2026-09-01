// LLM Chat Feature - Interactive chat with LLM for request manipulation
import { getAISettings, streamChatWithMessages } from '../ai/core.js';
import { state, actions } from '../../core/state.js';
import { events, EVENT_NAMES } from '../../core/events.js';
import { formatRawResponse } from '../../network/response-parser.js';
import { handleSendRequest } from '../../network/handler.js';
import { highlightHTTP } from '../../core/utils/network.js';
import { elements } from '../../ui/main-ui.js';
import { resetAllOpenCodeConversations, resetOpenCodeConversation } from '../ai/opencode.js';
import { renderMarkdown } from '../../core/utils/dom.js';
import {
    activateRepeaterContext,
    captureRepeaterContext,
    clearRepeaterContext,
    getActiveRepeaterContext,
    invalidateRepeaterOwner,
    isRepeaterSnapshotValid
} from '../repeater-context.js';
import {
    createBulkReplayDraftContract,
    isBulkReplayDraftRequested,
    parseBulkReplayDraft
} from './bulk-replay-drafts.js';

let chatHistory = [];
let lastSelectedRequestIndex = -1; // Track last selected request to prevent duplicate messages
let lastSelectedRequest = null;
let responseObservationsByOwner = new Map();
let chatTokenEstimateElement = null; // Reference to token estimate element
let activeChat = null;
let nextChatTurnId = 0;
let activePagehideHandler = null;
let nextBulkReplayCorrelationId = 0;

// Per-request chat history storage
let chatHistoryByRequest = new Map(); // Map<request, chatHistory[]>
let referencedRequests = new Set(); // Set of request indices to include in context

// Token optimization constants
const MAX_RESPONSE_HISTORY = 2; // Only keep last 2 responses (original + 1 resend)
const MAX_RESPONSE_TOKENS = 1500; // ~6KB of text (roughly 1500 tokens)
const MAX_CHAT_HISTORY = 15; // Keep last 15 messages (reduced from 20)
const TOKEN_ESTIMATE_CHARS = 4; // Rough estimate: 1 token ≈ 4 characters
const DEFAULT_BULK_REPLAY_REQUEST = 'Prepare a Bulk Replay draft for the current request.';
const BULK_REPLAY_MODE_LABELS = {
    sniper: 'Sniper',
    'battering-ram': 'Battering Ram',
    pitchfork: 'Pitchfork',
    'cluster-bomb': 'Cluster Bomb'
};

function createBulkReplayCorrelationId() {
    nextBulkReplayCorrelationId += 1;
    return `bulk-replay-draft-${Date.now().toString(36)}-${nextBulkReplayCorrelationId.toString(36)}`;
}

function parseBulkReplayAction(text, turn) {
    if (!turn?.bulkDraftRequested) return null;

    const result = parseBulkReplayDraft(text, {
        snapshot: turn.snapshot,
        correlationId: turn.correlationId
    });
    if (!result.found) return null;

    return {
        snapshot: turn.snapshot,
        draft: result.draft,
        projectedRequestCount: result.projectedRequestCount,
        status: result.valid ? 'ready' : 'invalid',
        errors: [...result.errors]
    };
}

function finishActiveChat(turnState, outcome) {
    if (!turnState || activeChat !== turnState) return false;

    activeChat = null;
    turnState.phase = outcome;
    try {
        turnState.onFinalize?.(turnState, outcome);
    } catch (error) {
        console.error('Chat finalization rendering error:', error);
    }
    return true;
}

function cancelActiveChat(request = null) {
    const turnState = activeChat;
    if (!turnState || (request && turnState.owner !== request)) return false;

    turnState.controller.abort();
    if (turnState.provider === 'opencode') {
        resetOpenCodeConversation(turnState.owner).catch(error => {
            console.warn('Failed to cancel OpenCode session:', error);
        });
    }
    return finishActiveChat(turnState, 'canceled');
}

function getConversationOwner() {
    return getActiveRepeaterContext()?.ownerRequest || state.selectedRequest || null;
}

function recordResponseObservation(context) {
    if (!context?.ownerRequest || context.responseText === null) return;

    let observations = responseObservationsByOwner.get(context.ownerRequest);
    if (!observations) {
        observations = new Map();
        responseObservationsByOwner.set(context.ownerRequest, observations);
    }

    observations.delete(context.sourceId);
    observations.set(context.sourceId, Object.freeze({
        sourceId: context.sourceId,
        kind: context.kind,
        label: context.label,
        responseText: context.responseText
    }));

    while (observations.size > MAX_RESPONSE_HISTORY) {
        observations.delete(observations.keys().next().value);
    }
}

function removeResponseObservation({ ownerRequest, sourceId } = {}) {
    const observations = responseObservationsByOwner.get(ownerRequest);
    if (!observations) return;
    observations.delete(sourceId);
    if (observations.size === 0) responseObservationsByOwner.delete(ownerRequest);
}

function captureTurnSnapshot() {
    const activeContext = getActiveRepeaterContext();
    if (!activeContext) return null;
    const owner = activeContext.ownerRequest;

    const editorText = elements.rawRequestInput?.innerText;
    const requestText = typeof editorText === 'string'
        ? editorText
        : elements.rawRequestInput?.textContent || '';
    const httpsInput = elements.useHttpsCheckbox || document.getElementById('use-https');
    let useHttps;
    if (httpsInput && typeof httpsInput.checked === 'boolean') {
        useHttps = httpsInput.checked;
    } else {
        try {
            useHttps = new URL(owner.request?.url).protocol === 'https:';
        } catch {
            useHttps = false;
        }
    }

    const snapshot = captureRepeaterContext({ requestText, useHttps });
    if (snapshot) recordResponseObservation(snapshot);
    return snapshot;
}

const SYSTEM_PROMPT = `You are a helpful assistant for working with HTTP requests and responses. You have access to the currently selected request and response, which will be provided in the conversation context.

You can help with:
- Security testing and penetration testing (identifying vulnerabilities, attack vectors, security improvements)
- Understanding and explaining requests/responses
- Modifying requests (headers, body, parameters)
- Debugging issues
- Testing different scenarios
- Any other questions about the HTTP request/response

When the user asks you to modify a request, provide the modified request in a code block using \`\`\`http or \`\`\`request format. 

Important technical requirements:
- Request line format: METHOD PATH HTTP/VERSION (use path only, not full URL)
  Example: POST /api/users HTTP/1.1 (not POST http://example.com/api/users HTTP/1.1)
- When providing a full request, include all headers and the body
- Preserve the existing request structure when making modifications

Be friendly, helpful, and clear in your explanations.`;

function getChatExportFilename(extension) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const request = getConversationOwner()?.request;
    let host = 'unknown';
    let endpoint = 'unknown';

    if (request?.url) {
        try {
            const url = new URL(request.url);
            host = url.hostname.replace(/[^a-zA-Z0-9.-]/g, '_') || host;
            endpoint = url.pathname
                .replace(/^\/+|\/+$/g, '')
                .replace(/\//g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .slice(0, 50) || 'root';
        } catch (error) {
            // Keep the safe fallback names for malformed request URLs.
        }
    }

    return `poor-mans-suite-ai-chat-${host}-${endpoint}-${timestamp}.${extension}`;
}

function buildChatTranscriptMarkdown() {
    if (chatHistory.length === 0) return '';

    const request = getConversationOwner()?.request;
    const requestLabel = request
        ? `${request.method || 'GET'} ${request.url || ''}`.trim()
        : 'Unknown request';
    const messages = chatHistory.map(message => {
        const heading = message.role === 'assistant' ? "Poor Man's Suite AI" : 'You';
        return `## ${heading}\n\n${message.content}`;
    });

    return `# Poor Man's Suite AI conversation\n\n**Request:** ${requestLabel}\n\n${messages.join('\n\n')}`;
}

function downloadChatTranscript(markdown) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = getChatExportFilename('md');
    anchor.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function printChatTranscript(markdown) {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    const title = getChatExportFilename('pdf').replace(/\.pdf$/, '');
    printWindow.document.write(`
        <html>
        <head>
            <title>${escapeHtml(title)}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 24px; line-height: 1.6; }
                pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
                .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ddd; color: #555; font-size: 12px; }
            </style>
        </head>
        <body>
            <pre>${escapeHtml(markdown)}</pre>
            <div class="footer">Exported from Poor Man's Suite on ${escapeHtml(new Date().toLocaleString())}</div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function formatRequestForContext(request) {
    if (!request || !request.request) return '';
    
    const req = request.request;
    let formatted = `${req.method} ${req.url} ${req.httpVersion || 'HTTP/1.1'}\n`;
    
    if (req.headers) {
        // Handle both array and object formats
        if (Array.isArray(req.headers)) {
            req.headers.forEach(h => {
                if (h && h.name) formatted += `${h.name}: ${h.value ?? ''}\n`;
            });
        } else {
            Object.entries(req.headers).forEach(([key, value]) => {
                formatted += `${key}: ${value}\n`;
            });
        }
    }
    
    formatted += '\n';
    
    if (req.postData && req.postData.text) {
        formatted += req.postData.text;
    }
    
    return formatted;
}

function formatResponseForContext(request) {
    if (!request || !request.response) return '';
    
    try {
        return formatRawResponse(request.response);
    } catch (e) {
        // Fallback to basic formatting
        const resp = request.response;
        if (!resp) return '';
        
        let formatted = `${resp.status} ${resp.statusText || ''}\n`;
        
        if (resp.headers) {
            Object.entries(resp.headers).forEach(([key, value]) => {
                formatted += `${key}: ${value}\n`;
            });
        }
        
        if (resp.content && resp.content.text) {
            formatted += `\n${resp.content.text}`;
        }
        
        return formatted;
    }
}

/**
 * Summarize previous chat history for context
 * @param {Array} prevChat - Previous chat history array
 * @returns {string} Summary of the previous investigation
 */
function summarizePreviousChat(prevChat) {
    if (!prevChat || prevChat.length === 0) return 'No previous conversation.';
    
    // Extract key findings from assistant messages
    const assistantMessages = prevChat.filter(msg => msg.role === 'assistant' && !msg.excludeFromProvider);
    if (assistantMessages.length === 0) return 'Previous conversation had no assistant responses.';
    
    // Get the last assistant message as summary (most relevant)
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    const summary = lastAssistant.content.substring(0, 200); // First 200 chars
    
    return summary + (lastAssistant.content.length > 200 ? '...' : '');
}

function buildUserPrompt(userMessage, snapshot) {
    let prompt = userMessage;

    if (!snapshot) return prompt;

    if (referencedRequests.size > 0) {
        prompt += '\n\n--- Related Requests (from previous investigation) ---\n';
        const currentIndex = state.requests.indexOf(snapshot.ownerRequest);

        for (const reqIndex of referencedRequests) {
            if (reqIndex === currentIndex || reqIndex < 0 || reqIndex >= state.requests.length) continue;

            const prevReq = state.requests[reqIndex];
            const prevChat = chatHistoryByRequest.get(prevReq);
            if (!prevReq?.request) continue;

            const method = prevReq.request.method || 'GET';
            const url = new URL(prevReq.request.url);
            prompt += `\nRequest #${reqIndex + 1}: ${method} ${url.pathname}\n`;
            prompt += `Previous findings: ${summarizePreviousChat(prevChat || [])}\n`;
        }
    }

    prompt += '\n\n--- Current Repeater Source ---\n';
    prompt += `Label: ${snapshot.label}\n`;
    prompt += `Kind: ${snapshot.kind}`;
    prompt += '\n\n--- Exact Current Request ---\n';
    prompt += snapshot.requestText;
    prompt += '\n\n--- Exact Current Response ---\n';
    prompt += snapshot.responseText === null
        ? 'No current response is available for this source.'
        : snapshot.responseText;

    const responseComparisonRelevant = /compare|comparison|differ|previous|prior|changed|response|status|error|body|header|returned|received|result|output|answer|reply/i.test(userMessage);
    if (responseComparisonRelevant) {
        const observations = responseObservationsByOwner.get(snapshot.ownerRequest);
        const priorObservations = observations
            ? Array.from(observations.values()).filter(observation => observation.sourceId !== snapshot.sourceId)
            : [];

        if (priorObservations.length > 0) {
            prompt += '\n\n--- Prior Response Observations (not current) ---';
            priorObservations.forEach(observation => {
                prompt += `\n\nPrior observation: ${observation.label} (${observation.kind})\n`;
                prompt += truncateResponse(observation.responseText, MAX_RESPONSE_TOKENS);
            });
        }
    }

    return prompt;
}

/**
 * Truncate large text to limit token usage
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum tokens (default: MAX_RESPONSE_TOKENS)
 * @returns {string} Truncated text with indicator
 */
function truncateResponse(text, maxTokens = MAX_RESPONSE_TOKENS) {
    if (!text || typeof text !== 'string') return text;
    
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * TOKEN_ESTIMATE_CHARS;
    
    if (text.length <= maxChars) return text;
    
    // Try to truncate at a logical point (newline, space, etc.)
    const truncated = text.substring(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    const lastSpace = truncated.lastIndexOf(' ');
    
    // Prefer newline if it's within 80% of max, otherwise use space
    const cutoff = lastNewline > maxChars * 0.8 ? lastNewline : 
                   (lastSpace > maxChars * 0.8 ? lastSpace : maxChars);
    
    return truncated.substring(0, cutoff) + '\n\n[... response truncated for token efficiency ...]';
}

/**
 * Estimate token count for text
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS);
}

/**
 * Update token estimate display
 * @param {number} tokenCount - Estimated token count
 */
function updateTokenEstimate(tokenCount) {
    if (!chatTokenEstimateElement) return;
    
    if (tokenCount > 0) {
        chatTokenEstimateElement.textContent = `~${tokenCount.toLocaleString()} tokens`;
        chatTokenEstimateElement.style.display = 'inline-block';
        
        // Add warning class for high token usage
        if (tokenCount > 10000) {
            chatTokenEstimateElement.classList.add('token-warning');
            chatTokenEstimateElement.classList.remove('token-medium');
        } else if (tokenCount > 5000) {
            chatTokenEstimateElement.classList.add('token-medium');
            chatTokenEstimateElement.classList.remove('token-warning');
        } else {
            chatTokenEstimateElement.classList.remove('token-warning', 'token-medium');
        }
    } else {
        chatTokenEstimateElement.style.display = 'none';
    }
}

function addMessageToHistory(role, content, request = getConversationOwner(), localMetadata = {}) {
    const message = { role, content, timestamp: Date.now(), ...localMetadata };
    if (!request) return null;

    if (!chatHistoryByRequest.has(request)) chatHistoryByRequest.set(request, []);
    const requestHistory = chatHistoryByRequest.get(request);
    requestHistory.push(message);
    if (requestHistory.length > MAX_CHAT_HISTORY) {
        requestHistory.splice(0, requestHistory.length - MAX_CHAT_HISTORY);
    }

    if (request === lastSelectedRequest) {
        chatHistory = requestHistory.map(storedMessage => ({ ...storedMessage }));
    }

    return message;
}

function clearChatHistory() {
    chatHistory = [];
    // Don't clear per-request history, just current session
}

function loadChatHistoryForRequest(request) {
    if (!request || !chatHistoryByRequest.has(request)) {
        chatHistory = [];
        return;
    }
    
    // Load the stored history for this request
    const storedHistory = chatHistoryByRequest.get(request);
    chatHistory = storedHistory.map(msg => ({ ...msg })); // Deep copy
}

/**
 * Compress old conversation history to reduce tokens
 * Keeps first 2 messages (context) and last N messages (recent)
 */
function compressChatHistory(history = chatHistory) {
    history = history.filter(message => !message.excludeFromProvider);
    if (history.length <= MAX_CHAT_HISTORY) {
        return history;
    }
    
    // Keep first 2 messages for context, last (MAX_CHAT_HISTORY - 3) for recent
    // Middle messages get summarized
    const keepRecent = MAX_CHAT_HISTORY - 3;
    const oldest = history.slice(0, 2);
    const recent = history.slice(-keepRecent);
    const middle = history.slice(2, -keepRecent);
    
    if (middle.length > 0) {
        // Create a summary message for the middle section
        const summary = {
            role: 'system',
            content: `[Previous conversation: ${middle.length} messages about request modification, testing, and analysis]`,
            timestamp: Date.now()
        };
        
        return [...oldest, summary, ...recent];
    }
    
    return history;
}

function getConversationMessages() {
    // Build conversation from history, starting with system prompt
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    
    // Compress history if needed
    const compressedHistory = compressChatHistory();
    
    // Add conversation history
    compressedHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
    });
    
    return messages;
}

async function sendChatMessage(userMessage, turn, handlers) {
    if (activeChat) return false;

    const request = turn?.owner;
    const snapshot = turn?.snapshot;
    if (!request) {
        handlers.onRejected('No request selected. Please select a request first.');
        return false;
    }

    let settings;
    try {
        settings = getAISettings();
    } catch (error) {
        handlers.onRejected(error.message || 'Failed to load AI settings.');
        return false;
    }

    if (!settings.apiKey || (['local', 'opencode'].includes(settings.provider) && !settings.model)) {
        handlers.onRejected(settings.provider === 'opencode'
            ? 'OpenCode is not configured. Test the connection and select a model in settings.'
            : 'AI API key not configured. Please configure it in settings.');
        return false;
    }

    const controller = new AbortController();
    const turnState = {
        id: `chat-turn-${++nextChatTurnId}`,
        owner: request,
        snapshot,
        provider: settings.provider,
        controller,
        phase: 'pending',
        partialText: '',
        onFinalize: handlers.onFinalize
    };
    activeChat = turnState;

    try {
        handlers.onStart(turnState);
        // Build the full user prompt with request context
        const fullUserPrompt = buildUserPrompt(userMessage, snapshot);
        const systemPrompt = turn.bulkDraftRequested
            ? `${SYSTEM_PROMPT}\n\n${createBulkReplayDraftContract(turn.correlationId)}`
            : SYSTEM_PROMPT;
        
        // Build proper message array for rolling context
        // Start with system prompt
        const messages = [{ role: 'system', content: systemPrompt }];
        
        // Compress and add conversation history (previous turns)
        const compressedHistory = compressChatHistory(chatHistoryByRequest.get(request) || []);
        compressedHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });
        
        // Add current user message with full context
        messages.push({ role: 'user', content: fullUserPrompt });
        
        // Calculate and display token estimate
        const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
        updateTokenEstimate(totalTokens);
        
        // Add user message to history (for next turn) - use original message, not full prompt
        addMessageToHistory('user', turn.originalUserMessage, request);
        
        let assistantResponse = '';
        
        // Use proper message array for rolling context
        const requestUrl = new URL(request.request.url);
        const sessionTitle = `Poor Man's Suite ${request.request.method || 'GET'} ${requestUrl.hostname}${requestUrl.pathname}`.slice(0, 120);
        const returnedResponse = await streamChatWithMessages(
            settings.apiKey,
            settings.model,
            messages,
            (text) => {
                if (activeChat !== turnState || controller.signal.aborted) return;
                assistantResponse = text;
                turnState.phase = 'streaming';
                turnState.partialText = text;
                handlers.onUpdate(text, turn, turnState);
            },
            settings.provider,
            { conversationKey: request, sessionTitle, signal: controller.signal }
        );

        if (controller.signal.aborted || activeChat !== turnState) return false;
        if (!assistantResponse && typeof returnedResponse === 'string') {
            assistantResponse = returnedResponse;
            turnState.phase = 'streaming';
            turnState.partialText = returnedResponse;
        }

        // Local action metadata never enters provider history or transcript exports.
        const bulkReplayAction = parseBulkReplayAction(assistantResponse, turn);
        const assistantMessage = addMessageToHistory('assistant', assistantResponse, request, {
            ...(bulkReplayAction ? { bulkReplayAction } : {})
        });

        try {
            handlers.onComplete(assistantResponse, turn, assistantMessage, turnState);
        } catch (renderError) {
            console.error('Chat completion rendering error:', renderError);
        }
        finishActiveChat(turnState, 'completed');
        return true;
    } catch (error) {
        if (controller.signal.aborted || activeChat !== turnState) return false;
        console.error('Chat error:', error);
        const errorText = error.message || 'Failed to send message. Please check your API key and try again.';
        const errorMessage = addMessageToHistory('assistant', `Error: ${errorText}`, request, {
            isError: true,
            excludeFromProvider: true
        });
        try {
            handlers.onError(errorText, turn, errorMessage, turnState);
        } catch (renderError) {
            console.error('Chat error rendering error:', renderError);
        }
        finishActiveChat(turnState, 'failed');
        return false;
    }
}

export function setupLLMChat(elements, { bulkReplay } = {}) {
    // Configure marked.js to use highlight.js for syntax highlighting
    if (window.marked && window.hljs) {
        window.marked.setOptions({
            highlight: function(code, lang) {
                if (lang && window.hljs.getLanguage(lang)) {
                    try {
                        return window.hljs.highlight(code, { language: lang }).value;
                    } catch (err) {
                        console.warn('Highlight.js error:', err);
                    }
                }
                // Fallback: auto-detect language or highlight as plain text
                try {
                    return window.hljs.highlightAuto(code).value;
                } catch (err) {
                    return window.hljs.highlight(code, { language: 'plaintext' }).value;
                }
            },
            langPrefix: 'hljs language-'
        });
    }
    
    const chatPane = document.getElementById('llm-chat-pane');
    const chatToggleBtn = document.getElementById('llm-chat-toggle-btn');
    const chatCloseBtn = document.getElementById('llm-chat-close-btn');
    const chatResizeHandle = document.querySelector('.chat-resize-handle');
    const chatMessages = document.getElementById('llm-chat-messages');
    const chatInput = document.getElementById('llm-chat-input');
    const chatTokenEstimate = document.getElementById('llm-chat-token-estimate');
    
    // Store reference at module level for updateTokenEstimate function
    chatTokenEstimateElement = chatTokenEstimate;
    const chatSendBtn = document.getElementById('llm-chat-send-btn');
    const chatPrepareBulkReplayBtn = document.getElementById('llm-chat-prepare-bulk-replay-btn');
    const chatClearBtn = document.getElementById('llm-chat-clear-btn');
    const chatRequestBadge = document.getElementById('llm-chat-request-badge');
    const chatExportToggle = document.getElementById('llm-chat-export-toggle');
    const chatExportMenu = document.getElementById('llm-chat-export-menu');
    const chatExportMarkdown = document.getElementById('llm-chat-export-md');
    const chatExportPdf = document.getElementById('llm-chat-export-pdf');
    
    if (!chatPane) {
        console.error('LLM Chat: Chat pane not found');
        return;
    }
    
    if (!chatToggleBtn) {
        console.error('LLM Chat: Toggle button not found');
        return;
    }

    const SCROLL_BOTTOM_TOLERANCE = 24;
    const sendButtonDefaultTitle = chatSendBtn?.title || 'Send message (Enter)';
    const prepareButtonDefaultTitle = chatPrepareBulkReplayBtn?.title || 'Prepare a Bulk Replay draft';
    const requestFrame = typeof window.requestAnimationFrame === 'function'
        ? callback => window.requestAnimationFrame(callback)
        : callback => window.setTimeout(callback, 0);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
        ? frameId => window.cancelAnimationFrame(frameId)
        : frameId => window.clearTimeout(frameId);
    let followLatest = true;
    let scrollFrameId = null;
    let pendingScrollRequest = null;
    let renderGeneration = 0;

    if (chatMessages) {
        chatMessages.setAttribute('role', 'log');
        chatMessages.setAttribute('aria-label', chatMessages.getAttribute('aria-label') || 'AI conversation');
        chatMessages.setAttribute('aria-live', 'polite');
        chatMessages.setAttribute('aria-relevant', 'additions text');
        chatMessages.setAttribute('aria-busy', 'false');
        if (!chatMessages.hasAttribute('tabindex')) chatMessages.tabIndex = 0;
    }

    function isNearChatBottom() {
        if (!chatMessages) return true;
        return chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= SCROLL_BOTTOM_TOLERANCE;
    }

    function scheduleScrollToLatest({ force = false } = {}) {
        if (!chatMessages || (!force && !followLatest)) return;

        if (force) followLatest = true;
        pendingScrollRequest = {
            force: force || pendingScrollRequest?.force === true,
            generation: renderGeneration
        };
        if (scrollFrameId !== null) return;

        scrollFrameId = requestFrame(() => {
            scrollFrameId = null;
            const request = pendingScrollRequest;
            pendingScrollRequest = null;
            if (!request || request.generation !== renderGeneration) return;
            if (!request.force && !followLatest) return;

            chatMessages.scrollTop = chatMessages.scrollHeight;
            followLatest = true;
        });
    }

    function renderAssistantContent(messageDiv, text, { streaming = false, final = false } = {}) {
        const content = messageDiv.querySelector('.llm-chat-response-content') || messageDiv;
        const sourceText = text || '';

        if (window.marked && sourceText) {
            try {
                const markdown = streaming ? prepareMarkdownForStreaming(sourceText) : sourceText;
                content.innerHTML = renderMarkdown(markdown, window.marked);
            } catch (error) {
                content.textContent = sourceText;
            }
        } else {
            content.textContent = sourceText;
        }

        if (window.hljs) {
            content.querySelectorAll('pre code').forEach(block => {
                if (block.classList.contains('hljs')) return;
                try {
                    window.hljs.highlightElement(block);
                } catch (error) {
                    // Keep rendered code readable when highlighting fails.
                }
            });
        }
        if (final) addCopyButtonsToCodeBlocks(content);
    }

    function getActiveTurnElement(turnState) {
        if (!turnState) return null;
        return document.getElementById(turnState.id);
    }

    function renderActiveTurn(turnState, { forceScroll = false } = {}) {
        if (!chatMessages || !turnState || turnState.owner !== getConversationOwner()) return null;

        let messageDiv = getActiveTurnElement(turnState);
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.id = turnState.id;
            messageDiv.innerHTML = `
                <div class="llm-chat-processing-status" role="status" aria-live="polite" aria-atomic="true">
                    <span class="llm-chat-processing-spinner" aria-hidden="true"></span>
                    <span class="llm-chat-processing-label"></span>
                </div>
                <div class="llm-chat-response-content"></div>
            `;
            chatMessages.appendChild(messageDiv);
        }

        messageDiv.className = 'chat-message chat-message-assistant processing';
        messageDiv.dataset.phase = turnState.phase;
        const label = messageDiv.querySelector('.llm-chat-processing-label');
        if (label) {
            label.textContent = turnState.phase === 'streaming' ? 'Generating answer...' : 'Thinking...';
        }
        renderAssistantContent(messageDiv, turnState.partialText, { streaming: turnState.phase === 'streaming' });
        scheduleScrollToLatest({ force: forceScroll });
        return messageDiv;
    }

    function syncProcessingUI({ forceScroll = false } = {}) {
        const visibleTurn = activeChat?.owner === getConversationOwner() ? activeChat : null;
        if (chatMessages) chatMessages.setAttribute('aria-busy', visibleTurn ? 'true' : 'false');
        if (visibleTurn) renderActiveTurn(visibleTurn, { forceScroll });
        updateSendButtonState();
    }

    function handleTurnFinalized(turnState, outcome) {
        const messageDiv = getActiveTurnElement(turnState);
        if (outcome === 'canceled') messageDiv?.remove();
        if (chatMessages && turnState.owner === getConversationOwner()) {
            chatMessages.setAttribute('aria-busy', 'false');
        }
        updateSendButtonState();
        scheduleScrollToLatest();
    }

    if (chatMessages) {
        chatMessages.addEventListener('scroll', () => {
            followLatest = isNearChatBottom();
        });
    }
    
    // Initialize chat pane to be hidden by default
    const responsePane = document.querySelector('.response-pane');
    const requestPane = document.querySelector('.request-pane');
    if (chatPane) {
        chatPane.style.display = 'none';
    }
    if (chatResizeHandle) {
        chatResizeHandle.style.display = 'none';
    }
    
    function setChatPaneVisibility(visible, focusInput = true) {
        chatPane.style.display = visible ? 'flex' : 'none';
        if (chatResizeHandle) chatResizeHandle.style.display = visible ? 'block' : 'none';
        chatToggleBtn.classList.toggle('active', visible);

        if (requestPane && responsePane) {
            requestPane.style.flex = visible ? '0 0 33.33%' : '1';
            responsePane.style.flex = visible ? '0 0 33.33%' : '1';
        }
        if (visible) {
            chatPane.style.flex = '0 0 33.33%';
            if (focusInput && chatInput) {
                setTimeout(() => chatInput.focus(), 100);
            }
            if (!getConversationOwner()) {
                clearChatHistory();
                renderChatHistory();
            }
        } else {
            const requestResponseResizeHandle = document.querySelector('.pane-resize-handle:not(.chat-resize-handle)');
            if (requestResponseResizeHandle) {
                requestResponseResizeHandle.style.pointerEvents = '';
                requestResponseResizeHandle.style.opacity = '';
            }
        }
    }

    function openChatPane() {
        setChatPaneVisibility(true);
    }

    // Toggle chat pane visibility
    chatToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const currentDisplay = chatPane.style.display || window.getComputedStyle(chatPane).display;
        setChatPaneVisibility(currentDisplay === 'none');
    });

    if (chatCloseBtn) {
        chatCloseBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setChatPaneVisibility(false);
        });
    }

    // Setup resize handle for chat pane
    if (chatResizeHandle && chatPane) {
        let isResizing = false;
        let requestPaneFixedWidth = null; // Store fixed request pane width when starting resize
        const responsePane = document.querySelector('.response-pane');
        const requestPane = document.querySelector('.request-pane');
        
        chatResizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent triggering request/response resize
            isResizing = true;
            chatResizeHandle.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            // Store the current request pane width to keep it fixed during resize
            if (requestPane) {
                const requestRect = requestPane.getBoundingClientRect();
                requestPaneFixedWidth = requestRect.width;
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !responsePane || !chatPane || !requestPane) return;
            
            const container = document.querySelector('.split-view-container');
            if (!container) return;
            
            const containerRect = container.getBoundingClientRect();
            
            // Use stored fixed width (from when resize started) to keep request pane fixed
            const requestWidth = requestPaneFixedWidth || requestPane.getBoundingClientRect().width;
            
            // Calculate available width (container width minus request pane width and resize handles)
            const requestResponseResizeHandle = document.querySelector('.pane-resize-handle:not(.chat-resize-handle)');
            const requestResponseResizeHandleWidth = requestResponseResizeHandle ? (requestResponseResizeHandle.offsetWidth || 5) : 5;
            const chatResizeHandleWidth = chatResizeHandle.offsetWidth || 5;
            const availableWidth = containerRect.width - requestWidth - requestResponseResizeHandleWidth - chatResizeHandleWidth;
            
            // Mouse position relative to the start of response pane (after request pane and its resize handle)
            const requestRect = requestPane.getBoundingClientRect();
            const offsetX = e.clientX - requestRect.right - requestResponseResizeHandleWidth;
            
            // Calculate percentages based on available space (not full container)
            const minResponsePx = 200;
            const minChatPx = 300;
            const clampedOffsetX = Math.min(
                Math.max(offsetX, minResponsePx),
                Math.max(availableWidth - minChatPx, minResponsePx)
            );
            
            // Calculate percentages of available space
            const responsePercentage = (clampedOffsetX / availableWidth) * 100;
            const chatPercentage = 100 - responsePercentage;
            
            // Keep request pane fixed at its stored width, only adjust response and chat
            // Convert to container percentages
            const requestPercentage = (requestWidth / containerRect.width) * 100;
            const remainingPercentage = 100 - requestPercentage;
            const responseContainerPercentage = (responsePercentage / 100) * remainingPercentage;
            const chatContainerPercentage = (chatPercentage / 100) * remainingPercentage;
            
            // Keep request pane fixed, only adjust response and chat
            requestPane.style.flex = `0 0 ${requestPercentage}%`;
            responsePane.style.flex = `0 0 ${responseContainerPercentage}%`;
            chatPane.style.flex = `0 0 ${chatContainerPercentage}%`;
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                requestPaneFixedWidth = null; // Clear fixed width when done resizing
                chatResizeHandle.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
    
    // Auto-resize textarea
    function autoResizeTextarea() {
        if (!chatInput) return;
        // Reset height to auto to get accurate scrollHeight
        chatInput.style.height = 'auto';
        // Calculate new height, ensuring it doesn't exceed max-height
        const newHeight = Math.max(28, Math.min(chatInput.scrollHeight, 200));
        chatInput.style.height = newHeight + 'px';
        
        // Ensure wrapper maintains proper height (padding top + bottom = 16px)
        const wrapper = chatInput.closest('.llm-chat-input-wrapper');
        if (wrapper) {
            wrapper.style.minHeight = (newHeight + 16) + 'px';
        }
    }
    
    // Update send button state
    function updateSendButtonState() {
        const isProcessing = Boolean(activeChat);
        const hasText = Boolean(chatInput?.value.trim());
        const busyTitle = activeChat?.owner === getConversationOwner()
            ? 'Poor Man\'s Suite is generating an answer.'
            : 'Another request conversation is still generating an answer.';

        if (chatSendBtn) {
            chatSendBtn.disabled = isProcessing || !hasText;
            chatSendBtn.title = isProcessing ? busyTitle : sendButtonDefaultTitle;
        }
        if (chatPrepareBulkReplayBtn) {
            chatPrepareBulkReplayBtn.disabled = isProcessing;
            chatPrepareBulkReplayBtn.title = isProcessing ? busyTitle : prepareButtonDefaultTitle;
        }
    }
    
    // Send a typed or programmatic message through the same request-scoped conversation.
    function submitMessage(message, options = {}) {
        if (!chatMessages) return Promise.resolve(false);

        message = (message || '').trim();
        if (!message) return Promise.resolve(false);
        if (activeChat) {
            updateSendButtonState();
            return Promise.resolve(false);
        }

        const snapshot = captureTurnSnapshot();
        if (!snapshot) {
            addSystemMessage('Please select a request first.');
            return Promise.resolve(false);
        }
        const bulkDraftRequested = options.bulkDraftRequested === true || isBulkReplayDraftRequested(message);
        const turn = Object.freeze({
            owner: snapshot.ownerRequest,
            snapshot,
            originalUserMessage: message,
            bulkDraftRequested,
            ...(bulkDraftRequested ? { correlationId: createBulkReplayCorrelationId() } : {})
        });

        // Send to LLM
        return sendChatMessage(
            message,
            turn,
            {
                onRejected(error) {
                    addSystemMessage(error, { forceScroll: true });
                },
                onStart(turnState) {
                    addUserMessage(message, { forceScroll: true });
                    renderActiveTurn(turnState, { forceScroll: true });
                    syncProcessingUI();
                },
                onUpdate(text, activeTurn, turnState) {
                    if (getConversationOwner() === activeTurn.owner) renderActiveTurn(turnState);
                },
                onComplete(fullText, completedTurn, assistantMessage, turnState) {
                    if (getConversationOwner() !== completedTurn.owner) return;
                    const loadingElement = getActiveTurnElement(turnState) || renderActiveTurn(turnState);
                    if (!loadingElement) return;

                    // Complete - final markdown update
                    loadingElement.classList.remove('processing');
                    loadingElement.removeAttribute('data-phase');
                    loadingElement.querySelector('.llm-chat-processing-status')?.remove();
                    renderAssistantContent(loadingElement, fullText, { final: true });

                    renderBulkReplayAction(loadingElement, assistantMessage);
                    
                    // Parse and apply modifications after message is complete
                    // Use the raw text (fullText) before markdown conversion
                    const suggestions = parseModificationSuggestions(fullText);
                    console.log('LLM Chat: Parsed suggestions from fullText:', suggestions.length, suggestions);
                    
                    // Get the user's original message to understand intent
                    const lastUserMessage = completedTurn.originalUserMessage;
                    
                    // Check for explicit modification intent (must be action-oriented)
                    // More specific patterns that indicate actual modification requests
                    const modificationKeywords = /(?:modif|chang|updat|add|set|edit|alter|replace|test|try|send|resend|apply|inject|insert|remove|delete|update the|change the|modify the|add to|set header|edit header|update header|bypass|sql|sqli|xss|csrf|payload)/i;
                    const hasModificationIntent = modificationKeywords.test(fullText);
                    
                    // Check if user explicitly asked to modify/test the request
                    const userWantsModification = lastUserMessage && /(?:modif|chang|updat|add|set|edit|alter|test|try|send|resend|inject|insert|remove|delete|update the|change the|modify the|add to|set header|edit header|update header|bypass|sql|sqli|xss|csrf|payload)/i.test(lastUserMessage);
                    
                    // Check for purely informational/documentation intent (exclude these ONLY if no modification intent)
                    // If user wants to modify AND explain, prioritize modification
                    const informationalKeywords = /(?:generat|creat|writ|show|display|report|explain|analyze|describe|document|outline|summar|list|provide|give me|tell me|what|how does|why)/i;
                    const isPurelyInformational = !userWantsModification && !hasModificationIntent && informationalKeywords.test(lastUserMessage || '');
                    
                    // Only show buttons if:
                    // 1. There are suggestions found
                    // 2. AND it's NOT a purely informational request (like reports without modifications)
                    // 3. AND (the LLM used modification language OR the user explicitly asked for modifications)
                    const shouldShowButtons = suggestions.length > 0 
                        && !isPurelyInformational 
                        && (hasModificationIntent || userWantsModification);
                    
                    if (shouldShowButtons) {
                        // Sort suggestions: full_request first, then headers, then body
                        suggestions.sort((a, b) => {
                            const order = { 'full_request': 0, 'header': 1, 'body': 2, 'structured': 3 };
                            return (order[a.type] || 99) - (order[b.type] || 99);
                        });
                        
                        // Show buttons for all suggestions (no auto-apply)
                        const messageContainer = loadingElement.closest('.chat-message');
                        if (messageContainer) {
                            const actionsDiv = document.createElement('div');
                            actionsDiv.className = 'llm-chat-actions';
                            actionsDiv.innerHTML = '<div class="llm-chat-actions-label">Apply modifications:</div>';
                            
                            suggestions.forEach((suggestion) => {
                                const button = document.createElement('button');
                                button.className = 'llm-chat-apply-btn';
                                button.textContent = suggestion.type === 'full_request' 
                                    ? 'Apply Request Changes' 
                                    : suggestion.type === 'header'
                                    ? `Apply Header: ${suggestion.name}`
                                    : suggestion.type === 'body'
                                    ? 'Apply Body Changes'
                                    : 'Apply Changes';
                                
                                button.onclick = () => {
                                    if (applyRequestModification(suggestion, completedTurn)) {
                                        button.textContent = '✓ Applied';
                                        button.disabled = true;
                                        button.classList.add('applied');
                                    } else {
                                        button.textContent = '✗ Failed';
                                        button.classList.add('error');
                                        setTimeout(() => {
                                            button.textContent = button.textContent.replace('✗ Failed', 'Apply Changes');
                                            button.classList.remove('error');
                                        }, 2000);
                                    }
                                };
                                
                                actionsDiv.appendChild(button);
                                // Add Apply & Send button
                                const sendButton = document.createElement('button');
                                sendButton.className = 'llm-chat-apply-send-btn';
                                sendButton.textContent = 'Apply Request & Send';
                                sendButton.title = 'Apply changes and send request immediately';
                                
                                sendButton.onclick = async () => {
                                    if (applyRequestModification(suggestion, completedTurn)) {
                                        sendButton.textContent = '✓ Sending...';
                                        sendButton.disabled = true;
                                        sendButton.classList.add('applied');
                                        
                                        // Update the other button too
                                        button.textContent = '✓ Applied';
                                        button.disabled = true;
                                        button.classList.add('applied');
                                        
                                        try {
                                            await handleSendRequest();
                                            sendButton.textContent = '✓ Sent';
                                        } catch (e) {
                                            sendButton.textContent = '✗ Send Failed';
                                            sendButton.classList.add('error');
                                            console.error('Apply & Send failed:', e);
                                        }
                                    } else {
                                        sendButton.textContent = '✗ Failed';
                                        sendButton.classList.add('error');
                                        setTimeout(() => {
                                            sendButton.textContent = 'Apply & Send';
                                            sendButton.classList.remove('error');
                                        }, 2000);
                                    }
                                };
                                
                                actionsDiv.appendChild(sendButton);
                            });
                            
                            messageContainer.appendChild(actionsDiv);
                        }
                    }
                    scheduleScrollToLatest();
                },
                onError(error, failedTurn, errorMessage, turnState) {
                    if (getConversationOwner() !== failedTurn.owner) return;
                    const loadingElement = getActiveTurnElement(turnState) || renderActiveTurn(turnState);
                    if (!loadingElement) return;

                    loadingElement.className = 'chat-message chat-message-assistant error';
                    loadingElement.removeAttribute('data-phase');
                    loadingElement.textContent = errorMessage.content;
                    scheduleScrollToLatest();
                },
                onFinalize: handleTurnFinalized
            }
        );
    }

    function handleSend() {
        if (!chatInput) return Promise.resolve(false);

        const message = chatInput.value.trim();
        if (!message) return Promise.resolve(false);

        const submission = submitMessage(message);
        if (activeChat?.owner === getConversationOwner()) {
            chatInput.value = '';
            autoResizeTextarea();
            updateSendButtonState();
        }

        return submission;
    }

    function handlePrepareBulkReplay() {
        if (!chatInput) return Promise.resolve(false);

        const message = chatInput.value.trim() || DEFAULT_BULK_REPLAY_REQUEST;
        const submission = submitMessage(message, { bulkDraftRequested: true });
        if (activeChat?.owner === getConversationOwner()) {
            chatInput.value = '';
            autoResizeTextarea();
            updateSendButtonState();
        }

        return submission;
    }
    
    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', handleSend);
    }

    if (chatPrepareBulkReplayBtn) {
        chatPrepareBulkReplayBtn.addEventListener('click', handlePrepareBulkReplay);
    }
    
    if (chatInput) {
        // Auto-resize on input
        chatInput.addEventListener('input', () => {
            autoResizeTextarea();
            updateSendButtonState();
        });
        
        // Handle Enter key (Shift+Enter for new line)
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (chatInput.value.trim() && !chatSendBtn?.disabled) {
                    handleSend();
                }
            }
        });
        
        // Initial state
        updateSendButtonState();
    }
    
    // Clear chat
    if (chatClearBtn) {
        chatClearBtn.addEventListener('click', () => {
            const owner = getConversationOwner();
            if (owner) {
                cancelActiveChat(owner);
                chatHistoryByRequest.delete(owner);
                responseObservationsByOwner.delete(owner);
                resetOpenCodeConversation(owner).catch(error => {
                    console.warn('Failed to clear OpenCode session:', error);
                });
            }
            
            clearChatHistory();
            referencedRequests.clear();
            updateReferenceUI();

            renderChatHistory(owner
                ? { emptyMessage: 'Chat cleared. How can I help you with this request?' }
                : undefined);
        });
    }
    
    if (chatExportToggle && chatExportMenu) {
        chatExportToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            chatExportMenu.classList.toggle('show');
        });
        document.addEventListener('click', (event) => {
            if (!chatExportMenu.contains(event.target) && event.target !== chatExportToggle) {
                chatExportMenu.classList.remove('show');
            }
        });
    }

    if (chatExportMarkdown) {
        chatExportMarkdown.addEventListener('click', () => {
            const markdown = buildChatTranscriptMarkdown();
            if (!markdown) {
                alert('No conversation to export yet.');
                return;
            }
            downloadChatTranscript(markdown);
            chatExportMenu?.classList.remove('show');
        });
    }

    if (chatExportPdf) {
        chatExportPdf.addEventListener('click', () => {
            const markdown = buildChatTranscriptMarkdown();
            if (!markdown) {
                alert('No conversation to export yet.');
                return;
            }
            printChatTranscript(markdown);
            chatExportMenu?.classList.remove('show');
        });
    }

    // Function to update request badge in header
    function updateRequestBadge() {
        if (!chatRequestBadge) return;

        const owner = getConversationOwner();
        if (owner) {
            const request = owner.request;
            const method = request.method || 'GET';
            const url = new URL(request.url);
            const path = url.pathname.length > 30 
                ? url.pathname.substring(0, 27) + '...' 
                : url.pathname;
            const index = state.requests.indexOf(owner);
            
            chatRequestBadge.textContent = `#${index + 1} ${method} ${path}`;
            chatRequestBadge.style.display = 'inline-block';
        } else {
            chatRequestBadge.style.display = 'none';
        }
    }
    
    // Function to show a subtle context change notification
    function showFreshChatNotice() {
        if (!chatMessages) return;
        
        // Create a subtle notice that chat is fresh for this request
        const notice = document.createElement('div');
        notice.className = 'llm-chat-fresh-notice';
        notice.innerHTML = `
            <span>💬 Starting fresh chat for this request</span>
            <button class="llm-chat-notification-dismiss" onclick="this.parentElement.remove()">×</button>
        `;
        
        // Insert at the top of messages
        chatMessages.insertBefore(notice, chatMessages.firstChild);
        scheduleScrollToLatest();
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (notice.parentElement) {
                notice.remove();
                scheduleScrollToLatest();
            }
        }, 5000);
    }
    
    function updateReferenceUI() {
        const referenceContainer = document.getElementById('llm-chat-reference-container');
        if (!referenceContainer) return;
        
        const currentIndex = state.requests.indexOf(getConversationOwner());
        if (currentIndex === -1) {
            referenceContainer.style.display = 'none';
            return;
        }
        
        // Get all requests that have chat history (excluding current)
        const availableRequests = [];
        for (let i = 0; i < state.requests.length; i++) {
            const req = state.requests[i];
            if (i !== currentIndex && chatHistoryByRequest.has(req)) {
                const history = chatHistoryByRequest.get(req);
                if (req && req.request && history && history.length > 0) {
                    const method = req.request.method || 'GET';
                    const url = new URL(req.request.url);
                    const path = url.pathname.length > 40 ? url.pathname.substring(0, 37) + '...' : url.pathname;
                    availableRequests.push({
                        index: i,
                        method,
                        path,
                        messageCount: history.length
                    });
                }
            }
        }
        
        if (availableRequests.length === 0) {
            referenceContainer.style.display = 'none';
            return;
        }
        
        // Show the reference UI
        referenceContainer.style.display = 'block';
        const checkboxContainer = referenceContainer.querySelector('.llm-chat-reference-checkboxes');
        if (!checkboxContainer) return;
        
        // Clear existing checkboxes
        checkboxContainer.innerHTML = '';
        
        // Add checkboxes for each available request
        availableRequests.forEach(req => {
            const label = document.createElement('label');
            label.className = 'llm-chat-reference-item';
            label.innerHTML = `
                <input type="checkbox" value="${req.index}" ${referencedRequests.has(req.index) ? 'checked' : ''}>
                <span>#${req.index + 1} ${req.method} ${req.path} (${req.messageCount} msgs)</span>
            `;
            checkboxContainer.appendChild(label);
        });
        
        // Update checkboxes event listeners
        checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const reqIndex = parseInt(e.target.value, 10);
                if (e.target.checked) {
                    referencedRequests.add(reqIndex);
                } else {
                    referencedRequests.delete(reqIndex);
                }
            });
        });
        
        // Set up collapse/expand toggle
        const toggleBtn = document.getElementById('llm-chat-reference-toggle');
        if (toggleBtn) {
            // Remove existing listeners to avoid duplicates
            const newToggleBtn = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
            
            // Default to collapsed if there are more than 2 requests
            const shouldCollapse = availableRequests.length > 2;
            if (shouldCollapse) {
                checkboxContainer.style.display = 'none';
                referenceContainer.classList.add('collapsed');
                newToggleBtn.querySelector('svg').style.transform = 'rotate(-90deg)';
            }
            
            newToggleBtn.addEventListener('click', () => {
                const isCollapsed = checkboxContainer.style.display === 'none';
                checkboxContainer.style.display = isCollapsed ? 'block' : 'none';
                referenceContainer.classList.toggle('collapsed', !isCollapsed);
                const svg = newToggleBtn.querySelector('svg');
                if (svg) {
                    svg.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
                }
            });
        }
    }
    
    function showContextChangeNotification() {
        if (!chatMessages) return;
        
        // Check if there's existing conversation history
        const hasHistory = chatHistory.length > 0;
        if (!hasHistory) return; // No need to notify if no conversation yet
        
        // Create a dismissible notification banner
        const notification = document.createElement('div');
        notification.className = 'llm-chat-context-notification';
        notification.innerHTML = `
            <span>Context updated to new request</span>
            <button class="llm-chat-notification-dismiss" onclick="this.parentElement.remove()">×</button>
        `;
        
        // Insert at the top of messages (after any existing notifications)
        const firstChild = chatMessages.firstChild;
        if (firstChild && firstChild.classList && firstChild.classList.contains('llm-chat-context-notification')) {
            firstChild.replaceWith(notification);
        } else {
            chatMessages.insertBefore(notification, firstChild);
        }
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(-10px)';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }
    
    function syncConversationOwner() {
        if (!chatPane) return;

        const currentRequest = getConversationOwner();
        const currentIndex = state.requests.indexOf(currentRequest);
        updateRequestBadge();
        if (currentRequest === lastSelectedRequest) {
            lastSelectedRequestIndex = currentIndex;
            return;
        }

        const wasChanged = lastSelectedRequest !== null;
        lastSelectedRequest = currentRequest;
        lastSelectedRequestIndex = currentIndex;
        loadChatHistoryForRequest(currentRequest);
        renderChatHistory();
        referencedRequests.clear();
        updateReferenceUI();

        if (wasChanged && currentRequest && chatMessages) {
            const isChatVisible = chatPane.style.display !== 'none' &&
                window.getComputedStyle(chatPane).display !== 'none';
            if (isChatVisible) {
                showContextChangeNotification();
                showFreshChatNotice();
            }
        }
    }

    events.on(EVENT_NAMES.REQUEST_SELECTED, syncConversationOwner);
    events.on(EVENT_NAMES.REPEATER_CONTEXT_ACTIVATED, context => {
        recordResponseObservation(context);
        syncConversationOwner();
    });
    events.on(EVENT_NAMES.REPEATER_CONTEXT_INVALIDATED, invalidation => {
        if (activeChat?.snapshot?.sourceId === invalidation?.sourceId) {
            cancelActiveChat(activeChat.owner);
        }
        removeResponseObservation(invalidation);
        syncConversationOwner();
        if (invalidation?.ownerRequest === lastSelectedRequest) {
            loadChatHistoryForRequest(lastSelectedRequest);
            renderChatHistory();
        }
    });

    events.on(EVENT_NAMES.REQUESTS_REMOVED, removedRequests => {
        (removedRequests || []).forEach(request => {
            cancelActiveChat(request);
            chatHistoryByRequest.delete(request);
            responseObservationsByOwner.delete(request);
            resetOpenCodeConversation(request).catch(error => {
                console.warn('Failed to delete OpenCode session for removed request:', error);
            });
            invalidateRepeaterOwner(request);
        });
        referencedRequests.clear();
        syncConversationOwner();
        updateReferenceUI();
    });

    events.on(EVENT_NAMES.STATE_REQUESTS_CLEARED, () => {
        cancelActiveChat();
        chatHistoryByRequest.clear();
        responseObservationsByOwner.clear();
        clearRepeaterContext();
        chatHistory = [];
        lastSelectedRequest = null;
        lastSelectedRequestIndex = -1;
        renderChatHistory();
        updateRequestBadge();
        resetAllOpenCodeConversations().catch(error => {
            console.warn('Failed to clear OpenCode sessions:', error);
        });
    });

    if (activePagehideHandler) window.removeEventListener('pagehide', activePagehideHandler);
    activePagehideHandler = () => {
        cancelActiveChat();
        chatHistoryByRequest.clear();
        responseObservationsByOwner.clear();
        referencedRequests.clear();
        clearRepeaterContext();
        if (scrollFrameId !== null) {
            cancelFrame(scrollFrameId);
            scrollFrameId = null;
            pendingScrollRequest = null;
        }
        resetAllOpenCodeConversations().catch(() => {});
    };
    window.addEventListener('pagehide', activePagehideHandler);

    const initialContext = getActiveRepeaterContext();
    if (initialContext) recordResponseObservation(initialContext);
    lastSelectedRequest = getConversationOwner();
    lastSelectedRequestIndex = state.requests.indexOf(lastSelectedRequest);
    loadChatHistoryForRequest(lastSelectedRequest);
    
    // Initial badge update
    updateRequestBadge();
    
    // Initial reference UI update
    updateReferenceUI();
    
    function addUserMessage(text, { forceScroll = false, scroll = true } = {}) {
        if (!chatMessages) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message chat-message-user';
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        if (scroll) scheduleScrollToLatest({ force: forceScroll });
    }

    function renderChatHistory({ emptyMessage = 'How can I help you with this request?' } = {}) {
        if (!chatMessages) return;
        renderGeneration += 1;
        followLatest = true;
        chatMessages.innerHTML = '';

        if (!getConversationOwner()) {
            addSystemMessage('Select a request to start chatting. I can help you understand, modify, or debug HTTP requests and responses.', { scroll: false });
            syncProcessingUI();
            scheduleScrollToLatest({ force: true });
            return;
        }
        if (chatHistory.length === 0) {
            addSystemMessage(emptyMessage, { scroll: false });
        } else {
            chatHistory.forEach(message => {
                if (message.role === 'user') addUserMessage(message.content, { scroll: false });
                else if (message.role === 'assistant') addAssistantMessage(message.content, message, { scroll: false });
                else addSystemMessage(message.content, { scroll: false });
            });
        }

        syncProcessingUI();
        scheduleScrollToLatest({ force: true });
    }
    
    // Parse LLM response for modification suggestions
    function parseModificationSuggestions(text) {
        const suggestions = [];
        
        if (!text || typeof text !== 'string') {
            return suggestions;
        }
        
        // Look for code blocks with HTTP requests
        // Match: ```http, ```request, ```, or just code blocks that contain HTTP requests
        const codeBlockRegex = /```(?:http|request|text|plain|bash|shell)?\n?([\s\S]*?)```/gi;
        let match;
        
        while ((match = codeBlockRegex.exec(text)) !== null) {
            let codeContent = match[1].trim();
            
            // Remove any leading/trailing whitespace and normalize line endings
            codeContent = codeContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            
            // Check if it looks like an HTTP request (starts with HTTP method)
            if (codeContent.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i)) {
                // Validate it has more than just the request line
                const lines = codeContent.split('\n').filter(l => l.trim());
                if (lines.length > 1) {
                    // Store the full content - make sure we have everything
                    const fullContent = codeContent;
                    
                    suggestions.push({
                        type: 'full_request',
                        content: fullContent, // Keep the full content including headers and body
                        description: 'Full request modification'
                    });
                    console.log('LLM Chat: Found full request in code block, lines:', lines.length, 'content length:', fullContent.length);
                    console.log('LLM Chat: Content preview (first 300 chars):', fullContent.substring(0, 300));
                    console.log('LLM Chat: Content preview (last 200 chars):', fullContent.substring(Math.max(0, fullContent.length - 200)));
                }
            }
        }
        
        // Also look for HTTP requests without code blocks (sometimes LLMs don't use them)
        // But only if we haven't found any in code blocks (to avoid duplicates)
        // Prefer code block suggestions as they're more reliable
        if (suggestions.length === 0) {
            // More flexible regex to catch HTTP requests in various formats
            const directRequestRegex = /(?:^|\n)(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+[^\s]+\s+HTTP\/[\d.]+/gim;
            let directMatch;
            while ((directMatch = directRequestRegex.exec(text)) !== null) {
                const startIndex = directMatch.index;
                
                // Find where this request ends - look for next code block start, blank line with text after, or end of text
                let endIndex = text.length;
                
                // Check for next code block
                const nextCodeBlock = text.indexOf('```', startIndex + 50);
                if (nextCodeBlock !== -1 && nextCodeBlock < endIndex) {
                    endIndex = nextCodeBlock;
                }
                
                // Check for double newline followed by text (likely end of request)
                const doubleNewline = text.indexOf('\n\n', startIndex + 50);
                if (doubleNewline !== -1 && doubleNewline < endIndex) {
                    // Make sure there's actual text after (not just whitespace)
                    const afterNewline = text.substring(doubleNewline + 2).trim();
                    if (afterNewline.length > 10 && !afterNewline.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i)) {
                        endIndex = doubleNewline;
                    }
                }
                
                // Extract the full request content
                let requestContent = text.substring(startIndex, endIndex).trim();
                
                // Clean up: remove trailing code block markers, explanations, etc.
                requestContent = requestContent.replace(/\n```\s*$/, '').trim();
                // Remove trailing explanations that start with common words
                requestContent = requestContent.replace(/\n(?:This|Here|The|Note|Important|Explanation|Change|Modification|Update)[:\.].*$/i, '').trim();
                
                // Normalize line endings
                requestContent = requestContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                
                // Validate it has more than just the request line and substantial content
                const lines = requestContent.split('\n').filter(l => l.trim());
                if (lines.length >= 2 && requestContent.length > 50) {
                    suggestions.push({
                        type: 'full_request',
                        content: requestContent,
                        description: 'Full request modification (direct)'
                    });
                    console.log('LLM Chat: Found direct request, lines:', lines.length, 'content length:', requestContent.length);
                    console.log('LLM Chat: Direct request preview:', requestContent.substring(0, 200));
                } else {
                    console.log('LLM Chat: Skipped incomplete direct request, lines:', lines.length, 'length:', requestContent.length);
                }
            }
        }
        
        // Look for structured modification blocks
        const modBlockRegex = /(?:modification|change|suggestion):\s*\{([\s\S]*?)\}/gi;
        while ((match = modBlockRegex.exec(text)) !== null) {
            try {
                const modData = JSON.parse(`{${match[1]}}`);
                suggestions.push({
                    type: 'structured',
                    data: modData
                });
            } catch (e) {
                // Not valid JSON, skip
            }
        }
        
        // Look for header modifications
        const headerRegex = /(?:add|set|update|change)\s+header[:\s]+([^\n:]+):\s*([^\n]+)/gi;
        while ((match = headerRegex.exec(text)) !== null) {
            suggestions.push({
                type: 'header',
                name: match[1].trim(),
                value: match[2].trim()
            });
        }
        
        // Look for body modifications
        const bodyRegex = /(?:set|update|change)\s+body[:\s]+([\s\S]+?)(?:\n\n|\n```|$)/i;
        const bodyMatch = bodyRegex.exec(text);
        if (bodyMatch) {
            suggestions.push({
                type: 'body',
                content: bodyMatch[1].trim()
            });
        }
        
        // Deduplicate and validate suggestions
        // Only keep ONE full_request suggestion (the best one)
        const validatedSuggestions = [];
        const seenContents = new Set();
        let bestFullRequest = null;
        let bestFullRequestScore = 0;
        
        for (const suggestion of suggestions) {
            if (suggestion.type === 'full_request') {
                // Validate the content has headers and body
                const lines = suggestion.content.split('\n').filter(l => l.trim());
                if (lines.length >= 2 && suggestion.content.length > 50) {
                    // Score: prefer longer content and code block suggestions
                    const score = lines.length * 10 + suggestion.content.length;
                    const isFromCodeBlock = suggestion.description === 'Full request modification';
                    const adjustedScore = isFromCodeBlock ? score * 2 : score;
                    
                    // Keep only the best one
                    if (!bestFullRequest || adjustedScore > bestFullRequestScore) {
                        bestFullRequest = suggestion;
                        bestFullRequestScore = adjustedScore;
                        console.log('LLM Chat: New best full request, lines:', lines.length, 'length:', suggestion.content.length, 'score:', adjustedScore);
                    }
                } else {
                    console.warn('LLM Chat: Rejected incomplete suggestion, lines:', lines.length, 'length:', suggestion.content.length);
                }
            } else {
                // For other types, deduplicate by type+name/content
                const key = `${suggestion.type}:${suggestion.name || suggestion.content || ''}`;
                if (!seenContents.has(key)) {
                    validatedSuggestions.push(suggestion);
                    seenContents.add(key);
                }
            }
        }
        
        // Add the best full request suggestion (only one)
        if (bestFullRequest) {
            validatedSuggestions.push(bestFullRequest);
            console.log('LLM Chat: Selected best full request suggestion');
        }
        
        console.log('LLM Chat: Validated suggestions:', validatedSuggestions.length, 'out of', suggestions.length);
        return validatedSuggestions;
    }
    
    // Safely apply request modifications
    function applyRequestModification(suggestion, turn) {
        console.log('LLM Chat: applyRequestModification called with:', suggestion);

        const owner = turn?.owner || getConversationOwner();
        const activeContext = getActiveRepeaterContext();
        const currentContent = elements.rawRequestInput?.innerText || elements.rawRequestInput?.textContent || '';
        const httpsInput = elements.useHttpsCheckbox || document.getElementById('use-https');
        const currentUseHttps = typeof httpsInput?.checked === 'boolean' ? httpsInput.checked : null;
        if (
            !owner || getConversationOwner() !== owner ||
            (turn?.snapshot && (
                !isRepeaterSnapshotValid(turn.snapshot) ||
                activeContext?.sourceId !== turn.snapshot.sourceId ||
                currentContent !== turn.snapshot.requestText ||
                (currentUseHttps !== null && currentUseHttps !== turn.snapshot.useHttps)
            ))
        ) {
            console.warn('LLM Chat: The request context for this action is no longer active');
            return false;
        }
        
        if (!elements.rawRequestInput) {
            console.warn('LLM Chat: rawRequestInput element not found');
            return false;
        }
        
        try {
            const currentContent = elements.rawRequestInput.innerText || elements.rawRequestInput.textContent;
            console.log('LLM Chat: Current content length:', currentContent.length);
            
            const lines = currentContent.split('\n');
            
            let newContent = '';
            let modified = false;
            
            if (suggestion.type === 'full_request') {
                // Replace entire request
                // Get the raw content - ensure it exists and is valid
                if (!suggestion.content || typeof suggestion.content !== 'string') {
                    console.error('LLM Chat: Suggestion content is invalid:', suggestion);
                    return false;
                }
                
                let rawContent = suggestion.content;
                console.log('LLM Chat: Raw suggestion content length:', rawContent.length);
                console.log('LLM Chat: Raw suggestion content preview:', rawContent.substring(0, 200));
                
                newContent = rawContent.trim();
                
                // Ensure proper line endings
                newContent = newContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                
                // Remove any trailing markdown code block markers
                newContent = newContent.replace(/\n```\s*$/, '').trim();
                
                // Validate the request has headers (at least one line after request line)
                const allLines = newContent.split('\n');
                const nonEmptyLines = allLines.filter(l => l.trim());
                
                if (nonEmptyLines.length < 2) {
                    console.error('LLM Chat: Invalid request - only has request line, missing headers/body');
                    console.error('LLM Chat: Processed content length:', newContent.length);
                    console.error('LLM Chat: Processed content:', newContent);
                    console.error('LLM Chat: Original suggestion content length:', rawContent.length);
                    console.error('LLM Chat: Original suggestion content:', rawContent);
                    console.error('LLM Chat: Full suggestion object:', JSON.stringify(suggestion, null, 2));
                    return false;
                }
                
                // Fix the request line: extract path from URL if needed
                // Format should be: METHOD PATH HTTP/VERSION (not METHOD FULL_URL HTTP/VERSION)
                const reqLine = allLines[0].trim();
                const reqLineParts = reqLine.split(/\s+/);
                
                if (reqLineParts.length >= 3) {
                    const method = reqLineParts[0];
                    const urlOrPath = reqLineParts[1];
                    const version = reqLineParts[2];
                    
                    // Check if the second part is a full URL (contains :// or starts with http)
                    let path = urlOrPath;
                    if (urlOrPath.includes('://') || urlOrPath.startsWith('http')) {
                        try {
                            const urlObj = new URL(urlOrPath);
                            path = urlObj.pathname + urlObj.search;
                            console.log('LLM Chat: Extracted path from URL:', path);
                        } catch (e) {
                            // If URL parsing fails, try to extract path manually
                            const pathMatch = urlOrPath.match(/\/\/[^\/]+(\/.*)/);
                            if (pathMatch) {
                                path = pathMatch[1];
                                console.log('LLM Chat: Extracted path manually:', path);
                            } else {
                                // If we can't parse it, just use the original
                                console.warn('LLM Chat: Could not extract path from URL, using as-is:', urlOrPath);
                            }
                        }
                    }
                    
                    // Reconstruct the request line with just the path
                    allLines[0] = `${method} ${path} ${version}`;
                    newContent = allLines.join('\n');
                    console.log('LLM Chat: Normalized request line:', allLines[0]);
                }
                
                // Log for debugging
                console.log('LLM Chat: Full request replacement successful');
                console.log('LLM Chat: Total lines:', allLines.length, 'Non-empty lines:', nonEmptyLines.length);
                console.log('LLM Chat: Content length:', newContent.length);
                console.log('LLM Chat: First 5 lines:', allLines.slice(0, 5));
                console.log('LLM Chat: Last 3 lines:', allLines.slice(-3));
                
                modified = true;
            } else if (suggestion.type === 'header') {
                // Modify or add header
                const headerLine = `${suggestion.name}: ${suggestion.value}`;
                let headerFound = false;
                let bodyStartIndex = -1;
                
                // Find body start
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '') {
                        bodyStartIndex = i;
                        break;
                    }
                }
                
                // Build new content
                newContent = lines[0] + '\n'; // Request line
                
                // Update or add header
                for (let i = 1; i < (bodyStartIndex > 0 ? bodyStartIndex : lines.length); i++) {
                    const line = lines[i];
                    if (line.trim() === '') continue;
                    
                    const colonIndex = line.indexOf(':');
                    if (colonIndex > 0) {
                        const headerName = line.substring(0, colonIndex).trim();
                        if (headerName.toLowerCase() === suggestion.name.toLowerCase()) {
                            newContent += headerLine + '\n';
                            headerFound = true;
                            modified = true;
                        } else {
                            newContent += line + '\n';
                        }
                    } else {
                        newContent += line + '\n';
                    }
                }
                
                // Add header if not found
                if (!headerFound) {
                    newContent += headerLine + '\n';
                    modified = true;
                }
                
                // Add body if exists
                if (bodyStartIndex > 0) {
                    newContent += '\n';
                    for (let i = bodyStartIndex + 1; i < lines.length; i++) {
                        newContent += lines[i] + (i < lines.length - 1 ? '\n' : '');
                    }
                }
            } else if (suggestion.type === 'body') {
                // Modify body
                let bodyStartIndex = -1;
                
                // Find body start
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '') {
                        bodyStartIndex = i;
                        break;
                    }
                }
                
                // Build new content - headers and request line
                for (let i = 0; i <= (bodyStartIndex > 0 ? bodyStartIndex : lines.length - 1); i++) {
                    newContent += lines[i];
                    if (i < (bodyStartIndex > 0 ? bodyStartIndex : lines.length - 1)) {
                        newContent += '\n';
                    }
                }
                
                // Add new body
                if (bodyStartIndex <= 0) {
                    newContent += '\n';
                }
                newContent += '\n' + suggestion.content;
                modified = true;
            }
            
            if (modified && newContent) {
                // Apply with animation
                applyRequestWithAnimation(newContent, owner);
                return true;
            }
        } catch (error) {
            console.error('Error applying request modification:', error);
            return false;
        }
        
        return false;
    }
    
    // Apply request modification with animation
    function applyRequestWithAnimation(newContent, owner) {
        console.log('LLM Chat: applyRequestWithAnimation called with content length:', newContent.length);
        
        if (!elements.rawRequestInput) {
            console.error('LLM Chat: rawRequestInput not found');
            return;
        }
        
        // Store original content for diff
        const originalContent = elements.rawRequestInput.innerText || elements.rawRequestInput.textContent;
        
        // Add highlight class for animation
        elements.rawRequestInput.classList.add('request-modifying');
        
        const httpsInput = elements.useHttpsCheckbox || document.getElementById('use-https');
        const useHttps = typeof httpsInput?.checked === 'boolean'
            ? httpsInput.checked
            : new URL(owner.request.url).protocol === 'https:';
        
        // Update content with highlighting
        const highlightedContent = highlightHTTP(newContent);
        elements.rawRequestInput.innerHTML = highlightedContent;
        console.log('LLM Chat: Updated rawRequestInput innerHTML');
        
        // Also sync with raw textarea if it exists
        const rawTextarea = document.getElementById('raw-request-textarea');
        if (rawTextarea) {
            rawTextarea.value = newContent;
            console.log('LLM Chat: Updated raw textarea');
        }
        
        // Add to history
        actions.history.add(newContent, useHttps);
        
        // Update undo stack
        if (!state.undoStack) {
            state.undoStack = [];
        }
        state.undoStack.push(newContent);
        state.redoStack = [];
        
        // Animate the change with magic effect
        setTimeout(() => {
            elements.rawRequestInput.classList.remove('request-modifying');
            elements.rawRequestInput.classList.add('request-modified');
            
            // Remove animation class after animation completes
            setTimeout(() => {
                elements.rawRequestInput.classList.remove('request-modified');
            }, 1500);
        }, 100);
        
        // Emit event for UI updates
        events.emit(EVENT_NAMES.UI_UPDATE_HISTORY_BUTTONS);
        
        console.log('LLM Chat: Request modification applied successfully');
    }
    
    /**
     * Prepare markdown text for parsing during streaming
     * Handles incomplete code blocks by temporarily closing them for proper rendering
     */
    function prepareMarkdownForStreaming(text) {
        if (!text) return text;
        
        // Count code block markers (```)
        const codeBlockMatches = text.match(/```/g);
        if (!codeBlockMatches) return text;
        
        const codeBlockCount = codeBlockMatches.length;
        
        // If odd number of ```, we have an unclosed code block
        if (codeBlockCount % 2 === 1) {
            // Find the last opening code block
            const lastBacktickIndex = text.lastIndexOf('```');
            const afterLastBacktick = text.substring(lastBacktickIndex + 3);
            
            // Check if there's no closing ``` after the last opening
            // This handles both cases:
            // 1. Code block just started: ```javascript (no content yet)
            // 2. Code block with content: ```javascript\nconst x = 1;
            if (!afterLastBacktick.includes('```')) {
                // Temporarily close the code block for rendering
                // This ensures the markdown parser recognizes it as a code block
                // Add a newline before closing if the content doesn't end with one
                const needsNewline = afterLastBacktick.length > 0 && !afterLastBacktick.endsWith('\n');
                return text + (needsNewline ? '\n' : '') + '```';
            }
        }
        
        return text;
    }

    /**
     * Add copy buttons to all code blocks in a container
     * Also applies syntax highlighting if highlight.js is available
     */
    function addCopyButtonsToCodeBlocks(container) {
        if (!container) return;
        
        // Find all pre elements (code blocks)
        const preElements = container.querySelectorAll('pre');
        
        preElements.forEach((preElement) => {
            // Skip if already has a copy button
            if (preElement.querySelector('.code-copy-btn')) {
                return;
            }
            
            // Get the code element (might be nested or direct)
            const codeElement = preElement.querySelector('code') || preElement;
            
            // Apply syntax highlighting if highlight.js is available and not already highlighted
            if (window.hljs && codeElement && !codeElement.classList.contains('hljs')) {
                // Check if there's a language class (from marked.js with langPrefix)
                const langMatch = codeElement.className.match(/language-(\w+)/);
                const lang = langMatch ? langMatch[1] : null;
                
                if (lang && window.hljs.getLanguage(lang)) {
                    try {
                        window.hljs.highlightElement(codeElement);
                    } catch (err) {
                        // Fallback to auto-detect
                        try {
                            window.hljs.highlightElement(codeElement);
                        } catch (e) {
                            console.warn('Highlight.js error:', e);
                        }
                    }
                } else {
                    // Auto-detect language
                    try {
                        window.hljs.highlightElement(codeElement);
                    } catch (e) {
                        console.warn('Highlight.js error:', e);
                    }
                }
            }
            
            // Get the code text
            const codeText = codeElement.textContent || codeElement.innerText;
            
            // Create copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.setAttribute('aria-label', 'Copy code');
            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1.5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 1.5h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            
            // Copy functionality
            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(codeText);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1.5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 1.5h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy code:', err);
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = codeText;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        copyBtn.classList.add('copied');
                        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                        setTimeout(() => {
                            copyBtn.classList.remove('copied');
                            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1.5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 1.5h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                        }, 2000);
                    } catch (fallbackErr) {
                        console.error('Fallback copy failed:', fallbackErr);
                    }
                    document.body.removeChild(textArea);
                }
            };
            
            // Make pre element relative for absolute positioning of button
            if (getComputedStyle(preElement).position === 'static') {
                preElement.style.position = 'relative';
            }
            preElement.appendChild(copyBtn);
        });
    }

    function renderBulkReplayAction(messageDiv, message) {
        if (!messageDiv) return;

        Array.from(messageDiv.children).forEach(child => {
            if (
                child.classList.contains('llm-chat-bulk-replay-card') ||
                child.classList.contains('llm-chat-bulk-replay-validation')
            ) {
                child.remove();
            }
        });

        const action = message?.bulkReplayAction;
        if (!action) return;

        if (action.status === 'invalid') {
            const validation = document.createElement('section');
            validation.className = 'llm-chat-bulk-replay-validation';
            validation.setAttribute('aria-label', 'Bulk Replay draft validation outcome');

            const heading = document.createElement('h4');
            heading.textContent = 'Bulk Replay draft is not executable';
            validation.appendChild(heading);

            const errors = document.createElement('ul');
            (action.errors.length > 0 ? action.errors : ['The draft did not satisfy the Bulk Replay action contract.'])
                .forEach(error => {
                    const item = document.createElement('li');
                    item.textContent = error;
                    errors.appendChild(item);
                });
            validation.appendChild(errors);
            messageDiv.appendChild(validation);
            return;
        }

        if (!['discarded', 'started'].includes(action.status) && !isRepeaterSnapshotValid(action.snapshot)) {
            action.status = 'expired';
        }

        const card = document.createElement('section');
        card.className = 'llm-chat-bulk-replay-card';
        card.setAttribute('aria-label', 'Bulk Replay draft');
        if (action.status === 'expired') card.classList.add('expired');

        const heading = document.createElement('h4');
        heading.textContent = 'Bulk Replay draft';
        card.appendChild(heading);

        const summary = document.createElement('dl');
        summary.className = 'llm-chat-bulk-replay-summary';
        [
            ['Source', action.snapshot.label],
            ['Target', action.snapshot.targetUrl],
            ['Mode', BULK_REPLAY_MODE_LABELS[action.draft.attackType] || action.draft.attackType],
            ['Projected requests', String(action.projectedRequestCount)]
        ].forEach(([label, value]) => {
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            summary.append(term, description);
        });
        card.appendChild(summary);

        const status = document.createElement('p');
        status.className = 'llm-chat-bulk-replay-status';
        status.setAttribute('role', 'status');
        if (action.reviewMessage) {
            status.textContent = action.reviewMessage;
        } else if (action.status === 'discarded') {
            status.textContent = 'Discarded. This draft can no longer be reviewed.';
        } else if (action.status === 'expired') {
            status.textContent = 'Expired. The source snapshot is no longer available.';
        } else if (action.status === 'reviewing') {
            status.textContent = 'Reviewing in Bulk Replay. Start Attack remains a separate confirmation.';
        } else if (action.status === 'started') {
            status.textContent = 'Started through the reviewed Bulk Replay configuration.';
        } else if (action.status === 'ready') {
            status.textContent = 'Non-executable draft. Review is required before any traffic can start.';
        } else {
            status.textContent = action.status;
        }
        card.appendChild(status);

        const buttons = document.createElement('div');
        buttons.className = 'llm-chat-bulk-replay-buttons';

        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'llm-chat-bulk-replay-review-btn';
        reviewButton.textContent = 'Review in Bulk Replay';
        reviewButton.disabled = action.status !== 'ready';
        reviewButton.addEventListener('click', () => {
            if (action.status !== 'ready') return;
            if (!isRepeaterSnapshotValid(action.snapshot)) {
                action.status = 'expired';
                renderBulkReplayAction(messageDiv, message);
                return;
            }

            const onStatus = nextStatus => {
                if (action.status === 'discarded' || typeof nextStatus !== 'string' || nextStatus === '') return;
                action.reviewMessage = '';
                action.status = ['discarded', 'started'].includes(nextStatus) || isRepeaterSnapshotValid(action.snapshot)
                    ? nextStatus
                    : 'expired';
                renderBulkReplayAction(messageDiv, message);
            };
            const handleReviewResult = outcome => {
                if (outcome?.accepted !== false || action.status === 'discarded') return;
                if (outcome.reason === 'expired') {
                    action.status = 'expired';
                    action.reviewMessage = 'Expired. The source snapshot is no longer available.';
                } else if (outcome.reason === 'active-run') {
                    action.reviewMessage = 'Another Bulk Replay is active. Stop it before reviewing this draft.';
                } else {
                    action.reviewMessage = outcome.errors?.join(' ') || 'This draft could not be opened for review.';
                }
                renderBulkReplayAction(messageDiv, message);
            };
            try {
                const result = bulkReplay?.reviewDraft?.({
                    snapshot: action.snapshot,
                    draft: action.draft,
                    projectedRequestCount: action.projectedRequestCount,
                    onStatus
                });
                Promise.resolve(result).then(handleReviewResult).catch(error => {
                    console.error('Bulk Replay draft review failed:', error);
                    action.reviewMessage = 'Bulk Replay review could not be opened.';
                    renderBulkReplayAction(messageDiv, message);
                });
            } catch (error) {
                console.error('Bulk Replay draft review failed:', error);
                action.reviewMessage = 'Bulk Replay review could not be opened.';
                renderBulkReplayAction(messageDiv, message);
            }
        });
        buttons.appendChild(reviewButton);

        const discardButton = document.createElement('button');
        discardButton.type = 'button';
        discardButton.className = 'llm-chat-bulk-replay-discard-btn';
        discardButton.textContent = 'Discard';
        discardButton.disabled = action.status === 'discarded' || action.status === 'started';
        discardButton.addEventListener('click', () => {
            bulkReplay?.discardReview?.({ snapshot: action.snapshot, draft: action.draft });
            action.status = 'discarded';
            renderBulkReplayAction(messageDiv, message);
        });
        buttons.appendChild(discardButton);

        card.appendChild(buttons);
        messageDiv.appendChild(card);
        scheduleScrollToLatest();
    }

    function addAssistantMessage(text, message = null, { forceScroll = false, scroll = true } = {}) {
        if (!chatMessages) return '';
        const messageDiv = document.createElement('div');
        const messageId = `chat-msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `chat-message chat-message-assistant${message?.isError ? ' error' : ''}`;

        if (message?.isError) {
            messageDiv.textContent = text;
        } else {
            const content = document.createElement('div');
            content.className = 'llm-chat-response-content';
            messageDiv.appendChild(content);
            renderAssistantContent(messageDiv, text, { final: true });
        }

        chatMessages.appendChild(messageDiv);
        if (!message?.isError) renderBulkReplayAction(messageDiv, message);
        if (scroll) scheduleScrollToLatest({ force: forceScroll });
        return messageId;
    }
    
    function addSystemMessage(text, { forceScroll = false, scroll = true } = {}) {
        if (!chatMessages) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message chat-message-system';
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        if (scroll) scheduleScrollToLatest({ force: forceScroll });
    }
    
    renderChatHistory();

    return {
        open: openChatPane,
        prompt(message, options) {
            openChatPane();
            return submitMessage(message, options);
        }
    };
}
