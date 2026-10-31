const DEFAULT_BASE_URL = 'http://127.0.0.1:4096';
const DEFAULT_USERNAME = 'opencode';
const REQUEST_TIMEOUT_MS = 15000;
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

let sharedPort = null;
const requestListeners = new Map();
const conversationSessions = new Map();

export function normalizeOpenCodeBaseUrl(value = DEFAULT_BASE_URL) {
    let url;
    try {
        url = new URL(value || DEFAULT_BASE_URL);
    } catch (error) {
        throw new Error('Enter a valid OpenCode server URL.');
    }

    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('OpenCode URL must use localhost or 127.0.0.1.');
    }
    if (url.username || url.password) {
        throw new Error('Put credentials in the OpenCode username and password fields, not the URL.');
    }
    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error('OpenCode URL must contain only the server origin, without a path, query, or hash.');
    }

    return url.origin;
}

export function getOpenCodePermissionPattern(baseUrl) {
    const url = new URL(normalizeOpenCodeBaseUrl(baseUrl));
    return `${url.protocol}//${url.hostname}/*`;
}

export function parseOpenCodeModel(value) {
    const separator = value.indexOf('/');
    if (separator <= 0 || separator === value.length - 1) {
        throw new Error('Select a valid OpenCode provider and model.');
    }
    return {
        providerID: value.slice(0, separator),
        modelID: value.slice(separator + 1)
    };
}

