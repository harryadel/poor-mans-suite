// Request Handler Module - High-level orchestrator for sending requests
import { state, addToHistory } from '../core/state.js';
import { elements } from '../ui/main-ui.js';
import { events, EVENT_NAMES } from '../core/events.js';
import { parseRequest } from './capture.js';
import { sendRequest } from './request-sender.js';
import { formatRawResponse, getStatusClass } from './response-parser.js';
import { formatBytes } from '../core/utils/format.js';
import { renderDiff } from '../core/utils/misc.js';
import { highlightHTTP } from '../core/utils/network.js';
import { generateHexView } from '../ui/hex-view.js'
import { generateJsonView } from '../ui/json-view.js'
import { saveEditorState } from '../ui/request-editor.js';
import { activateRepeaterContext, getActiveRepeaterContext } from '../features/repeater-context.js';

function getResendLabel(rawContent, failed = false) {
    const [method = '', target = ''] = (rawContent.split(/\r?\n/, 1)[0] || '').split(/\s+/);
    const requestLabel = `${method} ${target}`.trim();
    return `${failed ? 'Failed resend' : 'Resend'}${requestLabel ? `: ${requestLabel}` : ''}`;
}

function saveResponseContext(ownerRequest, rawContent, responseText, failed = false) {
    state.currentResponse = responseText;
    if (!ownerRequest) return;

    activateRepeaterContext({
        ownerRequest,
        kind: 'resend',
        label: getResendLabel(rawContent, failed),
        responseText
    });

    if (state.selectedRequest === ownerRequest) {
        const requestIndex = state.requests.indexOf(ownerRequest);
        if (requestIndex !== -1) saveEditorState(requestIndex);
    }
}

function isSendContextStillVisible(ownerRequest, sourceId, rawContent, useHttps) {
    const activeContext = getActiveRepeaterContext();
    const activeOwner = activeContext?.ownerRequest || state.selectedRequest;
    const currentContent = elements.rawRequestInput?.innerText ?? elements.rawRequestInput?.textContent ?? '';
    const currentUseHttps = elements.useHttpsCheckbox?.checked;

    return activeOwner === ownerRequest &&
        (!sourceId || activeContext?.sourceId === sourceId) &&
        currentContent === rawContent &&
        (typeof currentUseHttps !== 'boolean' || currentUseHttps === useHttps);
}

