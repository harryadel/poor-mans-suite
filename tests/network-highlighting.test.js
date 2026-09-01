import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { highlightHTTP } from '../js/core/utils/network.js';

const highlightSource = readFileSync(resolve(process.cwd(), 'lib/highlight.min.js'), 'utf8');

describe('HTTP response syntax highlighting', () => {
  let originalHighlighter;
  let bundledHighlighter;

  beforeAll(() => {
    originalHighlighter = globalThis.hljs;
    window.eval(highlightSource);
    bundledHighlighter = window.hljs;
  });

  beforeEach(() => {
    globalThis.hljs = bundledHighlighter;
  });

  afterAll(() => {
    if (originalHighlighter === undefined) {
      delete globalThis.hljs;
    } else {
      globalThis.hljs = originalHighlighter;
    }
  });

  it('highlights a complete text/html response with media type parameters', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: Text/HTML; Charset=UTF-8
X-Test: response

<!doctype html>
<!-- greeting -->
<main class="content" data-id='7'>Hello</main>`;

    const highlighted = highlightHTTP(response);

    expect(highlighted).toContain('<span class="http-method">HTTP/1.1</span>');
    expect(highlighted).toContain('<span class="http-header-name">Content-Type</span>');
    expect(highlighted).toContain('class="hljs-tag"');
    expect(highlighted).toContain('class="hljs-name"');
    expect(highlighted).toContain('class="hljs-attr"');
    expect(highlighted).toContain('class="hljs-string"');
    expect(highlighted).toContain('class="hljs-comment"');
  });

  it('highlights an XHTML fragment with case-insensitive headers and media type', () => {
    const response = `HTTP/2 200
cOnTeNt-TyPe: APPLICATION/XHTML+XML

<section aria-label="Result">Ready</section>`;

    const highlighted = highlightHTTP(response);

    expect(highlighted).toContain('class="hljs-tag"');
    expect(highlighted).toContain('class="hljs-name">section</span>');
    expect(highlighted).toContain('class="hljs-attr">aria-label</span>');
  });

  it('does not classify plain text as HTML solely because it contains angle brackets', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: text/plain

Use <example> as a placeholder.`;

    const highlighted = highlightHTTP(response);

    expect(highlighted).not.toContain('class="hljs-');
    expect(highlighted).toContain('Use &lt;example&gt; as a placeholder.');
  });

  it('preserves existing JSON response highlighting', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: application/json

{"ready":true,"count":2}`;

    const highlighted = highlightHTTP(response);

    expect(highlighted).toContain('class="json-key"');
    expect(highlighted).toContain('class="json-boolean"');
    expect(highlighted).toContain('class="json-number"');
    expect(highlighted).not.toContain('class="hljs-');
  });

  it('keeps active HTML inert and preserves the exact response text', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: text/html

<!-- safe text -->
<script>globalThis.responseScriptRan = true;</script>
<img src="https://example.invalid/tracker.png" onerror="alert('no')" data-note="1 > 0">
<p title="Fish &amp; Chips">Fish &amp; Chips</p>`;
    const display = document.createElement('pre');

    display.innerHTML = highlightHTTP(response);

    expect(display.textContent).toBe(response);
    expect(display.querySelector('script')).toBeNull();
    expect(display.querySelector('img')).toBeNull();
    expect(display.querySelector('p')).toBeNull();
    expect(globalThis.responseScriptRan).toBeUndefined();
  });

  it('falls back to escaped text when Highlight.js is unavailable', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: text/html

<strong data-value="safe">Hello</strong>`;
    delete globalThis.hljs;

    const highlighted = highlightHTTP(response);

    expect(highlighted).not.toContain('class="hljs-');
    expect(highlighted).toContain('&lt;strong data-value="safe"&gt;Hello&lt;/strong&gt;');
  });

  it('falls back to escaped text when Highlight.js rejects the body', () => {
    const response = `HTTP/1.1 200 OK
Content-Type: text/html

<strong>Hello</strong>`;
    globalThis.hljs = {
      getLanguage: () => true,
      highlight: () => {
        throw new Error('highlight failed');
      }
    };

    const highlighted = highlightHTTP(response);

    expect(highlighted).not.toContain('class="hljs-');
    expect(highlighted).toContain('&lt;strong&gt;Hello&lt;/strong&gt;');
  });
});