export function flattenOpenCodeModels(data, providerList = null) {
    if (Array.isArray(data?.data)) {
        // OpenCode 2.x: GET /api/model lists every usable model; /api/provider supplies display names.
        const providerNames = new Map(
            (Array.isArray(providerList?.data) ? providerList.data : []).map(provider => [provider.id, provider.name])
        );
        return data.data
            .filter(model => model?.providerID && (model.id || model.modelID) && (!model.type || model.type === 'chat'))
            .map(model => {
                const modelId = model.id || model.modelID;
                return {
                    id: `${model.providerID}/${modelId}`,
                    label: `${providerNames.get(model.providerID) || model.providerID} - ${model.name || modelId}`
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    const hasConnectedList = Array.isArray(data?.connected);
    const connected = new Set(Array.isArray(data?.connected) ? data.connected : []);
    const providers = Array.isArray(data?.all)
        ? data.all
        : (Array.isArray(data?.providers) ? data.providers : []);

    return providers
        .filter(provider => !hasConnectedList || connected.has(provider.id))
        .flatMap(provider => Object.values(provider.models || {}).map(model => ({
            id: `${provider.id}/${model.id}`,
            label: `${provider.name || provider.id} - ${model.name || model.id}`
        })))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function createSSEParser(onEvent) {
    let buffer = '';

    return {
        feed(chunk) {
            buffer += chunk || '';
            let boundary = buffer.match(/\r?\n\r?\n/);

            while (boundary && boundary.index !== undefined) {
                const block = buffer.slice(0, boundary.index);
                buffer = buffer.slice(boundary.index + boundary[0].length);
                const data = block
                    .split(/\r?\n/)
                    .filter(line => line.startsWith('data:'))
                    .map(line => line.slice(5).trimStart())
                    .join('\n');

                if (data && data !== '[DONE]') {
                    try {
                        onEvent(JSON.parse(data));
                    } catch (error) {
                        throw new Error(`OpenCode returned an invalid event: ${error.message}`);
                    }
                }
                boundary = buffer.match(/\r?\n\r?\n/);
            }
        }
    };
}

function getPort() {
    if (sharedPort) return sharedPort;

    sharedPort = chrome.runtime.connect({ name: 'poor-mans-suite-panel' });
    sharedPort.onMessage.addListener(message => {
        if (!message.type?.startsWith('opencode-') || !message.requestId) return;
        requestListeners.get(message.requestId)?.(message);
    });
    sharedPort.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'Connection to the background worker was lost.';
        sharedPort = null;
        requestListeners.forEach(listener => listener({ type: 'opencode-error', error }));
        requestListeners.clear();
        conversationSessions.forEach(entry => {
            entry.activeCancel = null;
            entry.needsValidation = true;
        });
    });
    return sharedPort;
}

function getConnection(settings) {
    return {
        baseUrl: normalizeOpenCodeBaseUrl(settings.baseUrl || settings.apiKey),
        username: settings.username || DEFAULT_USERNAME,
        password: settings.password || ''
    };
}

function connectionFingerprint(connection) {
    return `${connection.baseUrl}\n${connection.username}\n${connection.password}`;
}

// OpenCode 2.x serves its web UI at / and the HTTP API under /api; 1.x served the API at /.
const apiDetections = new Map();

export function clearOpenCodeApiCache() {
    apiDetections.clear();
}

function looksLikeHtml(body) {
    return /^\s*</.test(body || '');
}

async function probeOpenCodeApi(settings) {
    try {
        const info = await requestOpenCode(settings, '/api/info');
        if (info?.version) return { version: 'v2', server: info };
    } catch (error) {
        if (error.status === 401) throw error;
    }

    const health = await requestOpenCode(settings, '/global/health');
    if (!health?.healthy) throw new Error('OpenCode server reported that it is unhealthy.');
    return { version: 'v1', server: health };
}

function detectOpenCodeApi(settings) {
    const fingerprint = connectionFingerprint(getConnection(settings));
    let detection = apiDetections.get(fingerprint);
    if (!detection) {
        detection = probeOpenCodeApi(settings);
        apiDetections.set(fingerprint, detection);
        detection.catch(() => {
            if (apiDetections.get(fingerprint) === detection) apiDetections.delete(fingerprint);
        });
    }
    return detection;
}

function sessionEndpoints(apiVersion, sessionId) {
    const id = encodeURIComponent(sessionId);
    if (apiVersion === 'v2') {
        return {
            events: '/api/event',
            session: `/api/session/${id}`,
            abort: `/api/session/${id}/interrupt`,
            model: `/api/session/${id}/model`,
            prompt: `/api/session/${id}/prompt`,
            permissionReply: requestId => `/api/session/${id}/permission/${encodeURIComponent(requestId)}/reply`
        };
    }
    return {
        events: '/event',
        session: `/session/${id}`,
        abort: `/session/${id}/abort`,
        prompt: `/session/${id}/prompt_async`,
        permissionReply: requestId => `/permission/${encodeURIComponent(requestId)}/reply`
    };
}

function nextRequestId() {
    return `opencode-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cancelRequest(requestId) {
    try {
        getPort().postMessage({ type: 'opencode-cancel', requestId });
    } catch (error) {
        // The port may already be disconnected.
    }
}

function requestOpenCode(settings, path, options = {}) {
    const requestId = nextRequestId();
    const connection = getConnection(settings);
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            requestListeners.delete(requestId);
            cancelRequest(requestId);
            reject(new Error('OpenCode request timed out.'));
        }, timeoutMs);

        requestListeners.set(requestId, message => {
            if (message.requestId && message.requestId !== requestId) return;
            if (message.type === 'opencode-response') {
                clearTimeout(timer);
                requestListeners.delete(requestId);
                if (!message.body) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(JSON.parse(message.body));
                } catch (error) {
                    reject(new Error(looksLikeHtml(message.body)
                        ? 'OpenCode returned a web page instead of JSON. Make sure the server URL points at a server started with `opencode serve`.'
                        : `OpenCode returned invalid JSON: ${error.message}`));
                }
            } else if (message.type === 'opencode-error') {
                clearTimeout(timer);
                requestListeners.delete(requestId);
                const error = new Error(message.error || 'OpenCode request failed.');
                if (message.status) error.status = message.status;
                reject(error);
            }
        });

        getPort().postMessage({
            type: 'opencode-request',
            requestId,
            ...connection,
            path,
            method: options.method || 'GET',
            body: options.body
        });
    });
}

function openOpenCodeEventStream(settings, eventsPath, onChunk) {
    const requestId = nextRequestId();
    const connection = getConnection(settings);
    let readySettled = false;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
    });
    done.catch(() => {});

    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            requestListeners.delete(requestId);
            cancelRequest(requestId);
            reject(new Error('Timed out while connecting to the OpenCode event stream.'));
            rejectDone(new Error('Timed out while connecting to the OpenCode event stream.'));
        }, REQUEST_TIMEOUT_MS);

        requestListeners.set(requestId, message => {
            if (message.requestId && message.requestId !== requestId) return;
            if (message.type === 'opencode-stream-start') {
                clearTimeout(timer);
                readySettled = true;
                resolve({
                    done,
                    cancel() {
                        requestListeners.delete(requestId);
                        cancelRequest(requestId);
                        resolveDone();
                    }
                });
            } else if (message.type === 'opencode-stream-chunk') {
                try {
                    onChunk(message.chunk || '');
                } catch (error) {
                    requestListeners.delete(requestId);
                    cancelRequest(requestId);
                    rejectDone(error);
                }
            } else if (message.type === 'opencode-stream-done') {
                requestListeners.delete(requestId);
                resolveDone();
            } else if (message.type === 'opencode-error') {
                clearTimeout(timer);
                requestListeners.delete(requestId);
                const error = new Error(message.error || 'OpenCode event stream failed.');
                if (!readySettled) reject(error);
                rejectDone(error);
            }
        });

        getPort().postMessage({
            type: 'opencode-request',
            requestId,
            ...connection,
            path: eventsPath,
            method: 'GET',
            stream: true
        });
    });

    return ready;
}

function trackSession(settings, sessionId, apiVersion) {
    getPort().postMessage({
        type: 'opencode-track-session',
        requestId: nextRequestId(),
        sessionId,
        apiVersion,
        ...getConnection(settings)
    });
}

function untrackSession(sessionId) {
    try {
        getPort().postMessage({ type: 'opencode-untrack-session', sessionId });
    } catch (error) {
        // Disconnect cleanup will retry tracked sessions.
    }
}

async function createSession(settings, title) {
    const api = await detectOpenCodeApi(settings);
    const sessionTitle = title || "Poor Man's Suite investigation";
    let session;
    if (api.version === 'v2') {
        const response = await requestOpenCode(settings, '/api/session', {
            method: 'POST',
            body: {
                title: sessionTitle,
                permissions: [{ action: '*', resource: '*', effect: 'deny' }]
            }
        });
        session = response?.data;
    } else {
        session = await requestOpenCode(settings, '/session', {
            method: 'POST',
            body: {
                title: sessionTitle,
                permission: [{ permission: '*', pattern: '*', action: 'deny' }]
            }
        });
    }
    if (!session?.id) throw new Error('OpenCode did not return a session ID.');
    trackSession(settings, session.id, api.version);
    return session.id;
}

async function deleteSession(settings, sessionId) {
    await abortSession(settings, sessionId);

    const api = await detectOpenCodeApi(settings);
    await requestOpenCode(settings, sessionEndpoints(api.version, sessionId).session, {
        method: 'DELETE'
    });
    untrackSession(sessionId);
}

async function abortSession(settings, sessionId) {
    try {
        const api = await detectOpenCodeApi(settings);
        await requestOpenCode(settings, sessionEndpoints(api.version, sessionId).abort, {
            method: 'POST'
        });
    } catch (error) {
        // The session may already be idle or the connection may have closed.
    }
}

async function denyPermission(settings, api, sessionId, permissionId) {
    try {
        await requestOpenCode(settings, sessionEndpoints(api.version, sessionId).permissionReply(permissionId), {
            method: 'POST',
            body: api.version === 'v2' ? { decision: 'reject' } : { reply: 'reject' }
        });
    } catch (error) {
        // The prompt is rejected regardless; this is best-effort cleanup.
    }
}

function composePrompt(systemPrompt, userPrompt) {
    // OpenCode 2.x has no per-prompt system field, so the instructions ride along with the request.
    if (!systemPrompt) return userPrompt;
    return `${systemPrompt}\n\n---\n\n${userPrompt}`;
}

async function runPrompt(settings, sessionId, model, systemPrompt, userPrompt, onUpdate, entry) {
    const api = await detectOpenCodeApi(settings);
    const endpoints = sessionEndpoints(api.version, sessionId);
    const textParts = new Map();
    const assistantMessageIds = new Set();
    const pendingParts = new Map();
    let promptSent = false;
    let settled = false;
    let resolveResult;
    let rejectResult;

    const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    result.catch(() => {});
    let promptRunning = false;

    const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) {
            rejectResult(error);
            return;
        }
        const text = Array.from(textParts.values()).join('');
        if (!text) {
            rejectResult(new Error('OpenCode completed without returning text.'));
            return;
        }
        resolveResult(text);
    };

    const emitText = () => onUpdate(Array.from(textParts.values()).join(''));

    const acceptPart = part => {
        if (part.type !== 'text' || !assistantMessageIds.has(part.messageID)) return;
        textParts.set(part.id, part.text || '');
        emitText();
    };

    const rejectPermission = (permissionId, permissionName) => {
        denyPermission(settings, api, sessionId, permissionId);
        finish(new Error(`OpenCode unexpectedly requested the "${permissionName}" permission. The request was blocked.`));
    };

    const handleV2Event = event => {
        const data = event.data;
        if (data?.sessionID !== sessionId) return;
        const textKey = `${data.assistantMessageID}:${data.ordinal}`;

        switch (event.type) {
            case 'session.execution.started':
                if (promptSent) promptRunning = true;
                break;
            case 'session.text.started':
                if (promptRunning && !textParts.has(textKey)) textParts.set(textKey, '');
                break;
            case 'session.text.delta':
                if (!promptRunning) break;
                textParts.set(textKey, `${textParts.get(textKey) || ''}${data.delta || ''}`);
                emitText();
                break;
            case 'session.text.ended':
                if (!promptRunning || typeof data.text !== 'string') break;
                textParts.set(textKey, data.text);
                emitText();
                break;
            case 'session.execution.succeeded':
                if (promptRunning) finish();
                break;
            case 'session.execution.failed':
                finish(new Error(data.error?.message || 'OpenCode model request failed.'));
                break;
            case 'session.execution.interrupted':
                finish(new Error('OpenCode interrupted the prompt.'));
                break;
            case 'permission.asked':
                rejectPermission(data.id, data.action);
                break;
            default:
                break;
        }
    };

    const handleV1Event = event => {
        if (event.type === 'message.updated') {
            const info = event.properties?.info;
            if (info?.sessionID !== sessionId || info.role !== 'assistant' || info.summary === true) return;
            if (info.error) {
                finish(new Error(info.error.data?.message || 'OpenCode model request failed.'));
                return;
            }
            assistantMessageIds.add(info.id);
            pendingParts.forEach((part, partId) => {
                if (part.messageID === info.id) {
                    acceptPart(part);
                    pendingParts.delete(partId);
                }
            });
        } else if (event.type === 'message.part.updated') {
            const part = event.properties?.part;
            if (part?.sessionID !== sessionId || part.type !== 'text') return;
            if (assistantMessageIds.has(part.messageID)) acceptPart(part);
            else pendingParts.set(part.id, part);
        } else if (event.type === 'message.part.delta') {
            const delta = event.properties;
            if (delta?.sessionID === sessionId && delta.field === 'text' && textParts.has(delta.partID)) {
                textParts.set(delta.partID, `${textParts.get(delta.partID)}${delta.delta || ''}`);
                onUpdate(Array.from(textParts.values()).join(''));
            }
        } else if (event.type === 'permission.asked') {
            const permission = event.properties;
            if (permission?.sessionID !== sessionId) return;
            rejectPermission(permission.id, permission.permission);
        } else if (event.type === 'session.error' && event.properties?.sessionID === sessionId) {
            finish(new Error(event.properties.error?.data?.message || 'OpenCode session failed.'));
        } else if (event.type === 'session.idle' && event.properties?.sessionID === sessionId && promptRunning) {
            finish();
        } else if (
            event.type === 'session.status' &&
            event.properties?.sessionID === sessionId &&
            event.properties.status?.type === 'busy' &&
            promptSent
        ) {
            promptRunning = true;
        } else if (
            event.type === 'session.status' &&
            event.properties?.sessionID === sessionId &&
            event.properties.status?.type === 'idle' &&
            promptRunning
        ) {
            finish();
        }
    };

    const parser = createSSEParser(api.version === 'v2' ? handleV2Event : handleV1Event);

    const stream = await openOpenCodeEventStream(settings, endpoints.events, chunk => parser.feed(chunk));
    entry.activeCancel = () => {
        finish(new Error('OpenCode request was cancelled.'));
        stream.cancel();
    };
    stream.done.then(
        () => finish(new Error('OpenCode closed the event stream before the prompt completed.')),
        error => finish(error)
    );
    try {
        const selectedModel = parseOpenCodeModel(model);
        if (api.version === 'v2') {
            await requestOpenCode(settings, endpoints.model, {
                method: 'POST',
                body: { model: { providerID: selectedModel.providerID, id: selectedModel.modelID } }
            });
            promptSent = true;
            await requestOpenCode(settings, endpoints.prompt, {
                method: 'POST',
                timeoutMs: REQUEST_TIMEOUT_MS,
                body: { text: composePrompt(systemPrompt, userPrompt) }
            });
        } else {
            promptSent = true;
            await requestOpenCode(settings, endpoints.prompt, {
                method: 'POST',
                timeoutMs: REQUEST_TIMEOUT_MS,
                body: {
                    model: selectedModel,
                    system: systemPrompt,
                    tools: { '*': false },
                    parts: [{ type: 'text', text: userPrompt }]
                }
            });
        }

        const timeout = setTimeout(() => finish(new Error('OpenCode prompt timed out.')), PROMPT_TIMEOUT_MS);
        try {
            return await result;
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        await abortSession(settings, sessionId);
        throw error;
    } finally {
        stream.cancel();
        entry.activeCancel = null;
    }
}

function throwIfCancelled(signal) {
    if (signal?.aborted) throw new Error('OpenCode request was cancelled.');
}

async function getConversationSession(settings, conversationKey, title, signal) {
    throwIfCancelled(signal);
    const connection = getConnection(settings);
    const fingerprint = connectionFingerprint(connection);
    let existing = conversationSessions.get(conversationKey);

    if (existing && existing.fingerprint === fingerprint && existing.sessionId) {
        if (existing.needsValidation) {
            try {
                await deleteSession(existing.settings, existing.sessionId);
            } catch (error) {
                // Disconnect cleanup may already have deleted the session.
            }
            throwIfCancelled(signal);
            if (existing.cancelled || conversationSessions.get(conversationKey) !== existing) {
                throw new Error('OpenCode session validation was cancelled.');
            }
            conversationSessions.delete(conversationKey);
            existing = null;
        }
        if (existing) {
            trackSession(existing.settings, existing.sessionId);
            return { entry: existing, isNew: false };
        }
    }
    if (existing) {
        await resetOpenCodeConversation(conversationKey);
        throwIfCancelled(signal);
    }

    const entry = {
        settings: { ...settings, ...connection },
        fingerprint,
        sessionId: null,
        activeCancel: null,
        needsValidation: false,
        cancelled: false
    };
    conversationSessions.set(conversationKey, entry);
    try {
        entry.sessionId = await createSession(settings, title);
        if (signal?.aborted || entry.cancelled || conversationSessions.get(conversationKey) !== entry) {
            await deleteSession(entry.settings, entry.sessionId);
            throw new Error('OpenCode session creation was cancelled.');
        }
        return { entry, isNew: true };
    } catch (error) {
        if (conversationSessions.get(conversationKey) === entry) {
            conversationSessions.delete(conversationKey);
        }
        throw error;
    }
}

export async function testOpenCodeConnection(settings) {
    // Always re-probe so a server upgraded or swapped behind the same URL is picked up.
    apiDetections.delete(connectionFingerprint(getConnection(settings)));
    const api = await detectOpenCodeApi(settings);
    return { healthy: true, version: api.server?.version, api: api.version };
}

export async function fetchOpenCodeModels(settings) {
    const api = await detectOpenCodeApi(settings);
    if (api.version === 'v2') {
        const [models, providers] = await Promise.all([
            requestOpenCode(settings, '/api/model'),
            requestOpenCode(settings, '/api/provider').catch(() => null)
        ]);
        return flattenOpenCodeModels(models, providers);
    }
    return flattenOpenCodeModels(await requestOpenCode(settings, '/config/providers'));
}

export async function streamFromOpenCode(settings, model, systemPrompt, userPrompt, onUpdate, options = {}) {
    const persistent = options.conversationKey !== undefined && options.conversationKey !== null;
    let session;
    if (persistent) {
        session = await getConversationSession(settings, options.conversationKey, options.sessionTitle, options.signal);
        if (!session.isNew && Array.isArray(options.messages) && session.entry.lastResponse !== undefined) {
            const previousMessage = options.messages.at(-2);
            if (previousMessage?.role !== 'assistant' || previousMessage.content !== session.entry.lastResponse) {
                await resetOpenCodeConversation(options.conversationKey);
                throwIfCancelled(options.signal);
                session = await getConversationSession(settings, options.conversationKey, options.sessionTitle, options.signal);
            }
        }
    } else {
        session = {
            entry: {
                settings,
                sessionId: await createSession(settings, options.sessionTitle),
                activeCancel: null,
                needsValidation: false
            },
            isNew: true
        };
    }
    const entry = session.entry;
    let prompt = userPrompt;

    if (persistent && session.isNew && Array.isArray(options.messages)) {
        const transcript = options.messages
            .filter(message => message.role !== 'system')
            .map(message => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`)
            .join('\n\n');
        if (transcript) prompt = `Continue this Poor Man's Suite investigation:\n\n${transcript}`;
    }

    try {
        const response = await runPrompt(settings, entry.sessionId, model, systemPrompt, prompt, onUpdate, entry);
        if (persistent) entry.lastResponse = response;
        return response;
    } catch (error) {
        if (persistent) entry.needsValidation = true;
        throw error;
    } finally {
        if (!persistent) {
            try {
                await deleteSession(settings, entry.sessionId);
            } catch (error) {
                console.warn('Failed to delete temporary OpenCode session:', error);
            }
        }
    }
}

export async function resetOpenCodeConversation(conversationKey) {
    const entry = conversationSessions.get(conversationKey);
    if (!entry) return;

    conversationSessions.delete(conversationKey);
    entry.cancelled = true;
    entry.activeCancel?.();
    if (!entry.sessionId) return;
    await deleteSession(entry.settings, entry.sessionId);
}

export async function resetAllOpenCodeConversations() {
    const keys = Array.from(conversationSessions.keys());
    await Promise.allSettled(keys.map(key => resetOpenCodeConversation(key)));
}
