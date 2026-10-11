import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const panel = readFileSync('panel.html', 'utf8');

function opencodeSettingsMarkup() {
  const start = panel.indexOf('id="opencode-settings"');
  const end = panel.indexOf('id="opencode-base-url"', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return panel.slice(start, end);
}

describe('OpenCode setup note', () => {
  it('explains how to start the local server before the connection fields', () => {
    const markup = opencodeSettingsMarkup();

    expect(markup).toContain('class="setup-note"');
    expect(markup).toContain('OpenCode needs a local server');
    expect(markup).toContain('opencode serve --hostname 127.0.0.1 --port 4096');
    expect(markup).toContain('OPENCODE_SERVER_PASSWORD=');
    expect(markup).toContain('href="https://github.com/harryadel/poor-mans-suite#opencode-setup"');
  });

  it('appears only once and only inside the OpenCode settings', () => {
    expect(panel.split('class="setup-note"').length - 1).toBe(1);
    const anthropicStart = panel.indexOf('id="anthropic-settings"');
    const opencodeStart = panel.indexOf('id="opencode-settings"');
    const noteIndex = panel.indexOf('class="setup-note"');
    expect(noteIndex).toBeGreaterThan(opencodeStart);
    expect(noteIndex).toBeGreaterThan(anthropicStart);
  });
});
