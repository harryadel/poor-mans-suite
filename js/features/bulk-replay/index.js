// Bulk Replay Logic
import { state } from '../../core/state.js';
import { elements } from '../../ui/main-ui.js';
import { generateAttackRequests } from './engine.js';
import { formatBytes } from '../../core/utils/format.js';
import { highlightHTTP } from '../../core/utils/network.js';
import { renderDiff } from '../../core/utils/misc.js';
import { escapeHtml } from '../../core/utils/dom.js';
import { requestReplayPermission } from '../../network/permissions.js';
import {
    getMatchedResponseMatchers,
    highlightResponseMatches,
    normalizeResponseMatchers,
    responseMatcherMatches
} from './response-matches.js';

export function setupBulkReplay() {
    const bulkReplayBtn = document.getElementById('bulk-replay-btn');
    const bulkConfigModal = document.getElementById('bulk-config-modal');
    const closeModalBtn = document.querySelector('.close-modal');
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
    const numericSortKeys = new Set(['id', 'status', 'size', 'time']);
    let bulkSortState = { key: null, direction: 'ascending' };

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

    function readResponseMatchers() {
        if (!responseMatchersContainer) return [];

        return normalizeResponseMatchers(
            Array.from(responseMatchersContainer.querySelectorAll('.response-matcher-row')).map(row => ({
                text: row.querySelector('.response-matcher-text')?.value || '',
                mode: row.querySelector('.response-matcher-mode')?.value || 'partial',
                isContinuationGuard: row.querySelector('.response-matcher-continuation-guard')?.checked === true
            }))
        );
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
    }

    renderResponseMatcherConfig();

    addResponseMatcherBtn?.addEventListener('click', () => {
        state.responseMatchers = readResponseMatchers();
        appendResponseMatcherRow({ text: '', mode: 'partial', isContinuationGuard: false }, true);
    });

    if (responseMatchCaseSensitiveInput) {
        responseMatchCaseSensitiveInput.checked = state.responseMatchCaseSensitive;
        responseMatchCaseSensitiveInput.addEventListener('change', () => {
            state.responseMatchCaseSensitive = responseMatchCaseSensitiveInput.checked;
        });
    }

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

            const currentContent = elements.rawRequestInput.innerText;
            const content = /§[\s\S]*?§/.test(currentContent)
                ? currentContent
                : state.bulkReplayTemplate;
            const matches = content.match(/§[\s\S]*?§/g);
            const count = matches ? matches.length : 0;
            document.getElementById('payload-count').textContent = count;

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

            populatePositionsContainer(matches);
            populateBatteringRamConfig();

            document.getElementById('attack-type').value = state.currentAttackType;
            updateAttackTypeUI(state.currentAttackType);

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
                    <span class="position-value">${cleanValue.substring(0, 30)}${cleanValue.length > 30 ? '...' : ''}</span>
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
            });
            listInput.addEventListener('input', () => {
                config.list = listInput.value;
            });
            [[fromInput, 'from'], [toInput, 'to'], [stepInput, 'step']].forEach(([input, key]) => {
                input.addEventListener('input', () => {
                    const value = parseInt(input.value, 10);
                    if (!Number.isNaN(value)) config.numbers[key] = value;
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

    const attackTypeSelect = document.getElementById('attack-type');
    if (attackTypeSelect) {
        attackTypeSelect.addEventListener('change', (e) => {
            state.currentAttackType = e.target.value;
            updateAttackTypeUI(e.target.value);
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

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            bulkConfigModal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === bulkConfigModal) {
            bulkConfigModal.style.display = 'none';
        }
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
        });

        document.getElementById('battering-ram-config').addEventListener('input', (e) => {
            if (e.target.classList.contains('payload-list-input')) {
                state.batteringRamConfig.list = e.target.value;
                return;
            }

            const numberKey = e.target.classList.contains('num-from-input') ? 'from' :
                e.target.classList.contains('num-to-input') ? 'to' :
                    e.target.classList.contains('num-step-input') ? 'step' : null;
            const value = parseInt(e.target.value, 10);
            if (numberKey && !Number.isNaN(value)) state.batteringRamConfig.numbers[numberKey] = value;
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

    async function startBulkReplay() {
        const template = state.bulkReplayTemplate || elements.rawRequestInput.innerText;
        const responseMatchers = readResponseMatchers();
        const continuationGuards = responseMatchers.filter(matcher => matcher.isContinuationGuard);
        const responseMatchCaseSensitive = responseMatchCaseSensitiveInput?.checked ?? true;

        state.responseMatchers = responseMatchers;
        state.responseMatchCaseSensitive = responseMatchCaseSensitive;

        let attackPositionConfigs = state.positionConfigs;
        if (state.currentAttackType === 'battering-ram') {
            const container = document.getElementById('battering-ram-config');
            const type = container.querySelector('.payload-type-select').value;
            state.batteringRamConfig = {
                type,
                list: container.querySelector('.payload-list-input').value,
                numbers: {
                    from: parseInt(container.querySelector('.num-from-input').value),
                    to: parseInt(container.querySelector('.num-to-input').value),
                    step: parseInt(container.querySelector('.num-step-input').value)
                }
            };

            attackPositionConfigs = state.positionConfigs.map(config => ({
                ...config,
                type: state.batteringRamConfig.type,
                list: state.batteringRamConfig.list,
                numbers: { ...state.batteringRamConfig.numbers }
            }));
        } else {
            const cards = document.querySelectorAll('.position-card');
            cards.forEach((card, index) => {
                const type = card.querySelector('.payload-type-select').value;
                state.positionConfigs[index].type = type;
                state.positionConfigs[index].list = card.querySelector('.payload-list-input').value;
                state.positionConfigs[index].numbers = {
                    from: parseInt(card.querySelector('.num-from-input').value),
                    to: parseInt(card.querySelector('.num-to-input').value),
                    step: parseInt(card.querySelector('.num-step-input').value)
                };
            });
        }

        let attackRequests;
        try {
            attackRequests = generateAttackRequests(state.currentAttackType, attackPositionConfigs, template);
        } catch (error) {
            alert(`Error generating attack requests: ${error.message}`);
            return;
        }

        if (attackRequests.length === 0) {
            alert('No requests generated. Please check your payload configuration.');
            return;
        }

        if (state.currentAttackType === 'cluster-bomb' && attackRequests.length > 1000) {
            if (!confirm(`This will generate ${attackRequests.length} requests. Continue?`)) {
                return;
            }
        }

        const hasReplayPermission = await requestReplayPermission();
        if (!hasReplayPermission) {
            alert('The <all_urls> permission is required to start Bulk Replay.');
            return;
        }

        bulkConfigModal.style.display = 'none';

        let baselineResponse = elements.rawResponseDisplay.textContent || '';
        if (baselineResponse.trim()) {
            elements.diffToggle.style.display = 'flex';
        }

        bulkReplayPane.style.display = 'flex';
        verticalResizeHandle.style.display = 'block';
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
        const useHttps = document.getElementById('use-https').checked;
        const scheme = useHttps ? 'https' : 'http';

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
                    elements.rawRequestInput.innerText = result.requestContent;
                    checkPayloadMarkers();

                    elements.resStatus.textContent = result.statusText ? `${result.status} ${result.statusText}` : result.status;
                    elements.resStatus.className = 'status-badge';
                    if (result.status >= 200 && result.status < 300) elements.resStatus.classList.add('status-2xx');
                    else if (result.status >= 400 && result.status < 500) elements.resStatus.classList.add('status-4xx');
                    else if (result.status >= 500) elements.resStatus.classList.add('status-5xx');

                    elements.resTime.textContent = result.duration;
                    elements.resSize.textContent = formatBytes(result.size);

                    if (result.error) {
                        elements.rawResponseDisplay.textContent = result.error;
                    } else {
                        let rawResponse = `HTTP/1.1 ${result.status} ${result.statusText}\n`;
                        if (result.headers) {
                            result.headers.forEach((val, key) => {
                                rawResponse += `${key}: ${val}\n`;
                            });
                        }
                        rawResponse += '\n';

                        try {
                            const json = JSON.parse(result.responseBody);
                            rawResponse += JSON.stringify(json, null, 2);
                        } catch (e) {
                            rawResponse += result.responseBody;
                        }

                        if (elements.showDiffCheckbox && elements.showDiffCheckbox.checked && baselineResponse.trim() && typeof Diff !== 'undefined') {
                            elements.rawResponseDisplay.innerHTML = renderDiff(baselineResponse, rawResponse);
                        } else {
                            elements.rawResponseDisplay.innerHTML = highlightHTTP(rawResponse);
                        }

                        const highlightMatchers = (result.responseMatches || []).map(matcher => ({
                            ...matcher,
                            mode: 'partial'
                        }));
                        highlightResponseMatches(elements.rawResponseDisplay, highlightMatchers, {
                            caseSensitive: result.responseMatchCaseSensitive
                        });
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

                if (!host) throw new Error('Host header missing');

                let url = path;
                if (!path.startsWith('http')) {
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
                    error: null
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
                    error: error.message
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
        }
    }
}
