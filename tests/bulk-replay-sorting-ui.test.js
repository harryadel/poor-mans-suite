import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiMocks = vi.hoisted(() => ({ elements: {} }));

vi.mock('../js/ui/main-ui.js', () => ({ elements: uiMocks.elements }));
vi.mock('../js/network/permissions.js', () => ({
  requestReplayPermission: vi.fn().mockResolvedValue(true)
}));

import { state } from '../js/core/state.js';
import { setupBulkReplay } from '../js/features/bulk-replay/index.js';
import {
  activateRepeaterContext,
  captureRepeaterContext,
  clearRepeaterContext,
  getActiveRepeaterContext,
  invalidateRepeaterOwner,
  invalidateRepeaterSource,
  isRepeaterSnapshotValid
} from '../js/features/repeater-context.js';

const sortHeaders = ['id', 'payload', 'status', 'size', 'time', 'matches']
  .map(key => `
    <th scope="col" data-sort-key="${key}" aria-sort="none">
      <button type="button" class="bulk-sort-button">${key}</button>
    </th>
  `).join('');

function getResultIds() {
  return Array.from(document.querySelectorAll('#bulk-results-table tbody tr'))
    .map(row => Number(row.dataset.sortId));
}

function createResponse(status, statusText, body) {
  return {
    status,
    statusText,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(body)
  };
}

