import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    elements: {},
    sendRequest: vi.fn(),
    saveEditorState: vi.fn()
}));

vi.mock('../js/ui/main-ui.js', () => ({ elements: mocks.elements }));
vi.mock('../js/network/request-sender.js', () => ({ sendRequest: mocks.sendRequest }));
vi.mock('../js/ui/request-editor.js', () => ({ saveEditorState: mocks.saveEditorState }));
vi.mock('../js/ui/json-view.js', () => ({
    generateJsonView: () => document.createTextNode('response')
}));

import { events } from '../js/core/events.js';
import { state } from '../js/core/state.js';
import {
    clearRepeaterContext,
    getActiveRepeaterContext
} from '../js/features/repeater-context.js';
import { handleSendRequest } from '../js/network/handler.js';

describe('request handler Repeater context', () => {
    let ownerRequest;

    beforeEach(() => {
        events.removeAllListeners();
        clearRepeaterContext();
        mocks.sendRequest.mockReset();
        mocks.saveEditorState.mockReset();

        const rawRequestInput = document.createElement('div');
        Object.defineProperty(rawRequestInput, 'innerText', {
            configurable: true,
            value: 'POST /edited HTTP/1.1\nHost: example.test\n\nbody  '
        });
        Object.assign(mocks.elements, {
            rawRequestInput,
            useHttpsCheckbox: Object.assign(document.createElement('input'), { checked: true }),
            resStatus: document.createElement('span'),
            resTime: document.createElement('span'),
            resSize: document.createElement('span'),
            diffToggle: document.createElement('div'),
            showDiffCheckbox: Object.assign(document.createElement('input'), { checked: false }),
            rawResponseDisplay: document.createElement('div'),
            rawResponseText: document.createElement('pre'),
            hexResponseDisplay: document.createElement('pre'),
            jsonResponseDisplay: document.createElement('div')
        });

        ownerRequest = {
            request: {
                method: 'POST',
                url: 'https://example.test/edited',
                headers: []
            }
        };
        state.requests = [ownerRequest];
        state.selectedRequest = ownerRequest;
        state.requestHistory = [];
        state.historyIndex = -1;
        state.currentResponse = null;
        state.regularRequestBaseline = null;
    });

    it('activates and persists the exact successful resend response', async () => {
        mocks.sendRequest.mockResolvedValue({
            duration: 12,
            size: 8,
            status: 201,
            statusText: 'Created',
            headers: new Headers([['x-exact', 'two spaces  ']]),
            body: 'response body  '
        });
        const contextsAtSave = [];
        mocks.saveEditorState.mockImplementation(() => {
            contextsAtSave.push(getActiveRepeaterContext());
        });

        await handleSendRequest();

        const active = getActiveRepeaterContext();
        expect(active).toMatchObject({
            ownerRequest,
            kind: 'resend',
            label: 'Resend: POST /edited'
        });
        expect(active.responseText).toBe(state.currentResponse);
        expect(active.responseText).toContain('response body  ');
        expect(contextsAtSave.at(-1)).toBe(active);
    });

    it('activates and persists the exact raw error representation shown', async () => {
        const error = new Error('exact failure');
        error.stack = 'exact stack';
        mocks.sendRequest.mockRejectedValue(error);
        const contextsAtSave = [];
        mocks.saveEditorState.mockImplementation(() => {
            contextsAtSave.push(getActiveRepeaterContext());
        });

        await handleSendRequest();

        const expected = 'Error: exact failure\n\nStack: exact stack';
        const active = getActiveRepeaterContext();
        expect(mocks.elements.rawResponseDisplay.textContent).toBe(expected);
        expect(state.currentResponse).toBe(expected);
        expect(active).toMatchObject({
            ownerRequest,
            kind: 'resend',
            label: 'Failed resend: POST /edited',
            responseText: expected
        });
        expect(contextsAtSave.at(-1)).toBe(active);
    });

    it('does not let a late resend overwrite a newly selected owner', async () => {
        let resolveRequest;
        mocks.sendRequest.mockReturnValue(new Promise(resolve => {
            resolveRequest = resolve;
        }));
        const originalOwner = ownerRequest;
        const sendPromise = handleSendRequest();
        const otherOwner = {
            request: { method: 'GET', url: 'https://other.test/current', headers: [] }
        };
        state.requests.push(otherOwner);
        state.selectedRequest = otherOwner;
        Object.defineProperty(mocks.elements.rawRequestInput, 'innerText', {
            configurable: true,
            value: 'GET /current HTTP/1.1\nHost: other.test'
        });
        const { activateRepeaterContext } = await import('../js/features/repeater-context.js');
        const currentContext = activateRepeaterContext({
            ownerRequest: otherOwner,
            kind: 'captured',
            label: 'Other request',
            responseText: null
        });

        resolveRequest({
            duration: 4,
            size: 4,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            body: 'late'
        });
        await sendPromise;

        expect(getActiveRepeaterContext()).toBe(currentContext);
        expect(getActiveRepeaterContext().ownerRequest).not.toBe(originalOwner);
        expect(state.currentResponse).toBeNull();
        expect(mocks.elements.rawResponseDisplay.textContent).not.toContain('late');
    });
});
