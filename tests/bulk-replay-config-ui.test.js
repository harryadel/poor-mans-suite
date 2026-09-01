import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiMocks = vi.hoisted(() => ({ elements: {} }));
const permissionMocks = vi.hoisted(() => ({ requestReplayPermission: vi.fn() }));

vi.mock('../js/ui/main-ui.js', () => ({ elements: uiMocks.elements }));
vi.mock('../js/network/permissions.js', () => ({
    requestReplayPermission: permissionMocks.requestReplayPermission
}));

import { state } from '../js/core/state.js';
import { setupBulkReplay } from '../js/features/bulk-replay/index.js';
import {
    activateRepeaterContext,
    captureRepeaterContext,
    clearRepeaterContext,
    getActiveRepeaterContext,
    invalidateRepeaterSource
} from '../js/features/repeater-context.js';

function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createReviewDraft({
    requestText = 'GET /login?username=candidate HTTP/1.1\nHost: example.test\n\n',
    template = 'GET /login?username=§candidate§ HTTP/1.1\nHost: example.test\n\n',
    list = 'alice\nbob',
    useHttps = true,
    responseText = 'HTTP/1.1 401 Unauthorized\n\nbaseline response',
    correlationId = 'review-config-1'
} = {}) {
    const ownerRequest = {
        request: { method: 'GET', url: `${useHttps ? 'https' : 'http'}://example.test/login` }
    };
    state.selectedRequest = ownerRequest;
    state.requests = [ownerRequest];
    const source = activateRepeaterContext({
        ownerRequest,
        kind: 'captured',
        label: 'Captured login request',
        responseText
    });
    const snapshot = captureRepeaterContext({ requestText, useHttps });
    const draft = Object.freeze({
        version: 1,
        correlationId,
        attackType: 'sniper',
        template,
        positionConfigs: [Object.freeze({ type: 'simple-list', list })],
        responseMatchers: Object.freeze([]),
        responseMatchCaseSensitive: true
    });
    return { ownerRequest, source, snapshot, draft };
}