function createDeferred() {
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function addContinuationGuard(text) {
  document.getElementById('add-response-matcher').click();
  const rows = document.querySelectorAll('.response-matcher-row');
  const row = rows[rows.length - 1];
  const textInput = row.querySelector('.response-matcher-text');
  textInput.value = text;
  textInput.dispatchEvent(new Event('input'));
  row.querySelector('.response-matcher-continuation-guard').click();
}

describe('Bulk Replay result sorting UI', () => {
  beforeEach(() => {
    clearRepeaterContext();
    document.body.innerHTML = `
      <button id="bulk-replay-btn" disabled></button>
      <div id="bulk-config-modal"><button class="close-modal"></button></div>
      <button id="start-attack-btn"></button>
      <div id="bulk-replay-pane"></div>
      <table id="bulk-results-table"><thead><tr>${sortHeaders}</tr></thead><tbody></tbody></table>
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
    Object.assign(uiMocks.elements, {
      rawRequestInput,
      rawResponseDisplay: document.createElement('div'),
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
    state.currentResponse = null;
    state.selectedRequest = {
      request: {
        method: 'GET',
        url: 'https://example.test/login',
        headers: []
      }
    };
    state.requests = [state.selectedRequest];

    Element.prototype.scrollIntoView = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue(createResponse(200, 'OK', 'response'));
  });

  it('exposes an accessible sort control for every results column', () => {
    const panelHtml = readFileSync(resolve(process.cwd(), 'panel.html'), 'utf8');
    const panelDocument = new DOMParser().parseFromString(panelHtml, 'text/html');
    const headers = Array.from(panelDocument.querySelectorAll('#bulk-results-table thead th'));

    expect(headers.map(header => header.dataset.sortKey)).toEqual([
      'id',
      'payload',
      'status',
      'size',
      'time',
      'matches'
    ]);
    expect(headers.every(header => header.getAttribute('aria-sort') === 'none')).toBe(true);
    expect(headers.map(header => header.querySelector('button')?.getAttribute('aria-label'))).toEqual([
      'Sort by ID',
      'Sort by Payload',
      'Sort by Status',
      'Sort by Size',
      'Sort by Time',
      'Sort by Matches'
    ]);
    expect(headers.every(header => header.querySelector('button')?.type === 'button')).toBe(true);
  });

  it('exposes an accessible run-status region', () => {
    const panelHtml = readFileSync(resolve(process.cwd(), 'panel.html'), 'utf8');
    const panelDocument = new DOMParser().parseFromString(panelHtml, 'text/html');
    const runStatus = panelDocument.getElementById('bulk-run-status');

    expect(runStatus?.getAttribute('role')).toBe('status');
    expect(runStatus?.getAttribute('aria-live')).toBe('polite');
  });

  it('wires the Bulk Replay controller into chat and exposes a hidden semantic review boundary', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'js/main.js'), 'utf8');
    const panelHtml = readFileSync(resolve(process.cwd(), 'panel.html'), 'utf8');
    const panelDocument = new DOMParser().parseFromString(panelHtml, 'text/html');
    const review = panelDocument.getElementById('bulk-chat-review');

    expect(mainSource).toMatch(/const bulkReplay = setupBulkReplay\(\);/);
    expect(mainSource).toMatch(/setupLLMChat\(elements, \{ bulkReplay \}\)/);
    expect(review?.hidden).toBe(true);
    expect(review?.getAttribute('aria-labelledby')).toBe('bulk-chat-review-title');
    expect(panelDocument.getElementById('bulk-review-validation')?.getAttribute('role')).toBe('status');
    expect(panelDocument.getElementById('bulk-review-validation')?.getAttribute('aria-live')).toBe('polite');
    expect(panelDocument.getElementById('bulk-review-hard-limit')?.textContent).toContain('1,000 requests');
    expect(panelDocument.getElementById('bulk-review-template')).not.toBeNull();
    expect(review?.textContent).toContain('Start Attack is a separate confirmation');
    expect(review?.textContent).toContain('optional host permission');
    expect(panelDocument.getElementById('cancel-bulk-review-btn')?.hidden).toBe(true);
  });

  it('updates the active header state and sort direction', () => {
    setupBulkReplay();
    document.querySelector('#bulk-results-table tbody').innerHTML = `
      <tr data-sort-id="1" data-sort-payload="charlie" data-sort-status="500"></tr>
      <tr data-sort-id="2" data-sort-payload="alpha" data-sort-status="200"></tr>
      <tr data-sort-id="3" data-sort-payload="bravo" data-sort-status="404"></tr>
    `;

    const statusHeader = document.querySelector('th[data-sort-key="status"]');
    statusHeader.querySelector('button').click();

    expect(getResultIds()).toEqual([2, 3, 1]);
    expect(statusHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(document.querySelectorAll('th[aria-sort="none"]')).toHaveLength(5);

    statusHeader.querySelector('button').click();
    expect(getResultIds()).toEqual([1, 3, 2]);
    expect(statusHeader.getAttribute('aria-sort')).toBe('descending');

    const payloadHeader = document.querySelector('th[data-sort-key="payload"]');
    payloadHeader.querySelector('button').click();
    expect(getResultIds()).toEqual([2, 3, 1]);
    expect(payloadHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(statusHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('uses canonical numeric and case-insensitive text values with ID tie-breaking', () => {
    setupBulkReplay();
    document.querySelector('#bulk-results-table tbody').innerHTML = `
      <tr data-sort-id="10" data-sort-payload="Zulu" data-sort-status="500" data-sort-size="1024" data-sort-time="100" data-sort-matches="Beta">
        <td>10</td><td>Zulu</td><td>500</td><td>1 KB</td><td>100ms</td><td>Beta</td>
      </tr>
      <tr data-sort-id="2" data-sort-payload="alpha" data-sort-status="200" data-sort-size="900" data-sort-time="20" data-sort-matches="gamma">
        <td>2</td><td>alpha</td><td>200</td><td>900 B</td><td>20ms</td><td>gamma</td>
      </tr>
      <tr data-sort-id="1" data-sort-payload="Bravo" data-sort-status="404" data-sort-size="1024" data-sort-time="3" data-sort-matches="Alpha">
        <td>1</td><td>Bravo</td><td>404</td><td>1 KB</td><td>3ms</td><td>Alpha</td>
      </tr>
      <tr data-sort-id="3" data-sort-payload="delta" data-sort-status="" data-sort-size="" data-sort-time="" data-sort-matches="Not checked">
        <td>3</td><td>delta</td><td>Error</td><td>-</td><td>-</td><td>Not checked</td>
      </tr>
    `;

    const sortAscending = key => document.querySelector(`th[data-sort-key="${key}"] button`).click();

    sortAscending('id');
    expect(getResultIds()).toEqual([1, 2, 3, 10]);

    sortAscending('payload');
    expect(getResultIds()).toEqual([2, 1, 3, 10]);

    sortAscending('status');
    expect(getResultIds()).toEqual([2, 1, 10, 3]);

    sortAscending('size');
    expect(getResultIds()).toEqual([2, 1, 10, 3]);

    sortAscending('time');
    expect(getResultIds()).toEqual([1, 2, 10, 3]);

    sortAscending('matches');
    expect(getResultIds()).toEqual([1, 10, 2, 3]);
  });

  it('reapplies live sorting, preserves selected results, and resets for a new attack', async () => {
    const firstResponse = createDeferred();
    const secondResponse = createDeferred();
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
      .mockResolvedValue(createResponse(201, 'Created', 'next attack'));

    setupBulkReplay();
    document.getElementById('bulk-replay-btn').click();
    const payloadInput = document.querySelector('.position-card .payload-list-input');
    payloadInput.value = 'first\nsecond';
    document.getElementById('start-attack-btn').click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    const statusHeader = document.querySelector('th[data-sort-key="status"]');
    statusHeader.querySelector('button').click();
    firstResponse.resolve(createResponse(500, 'Server Error', 'first response'));

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    document.querySelector('tr[data-sort-id="1"]').click();
    expect(uiMocks.elements.rawRequestInput.innerText).toContain('first');

    secondResponse.resolve(createResponse(200, 'OK', 'second response'));
    await vi.waitFor(() => {
      expect(document.getElementById('bulk-progress-text').textContent).toBe('2/2');
      expect(getResultIds()).toEqual([2, 1]);
    });

    expect(document.querySelector('tr.selected')?.dataset.sortId).toBe('1');
    document.querySelector('tr[data-sort-id="2"]').click();
    expect(uiMocks.elements.rawRequestInput.innerText).toContain('second');

    document.getElementById('start-attack-btn').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(statusHeader.getAttribute('aria-sort')).toBe('none');
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(2);
      expect(getResultIds()).toEqual([1, 2]);
    });
  });

  it('keeps a guard terminal marker on its execution result while sorting', async () => {
    const firstResponse = createDeferred();
    const secondResponse = createDeferred();
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);

    setupBulkReplay();
    document.getElementById('bulk-replay-btn').click();
    document.querySelector('.position-card .payload-list-input').value = 'zeta\nalpha';
    addContinuationGuard('Invalid username');
    document.getElementById('start-attack-btn').click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#bulk-results-table tbody tr')).toHaveLength(1);
    });
    document.querySelector('th[data-sort-key="payload"] button').click();
    firstResponse.resolve(createResponse(200, 'OK', 'Invalid username'));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(getResultIds()).toEqual([2, 1]);
    });
    secondResponse.resolve(createResponse(200, 'OK', 'Welcome back'));

    await vi.waitFor(() => {
      expect(document.getElementById('bulk-run-status').textContent)
        .toBe('Stopped at #2: no continuation guard matched');
    });

    expect(document.querySelector('.is-continuation-terminal')?.dataset.sortId).toBe('2');
    expect(document.querySelector('.is-continuation-terminal')?.dataset.terminationReason)
      .toBe('guard-mismatch');
    expect(state.shouldStopBulk).toBe(false);
    expect(state.shouldPauseBulk).toBe(false);

    document.querySelector('th[data-sort-key="id"] button').click();
    expect(getResultIds()).toEqual([1, 2]);
    expect(document.querySelector('tr[data-sort-id="2"]')?.classList.contains('is-continuation-terminal'))
      .toBe(true);
  });

  it('activates only the selected run-owned raw result and invalidates replaced result sources', async () => {
    globalThis.fetch = vi.fn(url => Promise.resolve(createResponse(
      200,
      'OK',
      url.includes('first') ? 'first raw response' : 'second raw response'
    )));

    setupBulkReplay();
    document.getElementById('bulk-replay-btn').click();
    document.querySelector('.position-card .payload-list-input').value = 'first\nsecond';
    document.getElementById('start-attack-btn').click();

    await vi.waitFor(() => {
      expect(document.getElementById('bulk-progress-text').textContent).toBe('2/2');
    });

    document.querySelector('tr[data-sort-id="1"]').click();
    const firstContext = getActiveRepeaterContext();
    const firstSnapshot = captureRepeaterContext({
      requestText: uiMocks.elements.rawRequestInput.innerText,
      useHttps: true
    });
    expect(firstContext).toMatchObject({
      ownerRequest: state.selectedRequest,
      kind: 'bulk-result',
      label: 'Bulk Replay result #1',
      responseText: expect.stringContaining('first raw response')
    });

    document.querySelector('tr[data-sort-id="2"]').click();
    const secondContext = getActiveRepeaterContext();
    const secondSnapshot = captureRepeaterContext({
      requestText: uiMocks.elements.rawRequestInput.innerText,
      useHttps: true
    });
    expect(secondContext.sourceId).not.toBe(firstContext.sourceId);
    expect(secondContext.responseText).toContain('second raw response');
    expect(secondContext.responseText).not.toContain('first raw response');
    expect(state.currentResponse).toBe(secondContext.responseText);

    document.getElementById('start-attack-btn').click();
    await vi.waitFor(() => {
      expect(isRepeaterSnapshotValid(firstSnapshot)).toBe(false);
      expect(isRepeaterSnapshotValid(secondSnapshot)).toBe(false);
    });
  });

  it('clears a visible result and refuses unopened rows after the owner is removed', async () => {
    activateRepeaterContext({
      ownerRequest: state.selectedRequest,
      kind: 'captured',
      label: 'Captured request',
      responseText: null
    });
    setupBulkReplay();
    document.getElementById('bulk-replay-btn').click();
    document.querySelector('.position-card .payload-list-input').value = 'first\nsecond';
    document.getElementById('start-attack-btn').click();
    await vi.waitFor(() => {
      expect(document.getElementById('bulk-progress-text').textContent).toBe('2/2');
    });

    document.querySelector('tr[data-sort-id="1"]').click();
    expect(getActiveRepeaterContext()?.kind).toBe('bulk-result');

    invalidateRepeaterOwner(state.selectedRequest);

    expect(uiMocks.elements.rawRequestInput.innerText).toBe('');
    expect(state.currentResponse).toBeNull();
    expect(getActiveRepeaterContext()).toBeNull();

    document.querySelector('tr[data-sort-id="2"]').click();
    expect(uiMocks.elements.rawRequestInput.innerText).toBe('');
    expect(getActiveRepeaterContext()).toBeNull();
    expect(document.getElementById('bulk-run-status').textContent).toContain('Source request was removed');
  });

  it('does not clear another source after a previously selected result is invalidated', async () => {
    activateRepeaterContext({
      ownerRequest: state.selectedRequest,
      kind: 'captured',
      label: 'Captured request',
      responseText: null
    });
    setupBulkReplay();
    document.getElementById('bulk-replay-btn').click();
    document.querySelector('.position-card .payload-list-input').value = 'first';
    document.getElementById('start-attack-btn').click();
    await vi.waitFor(() => {
      expect(document.getElementById('bulk-progress-text').textContent).toBe('1/1');
    });

    document.querySelector('tr[data-sort-id="1"]').click();
    const resultSourceId = getActiveRepeaterContext().sourceId;
    const otherOwner = { request: { method: 'GET', url: 'https://other.test/request', headers: [] } };
    uiMocks.elements.rawRequestInput.innerText = 'GET /request HTTP/1.1\nHost: other.test';
    state.currentResponse = 'HTTP/1.1 200 OK\n\nother response';
    activateRepeaterContext({
      ownerRequest: otherOwner,
      kind: 'captured',
      label: 'Other request',
      responseText: state.currentResponse
    });

    invalidateRepeaterSource(resultSourceId);

    expect(uiMocks.elements.rawRequestInput.innerText).toContain('Host: other.test');
    expect(state.currentResponse).toContain('other response');
    expect(getActiveRepeaterContext()?.ownerRequest).toBe(otherOwner);
  });
});
