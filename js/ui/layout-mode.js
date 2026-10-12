// Layout Mode Module - Chooses between the wide and compact layouts from the
// panel's own size, and runs the compact layout's tabs, drawer, and overflow.
import { state } from '../core/state.js';
import { events, EVENT_NAMES } from '../core/events.js';

export const LAYOUT_MODE_KEY = 'poor_mans_suite_layout_mode';
export const SIDEBAR_WIDTH_KEY = 'poor_mans_suite_sidebar_width';
export const SPLIT_RATIO_KEY = 'poor_mans_suite_split_ratio';
export const COMPACT_HEIGHT_THRESHOLD = 500;
export const COMPACT_WIDTH_THRESHOLD = 900;
export const LAYOUT_PREFERENCES = ['auto', 'wide', 'compact'];
export const COMPACT_TABS = ['request', 'response', 'chat', 'bulk'];

const TAB_LABELS = { request: 'Request', response: 'Response', chat: 'Chat', bulk: 'Bulk Replay' };

function getStorage(storage) {
    if (storage) return storage;
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

export function readLayoutPreference(storage) {
    try {
        const value = getStorage(storage)?.getItem(LAYOUT_MODE_KEY);
        return LAYOUT_PREFERENCES.includes(value) ? value : 'auto';
    } catch {
        return 'auto';
    }
}

export function writeLayoutPreference(preference, storage) {
    if (!LAYOUT_PREFERENCES.includes(preference)) return;
    try {
        getStorage(storage)?.setItem(LAYOUT_MODE_KEY, preference);
    } catch {
        // Storage is optional; the preference simply does not persist.
    }
}

export function readStoredNumber(key, { min, max, storage } = {}) {
    try {
        const raw = getStorage(storage)?.getItem(key);
        if (raw === null || raw === undefined || raw === '') return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        if (min !== undefined && value < min) return null;
        if (max !== undefined && value > max) return null;
        return value;
    } catch {
        return null;
    }
}

export function writeStoredNumber(key, value, storage) {
    try {
        const store = getStorage(storage);
        if (!store) return;
        if (value === null || value === undefined || !Number.isFinite(value)) {
            store.removeItem(key);
        } else {
            store.setItem(key, String(value));
        }
    } catch {
        // Ignore storage failures.
    }
}

/**
 * Pure mode selection: the override wins, otherwise a short or narrow panel is compact.
 */
export function resolveLayoutMode({ width, height, override = 'auto' } = {}) {
    if (override === 'wide' || override === 'compact') return override;
    const w = Number(width);
    const h = Number(height);
    if (Number.isFinite(h) && h < COMPACT_HEIGHT_THRESHOLD) return 'compact';
    if (Number.isFinite(w) && w < COMPACT_WIDTH_THRESHOLD) return 'compact';
    return 'wide';
}

export function isCompactLayout(container = document.querySelector('.container')) {
    return container?.dataset?.layout === 'compact';
}

function defaultObserve(callback) {
    const read = () => callback({ width: window.innerWidth, height: window.innerHeight });
    if (typeof ResizeObserver === 'function' && document.body) {
        const observer = new ResizeObserver(() => read());
        observer.observe(document.body);
        read();
        return () => observer.disconnect();
    }
    window.addEventListener('resize', read);
    read();
    return () => window.removeEventListener('resize', read);
}

function isPaneOpen(pane) {
    if (!pane) return false;
    return pane.style.display !== 'none';
}

function isVisible(element) {
    if (!element) return false;
    if (typeof getComputedStyle !== 'function') return true;
    const display = getComputedStyle(element).display;
    // jsdom reports an empty display for unstyled elements; only an explicit none hides.
    return display !== 'none' || element.offsetParent !== null;
}

function defaultHeaderFits(header) {
    if (!header || header.clientWidth === 0) return true;
    // The actions are right-aligned, so overflow runs leftward and scrollWidth misses it.
    // Compare the actions' natural width against the header's content box instead.
    const actions = header.querySelector('.header-actions') || header;
    const style = getComputedStyle(header);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    return actions.scrollWidth <= header.clientWidth - padding + 1;
}

function statusCode(text) {
    const match = String(text || '').trim().match(/^\d{3}/);
    return match ? match[0] : '';
}

function describeRequest(index) {
    const entry = state.requests?.[index];
    if (!entry?.request) return null;
    return {
        method: entry.request.method || '',
        url: entry.request.url || '',
        name: entry.name || ''
    };
}

/**
 * Wires the layout mode, the compact tab strip, the request list drawer, the
 * selected request summary, and the header overflow menus.
 */
export function setupLayoutMode({ observe = defaultObserve, storage, headerFits = defaultHeaderFits } = {}) {
    const container = document.querySelector('.container');
    const mainContent = document.querySelector('.main-content');
    const splitView = document.querySelector('.split-view-container');
    const tabBar = document.getElementById('compact-tab-bar');
    if (!container || !mainContent || !splitView || !tabBar) return null;

    const panes = {
        request: document.querySelector('.request-pane'),
        response: document.querySelector('.response-pane'),
        chat: document.getElementById('llm-chat-pane'),
        bulk: document.getElementById('bulk-replay-pane')
    };
    const tabStrip = tabBar.querySelector('.compact-tabs');
    const listBtn = document.getElementById('compact-list-btn');
    const chatBtn = document.getElementById('compact-chat-btn');
    const summary = document.getElementById('selected-request-summary');
    const backdrop = document.getElementById('drawer-backdrop');
    const searchBar = document.getElementById('search-bar');
    const resStatus = document.getElementById('res-status');
    const sendBtn = document.getElementById('send-btn');
    const modeMenu = document.getElementById('layout-mode-menu');
    const modeBtn = document.getElementById('layout-mode-btn');

    let preference = readLayoutPreference(storage);
    let mode = null;
    let lastSize = { width: undefined, height: undefined };
    let activeTab = 'request';
    let pendingSend = false;
    let lastStatus = '';

    // ----- Tabs -------------------------------------------------------------
    const tabButtons = {};
    const chip = document.createElement('span');
    chip.id = 'compact-request-status';
    chip.className = 'compact-tab-chip';

    function buildTabs() {
        if (!tabStrip) return;
        tabStrip.innerHTML = '';
        for (const name of COMPACT_TABS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'compact-tab';
            btn.dataset.tab = name;
            btn.setAttribute('role', 'tab');
            btn.textContent = TAB_LABELS[name];
            if (name === 'request') btn.appendChild(chip);
            btn.addEventListener('click', () => activateTab(name));
            tabButtons[name] = btn;
            tabStrip.appendChild(btn);
        }
    }

    function availableTabs() {
        return COMPACT_TABS.filter(name => {
            if (name === 'request' || name === 'response') return true;
            return isPaneOpen(panes[name]);
        });
    }

    function refreshTabs() {
        const available = availableTabs();
        for (const name of COMPACT_TABS) {
            const btn = tabButtons[name];
            if (!btn) continue;
            btn.hidden = !available.includes(name);
            btn.classList.toggle('active', name === activeTab);
            btn.setAttribute('aria-selected', name === activeTab ? 'true' : 'false');
        }
        for (const name of COMPACT_TABS) {
            panes[name]?.classList.toggle('compact-active', name === activeTab);
        }
        chatBtn?.classList.toggle('active', available.includes('chat'));
        splitView.dataset.activeTab = activeTab;
        mainContent.classList.toggle('compact-bulk-active', activeTab === 'bulk');
    }

    function activateTab(name) {
        if (!COMPACT_TABS.includes(name)) return;
        if (!availableTabs().includes(name)) return;
        activeTab = name;
        refreshTabs();
        refreshOverflow();
    }

    function cycleTab(step) {
        const available = availableTabs();
        const index = available.indexOf(activeTab);
        const next = available[(index + step + available.length) % available.length];
        activateTab(next);
    }

    // Opening a Bulk Replay result loads it into the editor panes, so show them.
    panes.bulk?.addEventListener('click', (event) => {
        if (mode !== 'compact') return;
        if (event.target.closest('#bulk-results-table tbody tr')) activateTab('request');
    });

    // Hosted panes signal open and close through their inline display, so watch it.
    const paneObservers = [];
    if (typeof MutationObserver === 'function') {
        for (const name of ['chat', 'bulk']) {
            const pane = panes[name];
            if (!pane) continue;
            let wasOpen = isPaneOpen(pane);
            const observer = new MutationObserver(() => {
                const open = isPaneOpen(pane);
                if (open === wasOpen) return;
                wasOpen = open;
                if (open) {
                    activeTab = name;
                } else if (activeTab === name) {
                    activeTab = 'request';
                }
                refreshTabs();
                refreshOverflow();
            });
            observer.observe(pane, { attributes: true, attributeFilter: ['style'] });
            paneObservers.push(observer);
        }
    }

    // ----- Status chip and Send -> Response ---------------------------------
    function syncStatusChip() {
        if (!resStatus) return;
        const text = resStatus.textContent || '';
        const code = statusCode(text);
        chip.textContent = code;
        chip.hidden = !code;
        chip.className = 'compact-tab-chip';
        for (const cls of resStatus.classList) {
            if (cls.startsWith('status-') && cls !== 'status-badge') chip.classList.add(cls);
        }
        if (pendingSend && text.trim() && text !== lastStatus) {
            pendingSend = false;
            if (mode === 'compact') activateTab('response');
        }
        lastStatus = text;
    }

    if (resStatus && typeof MutationObserver === 'function') {
        const statusObserver = new MutationObserver(syncStatusChip);
        statusObserver.observe(resStatus, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        paneObservers.push(statusObserver);
        lastStatus = resStatus.textContent || '';
    }

    sendBtn?.addEventListener('click', () => {
        pendingSend = true;
        lastStatus = resStatus?.textContent || '';
    }, true);

    // ----- Drawer -----------------------------------------------------------
    function isDrawerOpen() {
        return container.classList.contains('drawer-open');
    }

    function openDrawer() {
        if (mode !== 'compact') return;
        container.classList.add('drawer-open');
        listBtn?.classList.add('active');
        listBtn?.setAttribute('aria-expanded', 'true');
        if (searchBar) setTimeout(() => searchBar.focus(), 0);
    }

    function closeDrawer() {
        container.classList.remove('drawer-open');
        listBtn?.classList.remove('active');
        listBtn?.setAttribute('aria-expanded', 'false');
    }

    function toggleDrawer() {
        if (isDrawerOpen()) closeDrawer();
        else openDrawer();
    }

    listBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleDrawer();
    });

    // The chat toggle lives in the sidebar, which is a closed drawer here, so mirror it.
    chatBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.getElementById('llm-chat-toggle-btn')?.click();
    });
    backdrop?.addEventListener('click', closeDrawer);

    // ----- Selected request summary ----------------------------------------
    function renderSummary(info) {
        if (!summary) return;
        summary.innerHTML = '';
        if (!info) {
            summary.hidden = true;
            summary.removeAttribute('title');
            return;
        }
        const method = document.createElement('span');
        method.className = 'summary-method';
        method.textContent = info.method;
        const url = document.createElement('span');
        url.className = 'summary-url';
        url.textContent = info.name ? `${info.name} — ${info.url}` : info.url;
        summary.append(method, url);
        summary.title = info.url;
        summary.hidden = false;
    }

    const onRequestSelected = ({ index } = {}) => {
        renderSummary(describeRequest(index));
        if (isDrawerOpen()) closeDrawer();
    };
    events.on(EVENT_NAMES.UI_REQUEST_SELECTED, onRequestSelected);

    // ----- Header overflow ----------------------------------------------------
    const headerStates = [];
    for (const name of ['request', 'response']) {
        const header = panes[name]?.querySelector('.pane-header');
        const actions = header?.querySelector('.header-actions');
        const overflow = actions?.querySelector('.header-overflow');
        const menu = overflow?.querySelector('.header-overflow-menu');
        const button = overflow?.querySelector('.header-overflow-btn');
        if (!header || !actions || !overflow || !menu) continue;
        const order = Array.from(actions.children).filter(child => child !== overflow);
        headerStates.push({ name, header, actions, overflow, menu, button, order });
        button?.addEventListener('click', (event) => {
            event.stopPropagation();
            closeMenus(menu);
            menu.classList.toggle('show');
        });
    }

    function closeMenus(except) {
        for (const entry of headerStates) {
            if (entry.menu !== except) entry.menu.classList.remove('show');
        }
        if (modeMenu && modeMenu !== except) modeMenu.classList.remove('show');
    }

    function restoreHeader(entry) {
        for (const item of entry.order) entry.actions.appendChild(item);
        // Keep pinned trailing actions such as Send at the very end of the row.
        let anchor = null;
        for (let i = entry.order.length - 1; i >= 0; i--) {
            if (!entry.order[i].hasAttribute('data-no-overflow')) break;
            anchor = entry.order[i];
        }
        entry.actions.insertBefore(entry.overflow, anchor);
        entry.overflow.hidden = true;
        entry.menu.classList.remove('show');
    }

    function refreshOverflow() {
        for (const entry of headerStates) {
            restoreHeader(entry);
            if (mode !== 'compact' || entry.name !== activeTab) continue;
            const candidates = entry.order.filter(item => !item.hasAttribute('data-no-overflow') && isVisible(item));
            let guard = candidates.length;
            while (guard-- > 0 && !headerFits(entry.header)) {
                const item = candidates.pop();
                if (!item) break;
                entry.menu.prepend(item);
                entry.overflow.hidden = false;
            }
        }
    }

    // ----- Layout mode preference menu ---------------------------------------
    function refreshModeMenu() {
        if (!modeMenu) return;
        modeMenu.querySelectorAll('[data-layout-mode]').forEach(item => {
            item.classList.toggle('active', item.dataset.layoutMode === preference);
        });
        if (modeBtn) {
            modeBtn.title = `Layout: ${preference === 'auto' ? `Automatic (${mode || 'wide'})` : preference}`;
        }
    }

    modeBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenus(modeMenu);
        modeMenu?.classList.toggle('show');
    });
    modeMenu?.querySelectorAll('[data-layout-mode]').forEach(item => {
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            setPreference(item.dataset.layoutMode);
            modeMenu.classList.remove('show');
        });
    });

    // ----- Mode application -------------------------------------------------
    function applyMode(next) {
        const changed = next !== mode;
        mode = next;
        container.dataset.layout = next;
        if (next === 'compact') {
            if (!availableTabs().includes(activeTab)) activeTab = 'request';
            closeDrawer();
            refreshTabs();
        } else {
            closeDrawer();
        }
        refreshOverflow();
        refreshModeMenu();
        if (changed) events.emit(EVENT_NAMES.UI_LAYOUT_MODE_CHANGED, { mode: next, preference });
    }

    function evaluate() {
        applyMode(resolveLayoutMode({ ...lastSize, override: preference }));
    }

    function setPreference(next) {
        if (!LAYOUT_PREFERENCES.includes(next)) return;
        preference = next;
        writeLayoutPreference(next, storage);
        evaluate();
    }

    // ----- Keyboard -----------------------------------------------------------
    const onKeydown = (event) => {
        const mod = event.ctrlKey || event.metaKey;
        if ((event.key === 'Escape' || event.code === 'Escape') && isDrawerOpen()) {
            event.preventDefault();
            closeDrawer();
            return;
        }
        if (mode !== 'compact' || !mod || !event.shiftKey || event.altKey) return;
        if (event.code === 'KeyL') {
            event.preventDefault();
            toggleDrawer();
        } else if (event.code === 'Period') {
            event.preventDefault();
            cycleTab(1);
        } else if (event.code === 'Comma') {
            event.preventDefault();
            cycleTab(-1);
        }
    };
    document.addEventListener('keydown', onKeydown);
    const onDocumentClick = () => closeMenus();
    document.addEventListener('click', onDocumentClick);

    buildTabs();
    refreshTabs();
    syncStatusChip();
    renderSummary(null);

    const stopObserving = observe(({ width, height }) => {
        lastSize = { width, height };
        evaluate();
    });

    return {
        getMode: () => mode,
        getPreference: () => preference,
        setPreference,
        activateTab,
        getActiveTab: () => activeTab,
        availableTabs,
        openDrawer,
        closeDrawer,
        isDrawerOpen,
        refreshTabs,
        refreshOverflow,
        destroy() {
            if (typeof stopObserving === 'function') stopObserving();
            paneObservers.forEach(observer => observer.disconnect());
            events.off?.(EVENT_NAMES.UI_REQUEST_SELECTED, onRequestSelected);
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('click', onDocumentClick);
        }
    };
}
