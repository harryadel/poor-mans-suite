import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { events, EVENT_NAMES } from '../js/core/events.js';
import { state } from '../js/core/state.js';
import {
    COMPACT_HEIGHT_THRESHOLD,
    COMPACT_WIDTH_THRESHOLD,
    LAYOUT_MODE_KEY,
    SIDEBAR_WIDTH_KEY,
    SPLIT_RATIO_KEY,
    readLayoutPreference,
    readStoredNumber,
    resolveLayoutMode,
    setupLayoutMode,
    writeStoredNumber
} from '../js/ui/layout-mode.js';

const panel = readFileSync('panel.html', 'utf8');

function mountPanel() {
    document.body.innerHTML = `
        <div class="container">
            <div class="sidebar"><input id="search-bar"><button id="toggle-sidebar-btn"></button><div id="request-list"></div></div>
            <div class="resize-handle sidebar-resize-handle"></div>
            <div id="drawer-backdrop" class="drawer-backdrop"></div>
            <div class="main-content">
                <div id="compact-tab-bar" class="compact-tab-bar">
                    <button id="compact-list-btn" aria-expanded="false"></button>
                    <div class="compact-tabs" role="tablist"></div>
                    <div id="selected-request-summary" hidden></div>
                </div>
                <div class="split-view-container">
                    <div class="pane request-pane">
                        <div class="pane-header"><h3>Request</h3>
                            <div class="header-actions">
                                <button id="a1" title="Action 1"></button>
                                <button id="a2" title="Action 2"></button>
                                <button id="a3" title="Action 3"></button>
                                <div class="dropdown-menu-container header-overflow" hidden>
                                    <button class="header-overflow-btn"></button>
                                    <div class="dropdown-content header-overflow-menu"></div>
                                </div>
                                <button id="send-btn" data-no-overflow>Send</button>
                            </div>
                        </div>
                        <div class="pane-body"><div id="raw-request-input" contenteditable="true">GET / HTTP/1.1</div></div>
                    </div>
                    <div class="resize-handle pane-resize-handle"></div>
                    <div class="pane response-pane">
                        <div class="pane-header"><h3>Response</h3>
                            <div class="header-actions">
                                <div class="header-badges" data-no-overflow><span id="res-status" class="status-badge"></span></div>
                                <button id="b1" title="Copy"></button>
                                <div class="dropdown-menu-container header-overflow" hidden>
                                    <button class="header-overflow-btn"></button>
                                    <div class="dropdown-content header-overflow-menu"></div>
                                </div>
                            </div>
                        </div>
                        <div class="pane-body"><pre id="raw-response-display">body</pre></div>
                    </div>
                    <div class="resize-handle pane-resize-handle chat-resize-handle"></div>
                    <div id="llm-chat-pane" class="pane llm-chat-pane" style="display: none;"></div>
                </div>
                <div id="bulk-replay-pane" class="pane bulk-replay-pane" style="display: none;"></div>
            </div>
        </div>`;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function key(code, extra = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }));
}

describe('resolveLayoutMode', () => {
    it('chooses compact for a short panel and wide otherwise', () => {
        expect(resolveLayoutMode({ width: 1400, height: COMPACT_HEIGHT_THRESHOLD - 1 })).toBe('compact');
        expect(resolveLayoutMode({ width: 1400, height: COMPACT_HEIGHT_THRESHOLD })).toBe('wide');
        expect(resolveLayoutMode({ width: COMPACT_WIDTH_THRESHOLD - 1, height: 900 })).toBe('compact');
        expect(resolveLayoutMode({ width: COMPACT_WIDTH_THRESHOLD, height: 900 })).toBe('wide');
    });

    it('lets the override win', () => {
        expect(resolveLayoutMode({ width: 300, height: 300, override: 'wide' })).toBe('wide');
        expect(resolveLayoutMode({ width: 2000, height: 1200, override: 'compact' })).toBe('compact');
        expect(resolveLayoutMode({ width: 2000, height: 1200, override: 'bogus' })).toBe('wide');
    });
});

describe('layout preference storage', () => {
    it('falls back to automatic when missing, invalid, or unavailable', () => {
        const store = new Map();
        const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
        expect(readLayoutPreference(storage)).toBe('auto');
        store.set(LAYOUT_MODE_KEY, 'sideways');
        expect(readLayoutPreference(storage)).toBe('auto');
        store.set(LAYOUT_MODE_KEY, 'compact');
        expect(readLayoutPreference(storage)).toBe('compact');
        const broken = { getItem() { throw new Error('denied'); } };
        expect(readLayoutPreference(broken)).toBe('auto');
    });

    it('round-trips numbers within bounds and drops the rest', () => {
        const store = new Map();
        const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
        writeStoredNumber(SIDEBAR_WIDTH_KEY, 420, storage);
        expect(readStoredNumber(SIDEBAR_WIDTH_KEY, { min: 150, max: 600, storage })).toBe(420);
        store.set(SIDEBAR_WIDTH_KEY, '9000');
        expect(readStoredNumber(SIDEBAR_WIDTH_KEY, { min: 150, max: 600, storage })).toBeNull();
        store.set(SPLIT_RATIO_KEY, 'wide');
        expect(readStoredNumber(SPLIT_RATIO_KEY, { storage })).toBeNull();
        writeStoredNumber(SPLIT_RATIO_KEY, 42.5, storage);
        expect(readStoredNumber(SPLIT_RATIO_KEY, { storage })).toBe(42.5);
        writeStoredNumber(SPLIT_RATIO_KEY, null, storage);
        expect(store.has(SPLIT_RATIO_KEY)).toBe(false);
    });
});

