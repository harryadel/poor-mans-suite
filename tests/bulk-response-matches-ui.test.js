import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiMocks = vi.hoisted(() => ({
    elements: {}
}));

vi.mock('../js/ui/main-ui.js', () => ({
    elements: uiMocks.elements
}));

vi.mock('../js/network/permissions.js', () => ({
    requestReplayPermission: vi.fn().mockResolvedValue(true)
}));

import { state } from '../js/core/state.js';
import { setupBulkReplay } from '../js/features/bulk-replay/index.js';

function createResponse(body, status = 200, statusText = 'OK') {
    return {
        status,
        statusText,
        headers: new Headers(),
        text: vi.fn().mockResolvedValue(body)
    };
}

describe('Bulk Replay response-marker UI', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="bulk-replay-btn" disabled></button>
            <div id="bulk-config-modal"><button class="close-modal"></button></div>
            <button id="start-attack-btn"></button>
            <div id="bulk-replay-pane"></div>
            <table id="bulk-results-table"><tbody></tbody></table>
            <div id="bulk-progress-bar"></div>
            <span id="bulk-progress-text"></span>
            <span id="bulk-run-status" role="status" aria-live="polite"></span>
            <button id="bulk-stop-btn"></button>
            <button id="bulk-close-btn"></button>
            <div class="vertical-resize-handle"></div>
            <select id="attack-type"><option value="sniper">Sniper</option></select>
            <span id="attack-type-help"></span>
            <span id="payload-count"></span>
            <div id="positions-container"></div>
            <div id="battering-ram-config">
                <select class="payload-type-select"><option value="simple-list">Simple List</option></select>
                <div class="payload-options-simple-list"><textarea class="payload-list-input"></textarea></div>
                <div class="payload-options-numbers"></div>
            </div>
            <button id="add-response-matcher"></button>
            <div id="response-matchers"></div>
            <input id="response-match-case-sensitive" type="checkbox" checked>
            <input id="use-https" type="checkbox" checked>
            <div class="main-content"></div>
            <div id="context-menu"><button data-action="mark-payload"></button></div>
        `;

        const rawRequestInput = document.createElement('div');
        rawRequestInput.innerText = 'GET /login?username=§candidate§ HTTP/1.1\nHost: example.test\n\n';
        const rawResponseDisplay = document.createElement('div');

        Object.assign(uiMocks.elements, {
            rawRequestInput,
            rawResponseDisplay,
            diffToggle: document.createElement('div'),
            showDiffCheckbox: Object.assign(document.createElement('input'), { checked: false }),
            resStatus: document.createElement('span'),
            resTime: document.createElement('span'),
            resSize: document.createElement('span')
        });

        state.positionConfigs = [];
        state.bulkReplayTemplate = '';
        state.currentAttackType = 'sniper';
        state.responseMatchers = [];
        state.responseMatchCaseSensitive = true;
        state.shouldStopBulk = false;
        state.shouldPauseBulk = false;

        Element.prototype.scrollIntoView = vi.fn();
        globalThis.fetch = vi.fn().mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: vi.fn().mockResolvedValue('{"message":"Invalid username and password"}')
        });
    });

    function addResponseMatcher(text, mode = 'partial', isContinuationGuard = false) {
        document.getElementById('add-response-matcher').click();
        const rows = document.querySelectorAll('.response-matcher-row');
        const row = rows[rows.length - 1];
        const textInput = row.querySelector('.response-matcher-text');
        const modeSelect = row.querySelector('.response-matcher-mode');
        const guardInput = row.querySelector('.response-matcher-continuation-guard');
        textInput.value = text;
        textInput.dispatchEvent(new Event('input'));
        modeSelect.value = mode;
        modeSelect.dispatchEvent(new Event('change'));
        if (isContinuationGuard) guardInput.click();
        return row;
    }

    it('configures accessible continuation guards while new matchers remain display-only', () => {
        setupBulkReplay();

        const row = addResponseMatcher('Invalid username');
        const guard = row.querySelector('.response-matcher-continuation-guard');

        expect(guard.type).toBe('checkbox');
        expect(guard.checked).toBe(false);
        expect(guard.getAttribute('aria-label')).toContain('Invalid username');
        expect(state.responseMatchers).toEqual([{
            text: 'Invalid username',
            mode: 'partial',
            isContinuationGuard: false
        }]);

        guard.click();
        expect(state.responseMatchers[0].isContinuationGuard).toBe(true);
    });

    it('announces normal guarded completion and resets status for a new attack', async () => {
        setupBulkReplay();
        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice';
        addResponseMatcher('Invalid username', 'partial', true);

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent).toBe('Completed');
        });

        expect(document.getElementById('bulk-run-status').dataset.state).toBe('completed');
        expect(document.getElementById('bulk-progress-text').textContent).toBe('1/1');

        let resolveResponse;
        globalThis.fetch = vi.fn().mockImplementation(() => new Promise(resolve => {
            resolveResponse = resolve;
        }));
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent).toBe('Running');
        });
        expect(document.getElementById('bulk-progress-text').textContent).toBe('0/1');
        expect(document.querySelector('.is-continuation-terminal')).toBeNull();

        resolveResponse(createResponse('Invalid username'));
        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent).toBe('Completed');
        });
    });

    it('continues while any independent guard matches and retains the first mismatch', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(createResponse('Invalid username and password'))
            .mockResolvedValueOnce(createResponse('Try again'))
            .mockResolvedValueOnce(createResponse('Welcome back'));
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice\nbob\ncarol\ndave';
        addResponseMatcher('Invalid username', 'partial', true);
        addResponseMatcher('Invalid username and password');
        addResponseMatcher('Try again', 'partial', true);
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent)
                .toBe('Stopped at #3: no continuation guard matched');
        });

        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(3);
        expect(document.getElementById('bulk-progress-text').textContent).toBe('3/4');
        expect(document.querySelector('tr[data-sort-id="1"] .matches-cell').textContent)
            .toBe('Invalid username and password');
        expect(document.querySelector('.is-continuation-terminal')?.dataset.sortId).toBe('3');
        expect(document.querySelector('.is-continuation-terminal')?.dataset.terminationReason)
            .toBe('guard-mismatch');
        expect(state.shouldStopBulk).toBe(false);
        expect(state.shouldPauseBulk).toBe(false);
    });

    it('stops on an empty response when every continuation guard is nonempty', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(createResponse(''));
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice\nbob';
        addResponseMatcher('Invalid username', 'partial', true);
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent)
                .toBe('Stopped at #1: no continuation guard matched');
        });

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(document.getElementById('bulk-progress-text').textContent).toBe('1/2');
        expect(document.querySelector('.is-continuation-terminal')?.dataset.sortId).toBe('1');
    });

    it.each([
        [
            'fetch failure',
            () => vi.fn().mockRejectedValue(new Error('Network unavailable')),
            'Network unavailable'
        ],
        [
            'response-body failure',
            () => vi.fn().mockResolvedValue({
                ...createResponse(''),
                text: vi.fn().mockRejectedValue(new Error('Body unavailable'))
            }),
            'Body unavailable'
        ]
    ])('stops a guarded replay distinctly after a %s', async (_name, createFetch, errorMessage) => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        globalThis.fetch = createFetch();
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice\nbob';
        addResponseMatcher('Invalid username', 'partial', true);
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent)
                .toBe('Stopped at #1: continuation condition could not be checked');
        });

        const terminalRow = document.querySelector('.is-continuation-terminal');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(terminalRow.dataset.terminationReason).toBe('guard-check-failed');
        expect(terminalRow.querySelector('.status-cell').title).toBe(errorMessage);
        expect(terminalRow.querySelector('.response-match-badge-not-checked')?.textContent).toBe('Not checked');
        expect(document.getElementById('bulk-progress-text').textContent).toBe('1/2');

        terminalRow.click();
        expect(uiMocks.elements.rawResponseDisplay.textContent).toBe(errorMessage);
        consoleError.mockRestore();
    });

    it('stops a guarded replay after request parsing prevents matcher evaluation', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        uiMocks.elements.rawRequestInput.innerText = 'GET /login?username=§candidate§ HTTP/1.1\n\n';
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice\nbob';
        addResponseMatcher('Invalid username', 'partial', true);
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent)
                .toBe('Stopped at #1: continuation condition could not be checked');
        });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(document.querySelector('.is-continuation-terminal .status-cell').title)
            .toBe('Host header missing');
        expect(document.getElementById('bulk-progress-text').textContent).toBe('1/2');
        consoleError.mockRestore();
    });

    it('preserves existing continuation after an unguarded request error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        globalThis.fetch = vi.fn()
            .mockRejectedValueOnce(new Error('Network unavailable'))
            .mockResolvedValueOnce(createResponse('Welcome back'));
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice\nbob';
        addResponseMatcher('Invalid username');
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.getElementById('bulk-run-status').textContent).toBe('Completed');
        });

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(2);
        expect(document.querySelector('tr[data-sort-id="1"] .response-match-badge-not-checked')?.textContent)
            .toBe('Not checked');
        expect(document.querySelector('.is-continuation-terminal')).toBeNull();
        expect(document.getElementById('bulk-progress-text').textContent).toBe('2/2');
        consoleError.mockRestore();
    });

    it('shows only the longest overlapping marker and highlights it in the opened response', async () => {
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice';
        addResponseMatcher('Invalid username');
        addResponseMatcher('Invalid username and password');

        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.querySelector('.matches-cell')?.textContent).toBe('Invalid username and password');
        });

        expect(document.querySelectorAll('.response-match-badge')).toHaveLength(1);
        expect(document.querySelector('tr.has-response-match')).not.toBeNull();

        document.querySelector('#bulk-results-table tbody tr').click();

        expect(uiMocks.elements.rawResponseDisplay.querySelectorAll('mark.response-match-highlight')).toHaveLength(1);
        expect(uiMocks.elements.rawResponseDisplay.querySelector('mark')?.textContent).toBe('Invalid username and password');
    });

    it('uses each matcher\'s contains or whole-response mode', async () => {
        globalThis.fetch.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            text: vi.fn().mockResolvedValue('Invalid username and password')
        });
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice';
        addResponseMatcher('Invalid username', 'whole');
        addResponseMatcher('username and password', 'partial');
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.querySelectorAll('.response-match-badge')).toHaveLength(1);
        });

        expect(document.querySelector('.response-match-badge')?.textContent).toBe('username and password');
        expect(document.querySelector('.response-match-badge')?.dataset.mode).toBe('partial');
    });

    it('clearly marks responses that miss every configured matcher', async () => {
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice';
        addResponseMatcher('Welcome back');
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.querySelector('.response-match-badge-negative')?.textContent).toBe('No match');
        });

        expect(document.querySelector('.matches-cell')?.classList.contains('empty')).toBe(false);
        expect(document.querySelector('tr.has-no-response-match')).not.toBeNull();
        expect(document.querySelector('tr.has-response-match')).toBeNull();
    });

    it('keeps the matches cell neutral when no matchers are configured', async () => {
        setupBulkReplay();

        document.getElementById('bulk-replay-btn').click();
        document.querySelector('.position-card .payload-list-input').value = 'alice';
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.querySelector('.status-cell')?.textContent).toBe('200 OK');
        });

        expect(document.querySelector('.matches-cell')?.textContent).toBe('—');
        expect(document.querySelector('.matches-cell')?.classList.contains('empty')).toBe(true);
        expect(document.querySelector('.response-match-badge-negative')).toBeNull();
        expect(document.querySelector('tr.has-no-response-match')).toBeNull();
    });

    it('adds marked response text to the matcher configuration without changing the response', () => {
        setupBulkReplay();
        uiMocks.elements.rawResponseDisplay.textContent = 'Invalid username and password';

        const contextMenu = document.getElementById('context-menu');
        contextMenu.dataset.target = 'response';
        contextMenu.dataset.selectedText = 'Invalid username';
        contextMenu.querySelector('[data-action="mark-payload"]').click();

        const row = document.querySelector('.response-matcher-row');
        expect(row.querySelector('.response-matcher-text').value).toBe('Invalid username');
        expect(row.querySelector('.response-matcher-mode').value).toBe('partial');
        expect(row.querySelector('.response-matcher-continuation-guard').checked).toBe(false);
        expect(state.responseMatchers).toEqual([{
            text: 'Invalid username',
            mode: 'partial',
            isContinuationGuard: false
        }]);
        expect(uiMocks.elements.rawResponseDisplay.textContent).toBe('Invalid username and password');
    });
});
