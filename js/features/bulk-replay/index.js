// Bulk Replay Logic
import { state } from '../../core/state.js';
import { events, EVENT_NAMES } from '../../core/events.js';
import { elements } from '../../ui/main-ui.js';
import { calculateAttackRequestCount, generateAttackRequests } from './engine.js';
import { formatBytes } from '../../core/utils/format.js';
import { highlightHTTP } from '../../core/utils/network.js';
import { renderDiff } from '../../core/utils/misc.js';
import { escapeHtml } from '../../core/utils/dom.js';
import { requestReplayPermission } from '../../network/permissions.js';
import { formatRawResponse } from '../../network/response-parser.js';
import {
    activateRepeaterContext,
    canActivateRepeaterSource,
    getActiveRepeaterContext,
    invalidateRepeaterSource,
    isRepeaterOwnerValid,
    isRepeaterSnapshotValid
} from '../repeater-context.js';
import {
    CHAT_BULK_REPLAY_REQUEST_LIMIT,
    validateBulkReplayConfiguration
} from '../llm-chat/bulk-replay-drafts.js';
import {
    getMatchedResponseMatchers,
    highlightResponseMatches,
    normalizeResponseMatchers,
    responseMatcherMatches
} from './response-matches.js';

let nextBulkRunId = 0;
let removeBulkReplayInvalidationListener = null;
let removeBulkReplayActivationListener = null;

const ATTACK_TYPE_LABELS = {
    sniper: 'Sniper',
    'battering-ram': 'Battering Ram',
    pitchfork: 'Pitchfork',
    'cluster-bomb': 'Cluster Bomb'
};

function cloneConfiguration(value) {
    if (Array.isArray(value)) return value.map(cloneConfiguration);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneConfiguration(child)]));
    }
    return value;
}

function deepFreezeConfiguration(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreezeConfiguration);
    return Object.freeze(value);
}

