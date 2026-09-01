import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiMocks = vi.hoisted(() => ({ elements: {} }));

vi.mock('../js/ui/main-ui.js', () => ({ elements: uiMocks.elements }));

import { events, EVENT_NAMES } from '../js/core/events.js';
import { state } from '../js/core/state.js';
import {
    activateRepeaterContext,
    clearRepeaterContext,
    getActiveRepeaterContext,
    invalidateRepeaterSource
} from '../js/features/repeater-context.js';
import { saveEditorState, selectRequest } from '../js/ui/request-editor.js';

function capturedRequest(url, responseBody, status = 200, statusText = 'OK') {
    const request = {
        request: {
            method: 'GET',
            url,
            httpVersion: 'HTTP/1.1',
            headers: []
        }
    };
    if (responseBody !== undefined) {
        Object.assign(request, {
            responseBody,
            responseStatus: status,
            responseStatusText: statusText,
            responseHeaders: []
        });
    }
    return request;
}

describe('request editor Repeater context', () => {
    beforeEach(() => {
        events.removeAllListeners();
        clearRepeaterContext();
        document.body.innerHTML = '';

        Object.assign(uiMocks.elements, {
            rawRequestInput: document.createElement('div'),
            rawRequestTextarea: document.createElement('textarea'),
            rawResponseDisplay: document.createElement('div'),
            rawResponseText: document.createElement('pre'),
            hexResponseDisplay: document.createElement('pre'),
            jsonResponseDisplay: document.createElement('div'),
            resStatus: document.createElement('span'),
            resTime: document.createElement('span'),
            resSize: document.createElement('span'),
            diffToggle: document.createElement('div'),
            useHttpsCheckbox: document.createElement('input')
        });

        events.on(EVENT_NAMES.UI_REQUEST_SELECTED, ({ rawText, useHttps }) => {
            uiMocks.elements.rawRequestInput.innerHTML = rawText;
            uiMocks.elements.useHttpsCheckbox.checked = useHttps;
        });
        events.on(EVENT_NAMES.UI_UPDATE_RESPONSE_VIEW, ({ status, content }) => {
            uiMocks.elements.resStatus.textContent = status;
            uiMocks.elements.rawResponseDisplay.textContent = content;
        });

        state.undoStack = [];
        state.redoStack = [];
        state.requestHistory = [];
        state.historyIndex = -1;
        state.currentResponse = null;
        state.regularRequestBaseline = null;
    });

    it('clears a previous response and activates no-response context after selection settles', () => {
        const withResponse = capturedRequest('https://first.example.test/one', 'first body');
        const withoutResponse = capturedRequest('https://second.example.test/two');
        state.requests = [withResponse, withoutResponse];

        selectRequest(0);
        expect(state.currentResponse).toContain('first body');

        const resentResponse = 'HTTP/1.1 202 Accepted\n\nresent body';
        state.currentResponse = resentResponse;
        uiMocks.elements.useHttpsCheckbox.checked = false;
        uiMocks.elements.resStatus.textContent = '202 Accepted';
        activateRepeaterContext({
            ownerRequest: withResponse,
            sourceId: 'saved-resend-source',
            kind: 'resend',
            label: 'Resend: GET /one',
            responseText: resentResponse
        });
        saveEditorState(0);

        selectRequest(1);

        expect(uiMocks.elements.rawRequestInput.textContent).toContain('GET /two HTTP/1.1');
        expect(state.currentResponse).toBeNull();
        expect(uiMocks.elements.rawResponseDisplay.textContent).toBe('');
        expect(getActiveRepeaterContext()).toMatchObject({
            ownerRequest: withoutResponse,
            kind: 'captured',
            label: 'Captured request #2',
            responseText: null
        });

        selectRequest(0);
        expect(state.currentResponse).toBe(resentResponse);
        expect(uiMocks.elements.useHttpsCheckbox.checked).toBe(false);
        expect(getActiveRepeaterContext()).toMatchObject({
            sourceId: 'saved-resend-source',
            ownerRequest: withResponse,
            kind: 'resend',
            label: 'Resend: GET /one',
            responseText: resentResponse
        });
    });

    it('does not restore a removed request state into the request that shifts into its index', () => {
        const removed = capturedRequest('https://first.example.test/removed', 'removed response');
        const retained = capturedRequest('https://second.example.test/retained');
        state.requests = [removed, retained];

        selectRequest(0);
        uiMocks.elements.rawRequestInput.textContent = 'GET /edited-removed HTTP/1.1\nHost: first.example.test';
        saveEditorState(0);
        state.requests.splice(0, 1);

        selectRequest(0);

        expect(uiMocks.elements.rawRequestInput.textContent).toContain('GET /retained HTTP/1.1');
        expect(uiMocks.elements.rawRequestInput.textContent).not.toContain('edited-removed');
        expect(state.currentResponse).toBeNull();
        expect(getActiveRepeaterContext().ownerRequest).toBe(retained);
    });

    it('saves a Bulk Replay result to its active owner instead of the stale sidebar owner', () => {
        const resultOwner = capturedRequest('https://owner.example.test/original');
        const sidebarOwner = capturedRequest('https://sidebar.example.test/sidebar');
        const nextOwner = capturedRequest('https://next.example.test/next');
        state.requests = [resultOwner, sidebarOwner, nextOwner];

        selectRequest(1);
        uiMocks.elements.rawRequestInput.textContent = 'GET /bulk-result HTTP/1.1\nHost: owner.example.test';
        activateRepeaterContext({
            ownerRequest: resultOwner,
            kind: 'bulk-result',
            label: 'Bulk Replay result #1',
            responseText: 'HTTP/1.1 200 OK\n\nresult'
        });

        selectRequest(2);
        selectRequest(1);

        expect(uiMocks.elements.rawRequestInput.textContent).toContain('GET /sidebar HTTP/1.1');
        expect(uiMocks.elements.rawRequestInput.textContent).not.toContain('/bulk-result');
        expect(getActiveRepeaterContext().ownerRequest).toBe(sidebarOwner);
    });

    it('does not restore editor state for an invalidated Bulk Replay result', () => {
        const resultOwner = capturedRequest('https://owner.example.test/original', 'captured response');
        const otherOwner = capturedRequest('https://other.example.test/other');
        state.requests = [resultOwner, otherOwner];

        selectRequest(0);
        uiMocks.elements.rawRequestInput.textContent = 'GET /bulk-result HTTP/1.1\nHost: owner.example.test';
        state.currentResponse = 'HTTP/1.1 200 OK\n\nbulk result';
        const resultContext = activateRepeaterContext({
            ownerRequest: resultOwner,
            sourceId: 'invalidated-editor-result',
            kind: 'bulk-result',
            label: 'Bulk Replay result #1',
            responseText: state.currentResponse
        });
        saveEditorState(0);

        invalidateRepeaterSource(resultContext.sourceId);
        selectRequest(1);
        selectRequest(0);

        expect(state.currentResponse).toContain('captured response');
        expect(state.currentResponse).not.toContain('bulk result');
        expect(getActiveRepeaterContext()).toMatchObject({
            ownerRequest: resultOwner,
            kind: 'captured'
        });
        expect(getActiveRepeaterContext().sourceId).not.toBe('invalidated-editor-result');
    });
});