describe('setupLayoutMode', () => {
    let store;
    let storage;
    let api;
    let resize;
    let fits;

    beforeEach(() => {
        mountPanel();
        store = new Map();
        storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
        fits = vi.fn(() => true);
        resize = null;
        state.requests.length = 0;
    });

    afterEach(() => {
        api?.destroy();
        api = null;
    });

    function start() {
        api = setupLayoutMode({
            storage,
            headerFits: header => fits(header),
            observe: callback => {
                resize = callback;
                callback({ width: 1400, height: 800 });
                return () => {};
            }
        });
        return api;
    }

    const container = () => document.querySelector('.container');
    const tab = name => document.querySelector(`.compact-tab[data-tab="${name}"]`);

    it('follows the panel size when the preference is automatic', () => {
        start();
        expect(container().dataset.layout).toBe('wide');
        resize({ width: 1400, height: 380 });
        expect(container().dataset.layout).toBe('compact');
        resize({ width: 1400, height: 800 });
        expect(container().dataset.layout).toBe('wide');
    });

    it('persists a manual override and applies it regardless of size', () => {
        start();
        api.setPreference('compact');
        expect(store.get(LAYOUT_MODE_KEY)).toBe('compact');
        expect(container().dataset.layout).toBe('compact');
        resize({ width: 1600, height: 1000 });
        expect(container().dataset.layout).toBe('compact');
        api.setPreference('wide');
        resize({ width: 400, height: 300 });
        expect(container().dataset.layout).toBe('wide');
    });

    it('restores a saved override and ignores an invalid one', () => {
        store.set(LAYOUT_MODE_KEY, 'compact');
        start();
        expect(api.getPreference()).toBe('compact');
        expect(container().dataset.layout).toBe('compact');
        api.destroy();
        store.set(LAYOUT_MODE_KEY, 'nope');
        start();
        expect(api.getPreference()).toBe('auto');
        expect(container().dataset.layout).toBe('wide');
    });

    it('emits a layout mode change event', () => {
        const seen = [];
        const off = events.on(EVENT_NAMES.UI_LAYOUT_MODE_CHANGED, payload => seen.push(payload.mode));
        start();
        resize({ width: 800, height: 800 });
        off();
        expect(seen).toEqual(['wide', 'compact']);
    });

    it('shows only Request and Response tabs until chat or bulk replay open', async () => {
        start();
        resize({ width: 1400, height: 380 });
        expect(tab('request').hidden).toBe(false);
        expect(tab('response').hidden).toBe(false);
        expect(tab('chat').hidden).toBe(true);
        expect(tab('bulk').hidden).toBe(true);
        expect(tab('request').classList.contains('active')).toBe(true);

        document.getElementById('llm-chat-pane').style.display = 'flex';
        await tick();
        expect(tab('chat').hidden).toBe(false);
        expect(api.getActiveTab()).toBe('chat');
        expect(document.getElementById('llm-chat-pane').classList.contains('compact-active')).toBe(true);

        document.getElementById('bulk-replay-pane').style.display = 'flex';
        await tick();
        expect(api.getActiveTab()).toBe('bulk');
        expect(document.querySelector('.main-content').classList.contains('compact-bulk-active')).toBe(true);

        document.getElementById('bulk-replay-pane').style.display = 'none';
        await tick();
        expect(tab('bulk').hidden).toBe(true);
        expect(api.getActiveTab()).toBe('request');
    });

    it('switches tabs by click and keyboard and keeps hidden pane content', () => {
        start();
        resize({ width: 1400, height: 380 });
        tab('response').click();
        expect(api.getActiveTab()).toBe('response');
        expect(document.querySelector('.request-pane').classList.contains('compact-active')).toBe(false);
        expect(document.getElementById('raw-request-input').textContent).toBe('GET / HTTP/1.1');

        key('Period', { ctrlKey: true, shiftKey: true });
        expect(api.getActiveTab()).toBe('request');
        key('Comma', { ctrlKey: true, shiftKey: true });
        expect(api.getActiveTab()).toBe('response');
        api.activateTab('chat');
        expect(api.getActiveTab()).toBe('response');
    });

    it('moves to Response when a sent request gets a status and shows the code on the Request tab', async () => {
        start();
        resize({ width: 1400, height: 380 });
        const status = document.getElementById('res-status');
        status.textContent = '404 Not Found';
        status.className = 'status-badge status-4xx';
        await tick();
        expect(api.getActiveTab()).toBe('request');
        const chip = document.getElementById('compact-request-status');
        expect(chip.textContent).toBe('404');
        expect(chip.classList.contains('status-4xx')).toBe(true);

        document.getElementById('send-btn').click();
        status.textContent = '200 OK';
        status.className = 'status-badge status-2xx';
        await tick();
        expect(api.getActiveTab()).toBe('response');
        expect(chip.textContent).toBe('200');
        expect(chip.classList.contains('status-2xx')).toBe(true);
    });

    it('does not move to Response in the wide layout', async () => {
        start();
        document.getElementById('send-btn').click();
        document.getElementById('res-status').textContent = '200 OK';
        await tick();
        expect(api.getActiveTab()).toBe('request');
    });

    it('opens the drawer, closes it on selection, and shows the selected request', () => {
        state.requests.push({ name: 'login', request: { method: 'POST', url: 'https://example.test/login' } });
        start();
        resize({ width: 1400, height: 380 });
        document.getElementById('compact-list-btn').click();
        expect(container().classList.contains('drawer-open')).toBe(true);
        events.emit(EVENT_NAMES.UI_REQUEST_SELECTED, { index: 0, rawText: '', useHttps: true });
        expect(container().classList.contains('drawer-open')).toBe(false);
        const summary = document.getElementById('selected-request-summary');
        expect(summary.hidden).toBe(false);
        expect(summary.querySelector('.summary-method').textContent).toBe('POST');
        expect(summary.querySelector('.summary-url').textContent).toContain('https://example.test/login');
    });

    it('closes the drawer on Escape, backdrop click, and the keyboard shortcut', () => {
        start();
        resize({ width: 1400, height: 380 });
        key('KeyL', { ctrlKey: true, shiftKey: true });
        expect(api.isDrawerOpen()).toBe(true);
        key('Escape');
        expect(api.isDrawerOpen()).toBe(false);
        api.openDrawer();
        document.getElementById('drawer-backdrop').click();
        expect(api.isDrawerOpen()).toBe(false);
        key('KeyL', { ctrlKey: true, shiftKey: true });
        key('KeyL', { ctrlKey: true, shiftKey: true });
        expect(api.isDrawerOpen()).toBe(false);
    });

    it('never opens the drawer in the wide layout', () => {
        start();
        document.getElementById('compact-list-btn').click();
        expect(api.isDrawerOpen()).toBe(false);
        key('KeyL', { ctrlKey: true, shiftKey: true });
        expect(api.isDrawerOpen()).toBe(false);
    });

    it('closes the drawer when the layout leaves compact', () => {
        start();
        resize({ width: 1400, height: 380 });
        api.openDrawer();
        resize({ width: 1400, height: 800 });
        expect(api.isDrawerOpen()).toBe(false);
    });

    it('moves actions that do not fit into the overflow menu and restores them', () => {
        let movedBudget = 2;
        fits = vi.fn(header => {
            const menu = header.querySelector('.header-overflow-menu');
            return menu.children.length >= movedBudget;
        });
        start();
        resize({ width: 1400, height: 380 });
        const requestActions = document.querySelector('.request-pane .header-actions');
        const menu = requestActions.querySelector('.header-overflow-menu');
        expect(Array.from(menu.children).map(el => el.id)).toEqual(['a2', 'a3']);
        expect(requestActions.querySelector('.header-overflow').hidden).toBe(false);
        expect(requestActions.contains(document.getElementById('send-btn'))).toBe(true);
        expect(document.getElementById('send-btn').closest('.header-overflow-menu')).toBeNull();

        movedBudget = 0;
        resize({ width: 1400, height: 400 });
        expect(menu.children.length).toBe(0);
        expect(Array.from(requestActions.children).map(el => el.id || el.className)).toEqual(
            ['a1', 'a2', 'a3', 'dropdown-menu-container header-overflow', 'send-btn']
        );
        expect(requestActions.querySelector('.header-overflow').hidden).toBe(true);
    });

    it('restores every action when returning to the wide layout', () => {
        fits = vi.fn(header => header.querySelector('.header-overflow-menu').children.length >= 3);
        start();
        resize({ width: 1400, height: 380 });
        expect(document.querySelector('.request-pane .header-overflow-menu').children.length).toBe(3);
        resize({ width: 1400, height: 800 });
        expect(document.querySelector('.request-pane .header-overflow-menu').children.length).toBe(0);
    });
});

describe('panel markup', () => {
    it('has the compact tab bar, drawer backdrop, layout menu, and overflow menus', () => {
        expect(panel).toContain('id="compact-tab-bar"');
        expect(panel).toContain('id="compact-list-btn"');
        expect(panel).toContain('id="selected-request-summary"');
        expect(panel).toContain('id="drawer-backdrop"');
        expect(panel).toContain('data-layout-mode="auto"');
        expect(panel).toContain('data-layout-mode="wide"');
        expect(panel).toContain('data-layout-mode="compact"');
        expect(panel.split('class="dropdown-content header-overflow-menu"').length - 1).toBe(2);
        expect(panel).toContain('id="send-btn" class="primary-btn" data-no-overflow');
        expect(panel).toContain('class="header-badges" data-no-overflow');
    });
});