export function setupBulkReplay() {
    const bulkReplayBtn = document.getElementById('bulk-replay-btn');
    const bulkConfigModal = document.getElementById('bulk-config-modal');
    const closeModalBtn = bulkConfigModal?.querySelector('.close-modal');
    const startAttackBtn = document.getElementById('start-attack-btn');
    const bulkReplayPane = document.getElementById('bulk-replay-pane');
    const bulkResultsTableElement = document.getElementById('bulk-results-table');
    const bulkResultsTable = bulkResultsTableElement.querySelector('tbody');
    const bulkSortHeaders = Array.from(bulkResultsTableElement.querySelectorAll('thead th[data-sort-key]'));
    const bulkProgressBar = document.getElementById('bulk-progress-bar');
    const bulkProgressText = document.getElementById('bulk-progress-text');
    const bulkRunStatus = document.getElementById('bulk-run-status');
    const bulkStopBtn = document.getElementById('bulk-stop-btn');
    const bulkCloseBtn = document.getElementById('bulk-close-btn');
    const verticalResizeHandle = document.querySelector('.vertical-resize-handle');
    const responseMatchersContainer = document.getElementById('response-matchers');
    const addResponseMatcherBtn = document.getElementById('add-response-matcher');
    const responseMatchCaseSensitiveInput = document.getElementById('response-match-case-sensitive');
    const attackTypeSelect = document.getElementById('attack-type');
    const reviewBanner = document.getElementById('bulk-chat-review');
    const reviewCancelBtn = document.getElementById('cancel-bulk-review-btn');
    const reviewSource = document.getElementById('bulk-review-source');
    const reviewSnapshotId = document.getElementById('bulk-review-snapshot-id');
    const reviewTarget = document.getElementById('bulk-review-target');
    const reviewScheme = document.getElementById('bulk-review-scheme');
    const reviewMode = document.getElementById('bulk-review-mode');
    const reviewProjectedCount = document.getElementById('bulk-review-projected-count');
    const reviewMatcherCount = document.getElementById('bulk-review-matcher-count');
    const reviewGuardSummary = document.getElementById('bulk-review-guard-summary');
    const reviewTemplate = document.getElementById('bulk-review-template');
    const reviewValidation = document.getElementById('bulk-review-validation');
    const reviewStatus = document.getElementById('bulk-review-status');
    const reviewErrors = document.getElementById('bulk-review-errors');
    const numericSortKeys = new Set(['id', 'status', 'size', 'time']);
    let bulkSortState = { key: null, direction: 'ascending' };
    const activatedResultSourceIds = new Set();
    let bulkRunPhase = 'idle';
    let activeStartAttempt = null;
    let reviewSession = null;
    let manualConfigurationContext = null;
    let visibleResultSourceId = null;

    function captureManualConfigurationContext() {
        const activeContext = getActiveRepeaterContext();
        return Object.freeze({
            ownerRequest: activeContext?.ownerRequest || state.selectedRequest || null,
            sourceId: activeContext?.sourceId || null,
            sourceLabel: activeContext?.label || 'Current Repeater source',
            baselineResponse: activeContext?.responseText ?? state.currentResponse ?? '',
            scheme: document.getElementById('use-https')?.checked ? 'https' : 'http'
        });
    }

    function configurationContextFromSnapshot(snapshot) {
        return Object.freeze({
            ownerRequest: snapshot.ownerRequest,
            sourceId: snapshot.sourceId,
            sourceLabel: snapshot.label,
            baselineResponse: snapshot.responseText ?? '',
            scheme: snapshot.scheme || (snapshot.useHttps ? 'https' : 'http')
        });
    }

    function invalidateActivatedResults() {
        activatedResultSourceIds.forEach(sourceId => invalidateRepeaterSource(sourceId));
        activatedResultSourceIds.clear();
    }

    function clearVisibleResultPanes() {
        if (elements.rawRequestInput) elements.rawRequestInput.innerText = '';
        const rawRequestTextarea = elements.rawRequestTextarea || document.getElementById('raw-request-textarea');
        if (rawRequestTextarea) rawRequestTextarea.value = '';
        state.currentResponse = null;
        state.regularRequestBaseline = null;
        events.emit(EVENT_NAMES.UI_UPDATE_RESPONSE_VIEW, {
            status: '',
            statusClass: 'status-badge',
            time: '',
            size: '',
            content: ''
        });
        visibleResultSourceId = null;
    }

    function renderBulkRunStatus(message, status) {
        if (!bulkRunStatus) return;
        bulkRunStatus.textContent = message;
        bulkRunStatus.dataset.state = status;
    }

    function getRowSortValue(row, key) {
        const value = row.dataset[`sort${key.charAt(0).toUpperCase()}${key.slice(1)}`];
        if (!numericSortKeys.has(key)) return (value || '').toLocaleLowerCase();
        if (value === undefined || value === '') return null;

        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function applyBulkResultsSort() {
        const { key, direction } = bulkSortState;
        if (!key) return;

        const directionMultiplier = direction === 'ascending' ? 1 : -1;
        const rows = Array.from(bulkResultsTable.querySelectorAll('tr'));
        rows.sort((leftRow, rightRow) => {
            const leftValue = getRowSortValue(leftRow, key);
            const rightValue = getRowSortValue(rightRow, key);
            let comparison = 0;

            if (leftValue === null || rightValue === null) {
                if (leftValue === null && rightValue !== null) comparison = 1;
                if (leftValue !== null && rightValue === null) comparison = -1;
            } else if (numericSortKeys.has(key)) {
                comparison = leftValue - rightValue;
            } else {
                comparison = leftValue.localeCompare(rightValue);
            }

            if (comparison !== 0) return comparison * directionMultiplier;
            return Number(leftRow.dataset.sortId) - Number(rightRow.dataset.sortId);
        });
        bulkResultsTable.append(...rows);
    }

    function renderBulkSortState() {
        bulkSortHeaders.forEach(header => {
            const isActive = header.dataset.sortKey === bulkSortState.key;
            header.setAttribute('aria-sort', isActive ? bulkSortState.direction : 'none');
        });
    }

    function resetBulkSort() {
        bulkSortState = { key: null, direction: 'ascending' };
        renderBulkSortState();
    }

    bulkSortHeaders.forEach(header => {
        header.querySelector('.bulk-sort-button')?.addEventListener('click', () => {
            const key = header.dataset.sortKey;
            const direction = bulkSortState.key === key && bulkSortState.direction === 'ascending'
                ? 'descending'
                : 'ascending';
            bulkSortState = { key, direction };
            renderBulkSortState();
            applyBulkResultsSort();
        });
    });

    function readRawResponseMatchers() {
        if (!responseMatchersContainer) return [];

        return Array.from(responseMatchersContainer.querySelectorAll('.response-matcher-row')).map(row => ({
            text: row.querySelector('.response-matcher-text')?.value || '',
            mode: row.querySelector('.response-matcher-mode')?.value || 'partial',
            isContinuationGuard: row.querySelector('.response-matcher-continuation-guard')?.checked === true
        }));
    }

    function readResponseMatchers() {
        return normalizeResponseMatchers(readRawResponseMatchers());
    }

    function showEmptyResponseMatchers() {
        if (!responseMatchersContainer || responseMatchersContainer.children.length > 0) return;

        const empty = document.createElement('div');
        empty.className = 'response-matcher-empty';
        empty.textContent = 'No response matchers configured.';
        responseMatchersContainer.appendChild(empty);
    }

    function appendResponseMatcherRow(
        matcher = { text: '', mode: 'partial', isContinuationGuard: false },
        focus = false
    ) {
        if (!responseMatchersContainer) return;

        responseMatchersContainer.querySelector('.response-matcher-empty')?.remove();

        const row = document.createElement('div');
        row.className = 'response-matcher-row';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'form-control response-matcher-text';
        textInput.placeholder = 'Response text';
        textInput.value = matcher.text || '';
        textInput.setAttribute('aria-label', 'Response matcher text');

        const modeSelect = document.createElement('select');
        modeSelect.className = 'form-control response-matcher-mode';
        modeSelect.setAttribute('aria-label', 'Response matcher mode');
        modeSelect.innerHTML = `
            <option value="partial">Contains</option>
            <option value="whole">Whole response</option>
        `;
        modeSelect.value = matcher.mode === 'whole' ? 'whole' : 'partial';

        const guardLabel = document.createElement('label');
        guardLabel.className = 'response-matcher-guard-option';
        guardLabel.title = 'Keep replaying while this matcher matches';

        const guardInput = document.createElement('input');
        guardInput.type = 'checkbox';
        guardInput.className = 'response-matcher-continuation-guard';
        guardInput.checked = matcher.isContinuationGuard === true;

        const guardText = document.createElement('span');
        guardText.textContent = 'Continue';
        guardLabel.append(guardInput, guardText);

        const updateGuardLabel = () => {
            const matcherText = textInput.value.trim();
            guardInput.setAttribute(
                'aria-label',
                matcherText
                    ? `Use "${matcherText}" as a continuation guard`
                    : 'Use this response matcher as a continuation guard'
            );
        };
        updateGuardLabel();

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'response-matcher-remove';
        removeBtn.title = 'Remove matcher';
        removeBtn.setAttribute('aria-label', 'Remove response matcher');
        removeBtn.textContent = '×';

        const syncState = () => {
            state.responseMatchers = readResponseMatchers();
            refreshReviewValidation();
        };
        textInput.addEventListener('input', () => {
            updateGuardLabel();
            syncState();
        });
        modeSelect.addEventListener('change', syncState);
        guardInput.addEventListener('change', syncState);
        removeBtn.addEventListener('click', () => {
            row.remove();
            syncState();
            showEmptyResponseMatchers();
        });

        row.append(textInput, modeSelect, guardLabel, removeBtn);
        responseMatchersContainer.appendChild(row);
        if (focus) textInput.focus();
    }

    function renderResponseMatcherConfig(matchers = state.responseMatchers) {
        if (!responseMatchersContainer) return;

        const normalizedMatchers = normalizeResponseMatchers(matchers);
        state.responseMatchers = normalizedMatchers;
        responseMatchersContainer.replaceChildren();
        normalizedMatchers.forEach(matcher => appendResponseMatcherRow(matcher));
        showEmptyResponseMatchers();
    }

    function addMarkedResponseMatcher(text) {
        const matchers = normalizeResponseMatchers([
            ...readResponseMatchers(),
            { text, mode: 'partial', isContinuationGuard: false }
        ]);
        renderResponseMatcherConfig(matchers);
        refreshReviewValidation();
    }

    renderResponseMatcherConfig();

    addResponseMatcherBtn?.addEventListener('click', () => {
        state.responseMatchers = readResponseMatchers();
        appendResponseMatcherRow({ text: '', mode: 'partial', isContinuationGuard: false }, true);
        refreshReviewValidation();
    });

    if (responseMatchCaseSensitiveInput) {
        responseMatchCaseSensitiveInput.checked = state.responseMatchCaseSensitive;
        responseMatchCaseSensitiveInput.addEventListener('change', () => {
            state.responseMatchCaseSensitive = responseMatchCaseSensitiveInput.checked;
            refreshReviewValidation();
        });
    }

    function payloadNumbers(numbers) {
        return {
            from: numbers?.from ?? 1,
            to: numbers?.to ?? 10,
            step: numbers?.step ?? 1
        };
    }

    function editablePayloadConfig(config = {}, position = {}) {
        return {
            ...position,
            ...(config.index !== undefined ? { index: config.index } : {}),
            ...(config.originalValue !== undefined ? { originalValue: config.originalValue } : {}),
            type: config.type === 'numbers' ? 'numbers' : 'simple-list',
            list: typeof config.list === 'string' ? config.list : '',
            numbers: payloadNumbers(config.numbers)
        };
    }

    function captureBulkReplayConfiguration() {
        return {
            template: state.bulkReplayTemplate,
            positionConfigs: cloneConfiguration(state.positionConfigs),
            batteringRamConfig: cloneConfiguration(state.batteringRamConfig),
            attackType: state.currentAttackType,
            responseMatchers: cloneConfiguration(state.responseMatchers),
            responseMatchCaseSensitive: state.responseMatchCaseSensitive
        };
    }

    function applyBulkReplayConfiguration(configuration) {
        state.bulkReplayTemplate = configuration.template || '';
        state.positionConfigs = (configuration.positionConfigs || []).map((config, index) => editablePayloadConfig(config, {
            index,
            originalValue: config.originalValue || ''
        }));
        state.batteringRamConfig = editablePayloadConfig(configuration.batteringRamConfig || {});
        state.currentAttackType = configuration.attackType || 'sniper';
        state.responseMatchers = cloneConfiguration(configuration.responseMatchers || []);
        state.responseMatchCaseSensitive = configuration.responseMatchCaseSensitive !== false;
    }

    function renderModalConfiguration() {
        const matches = state.bulkReplayTemplate.match(/§[\s\S]*?§/g) || [];
        const payloadCount = document.getElementById('payload-count');
        if (payloadCount) payloadCount.textContent = String(matches.length);
        if (document.getElementById('positions-container')) populatePositionsContainer(matches);
        populateBatteringRamConfig();
        if (attackTypeSelect) attackTypeSelect.value = state.currentAttackType;
        updateAttackTypeUI(state.currentAttackType);
        renderResponseMatcherConfig(state.responseMatchers);
        if (responseMatchCaseSensitiveInput) {
            responseMatchCaseSensitiveInput.checked = state.responseMatchCaseSensitive;
        }
    }

    function readNumberInput(input, fallback) {
        if (!input) return fallback;
        if (input.value.trim() === '') return Number.NaN;
        return Number(input.value);
    }

    function collectModalConfiguration() {
        const cards = Array.from(document.querySelectorAll('.position-card'));
        const positionConfigs = cards.length > 0
            ? cards.map((card, index) => {
                const previous = state.positionConfigs[index] || {};
                return editablePayloadConfig({
                    index,
                    originalValue: previous.originalValue || '',
                    type: card.querySelector('.payload-type-select')?.value,
                    list: card.querySelector('.payload-list-input')?.value || '',
                    numbers: {
                        from: readNumberInput(card.querySelector('.num-from-input'), previous.numbers?.from),
                        to: readNumberInput(card.querySelector('.num-to-input'), previous.numbers?.to),
                        step: readNumberInput(card.querySelector('.num-step-input'), previous.numbers?.step)
                    }
                });
            })
            : cloneConfiguration(state.positionConfigs);

        const batteringContainer = document.getElementById('battering-ram-config');
        const previousBattering = state.batteringRamConfig || {};
        const batteringRamConfig = editablePayloadConfig({
            type: batteringContainer?.querySelector('.payload-type-select')?.value || previousBattering.type,
            list: batteringContainer?.querySelector('.payload-list-input')?.value ?? previousBattering.list,
            numbers: {
                from: readNumberInput(
                    batteringContainer?.querySelector('.num-from-input'),
                    previousBattering.numbers?.from
                ),
                to: readNumberInput(
                    batteringContainer?.querySelector('.num-to-input'),
                    previousBattering.numbers?.to
                ),
                step: readNumberInput(
                    batteringContainer?.querySelector('.num-step-input'),
                    previousBattering.numbers?.step
                )
            }
        });
        const rawResponseMatchers = readRawResponseMatchers();
        const responseMatchCaseSensitive = responseMatchCaseSensitiveInput?.checked ?? true;
        const attackType = attackTypeSelect?.value || state.currentAttackType;

        state.positionConfigs = cloneConfiguration(positionConfigs);
        state.batteringRamConfig = cloneConfiguration(batteringRamConfig);
        state.currentAttackType = attackType;
        state.responseMatchers = normalizeResponseMatchers(rawResponseMatchers);
        state.responseMatchCaseSensitive = responseMatchCaseSensitive;

        return {
            attackType,
            positionConfigs,
            batteringRamConfig,
            rawResponseMatchers,
            responseMatchers: state.responseMatchers,
            responseMatchCaseSensitive
        };
    }

    function createReviewCandidate() {
        const modalConfiguration = collectModalConfiguration();
        const candidate = {
            version: 1,
            correlationId: reviewSession.correlationId,
            attackType: modalConfiguration.attackType,
            template: reviewSession.template,
            positionConfigs: modalConfiguration.attackType === 'battering-ram'
                ? []
                : modalConfiguration.positionConfigs,
            responseMatchers: modalConfiguration.rawResponseMatchers,
            responseMatchCaseSensitive: modalConfiguration.responseMatchCaseSensitive
        };
        if (modalConfiguration.attackType === 'battering-ram') {
            candidate.batteringRamConfig = modalConfiguration.batteringRamConfig;
        }
        return candidate;
    }

    function notifyReviewStatus(session, status) {
        try {
            session?.onStatus?.(status);
        } catch (error) {
            console.error('Bulk Replay review status callback failed:', error);
        }
    }

    function setReviewSummaryText(element, value) {
        if (element) element.textContent = value;
    }

    function refreshReviewValidation(statusMessage = null) {
        if (!reviewSession) {
            if (startAttackBtn) startAttackBtn.disabled = bulkRunPhase !== 'idle';
            return null;
        }

        const candidate = createReviewCandidate();
        const validation = validateBulkReplayConfiguration(candidate, {
            snapshot: reviewSession.snapshot,
            maxRequests: CHAT_BULK_REPLAY_REQUEST_LIMIT
        });
        const matcherCount = candidate.responseMatchers.length;
        const guardCount = candidate.responseMatchers.filter(matcher => matcher.isContinuationGuard).length;
        const isExpired = !isRepeaterSnapshotValid(reviewSession.snapshot);

        reviewSession.validation = validation;
        setReviewSummaryText(reviewMode, ATTACK_TYPE_LABELS[candidate.attackType] || candidate.attackType || 'Unknown');
        setReviewSummaryText(
            reviewProjectedCount,
            validation.projectedRequestCount === null
                ? 'Unavailable'
                : validation.projectedRequestCount.toLocaleString()
        );
        setReviewSummaryText(reviewMatcherCount, `${matcherCount} configured`);
        setReviewSummaryText(
            reviewGuardSummary,
            guardCount > 0
                ? `${guardCount} enabled; replay stops when none match`
                : '0 enabled; no continuation stop condition'
        );

        if (reviewErrors) {
            reviewErrors.replaceChildren();
            validation.errors.forEach(message => {
                const item = document.createElement('li');
                item.textContent = message;
                reviewErrors.appendChild(item);
            });
            reviewErrors.hidden = validation.errors.length === 0;
        }

        if (reviewValidation) {
            reviewValidation.dataset.state = isExpired
                ? 'expired'
                : statusMessage || !validation.valid
                    ? 'error'
                    : 'ready';
        }
        if (reviewStatus) {
            reviewStatus.textContent = statusMessage || (isExpired
                ? 'This source snapshot expired. The draft cannot be started.'
                : validation.valid
                    ? 'Configuration is valid and ready for separate confirmation.'
                    : 'Fix the validation errors before starting the attack.');
        }
        if (startAttackBtn) {
            startAttackBtn.disabled = bulkRunPhase !== 'idle' || !validation.valid;
        }

        if (isExpired && reviewSession.status !== 'expired') {
            reviewSession.status = 'expired';
            notifyReviewStatus(reviewSession, 'expired');
        }
        return validation;
    }

    function hideReviewUI() {
        if (reviewBanner) reviewBanner.hidden = true;
        if (reviewCancelBtn) reviewCancelBtn.hidden = true;
    }

    function renderReviewIdentity(session) {
        if (reviewBanner) reviewBanner.hidden = false;
        if (reviewCancelBtn) reviewCancelBtn.hidden = false;
        setReviewSummaryText(reviewSource, session.snapshot.label);
        setReviewSummaryText(reviewSnapshotId, session.snapshot.snapshotId);
        setReviewSummaryText(reviewTarget, session.snapshot.targetUrl || 'Unavailable');
        setReviewSummaryText(
            reviewScheme,
            (session.snapshot.scheme || (session.snapshot.useHttps ? 'https' : 'http')).toUpperCase()
        );
        setReviewSummaryText(reviewTemplate, session.template);
    }

    function discardReview({ snapshot, draft, hideModal = true } = {}) {
        if (!reviewSession) return false;
        if (snapshot && reviewSession.snapshot !== snapshot) return false;
        if (draft?.correlationId && reviewSession.correlationId !== draft.correlationId) return false;
        if (bulkRunPhase === 'running') return false;
        if (bulkRunPhase === 'starting' && activeStartAttempt) {
            activeStartAttempt.cancelled = true;
            activeStartAttempt = null;
            bulkRunPhase = 'idle';
            if (startAttackBtn) startAttackBtn.disabled = false;
        }

        const discardedSession = reviewSession;
        reviewSession = null;
        applyBulkReplayConfiguration(discardedSession.priorState);
        manualConfigurationContext = discardedSession.priorExecutionContext;
        renderModalConfiguration();
        hideReviewUI();
        if (hideModal && bulkConfigModal) bulkConfigModal.style.display = 'none';
        if (startAttackBtn) startAttackBtn.disabled = bulkRunPhase !== 'idle';
        notifyReviewStatus(discardedSession, 'discarded');
        return true;
    }

    function commitReview(configuration) {
        const committedSession = reviewSession;
        reviewSession = null;
        applyBulkReplayConfiguration(configuration);
        manualConfigurationContext = configurationContextFromSnapshot(committedSession.snapshot);
        hideReviewUI();
        notifyReviewStatus(committedSession, 'started');
    }

    function reviewDraft({ snapshot, draft, projectedRequestCount, onStatus } = {}) {
        if (!isRepeaterSnapshotValid(snapshot)) {
            notifyReviewStatus({ onStatus }, 'expired');
            return Object.freeze({ accepted: false, reason: 'expired' });
        }
        if (bulkRunPhase !== 'idle') {
            return Object.freeze({ accepted: false, reason: 'active-run' });
        }

        const validation = validateBulkReplayConfiguration(draft, {
            snapshot,
            maxRequests: CHAT_BULK_REPLAY_REQUEST_LIMIT
        });
        if (!validation.valid) {
            return Object.freeze({ accepted: false, reason: 'invalid', errors: [...validation.errors] });
        }
        if (reviewSession) discardReview({ hideModal: false });

        const priorState = captureBulkReplayConfiguration();
        const editableConfiguration = cloneConfiguration(validation.config);
        applyBulkReplayConfiguration(editableConfiguration);
        reviewSession = {
            snapshot,
            draft,
            correlationId: draft.correlationId,
            configIdentity: draft.correlationId,
            template: draft.template,
            projectedRequestCount,
            priorState,
            priorExecutionContext: manualConfigurationContext,
            onStatus,
            status: 'reviewing',
            validation
        };

        renderModalConfiguration();
        renderReviewIdentity(reviewSession);
        if (bulkConfigModal) bulkConfigModal.style.display = 'block';
        notifyReviewStatus(reviewSession, 'reviewing');
        refreshReviewValidation();
        return Object.freeze({ accepted: true, projectedRequestCount: validation.projectedRequestCount });
    }

    function getStatus() {
        return Object.freeze({
            phase: bulkRunPhase,
            reviewing: reviewSession !== null,
            snapshotId: reviewSession?.snapshot.snapshotId || null,
            configIdentity: reviewSession?.configIdentity || null
        });
    }

    removeBulkReplayInvalidationListener?.();
    removeBulkReplayInvalidationListener = events.on(EVENT_NAMES.REPEATER_CONTEXT_INVALIDATED, invalidation => {
        if (invalidation?.sourceId === visibleResultSourceId) {
            clearVisibleResultPanes();
        }
        if (reviewSession && (
            invalidation?.sourceId === reviewSession.snapshot.sourceId ||
            invalidation?.ownerRequest === reviewSession.snapshot.ownerRequest
        )) {
            refreshReviewValidation();
        }
    });
    removeBulkReplayActivationListener?.();
    removeBulkReplayActivationListener = events.on(EVENT_NAMES.REPEATER_CONTEXT_ACTIVATED, context => {
        if (context?.sourceId !== visibleResultSourceId) visibleResultSourceId = null;
    });

    function renderResponseMatches(cell, matchers, { configuredMatcherCount = 0, error = false } = {}) {
        if (!cell) return;

        cell.replaceChildren();
        cell.classList.toggle('empty', configuredMatcherCount === 0);
        cell.classList.toggle('no-match', configuredMatcherCount > 0 && matchers.length === 0 && !error);

        if (configuredMatcherCount === 0) {
            cell.textContent = '—';
            return;
        }

        if (error) {
            const badge = document.createElement('span');
            badge.className = 'response-match-badge response-match-badge-not-checked';
            badge.textContent = 'Not checked';
            badge.title = 'The request failed before response matchers could be checked';
            cell.appendChild(badge);
            return;
        }

        if (matchers.length === 0) {
            const badge = document.createElement('span');
            badge.className = 'response-match-badge response-match-badge-negative';
            badge.textContent = 'No match';
            badge.title = 'None of the configured response matchers matched';
            cell.appendChild(badge);
            return;
        }

        matchers.forEach(matcher => {
            const badge = document.createElement('span');
            badge.className = 'response-match-badge';
            badge.dataset.mode = matcher.mode;
            badge.textContent = matcher.text;
            badge.title = `${matcher.mode === 'whole' ? 'Whole response' : 'Contains'}: ${matcher.text}`;
            cell.appendChild(badge);
        });
    }

    // We use elements.rawRequestInput from ui.js

    // Helper to check for payload markers
    function checkPayloadMarkers() {
        if (!bulkReplayBtn || !elements.rawRequestInput) return;

        const content = elements.rawRequestInput.innerText;
        const hasMarkers = /§[\s\S]*?§/.test(content);
        const hasSavedTemplate = /§[\s\S]*?§/.test(state.bulkReplayTemplate || '');

        if (hasMarkers || hasSavedTemplate) {
            bulkReplayBtn.disabled = false;
            bulkReplayBtn.classList.add('ready');
            bulkReplayBtn.title = hasMarkers
                ? 'Bulk Replay - Configure marked payloads'
                : 'Bulk Replay - Reuse previous marked request and configuration';
        } else {
            bulkReplayBtn.disabled = true;
            bulkReplayBtn.classList.remove('ready');
            bulkReplayBtn.title = 'Bulk Replay - Mark parameters with § to start attack';
        }
    }

    // Initial check
    checkPayloadMarkers();

    // Listen for changes in input
    if (elements.rawRequestInput) {
        elements.rawRequestInput.addEventListener('input', checkPayloadMarkers);
        elements.rawRequestInput.addEventListener('keyup', checkPayloadMarkers);
        elements.rawRequestInput.addEventListener('click', checkPayloadMarkers);

        const observer = new MutationObserver(checkPayloadMarkers);
        observer.observe(elements.rawRequestInput, { childList: true, subtree: true, characterData: true });
    }

    // Bulk Replay Button
    if (bulkReplayBtn) {
        bulkReplayBtn.addEventListener('click', () => {
            if (bulkReplayBtn.disabled) return;
            if (bulkRunPhase !== 'idle') return;
            if (reviewSession) discardReview({ hideModal: false });

            const currentContent = elements.rawRequestInput.innerText || elements.rawRequestInput.textContent || '';
            const currentHasMarkers = /§[\s\S]*?§/.test(currentContent);
            const content = currentHasMarkers
                ? currentContent
                : state.bulkReplayTemplate;
            const matches = content.match(/§[\s\S]*?§/g);
            const count = matches ? matches.length : 0;

            if (!matches || count === 0) {
                alert('No payload positions found. Mark parameters with § to enable Bulk Replay.');
                return;
            }

            const isSavedTemplate = content === state.bulkReplayTemplate &&
                state.positionConfigs.length === matches.length;

            if (!isSavedTemplate) {
                state.bulkReplayTemplate = content;
                state.positionConfigs = matches.map((match, index) => ({
                    index,
                    originalValue: match.replace(/§/g, ''),
                    type: 'simple-list',
                    list: '',
                    numbers: { from: 1, to: 10, step: 1 }
                }));
                state.batteringRamConfig = {
                    type: 'simple-list',
                    list: '',
                    numbers: { from: 1, to: 10, step: 1 }
                };
                state.currentAttackType = 'sniper';
            }
            if (currentHasMarkers) {
                manualConfigurationContext = captureManualConfigurationContext();
            }

            hideReviewUI();
            renderModalConfiguration();
            if (startAttackBtn) startAttackBtn.disabled = false;
            bulkConfigModal.style.display = 'block';
        });
    }

    function populatePositionsContainer(matches) {
        const container = document.getElementById('positions-container');
        container.innerHTML = '';

        matches.forEach((match, index) => {
            const cleanValue = match.replace(/§/g, '');
            const card = document.createElement('div');
            card.className = 'position-card';
            card.dataset.index = index;
            card.innerHTML = `
                <div class="position-card-header">
                    <span class="position-title">Position ${index + 1}</span>
                    <span class="position-value">${escapeHtml(cleanValue.substring(0, 30))}${cleanValue.length > 30 ? '...' : ''}</span>
                </div>
                <div class="form-group">
                    <label>Payload Type</label>
                    <select class="payload-type-select form-control" data-index="${index}">
                        <option value="simple-list">Simple List</option>
                        <option value="numbers">Numbers</option>
                    </select>
                </div>
                <div class="payload-options-simple-list">
                    <div class="form-group">
                        <label>Payloads (one per line)</label>
                        <textarea class="payload-list-input form-control" rows="5" data-index="${index}" placeholder="admin&#10;user&#10;guest"></textarea>
                    </div>
                </div>
                <div class="payload-options-numbers" style="display: none;">
                    <div class="form-row">
                        <div class="form-group">
                            <label>From</label>
                            <input type="number" class="num-from-input form-control" data-index="${index}" value="1">
                        </div>
                        <div class="form-group">
                            <label>To</label>
                            <input type="number" class="num-to-input form-control" data-index="${index}" value="10">
                        </div>
                        <div class="form-group">
                            <label>Step</label>
                            <input type="number" class="num-step-input form-control" data-index="${index}" value="1">
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);

            const config = state.positionConfigs[index];
            const typeSelect = card.querySelector('.payload-type-select');
            const listInput = card.querySelector('.payload-list-input');
            const fromInput = card.querySelector('.num-from-input');
            const toInput = card.querySelector('.num-to-input');
            const stepInput = card.querySelector('.num-step-input');
            typeSelect.value = config.type;
            listInput.value = config.list;
            fromInput.value = config.numbers.from;
            toInput.value = config.numbers.to;
            stepInput.value = config.numbers.step;

            const updatePayloadType = () => {
                const simpleList = card.querySelector('.payload-options-simple-list');
                const numbers = card.querySelector('.payload-options-numbers');
                simpleList.style.display = typeSelect.value === 'simple-list' ? 'block' : 'none';
                numbers.style.display = typeSelect.value === 'numbers' ? 'block' : 'none';
            };

            typeSelect.addEventListener('change', (e) => {
                config.type = e.target.value;
                updatePayloadType();
                refreshReviewValidation();
            });
            listInput.addEventListener('input', () => {
                config.list = listInput.value;
                refreshReviewValidation();
            });
            [[fromInput, 'from'], [toInput, 'to'], [stepInput, 'step']].forEach(([input, key]) => {
                input.addEventListener('input', () => {
                    config.numbers[key] = input.value.trim() === '' ? Number.NaN : Number(input.value);
                    refreshReviewValidation();
                });
            });
            updatePayloadType();
        });
    }

    function populateBatteringRamConfig() {
        const container = document.getElementById('battering-ram-config');
        if (!container) return;

        const config = state.batteringRamConfig;
        const typeSelect = container.querySelector('.payload-type-select');
        const listInput = container.querySelector('.payload-list-input');
        const fromInput = container.querySelector('.num-from-input');
        const toInput = container.querySelector('.num-to-input');
        const stepInput = container.querySelector('.num-step-input');
        typeSelect.value = config.type;
        listInput.value = config.list;
        if (fromInput) fromInput.value = config.numbers.from;
        if (toInput) toInput.value = config.numbers.to;
        if (stepInput) stepInput.value = config.numbers.step;
        container.querySelector('.payload-options-simple-list').style.display = config.type === 'simple-list' ? 'block' : 'none';
        container.querySelector('.payload-options-numbers').style.display = config.type === 'numbers' ? 'block' : 'none';
    }

    if (attackTypeSelect) {
        attackTypeSelect.addEventListener('change', (e) => {
            state.currentAttackType = e.target.value;
            updateAttackTypeUI(e.target.value);
            refreshReviewValidation();
        });
    }

    function updateAttackTypeUI(attackType) {
        const positionsContainer = document.getElementById('positions-container');
        const batteringRamConfig = document.getElementById('battering-ram-config');
        const helpText = document.getElementById('attack-type-help');

        const helpTexts = {
            'sniper': 'Sniper: Tests each position independently with its own payloads. Others remain unchanged.',
            'battering-ram': 'Battering Ram: All positions receive the same payload value from a shared list.',
            'pitchfork': 'Pitchfork: Zips payloads across positions (index-wise). Stops at shortest list.',
            'cluster-bomb': 'Cluster Bomb: Tests all combinations of payloads across positions (Cartesian product).'
        };
        helpText.textContent = helpTexts[attackType] || '';

        if (attackType === 'battering-ram') {
            positionsContainer.style.display = 'none';
            batteringRamConfig.style.display = 'block';
        } else {
            positionsContainer.style.display = 'block';
            batteringRamConfig.style.display = 'none';
        }
    }

    function dismissBulkConfigModal() {
        if (reviewSession) {
            discardReview();
            return;
        }
        if (bulkRunPhase === 'starting' && activeStartAttempt) {
            activeStartAttempt.cancelled = true;
            activeStartAttempt = null;
            bulkRunPhase = 'idle';
            if (startAttackBtn) startAttackBtn.disabled = false;
        }
        if (bulkConfigModal) bulkConfigModal.style.display = 'none';
    }

    closeModalBtn?.addEventListener('click', dismissBulkConfigModal);
    reviewCancelBtn?.addEventListener('click', dismissBulkConfigModal);

    window.addEventListener('click', (e) => {
        if (e.target === bulkConfigModal) dismissBulkConfigModal();
    });

    const batteringRamTypeSelect = document.querySelector('#battering-ram-config .payload-type-select');
    if (batteringRamTypeSelect) {
        batteringRamTypeSelect.addEventListener('change', (e) => {
            const container = document.getElementById('battering-ram-config');
            const simpleList = container.querySelector('.payload-options-simple-list');
            const numbers = container.querySelector('.payload-options-numbers');
            if (e.target.value === 'simple-list') {
                simpleList.style.display = 'block';
                numbers.style.display = 'none';
            } else {
                simpleList.style.display = 'none';
                numbers.style.display = 'block';
            }
            state.batteringRamConfig.type = e.target.value;
            refreshReviewValidation();
        });

        document.getElementById('battering-ram-config').addEventListener('input', (e) => {
            if (e.target.classList.contains('payload-list-input')) {
                state.batteringRamConfig.list = e.target.value;
                refreshReviewValidation();
                return;
            }

            const numberKey = e.target.classList.contains('num-from-input') ? 'from' :
                e.target.classList.contains('num-to-input') ? 'to' :
                    e.target.classList.contains('num-step-input') ? 'step' : null;
            if (numberKey) {
                state.batteringRamConfig.numbers[numberKey] = e.target.value.trim() === ''
                    ? Number.NaN
                    : Number(e.target.value);
                refreshReviewValidation();
            }
        });
    }

    if (startAttackBtn) {
        startAttackBtn.addEventListener('click', () => {
            startBulkReplay();
        });
    }

    if (bulkStopBtn) {
        bulkStopBtn.addEventListener('click', () => {
            if (bulkStopBtn.dataset.state === 'paused') {
                state.shouldPauseBulk = false;
                bulkStopBtn.dataset.state = 'running';
                bulkStopBtn.title = 'Pause Attack';
                bulkStopBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor" />
                    </svg>
                `;
            } else {
                state.shouldPauseBulk = true;
                bulkStopBtn.dataset.state = 'paused';
                bulkStopBtn.title = 'Resume Attack';
                bulkStopBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                    </svg>
                `;
            }
        });
    }

    if (bulkCloseBtn) {
        bulkCloseBtn.addEventListener('click', () => {
            bulkReplayPane.style.display = 'none';
            verticalResizeHandle.style.display = 'none';
            state.shouldStopBulk = true;
        });
    }

    // Vertical Resize Handle
    let isVerticalResizing = false;
    if (verticalResizeHandle) {
        verticalResizeHandle.addEventListener('mousedown', (e) => {
            isVerticalResizing = true;
            document.body.style.cursor = 'row-resize';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isVerticalResizing) return;
            const containerHeight = document.querySelector('.main-content').offsetHeight;
            const newHeight = containerHeight - e.clientY;
            if (newHeight > 100 && newHeight < containerHeight - 100) {
                bulkReplayPane.style.height = `${newHeight}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isVerticalResizing = false;
            document.body.style.cursor = 'default';
        });
    }

    // Context Menu: Mark Payload
    const contextMenu = document.getElementById('context-menu');
    const markPayloadItem = contextMenu.querySelector('[data-action="mark-payload"]');
    if (markPayloadItem) {
        markPayloadItem.addEventListener('click', () => {
            // Use the selection information stored by `setupContextMenu` in `ui-utils.js`
            const targetType = contextMenu.dataset.target;
            const rawSelected = contextMenu.dataset.selectedText || '';
            const selectedText = rawSelected.trim();

            if (!selectedText) {
                contextMenu.classList.remove('show');
                return;
            }

            if (targetType === 'response') {
                addMarkedResponseMatcher(selectedText);
                contextMenu.classList.remove('show');
                return;
            }

            const editor = elements.rawRequestInput;
            if (!editor) {
                contextMenu.classList.remove('show');
                return;
            }

            const editorText = editor.textContent || editor.innerText || '';
            
            // Use stored character offsets if available (most accurate - handles duplicate text)
            // This fixes the bug where marking "admin" in password field would also mark it in email field
            let startIndex = -1;
            let lengthToUse = selectedText.length;
            
            if (contextMenu.dataset.charStart && contextMenu.dataset.charEnd) {
                // Use the exact character offsets from the selection
                startIndex = parseInt(contextMenu.dataset.charStart, 10);
                const endIndex = parseInt(contextMenu.dataset.charEnd, 10);
                lengthToUse = endIndex - startIndex;
                
                // Verify the text at this position matches (safety check)
                const textAtPosition = editorText.substring(startIndex, endIndex);
                if (textAtPosition !== selectedText && textAtPosition !== rawSelected) {
                    // Offsets might be stale (editor content changed), fall back to search
                    startIndex = -1;
                }
            }
            
            // Fallback: if offsets not available or invalid, search for the text
            if (startIndex === -1) {
                startIndex = editorText.indexOf(selectedText);
                
                // As a small safeguard, if the trimmed text isn't found, try the raw text
                if (startIndex === -1 && rawSelected) {
                    startIndex = editorText.indexOf(rawSelected);
                    if (startIndex !== -1) {
                        lengthToUse = rawSelected.length;
                    }
                }
            }

            if (startIndex === -1) {
                // If we can't reliably find the text, do nothing rather than
                // inserting at an incorrect position (like the start of the request)
                contextMenu.classList.remove('show');
                return;
            }
            const before = editorText.substring(0, startIndex);
            const middle = editorText.substring(startIndex, startIndex + lengthToUse);
            const after = editorText.substring(startIndex + lengthToUse);
            const newText = `${before}§${middle}§${after}`;

            editor.textContent = newText;

            // Re-apply HTTP highlighting and notify undo system for the request editor
            if (editor === elements.rawRequestInput) {
                const currentContent = editor.innerText || editor.textContent;
                editor.innerHTML = highlightHTTP(currentContent);
                // Trigger input so the undo stack captures this change
                const inputEvent = new Event('input', { bubbles: true });
                editor.dispatchEvent(inputEvent);
            }

            contextMenu.classList.remove('show');
        });
    }

    function effectivePositionConfigs(configuration) {
        if (configuration.attackType !== 'battering-ram') {
            return cloneConfiguration(configuration.positionConfigs);
        }
        return configuration.positionConfigs.map(position => ({
            ...cloneConfiguration(configuration.batteringRamConfig),
            index: position.index,
            originalValue: position.originalValue
        }));
    }

    async function startBulkReplay() {
        if (bulkRunPhase !== 'idle') return;

        const modalConfiguration = collectModalConfiguration();
        const activeContext = getActiveRepeaterContext();
        const reviewing = reviewSession !== null;
        let reviewedConfiguration = null;
        let attackType = modalConfiguration.attackType;
        let template = state.bulkReplayTemplate || elements.rawRequestInput.innerText || elements.rawRequestInput.textContent || '';
        let attackPositionConfigs = modalConfiguration.positionConfigs;
        let responseMatchers = modalConfiguration.responseMatchers;
        let responseMatchCaseSensitive = modalConfiguration.responseMatchCaseSensitive;
        const manualContext = manualConfigurationContext;
        const manualOwnerIsAvailable = !manualContext?.ownerRequest || state.requests.includes(manualContext.ownerRequest);
        let runOwner = manualContext && manualOwnerIsAvailable
            ? manualContext.ownerRequest
            : manualContext
                ? null
                : activeContext?.ownerRequest || state.selectedRequest;
        let runSourceId = manualContext?.sourceId ?? activeContext?.sourceId ?? null;
        let runSourceLabel = manualContext?.sourceLabel || activeContext?.label || 'Current Repeater source';
        let baselineResponse = manualContext?.baselineResponse ?? activeContext?.responseText ?? state.currentResponse ?? '';
        let scheme = manualContext?.scheme || (document.getElementById('use-https')?.checked ? 'https' : 'http');

        if (reviewing) {
            const validation = refreshReviewValidation();
            if (!validation?.valid) return;
            reviewedConfiguration = validation.config;
            attackType = reviewedConfiguration.attackType;
            template = reviewedConfiguration.template;
            attackPositionConfigs = effectivePositionConfigs(reviewedConfiguration);
            responseMatchers = reviewedConfiguration.responseMatchers;
            responseMatchCaseSensitive = reviewedConfiguration.responseMatchCaseSensitive;
            runOwner = reviewSession.snapshot.ownerRequest;
            runSourceId = reviewSession.snapshot.sourceId;
            runSourceLabel = reviewSession.snapshot.label;
            baselineResponse = reviewSession.snapshot.responseText ?? '';
            scheme = reviewSession.snapshot.scheme || (reviewSession.snapshot.useHttps ? 'https' : 'http');
        } else if (attackType === 'battering-ram') {
            attackPositionConfigs = modalConfiguration.positionConfigs.map(position => ({
                ...cloneConfiguration(modalConfiguration.batteringRamConfig),
                index: position.index,
                originalValue: position.originalValue
            }));
        }

        let projectedRequestCount;
        try {
            projectedRequestCount = calculateAttackRequestCount(attackType, attackPositionConfigs);
        } catch (error) {
            if (reviewing) {
                refreshReviewValidation(`Unable to calculate the attack request count: ${error.message}`);
            } else {
                alert(`Error generating attack requests: ${error.message}`);
            }
            return;
        }
        if (projectedRequestCount < 1) {
            if (reviewing) {
                refreshReviewValidation('The reviewed configuration must generate at least one request.');
            } else {
                alert('No requests generated. Please check your payload configuration.');
            }
            return;
        }

        const executionInputs = Object.freeze({
            reviewing,
            reviewedConfiguration,
            attackType,
            template,
            attackPositionConfigs: deepFreezeConfiguration(cloneConfiguration(attackPositionConfigs)),
            responseMatchers: deepFreezeConfiguration(cloneConfiguration(responseMatchers)),
            responseMatchCaseSensitive,
            projectedRequestCount,
            runOwner,
            runSourceId,
            runSourceLabel,
            baselineResponse,
            scheme,
            snapshot: reviewing ? reviewSession.snapshot : null
        });

        bulkRunPhase = 'starting';
        const startAttempt = { cancelled: false };
        activeStartAttempt = startAttempt;
        if (startAttackBtn) startAttackBtn.disabled = true;
        if (reviewing) refreshReviewValidation();
        let reviewOutcome = null;

        try {
            if (
                !executionInputs.reviewing &&
                executionInputs.attackType === 'cluster-bomb' &&
                executionInputs.projectedRequestCount > 1000 &&
                !confirm(`This will generate ${executionInputs.projectedRequestCount} requests. Continue?`)
            ) {
                return;
            }
            if (startAttempt.cancelled) return;

            const hasReplayPermission = await requestReplayPermission();
            if (startAttempt.cancelled) return;
            if (!hasReplayPermission) {
                if (executionInputs.reviewing) {
                    reviewOutcome = 'Host permission was denied or dismissed. No requests were sent; you can retry safely.';
                } else {
                    alert('The <all_urls> permission is required to start Bulk Replay.');
                }
                return;
            }

            if (executionInputs.reviewing) {
                const finalValidation = validateBulkReplayConfiguration(executionInputs.reviewedConfiguration, {
                    snapshot: executionInputs.snapshot,
                    maxRequests: CHAT_BULK_REPLAY_REQUEST_LIMIT
                });
                if (!finalValidation.valid || finalValidation.projectedRequestCount !== executionInputs.projectedRequestCount) {
                    reviewOutcome = finalValidation.errors.join(' ') || 'The reviewed configuration changed before execution.';
                    return;
                }
            }

            let attackRequests;
            try {
                attackRequests = generateAttackRequests(
                    executionInputs.attackType,
                    executionInputs.attackPositionConfigs,
                    executionInputs.template
                );
            } catch (error) {
                if (executionInputs.reviewing) {
                    reviewOutcome = `Unable to generate attack requests: ${error.message}. No requests were sent.`;
                } else {
                    alert(`Error generating attack requests: ${error.message}`);
                }
                return;
            }
            if (attackRequests.length !== executionInputs.projectedRequestCount) {
                if (executionInputs.reviewing) {
                    reviewOutcome = 'Generated request count did not match the reviewed projection. No requests were sent.';
                } else {
                    alert('Generated request count did not match the projected count.');
                }
                return;
            }
            if (startAttempt.cancelled) return;

            bulkRunPhase = 'running';
            if (executionInputs.reviewing) commitReview(executionInputs.reviewedConfiguration);
            bulkConfigModal.style.display = 'none';

            nextBulkRunId += 1;
            const runId = `bulk-run-${nextBulkRunId}`;
            const {
                responseMatchers,
                responseMatchCaseSensitive,
                runOwner,
                runSourceId,
                runSourceLabel,
                baselineResponse,
                scheme
            } = executionInputs;
            const continuationGuards = responseMatchers.filter(matcher => matcher.isContinuationGuard);

            if (elements.diffToggle) {
                elements.diffToggle.style.display = baselineResponse.trim() ? 'flex' : 'none';
            }

            bulkReplayPane.style.display = 'flex';
            verticalResizeHandle.style.display = 'block';
            invalidateActivatedResults();
            bulkResultsTable.innerHTML = '';
            resetBulkSort();
            state.shouldStopBulk = false;
            state.shouldPauseBulk = false;
            renderBulkRunStatus('Running', 'running');

            if (bulkStopBtn) {
                bulkStopBtn.dataset.state = 'running';
                bulkStopBtn.title = 'Pause Attack';
                bulkStopBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor" />
                    </svg>
                `;
            }

            const bulkResults = [];
            let completed = 0;
            const total = attackRequests.length;
            let runTerminationReason = null;
            bulkProgressBar.style.setProperty('--progress', '0%');
            bulkProgressText.textContent = `0/${total}`;

        for (let i = 0; i < total; i++) {
            if (state.shouldStopBulk) break;

            while (state.shouldPauseBulk) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (state.shouldStopBulk) break;
            }

            if (state.shouldStopBulk) break;

            const { requestContent } = attackRequests[i];
            const payloadText = attackRequests[i].payloads.join(', ');

            const row = document.createElement('tr');
            row.dataset.index = i;
            row.dataset.sortId = String(i + 1);
            row.dataset.sortPayload = payloadText;
            row.dataset.sortStatus = '';
            row.dataset.sortSize = '';
            row.dataset.sortTime = '';
            row.dataset.sortMatches = '—';
            row.innerHTML = `
                <td>${i + 1}</td>
                <td>${escapeHtml(payloadText)}</td>
                <td class="status-cell">Sending...</td>
                <td class="size-cell">-</td>
                <td class="time-cell">-</td>
                <td class="matches-cell empty">—</td>
            `;
            bulkResultsTable.appendChild(row);
            applyBulkResultsSort();
            row.scrollIntoView({ behavior: 'smooth', block: 'end' });

            row.addEventListener('click', () => {
                bulkResultsTable.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');

                const result = bulkResults[i];
                if (result) {
                    if (
                        result.runOwner && (
                            !isRepeaterOwnerValid(result.runOwner) ||
                            !canActivateRepeaterSource(result.sourceId, result.runOwner)
                        )
                    ) {
                        renderBulkRunStatus('Source request was removed; this result can no longer be opened.', 'error');
                        return;
                    }
                    elements.rawRequestInput.innerText = result.requestContent;
                    const rawRequestTextarea = elements.rawRequestTextarea || document.getElementById('raw-request-textarea');
                    if (rawRequestTextarea) rawRequestTextarea.value = result.requestContent;
                    const useHttpsCheckbox = elements.useHttpsCheckbox || document.getElementById('use-https');
                    if (useHttpsCheckbox) useHttpsCheckbox.checked = result.scheme === 'https';
                    checkPayloadMarkers();
                    state.currentResponse = result.rawResponse;
                    state.regularRequestBaseline = baselineResponse.trim() ? baselineResponse : null;

                    elements.resStatus.textContent = result.statusText ? `${result.status} ${result.statusText}` : result.status;
                    elements.resStatus.className = 'status-badge';
                    if (result.status >= 200 && result.status < 300) elements.resStatus.classList.add('status-2xx');
                    else if (result.status >= 400 && result.status < 500) elements.resStatus.classList.add('status-4xx');
                    else if (result.status >= 500) elements.resStatus.classList.add('status-5xx');

                    elements.resTime.textContent = result.duration;
                    elements.resSize.textContent = formatBytes(result.size);

                    events.emit(EVENT_NAMES.UI_UPDATE_RESPONSE_VIEW, {
                        status: elements.resStatus.textContent,
                        statusClass: elements.resStatus.className,
                        time: result.duration,
                        size: formatBytes(result.size),
                        content: result.rawResponse
                    });

                    if (result.error) {
                        elements.rawResponseDisplay.textContent = result.rawResponse;
                    } else {
                        if (elements.showDiffCheckbox && elements.showDiffCheckbox.checked && baselineResponse.trim() && typeof Diff !== 'undefined') {
                            elements.rawResponseDisplay.innerHTML = renderDiff(baselineResponse, result.rawResponse);
                        } else {
                            elements.rawResponseDisplay.innerHTML = highlightHTTP(result.rawResponse);
                        }

                        const highlightMatchers = (result.responseMatches || []).map(matcher => ({
                            ...matcher,
                            mode: 'partial'
                        }));
                        highlightResponseMatches(elements.rawResponseDisplay, highlightMatchers, {
                            caseSensitive: result.responseMatchCaseSensitive
                        });
                    }

                    if (result.runOwner) {
                        activateRepeaterContext({
                            ownerRequest: result.runOwner,
                            sourceId: result.sourceId,
                            kind: 'bulk-result',
                            label: result.sourceLabel,
                            responseText: result.rawResponse
                        });
                        activatedResultSourceIds.add(result.sourceId);
                        visibleResultSourceId = result.sourceId;
                    }
                }
            });

            const startTime = performance.now();
            let terminationReason = null;

            try {
                // We duplicate parse logic here or import it. 
                // Since this is inside the loop and needs to be fast, and slightly different (no UI update), we can keep it or import `parseRequest` from network.js
                // But `parseRequest` in network.js is designed for the main editor.
                // Let's just use fetch directly as in original code for now to minimize risk.

                const lines = requestContent.split('\n');
                if (lines.length === 0) throw new Error('No content');

                const requestLine = lines[0].trim();
                const reqLineParts = requestLine.split(' ');
                if (reqLineParts.length < 2) throw new Error('Invalid Request Line');

                const method = reqLineParts[0].toUpperCase();
                const path = reqLineParts[1];

                let headers = {};
                let bodyLines = [];
                let isBody = false;
                let host = '';

                for (let j = 1; j < lines.length; j++) {
                    const line = lines[j];
                    if (!isBody) {
                        if (line.trim() === '') {
                            isBody = true;
                            continue;
                        }
                        if (line.trim().startsWith(':')) continue;

                        const colonIndex = line.indexOf(':');
                        if (colonIndex > 0) {
                            const key = line.substring(0, colonIndex).trim();
                            const value = line.substring(colonIndex + 1).trim();
                            if (key && value) {
                                if (key.toLowerCase() === 'host') host = value;
                                else headers[key] = value;
                            }
                        }
                    } else {
                        bodyLines.push(line);
                    }
                }

                const hasAbsoluteTarget = /^https?:\/\//i.test(path);
                if (!host && !hasAbsoluteTarget) throw new Error('Host header missing');

                let url = path;
                if (!hasAbsoluteTarget) {
                    url = `${scheme}://${host}${path}`;
                }

                const body = bodyLines.join('\n');

                const options = {
                    method: method,
                    headers: headers
                };

                if (method !== 'GET' && method !== 'HEAD') {
                    options.body = body;
                }

                const response = await fetch(url, options);
                const endTime = performance.now();
                const responseBody = await response.text();
                const responseSize = new TextEncoder().encode(responseBody).length;
                const durationMilliseconds = endTime - startTime;
                const duration = `${durationMilliseconds.toFixed(0)}ms`;
                const rawResponse = formatRawResponse({
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    body: responseBody
                });

                const responseMatches = getMatchedResponseMatchers(responseBody, responseMatchers, {
                    caseSensitive: responseMatchCaseSensitive
                });
                const continuationGuardMatched = continuationGuards.length === 0 || continuationGuards.some(
                    matcher => responseMatcherMatches(responseBody, matcher, {
                        caseSensitive: responseMatchCaseSensitive
                    })
                );
                if (!continuationGuardMatched) terminationReason = 'guard-mismatch';

                bulkResults[i] = {
                    requestContent: requestContent,
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    responseBody: responseBody,
                    size: responseSize,
                    duration: duration,
                    responseMatches,
                    responseMatchCaseSensitive,
                    terminationReason,
                    error: null,
                    rawResponse,
                    scheme,
                    runOwner,
                    runSourceId,
                    runSourceLabel,
                    sourceId: `${runId}-result-${i + 1}`,
                    sourceLabel: `Bulk Replay result #${i + 1}`
                };

                row.querySelector('.status-cell').textContent = `${response.status} ${response.statusText}`;
                row.querySelector('.size-cell').textContent = formatBytes(responseSize);
                row.querySelector('.time-cell').textContent = duration;
                renderResponseMatches(row.querySelector('.matches-cell'), responseMatches, {
                    configuredMatcherCount: responseMatchers.length
                });
                row.dataset.sortStatus = String(response.status);
                row.dataset.sortSize = String(responseSize);
                row.dataset.sortTime = String(durationMilliseconds);
                row.dataset.sortMatches = row.querySelector('.matches-cell').textContent;
                row.classList.toggle('has-response-match', responseMatches.length > 0);
                row.classList.toggle('has-no-response-match', responseMatchers.length > 0 && responseMatches.length === 0);
                applyBulkResultsSort();

            } catch (error) {
                const endTime = performance.now();
                console.error(error);
                if (continuationGuards.length > 0) terminationReason = 'guard-check-failed';

                bulkResults[i] = {
                    requestContent: requestContent,
                    status: 'Error',
                    statusText: '',
                    headers: null,
                    responseBody: '',
                    size: 0,
                    duration: `${(endTime - startTime).toFixed(0)}ms`,
                    responseMatches: [],
                    responseMatchCaseSensitive,
                    terminationReason,
                    error: error.message,
                    rawResponse: error.message,
                    scheme,
                    runOwner,
                    runSourceId,
                    runSourceLabel,
                    sourceId: `${runId}-result-${i + 1}`,
                    sourceLabel: `Bulk Replay result #${i + 1}`
                };

                row.querySelector('.status-cell').textContent = 'Error';
                row.querySelector('.status-cell').title = error.message;
                renderResponseMatches(row.querySelector('.matches-cell'), [], {
                    configuredMatcherCount: responseMatchers.length,
                    error: true
                });
                row.dataset.sortStatus = '';
                row.dataset.sortSize = '';
                row.dataset.sortTime = '';
                row.dataset.sortMatches = row.querySelector('.matches-cell').textContent;
                applyBulkResultsSort();
            }

            if (terminationReason) {
                row.classList.add('is-continuation-terminal');
                row.dataset.terminationReason = terminationReason;
            }

            completed++;
            const progress = (completed / total) * 100;
            bulkProgressBar.style.setProperty('--progress', `${progress}%`);
            bulkProgressText.textContent = `${completed}/${total}`;

            if (terminationReason) {
                runTerminationReason = terminationReason;
                const reason = terminationReason === 'guard-mismatch'
                    ? 'no continuation guard matched'
                    : 'continuation condition could not be checked';
                renderBulkRunStatus(`Stopped at #${i + 1}: ${reason}`, 'stopped');
                break;
            }
        }

            if (!runTerminationReason && completed === total) {
                renderBulkRunStatus('Completed', 'completed');
            } else if (!runTerminationReason && state.shouldStopBulk) {
                renderBulkRunStatus('Canceled', 'canceled');
            }
        } catch (error) {
            console.error('Bulk Replay failed:', error);
            if (bulkRunPhase === 'running') {
                renderBulkRunStatus(`Failed: ${error.message}`, 'error');
            } else if (reviewSession) {
                reviewOutcome = `Bulk Replay could not start: ${error.message}. No requests were sent.`;
            } else {
                alert(`Bulk Replay could not start: ${error.message}`);
            }
        } finally {
            if (activeStartAttempt === startAttempt) {
                bulkRunPhase = 'idle';
                activeStartAttempt = null;
                if (reviewSession) {
                    refreshReviewValidation(reviewOutcome);
                } else if (startAttackBtn) {
                    startAttackBtn.disabled = false;
                }
            }
        }
    }

    return Object.freeze({ reviewDraft, discardReview, getStatus });
}