export async function handleSendRequest() {
    const rawContent = elements.rawRequestInput.innerText;
    const useHttps = elements.useHttpsCheckbox.checked;
    const startingContext = getActiveRepeaterContext();
    const ownerRequest = startingContext?.ownerRequest || state.selectedRequest;
    const sourceId = startingContext?.sourceId || null;

    // Save editor state before sending (preserve modifications)
    if (ownerRequest) {
        const requestIndex = state.requests.indexOf(ownerRequest);
        if (requestIndex !== -1) {
            saveEditorState(requestIndex);
        }
    }

    // Add to history
    addToHistory(rawContent, useHttps);
    events.emit(EVENT_NAMES.UI_UPDATE_HISTORY_BUTTONS);

    try {
        const { url, options, method, filteredHeaders, bodyText } = parseRequest(rawContent, useHttps);

        elements.resStatus.textContent = 'Sending...';
        elements.resStatus.className = 'status-badge';

        console.log('Sending request to:', url);

        const result = await sendRequest(url, options);

        // Do not let a late resend overwrite panes that now belong to another
        // request, result, editor revision, or scheme.
        if (!isSendContextStillVisible(ownerRequest, sourceId, rawContent, useHttps)) return;

        elements.resTime.textContent = `${result.duration}ms`;
        elements.resSize.textContent = formatBytes(result.size);

        elements.resStatus.textContent = `${result.status} ${result.statusText}`;
        elements.resStatus.className = getStatusClass(result.status);

        // Format raw HTTP response
        const rawResponse = formatRawResponse(result);

        saveResponseContext(ownerRequest, rawContent, rawResponse);

        // Handle Diff Baseline
        if (!state.regularRequestBaseline) {
            state.regularRequestBaseline = rawResponse;
            elements.diffToggle.style.display = 'none';
        } else {
            elements.diffToggle.style.display = 'flex';
            if (elements.showDiffCheckbox && elements.showDiffCheckbox.checked) {
                elements.rawResponseDisplay.innerHTML = renderDiff(state.regularRequestBaseline, rawResponse);
            } else {
                elements.rawResponseDisplay.innerHTML = highlightHTTP(rawResponse);
            }
        }

        // If diff not enabled or first response
        if (!elements.showDiffCheckbox || !elements.showDiffCheckbox.checked || !state.regularRequestBaseline || state.regularRequestBaseline === rawResponse) {
            elements.rawResponseDisplay.innerHTML = highlightHTTP(rawResponse);
        }

        elements.rawResponseDisplay.style.display = 'block';
        elements.rawResponseDisplay.style.visibility = 'visible';

        // Update other tabs as well
        elements.rawResponseText.textContent = rawResponse;
        elements.hexResponseDisplay.textContent = generateHexView(rawResponse);
        elements.jsonResponseDisplay.innerHTML = '';
        elements.jsonResponseDisplay.appendChild(generateJsonView(rawResponse));

    } catch (err) {
        console.error('Request Failed:', err);
        if (!isSendContextStillVisible(ownerRequest, sourceId, rawContent, useHttps)) return;

        const rawError = `Error: ${err.message}\n\nStack: ${err.stack}`;
        showError(rawError);
        saveResponseContext(ownerRequest, rawContent, rawError, true);

        // Check for missing permissions if it's a fetch error
        if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
            chrome.permissions.contains({
                permissions: ['webRequest'],
                origins: ['<all_urls>']
            }, (hasPermissions) => {
                if (!isSendContextStillVisible(ownerRequest, sourceId, rawContent, useHttps)) return;

                if (!hasPermissions) {
                    elements.resStatus.textContent = 'Permission Required';
                    elements.resStatus.className = 'status-badge status-4xx';
                    elements.resTime.textContent = '0ms';

                    elements.rawResponseDisplay.innerHTML = `
                        <div style="padding: 20px; text-align: center;">
                            <h3 style="margin-top: 0;">Permission Required</h3>
                            <p>To replay requests to any domain, Poor Man's Suite needs the <code>&lt;all_urls&gt;</code> permission.</p>
                            <p>This permission is optional and only requested when you use this feature.</p>
                            <button id="grant-perm-btn" class="primary-btn" style="margin-top: 10px;">Grant Permission & Retry</button>
                        </div>
                    `;
                    elements.rawResponseDisplay.style.display = 'block';

                    document.getElementById('grant-perm-btn').addEventListener('click', () => {
                        chrome.permissions.request({
                            permissions: ['webRequest'],
                            origins: ['<all_urls>']
                        }, (granted) => {
                            if (granted) {
                                handleSendRequest();
                            } else {
                                elements.rawResponseDisplay.innerHTML += '<p style="color: var(--error-color); margin-top: 10px;">Permission denied.</p>';
                            }
                        });
                    });
                    return;
                }

                // If permissions exist but the request still failed, keep the raw error shown above.
            });
        }
    }
}

function showError(rawError) {
    elements.resStatus.textContent = 'Error';
    elements.resStatus.className = 'status-badge status-5xx';
    elements.resTime.textContent = '0ms';
    if (elements.resSize) elements.resSize.textContent = '';
    elements.rawResponseDisplay.textContent = rawError;
    elements.rawResponseDisplay.style.display = 'block';
    if (elements.rawResponseText) elements.rawResponseText.textContent = rawError;
    if (elements.hexResponseDisplay) elements.hexResponseDisplay.textContent = generateHexView(rawError);
    if (elements.jsonResponseDisplay) {
        elements.jsonResponseDisplay.replaceChildren(generateJsonView(rawError));
    }
}
