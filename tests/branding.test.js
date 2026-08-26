import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const occurrences = (text, value) => text.split(value).length - 1;

describe("Poor Man's Suite identity", () => {
  it('uses the standalone package identity', () => {
    const packageJson = JSON.parse(read('package.json'));
    const packageLock = JSON.parse(read('package-lock.json'));
    const manifest = JSON.parse(read('manifest.json'));

    expect(packageJson.name).toBe('poor-mans-suite');
    expect(packageJson.license).toBe('GPL-3.0-or-later');
    expect(packageLock.packages[''].license).toBe('GPL-3.0-or-later');
    expect(packageLock.name).toBe('poor-mans-suite');
    expect(packageLock.packages[''].name).toBe('poor-mans-suite');
    expect(manifest.name).toBe("Poor Man's Suite");
    expect(manifest.version).toBe(packageJson.version);
  });

  it('preserves upstream licensing while applying GPLv3 or later', () => {
    expect(read('LICENSE')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(read('LICENSE')).toContain('either version 3 of the License, or (at your option) any later version');
    expect(read('LICENSES/MIT-upstream.txt')).toContain('Copyright (c) 2025 Bour Abdelhadi');
    const notice = read('NOTICE');
    expect(notice).toContain('derived from rep+');

    for (const file of [
      'highlight.js-BSD-3-Clause.txt',
      'html2canvas-MIT.txt',
      'js-yaml-MIT.txt',
      'marked-LICENSE.md',
      'jsdiff-BSD-3-Clause.txt',
      'Kingfisher-Apache-2.0.txt',
      'Kingfisher-NOTICE.txt'
    ]) {
      expect(read(`LICENSES/${file}`).length).toBeGreaterThan(100);
      expect(notice).toContain(`LICENSES/${file}`);
    }
  });

  it('ships legal notices in the production package', () => {
    const packageScript = read('scripts/package.js');
    const windowsPackageScript = read('scripts/package.ps1');

    for (const file of ['LICENSE', 'NOTICE', 'LICENSES/MIT-upstream.txt']) {
      expect(packageScript).not.toContain(`! -name '${file}'`);
      expect(windowsPackageScript).not.toContain(`"${file}"`);
    }
    expect(packageScript).not.toContain("! -path './LICENSES/*'");
    expect(windowsPackageScript).not.toMatch(/\$excludeDirs\s*=.*"LICENSES"/);
  });

  it('keeps internal and stale build artifacts out of production packages', () => {
    const packageScript = read('scripts/package.js');
    const windowsPackageScript = read('scripts/package.ps1');

    expect(packageScript).toContain("! -name 'Agent.md'");
    expect(packageScript).toContain("! -name '*.zip'");
    expect(packageScript).toContain("! -path './dist/*'");
    expect(packageScript).toContain("! -path './build/*'");
    expect(packageScript).toContain("! -path './coverage/*'");
    expect(windowsPackageScript).toContain('"Agent.md"');
    expect(windowsPackageScript).toContain('"*.zip"');
  });

  it('brands the DevTools and panel surfaces', () => {
    const devtoolsPage = read('devtools.html');
    const devtoolsScript = read('devtools.js');
    const panel = read('panel.html');

    expect(devtoolsPage).toContain("<title>Poor Man's Suite DevTools</title>");
    expect(devtoolsScript).toContain('"Poor Man\'s Suite"');
    expect(panel).toContain("<title>Poor Man's Suite</title>");
    expect(panel).toContain("Poor Man's Suite AI Assistance");
    expect(panel).toContain("Poor Man's Suite can make mistakes");
  });

  it('keeps each renamed storage key consistent between readers and writers', () => {
    const storageSources = [
      read('js/main.js'),
      read('js/core/state/actions.js'),
      read('js/ui/sidebar.js'),
      read('js/ui/request-editor.js'),
      read('js/features/attack-surface/index.js')
    ].join('\n');

    expect(occurrences(storageSources, 'poorMansSuiteBannerDismissed')).toBe(2);
    expect(occurrences(storageSources, 'poor_mans_suite_remove_duplicates')).toBe(4);
    expect(occurrences(storageSources, 'poor_mans_suite_sidebar_hidden')).toBe(2);
    expect(occurrences(storageSources, 'poor_mans_suite_layout_preference')).toBe(2);
    expect(occurrences(storageSources, 'poorMansSuiteAttackSurfaceCache')).toBe(3);

    for (const oldKey of [
      'repPlusBannerDismissed',
      'rep_remove_duplicates',
      'rep_sidebar_hidden',
      'rep_layout_preference',
      'repPlusAttackSurfaceCache'
    ]) {
      expect(storageSources).not.toContain(oldKey);
    }
  });

  it('matches the runtime channel and replay header producers and consumers', () => {
    const runtimeSources = [
      read('background.js'),
      read('js/network/multi-tab.js'),
      read('js/features/ai/core.js'),
      read('js/features/ai/opencode.js')
    ].join('\n');
    const captureSource = read('js/network/capture.js');

    expect(occurrences(runtimeSources, 'poor-mans-suite-panel')).toBe(4);
    expect(runtimeSources).not.toContain('rep-panel');
    expect(occurrences(captureSource, 'X-Poor-Mans-Suite-Replay')).toBe(2);
    expect(captureSource).toContain('x-poor-mans-suite-replay');
    expect(captureSource).not.toContain('X-Rep-Plus-Replay');
    expect(captureSource).not.toContain('x-rep-plus-replay');
  });

  it('uses the new exporter and download prefixes', () => {
    const exporterSource = read('js/features/extractors/ui.js');
    const uiSource = read('js/ui/ui-utils.js');
    const chatSource = read('js/features/llm-chat/index.js');

    expect(exporterSource).toContain("_exporter_id: 'poor-mans-suite'");
    expect(exporterSource).not.toContain("_exporter_id: 'rep-plus'");
    expect(exporterSource).toContain('poor-mans-suite-secrets-');
    expect(exporterSource).toContain('poor-mans-suite-endpoints-');
    expect(exporterSource).toContain('poor-mans-suite-parameters-');
    expect(exporterSource).toContain('poor-mans-suite-postman-');
    expect(uiSource).toContain('poor-mans-suite-request-response-');
    expect(uiSource).toContain('poor-mans-suite-export-');
    expect(chatSource).toContain('poor-mans-suite-ai-chat-');
  });
});