describe('Bulk Replay configuration persistence', () => {
    beforeEach(() => {
        clearRepeaterContext();
        permissionMocks.requestReplayPermission.mockReset().mockResolvedValue(true);
        document.body.innerHTML = `
            <button id="bulk-replay-btn" disabled></button>
            <div id="bulk-config-modal">
                <button class="close-modal"></button>
                <section id="bulk-chat-review" hidden>
                    <span id="bulk-review-source"></span>
                    <span id="bulk-review-snapshot-id"></span>
                    <span id="bulk-review-target"></span>
                    <span id="bulk-review-scheme"></span>
                    <span id="bulk-review-mode"></span>
                    <span id="bulk-review-projected-count"></span>
                    <span id="bulk-review-matcher-count"></span>
                    <span id="bulk-review-guard-summary"></span>
                    <pre id="bulk-review-template"></pre>
                    <div id="bulk-review-validation"><p id="bulk-review-status"></p><ul id="bulk-review-errors" hidden></ul></div>
                </section>
            </div>
            <button id="cancel-bulk-review-btn" hidden></button>
            <button id="start-attack-btn"></button>
            <div id="bulk-replay-pane"></div>
            <table id="bulk-results-table"><tbody></tbody></table>
            <div id="bulk-progress-bar"></div>
            <span id="bulk-progress-text"></span>
            <span id="bulk-run-status" role="status" aria-live="polite"></span>
            <button id="bulk-stop-btn"></button>
            <button id="bulk-close-btn"></button>
            <div class="vertical-resize-handle"></div>
            <select id="attack-type">
                <option value="sniper">Sniper</option>
                <option value="battering-ram">Battering Ram</option>
                <option value="pitchfork">Pitchfork</option>
                <option value="cluster-bomb">Cluster Bomb</option>
            </select>
            <span id="attack-type-help"></span>
            <span id="payload-count"></span>
            <div id="positions-container"></div>
            <div id="battering-ram-config">
                <select class="payload-type-select">
                    <option value="simple-list">Simple List</option>
                    <option value="numbers">Numbers</option>
                </select>
                <div class="payload-options-simple-list"><textarea class="payload-list-input"></textarea></div>
                <div class="payload-options-numbers">
                    <input class="num-from-input" value="1">
                    <input class="num-to-input" value="10">
                    <input class="num-step-input" value="1">
                </div>
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
        Object.assign(uiMocks.elements, {
            rawRequestInput,
            rawResponseDisplay: document.createElement('div'),
            diffToggle: document.createElement('div'),
            showDiffCheckbox: Object.assign(document.createElement('input'), { checked: false }),
            resStatus: document.createElement('span'),
            resTime: document.createElement('span'),
            resSize: document.createElement('span')
        });

        state.bulkReplayTemplate = '';
        state.positionConfigs = [];
        state.batteringRamConfig = {
            type: 'simple-list',
            list: '',
            numbers: { from: 1, to: 10, step: 1 }
        };
        state.currentAttackType = 'sniper';
        state.responseMatchers = [];
        state.responseMatchCaseSensitive = true;
        state.shouldStopBulk = false;
        state.shouldPauseBulk = false;
        state.currentResponse = null;
        state.selectedRequest = null;
        state.requests = [];

        Element.prototype.scrollIntoView = vi.fn();
        globalThis.alert = vi.fn();
        globalThis.confirm = vi.fn().mockReturnValue(true);
        delete globalThis.Diff;
        globalThis.fetch = vi.fn().mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            text: vi.fn().mockResolvedValue('Invalid username')
        });
    });

    it('reopens the previous attack after selecting an unmarked result', async () => {
        setupBulkReplay();

        const replayButton = document.getElementById('bulk-replay-btn');
        replayButton.click();

        const attackType = document.getElementById('attack-type');
        attackType.value = 'pitchfork';
        attackType.dispatchEvent(new Event('change'));

        const payloadList = document.querySelector('.position-card .payload-list-input');
        payloadList.value = 'alice\nbob';
        payloadList.dispatchEvent(new Event('input'));
        document.getElementById('start-attack-btn').click();

        await vi.waitFor(() => {
            expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(2);
            expect(document.getElementById('bulk-progress-text').textContent).toBe('2/2');
        });

        document.querySelector('#bulk-results-table tbody tr').click();
        await vi.waitFor(() => expect(replayButton.title).toContain('Reuse previous'));
        expect(replayButton.disabled).toBe(false);
        expect(uiMocks.elements.rawRequestInput.innerText).not.toContain('§');

        replayButton.click();

        expect(document.getElementById('bulk-config-modal').style.display).toBe('block');
        expect(document.getElementById('attack-type').value).toBe('pitchfork');
        expect(document.querySelector('.position-card .payload-list-input').value).toBe('alice\nbob');
        expect(state.bulkReplayTemplate).toContain('§candidate§');
    });

    it('remembers Battering Ram selections when the modal is reopened', () => {
        setupBulkReplay();

        const replayButton = document.getElementById('bulk-replay-btn');
        replayButton.click();

        const attackType = document.getElementById('attack-type');
        attackType.value = 'battering-ram';
        attackType.dispatchEvent(new Event('change'));

        const payloadList = document.querySelector('#battering-ram-config .payload-list-input');
        payloadList.value = 'shared-one\nshared-two';
        payloadList.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.close-modal').click();

        replayButton.click();

        expect(document.getElementById('attack-type').value).toBe('battering-ram');
        expect(document.querySelector('#battering-ram-config .payload-list-input').value).toBe('shared-one\nshared-two');
    });

    it('keeps a reused manual configuration attached to the request that supplied its template', async () => {
        const originalOwner = {
            request: { method: 'GET', url: 'https://example.test/login', headers: [] }
        };
        const otherOwner = {
            request: { method: 'GET', url: 'https://other.test/current', headers: [] }
        };
        state.requests = [originalOwner, otherOwner];
        state.selectedRequest = originalOwner;
        activateRepeaterContext({
            ownerRequest: originalOwner,
            kind: 'captured',
            label: 'Original manual source',
            responseText: null
        });
        const controller = setupBulkReplay();
        const replayButton = document.getElementById('bulk-replay-btn');
        replayButton.click();
        document.querySelector('.close-modal').click();

        state.selectedRequest = otherOwner;
        activateRepeaterContext({
            ownerRequest: otherOwner,
            kind: 'captured',
            label: 'Other visible source',
            responseText: null
        });
        uiMocks.elements.rawRequestInput.innerText = 'GET /current HTTP/1.1\nHost: other.test\n\n';
        uiMocks.elements.rawRequestInput.dispatchEvent(new Event('input'));
        replayButton.click();
        const payloadList = document.querySelector('.position-card .payload-list-input');
        payloadList.value = 'alice';
        payloadList.dispatchEvent(new Event('input'));

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => expect(document.getElementById('bulk-progress-text').textContent).toBe('1/1'));
        document.querySelector('#bulk-results-table tbody tr').click();

        expect(getActiveRepeaterContext()).toMatchObject({
            ownerRequest: originalOwner,
            kind: 'bulk-result'
        });
        expect(controller.getStatus().phase).toBe('idle');
    });

    it('retains, edits, and removes a continuation guard with its matcher', () => {
        setupBulkReplay();

        const replayButton = document.getElementById('bulk-replay-btn');
        replayButton.click();
        document.getElementById('add-response-matcher').click();

        let row = document.querySelector('.response-matcher-row');
        const textInput = row.querySelector('.response-matcher-text');
        textInput.value = 'Invalid username';
        textInput.dispatchEvent(new Event('input'));
        row.querySelector('.response-matcher-continuation-guard').click();
        document.querySelector('.close-modal').click();

        replayButton.click();
        row = document.querySelector('.response-matcher-row');
        expect(row.querySelector('.response-matcher-continuation-guard').checked).toBe(true);
        expect(state.responseMatchers).toEqual([{
            text: 'Invalid username',
            mode: 'partial',
            isContinuationGuard: true
        }]);

        const retainedTextInput = row.querySelector('.response-matcher-text');
        retainedTextInput.value = 'Invalid credentials';
        retainedTextInput.dispatchEvent(new Event('input'));
        expect(state.responseMatchers[0]).toEqual({
            text: 'Invalid credentials',
            mode: 'partial',
            isContinuationGuard: true
        });

        row.querySelector('.response-matcher-remove').click();
        expect(state.responseMatchers).toEqual([]);
        expect(document.querySelector('.response-matcher-empty')?.textContent).toContain('No response matchers');
    });

    it('returns a review controller, prefills the frozen draft without traffic, and restores manual state', () => {
        const controller = setupBulkReplay();
        const priorState = {
            template: 'GET /manual?value=§old§ HTTP/1.1\nHost: manual.test\n\n',
            positionConfigs: [{
                index: 0,
                originalValue: 'old',
                type: 'simple-list',
                list: 'manual-one\nmanual-two',
                numbers: { from: 4, to: 8, step: 2 }
            }],
            batteringRamConfig: {
                type: 'numbers',
                list: 'manual-shared',
                numbers: { from: 20, to: 30, step: 5 }
            },
            attackType: 'pitchfork',
            responseMatchers: [{ text: 'manual matcher', mode: 'whole', isContinuationGuard: true }],
            responseMatchCaseSensitive: false
        };
        state.bulkReplayTemplate = priorState.template;
        state.positionConfigs = structuredClone(priorState.positionConfigs);
        state.batteringRamConfig = structuredClone(priorState.batteringRamConfig);
        state.currentAttackType = priorState.attackType;
        state.responseMatchers = structuredClone(priorState.responseMatchers);
        state.responseMatchCaseSensitive = priorState.responseMatchCaseSensitive;
        const { snapshot, draft } = createReviewDraft();
        const onStatus = vi.fn();

        expect(controller.reviewDraft({ snapshot, draft, projectedRequestCount: 2, onStatus }))
            .toEqual({ accepted: true, projectedRequestCount: 2 });

        expect(controller.getStatus()).toMatchObject({
            phase: 'idle',
            reviewing: true,
            snapshotId: snapshot.snapshotId,
            configIdentity: draft.correlationId
        });
        expect(document.getElementById('bulk-config-modal').style.display).toBe('block');
        expect(document.getElementById('bulk-chat-review').hidden).toBe(false);
        expect(document.getElementById('bulk-review-source').textContent).toBe('Captured login request');
        expect(document.getElementById('bulk-review-snapshot-id').textContent).toBe(snapshot.snapshotId);
        expect(document.getElementById('bulk-review-target').textContent).toBe('https://example.test/login?username=candidate');
        expect(document.getElementById('bulk-review-scheme').textContent).toBe('HTTPS');
        expect(document.getElementById('bulk-review-mode').textContent).toBe('Sniper');
        expect(document.getElementById('bulk-review-projected-count').textContent).toBe('2');
        expect(document.getElementById('bulk-review-template').textContent).toBe(draft.template);
        expect(document.querySelector('.position-card .payload-list-input').value).toBe('alice\nbob');
        expect(state.bulkReplayTemplate).toBe(draft.template);
        expect(Object.isFrozen(draft)).toBe(true);
        expect(permissionMocks.requestReplayPermission).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(onStatus).toHaveBeenCalledWith('reviewing');

        document.getElementById('cancel-bulk-review-btn').click();

        expect(controller.getStatus().reviewing).toBe(false);
        expect(state.bulkReplayTemplate).toBe(priorState.template);
        expect(state.positionConfigs).toEqual(priorState.positionConfigs);
        expect(state.batteringRamConfig).toEqual(priorState.batteringRamConfig);
        expect(state.currentAttackType).toBe(priorState.attackType);
        expect(state.responseMatchers).toEqual(priorState.responseMatchers);
        expect(state.responseMatchCaseSensitive).toBe(false);
        expect(onStatus).toHaveBeenLastCalledWith('discarded');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('renders model-selected payload values as text rather than executable markup', () => {
        const controller = setupBulkReplay();
        const markerValue = '<img src=x onerror="globalThis.__bulkXss = true">';
        const requestText = `GET /?value=${markerValue} HTTP/1.1\nHost: example.test\n\n`;
        const { snapshot, draft } = createReviewDraft({
            requestText,
            template: `GET /?value=§${markerValue}§ HTTP/1.1\nHost: example.test\n\n`,
            list: 'safe'
        });

        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 1, onStatus: vi.fn() });

        expect(document.querySelector('.position-card img')).toBeNull();
        expect(document.querySelector('.position-value').textContent).toContain('<img');
        expect(globalThis.__bulkXss).toBeUndefined();
    });

    it('ignores invalid hidden Battering Ram inputs after returning to Sniper', () => {
        const controller = setupBulkReplay();
        const { snapshot, draft } = createReviewDraft();
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 2, onStatus: vi.fn() });

        const attackType = document.getElementById('attack-type');
        attackType.value = 'battering-ram';
        attackType.dispatchEvent(new Event('change'));

        const batteringRam = document.getElementById('battering-ram-config');
        const payloadType = batteringRam.querySelector('.payload-type-select');
        const listInput = batteringRam.querySelector('.payload-list-input');
        listInput.value = 'shared';
        listInput.dispatchEvent(new Event('input', { bubbles: true }));
        payloadType.value = 'numbers';
        payloadType.dispatchEvent(new Event('change'));
        const fromInput = batteringRam.querySelector('.num-from-input');
        fromInput.value = '';
        fromInput.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.getElementById('start-attack-btn').disabled).toBe(true);

        payloadType.value = 'simple-list';
        payloadType.dispatchEvent(new Event('change'));
        expect(document.getElementById('start-attack-btn').disabled).toBe(false);

        payloadType.value = 'numbers';
        payloadType.dispatchEvent(new Event('change'));
        expect(document.getElementById('start-attack-btn').disabled).toBe(true);

        attackType.value = 'sniper';
        attackType.dispatchEvent(new Event('change'));

        expect(document.getElementById('start-attack-btn').disabled).toBe(false);
        expect(document.getElementById('bulk-review-errors').hidden).toBe(true);
    });

    it('executes an absolute request target without requiring a Host header', async () => {
        const controller = setupBulkReplay();
        const requestText = 'GET HTTP://absolute.test/path?value=one HTTP/1.1\nAccept: */*\n\n';
        const { snapshot, draft } = createReviewDraft({
            requestText,
            template: 'GET HTTP://absolute.test/path?value=§one§ HTTP/1.1\nAccept: */*\n\n',
            list: 'two'
        });
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 1, onStatus: vi.fn() });

        expect(snapshot.scheme).toBe('http');
        expect(document.getElementById('bulk-review-scheme').textContent).toBe('HTTP');

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'HTTP://absolute.test/path?value=two',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it.each(['close button', 'backdrop', 'explicit cancel'])(
        'discards a review and restores manual configuration through the %s',
        dismissal => {
            const controller = setupBulkReplay();
            state.bulkReplayTemplate = 'GET /manual/§saved§ HTTP/1.1\nHost: manual.test\n\n';
            state.positionConfigs = [{
                index: 0,
                originalValue: 'saved',
                type: 'simple-list',
                list: 'kept',
                numbers: { from: 1, to: 10, step: 1 }
            }];
            state.currentAttackType = 'sniper';
            const { snapshot, draft } = createReviewDraft();
            const onStatus = vi.fn();
            controller.reviewDraft({ snapshot, draft, projectedRequestCount: 2, onStatus });

            if (dismissal === 'close button') document.querySelector('.close-modal').click();
            if (dismissal === 'explicit cancel') document.getElementById('cancel-bulk-review-btn').click();
            if (dismissal === 'backdrop') {
                document.getElementById('bulk-config-modal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }

            expect(state.bulkReplayTemplate).toContain('/manual/§saved§');
            expect(state.positionConfigs[0].list).toBe('kept');
            expect(controller.getStatus().reviewing).toBe(false);
            expect(onStatus).toHaveBeenLastCalledWith('discarded');
            expect(permissionMocks.requestReplayPermission).not.toHaveBeenCalled();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        }
    );

    it('replaces an existing review only after restoring its original manual backup', () => {
        const controller = setupBulkReplay();
        state.bulkReplayTemplate = 'GET /manual/§original§ HTTP/1.1\nHost: manual.test\n\n';
        state.positionConfigs = [{
            index: 0,
            originalValue: 'original',
            type: 'simple-list',
            list: 'manual',
            numbers: { from: 1, to: 10, step: 1 }
        }];
        const first = createReviewDraft({ correlationId: 'first-review', list: 'first' });
        const firstStatus = vi.fn();
        controller.reviewDraft({ ...first, projectedRequestCount: 1, onStatus: firstStatus });
        const second = createReviewDraft({ correlationId: 'second-review', list: 'second' });
        const secondStatus = vi.fn();

        controller.reviewDraft({ ...second, projectedRequestCount: 1, onStatus: secondStatus });
        expect(firstStatus).toHaveBeenLastCalledWith('discarded');
        expect(document.querySelector('.position-card .payload-list-input').value).toBe('second');

        controller.discardReview({ snapshot: second.snapshot, draft: second.draft });
        expect(state.bulkReplayTemplate).toContain('/manual/§original§');
        expect(state.positionConfigs[0].list).toBe('manual');
        expect(secondStatus).toHaveBeenLastCalledWith('discarded');
    });

    it('revalidates live edits at exactly 1,000 and rejects 1,001 or invalid matcher input', () => {
        const controller = setupBulkReplay();
        const { snapshot, draft } = createReviewDraft();
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 2, onStatus: vi.fn() });
        const payloadList = document.querySelector('.position-card .payload-list-input');
        const startButton = document.getElementById('start-attack-btn');

        payloadList.value = Array.from({ length: 1000 }, (_, index) => `value-${index}`).join('\n');
        payloadList.dispatchEvent(new Event('input'));
        expect(document.getElementById('bulk-review-projected-count').textContent).toBe('1,000');
        expect(startButton.disabled).toBe(false);
        expect(document.getElementById('bulk-review-errors').hidden).toBe(true);

        payloadList.value += '\nvalue-1000';
        payloadList.dispatchEvent(new Event('input'));
        expect(document.getElementById('bulk-review-projected-count').textContent).toBe('1,001');
        expect(startButton.disabled).toBe(true);
        expect(document.getElementById('bulk-review-errors').textContent).toMatch(/exceeding the limit of 1000/i);

        payloadList.value = 'safe';
        payloadList.dispatchEvent(new Event('input'));
        document.getElementById('add-response-matcher').click();
        expect(startButton.disabled).toBe(true);
        expect(document.getElementById('bulk-review-matcher-count').textContent).toBe('1 configured');
        expect(document.getElementById('bulk-review-errors').textContent).toMatch(/non-empty string/i);
        expect(permissionMocks.requestReplayPermission).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('keeps a reviewed draft open for safe retry after permission denial', async () => {
        permissionMocks.requestReplayPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const controller = setupBulkReplay();
        const { snapshot, draft } = createReviewDraft({ list: 'alice' });
        const onStatus = vi.fn();
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 1, onStatus });

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => {
            expect(document.getElementById('bulk-review-status').textContent).toMatch(/permission was denied/i);
        });
        expect(document.getElementById('bulk-config-modal').style.display).toBe('block');
        expect(document.getElementById('start-attack-btn').disabled).toBe(false);
        expect(controller.getStatus()).toMatchObject({ phase: 'idle', reviewing: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => expect(document.getElementById('bulk-progress-text').textContent).toBe('1/1'));
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(state.bulkReplayTemplate).toBe(draft.template);
        expect(onStatus).toHaveBeenLastCalledWith('started');
        expect(controller.getStatus().reviewing).toBe(false);
    });

    it('counts before the manual large-run warning and sends nothing when it is canceled', () => {
        globalThis.confirm.mockReturnValue(false);
        setupBulkReplay();
        document.getElementById('bulk-replay-btn').click();
        const attackType = document.getElementById('attack-type');
        attackType.value = 'cluster-bomb';
        attackType.dispatchEvent(new Event('change'));
        const payloadList = document.querySelector('.position-card .payload-list-input');
        payloadList.value = Array.from({ length: 1001 }, (_, index) => `manual-${index}`).join('\n');
        payloadList.dispatchEvent(new Event('input'));

        document.getElementById('start-attack-btn').click();

        expect(globalThis.confirm).toHaveBeenCalledWith('This will generate 1001 requests. Continue?');
        expect(permissionMocks.requestReplayPermission).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('locks the starting phase against double confirmation and releases it after cancellation', async () => {
        const permission = createDeferred();
        permissionMocks.requestReplayPermission.mockReturnValue(permission.promise);
        const controller = setupBulkReplay();
        const { snapshot, draft } = createReviewDraft({ list: 'alice' });
        const onStatus = vi.fn();
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 1, onStatus });
        const startButton = document.getElementById('start-attack-btn');

        startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(permissionMocks.requestReplayPermission).toHaveBeenCalledTimes(1);
        expect(controller.getStatus().phase).toBe('starting');

        document.getElementById('cancel-bulk-review-btn').click();
        expect(controller.getStatus()).toMatchObject({ phase: 'idle', reviewing: false });
        expect(onStatus).toHaveBeenLastCalledWith('discarded');
        permission.resolve(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects review and duplicate starts while another run is active', async () => {
        const response = createDeferred();
        globalThis.fetch = vi.fn().mockReturnValue(response.promise);
        const controller = setupBulkReplay();
        const pendingReview = createReviewDraft({ list: 'later', correlationId: 'active-run-review' });
        document.getElementById('bulk-replay-btn').click();
        const payloadList = document.querySelector('.position-card .payload-list-input');
        payloadList.value = 'one';
        payloadList.dispatchEvent(new Event('input'));
        const startButton = document.getElementById('start-attack-btn');
        startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

        expect(controller.reviewDraft({ ...pendingReview, projectedRequestCount: 1, onStatus: vi.fn() }))
            .toEqual({ accepted: false, reason: 'active-run' });
        startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(permissionMocks.requestReplayPermission).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        response.resolve({
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            text: vi.fn().mockResolvedValue('done')
        });
        await vi.waitFor(() => expect(document.getElementById('bulk-run-status').textContent).toBe('Completed'));
    });

    it('expires an open review before confirmation and sends no permission or traffic', () => {
        const controller = setupBulkReplay();
        const { source, snapshot, draft } = createReviewDraft({ list: 'alice' });
        const onStatus = vi.fn();
        controller.reviewDraft({ snapshot, draft, projectedRequestCount: 1, onStatus });

        invalidateRepeaterSource(source.sourceId);

        expect(document.getElementById('start-attack-btn').disabled).toBe(true);
        expect(document.getElementById('bulk-review-status').textContent).toMatch(/expired/i);
        expect(onStatus).toHaveBeenLastCalledWith('expired');
        document.getElementById('start-attack-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(permissionMocks.requestReplayPermission).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('executes the frozen review template, scheme, owner, and response baseline, then commits it', async () => {
        const controller = setupBulkReplay();
        const baseline = 'HTTP/1.1 403 Forbidden\nX-Source: snapshot\n\nsnapshot baseline';
        const review = createReviewDraft({
            requestText: 'GET /snapshot?username=candidate HTTP/1.1\nHost: snapshot.test\n\n',
            template: 'GET /snapshot?username=§candidate§ HTTP/1.1\nHost: snapshot.test\n\n',
            list: 'alice',
            useHttps: false,
            responseText: baseline,
            correlationId: 'immutable-execution'
        });
        const onStatus = vi.fn();
        controller.reviewDraft({ ...review, projectedRequestCount: 1, onStatus });

        const otherOwner = { request: { method: 'GET', url: 'https://evil.test/changed' } };
        state.selectedRequest = otherOwner;
        uiMocks.elements.rawRequestInput.innerText = 'GET /changed HTTP/1.1\nHost: evil.test\n\n';
        document.getElementById('use-https').checked = true;
        state.currentResponse = 'HTTP/1.1 200 OK\n\nvisible replacement';
        activateRepeaterContext({
            ownerRequest: otherOwner,
            kind: 'captured',
            label: 'Visible replacement',
            responseText: state.currentResponse
        });
        uiMocks.elements.showDiffCheckbox.checked = true;
        globalThis.Diff = {
            diffLines: vi.fn().mockReturnValue([{ value: 'rendered response' }])
        };

        document.getElementById('start-attack-btn').click();
        await vi.waitFor(() => expect(document.getElementById('bulk-progress-text').textContent).toBe('1/1'));

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://snapshot.test/snapshot?username=alice',
            expect.objectContaining({ method: 'GET' })
        );
        expect(state.bulkReplayTemplate).toBe(review.draft.template);
        expect(state.positionConfigs[0].list).toBe('alice');
        expect(onStatus).toHaveBeenLastCalledWith('started');

        document.querySelector('#bulk-results-table tbody tr').click();
        expect(globalThis.Diff.diffLines).toHaveBeenCalledWith(baseline, expect.stringContaining('Invalid username'));
        expect(document.getElementById('use-https').checked).toBe(false);
        expect(getActiveRepeaterContext()).toMatchObject({
            ownerRequest: review.ownerRequest,
            kind: 'bulk-result',
            responseText: expect.stringContaining('Invalid username')
        });
        const resultSnapshot = captureRepeaterContext({
            requestText: uiMocks.elements.rawRequestInput.innerText,
            useHttps: document.getElementById('use-https').checked
        });
        expect(resultSnapshot.scheme).toBe('http');
        expect(resultSnapshot.targetUrl).toBe('http://snapshot.test/snapshot?username=alice');
    });
});
