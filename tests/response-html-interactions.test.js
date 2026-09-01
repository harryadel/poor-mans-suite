import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { highlightHTTP } from '../js/core/utils/network.js';
import { renderDiff } from '../js/core/utils/misc.js';
import { state } from '../js/core/state.js';
import { highlightResponseMatches } from '../js/features/bulk-replay/response-matches.js';
import { initSearch } from '../js/search/index.js';
import { elements } from '../js/ui/main-ui.js';
import { switchResponseView } from '../js/ui/request-editor.js';

const highlightSource = readFileSync(resolve(process.cwd(), 'lib/highlight.min.js'), 'utf8');
const diffSource = readFileSync(resolve(process.cwd(), 'lib/diff.min.js'), 'utf8');
const panelCSS = readFileSync(resolve(process.cwd(), 'css/panel.css'), 'utf8');

const htmlResponse = `HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html>
<!-- result -->
<section aria-label="Result">Ready</section>`;

describe('HTML response highlighting interactions', () => {
  let originalDiff;
  let originalHighlighter;
  let originalScrollIntoView;
  let bundledDiff;
  let bundledHighlighter;

  beforeAll(() => {
    originalDiff = globalThis.Diff;
    originalHighlighter = globalThis.hljs;
    originalScrollIntoView = Element.prototype.scrollIntoView;
    window.eval(highlightSource);
    window.eval(diffSource);
    bundledHighlighter = window.hljs;
    bundledDiff = window.Diff;
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.Diff = bundledDiff;
    globalThis.hljs = bundledHighlighter;
    state.currentResponse = null;
    Object.keys(elements).forEach(key => delete elements[key]);
  });

  afterEach(() => {
    state.currentResponse = null;
  });

  afterAll(() => {
    if (originalDiff === undefined) delete globalThis.Diff;
    else globalThis.Diff = originalDiff;

    if (originalHighlighter === undefined) delete globalThis.hljs;
    else globalThis.hljs = originalHighlighter;

    if (originalScrollIntoView === undefined) delete Element.prototype.scrollIntoView;
    else Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('reapplies HTML syntax coloring before highlighting response searches', () => {
    document.body.innerHTML = `
      <input id="response-search">
      <span id="response-search-count"></span>
      <button id="response-search-prev"></button>
      <button id="response-search-next"></button>
      <pre id="raw-response-display"></pre>
    `;
    const display = document.getElementById('raw-response-display');
    const input = document.getElementById('response-search');
    elements.rawResponseDisplay = display;
    display.innerHTML = highlightHTTP(htmlResponse);
    initSearch();

    input.value = 'aria-label';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(display.querySelector('.hljs-attr .search-highlight')?.textContent).toBe('aria-label');
    expect(document.getElementById('response-search-count').textContent).toBe('1/1');
    expect(display.textContent).toBe(htmlResponse);

    input.value = 'Ready';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(display.querySelector('.hljs-tag')).not.toBeNull();
    expect(display.querySelector('.search-highlight')?.textContent).toBe('Ready');
    expect(display.textContent).toBe(htmlResponse);
  });

  it('wraps a response matcher across HTML syntax spans without replacing them', () => {
    const display = document.createElement('pre');
    display.innerHTML = highlightHTTP(htmlResponse);

    const matchCount = highlightResponseMatches(display, ['aria-label="Result"']);

    expect(matchCount).toBe(1);
    expect(display.querySelector('.hljs-attr .response-match-highlight')).not.toBeNull();
    expect(display.querySelector('.hljs-string .response-match-highlight')).not.toBeNull();
    expect(display.querySelector('.hljs-tag')).not.toBeNull();
    expect(display.textContent).toBe(htmlResponse);
  });

  it('keeps alternate response views and Diff behavior unchanged', () => {
    document.body.innerHTML = `
      <button class="view-tab active" data-pane="response" data-view="pretty"></button>
      <button class="view-tab" data-pane="response" data-view="raw"></button>
      <button class="view-tab" data-pane="response" data-view="hex"></button>
      <button class="view-tab" data-pane="response" data-view="json"></button>
      <button class="view-tab" data-pane="response" data-view="preview"></button>
      <div id="res-view-pretty" class="active"><pre id="raw-response-display"></pre></div>
      <div id="res-view-raw"><pre id="raw-response-text"></pre></div>
      <div id="res-view-hex"><pre id="res-hex-display"></pre></div>
      <div id="res-view-json">
        <div class="json-warning-bar"><span class="json-warning-text"></span></div>
        <pre id="res-json-display"></pre>
      </div>
      <div id="res-view-preview"><iframe id="response-preview-iframe"></iframe></div>
      <input id="preview-allow-scripts" type="checkbox">
      <div id="diff-output"></div>
    `;
    const pretty = document.getElementById('raw-response-display');
    const raw = document.getElementById('raw-response-text');
    const hex = document.getElementById('res-hex-display');
    const json = document.getElementById('res-json-display');
    const preview = document.getElementById('response-preview-iframe');
    const diff = document.getElementById('diff-output');
    const responseBody = htmlResponse.split('\n\n')[1];
    elements.rawResponseText = raw;
    elements.hexResponseDisplay = hex;
    elements.jsonResponseDisplay = json;
    elements.responsePreviewIframe = preview;
    elements.previewAllowScriptsCheckbox = document.getElementById('preview-allow-scripts');
    state.currentResponse = htmlResponse;
    pretty.innerHTML = highlightHTTP(htmlResponse);

    switchResponseView('raw');
    expect(raw.textContent).toBe(htmlResponse);

    switchResponseView('hex');
    expect(hex.textContent).toContain('48 54 54 50');

    switchResponseView('json');
    expect(json.textContent).toContain('<!doctype html>');

    switchResponseView('preview');
    expect(preview.srcdoc).toBe(responseBody);
    expect(preview.getAttribute('sandbox')).not.toContain('allow-scripts');

    diff.innerHTML = renderDiff(htmlResponse, htmlResponse.replace('Ready', 'Changed'));

    expect(pretty.querySelector('.hljs-tag')).not.toBeNull();
    expect(raw.querySelector('.hljs-tag')).toBeNull();
    expect(hex.querySelector('.hljs-tag')).toBeNull();
    expect(json.querySelector('.hljs-tag')).toBeNull();
    expect(diff.querySelector('.hljs-tag')).toBeNull();
    expect(state.currentResponse).toBe(htmlResponse);
  });

  it('scopes HTML token palettes to the Pretty response view for every theme', () => {
    const themeSelectors = [
      '.light-theme',
      '.theme-modern-dark',
      '.theme-modern-light',
      '.theme-blue',
      '.theme-high-contrast',
      '.theme-terminal'
    ];

    expect(panelCSS).toContain('#raw-response-display .hljs-tag');
    expect(panelCSS).toContain('#raw-response-display .hljs-name');
    expect(panelCSS).toContain('#raw-response-display .hljs-attr');
    expect(panelCSS).toContain('#raw-response-display .hljs-string');
    expect(panelCSS).toContain('#raw-response-display .hljs-comment');
    themeSelectors.forEach(selector => {
      expect(panelCSS).toContain(`${selector} #raw-response-display`);
    });
    expect(panelCSS).not.toMatch(/(^|\n)\.hljs-(tag|name|attr|string|comment)\s*\{/);
  });
});
