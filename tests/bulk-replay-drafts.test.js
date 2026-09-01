import { beforeEach, describe, expect, it } from 'vitest';

import {
    CHAT_BULK_REPLAY_DRAFT_MAX_CHARS,
    CHAT_BULK_REPLAY_FENCE_LANGUAGE,
    CHAT_BULK_REPLAY_REQUEST_LIMIT,
    createBulkReplayDraftContract,
    isBulkReplayDraftRequested,
    parseBulkReplayDraft,
    validateBulkReplayConfiguration
} from '../js/features/llm-chat/bulk-replay-drafts.js';
import {
    activateRepeaterContext,
    captureRepeaterContext,
    clearRepeaterContext,
    invalidateRepeaterSource
} from '../js/features/repeater-context.js';

const correlationId = 'bulk-draft-1';
const requestText = 'POST /login HTTP/1.1\nHost: example.test\n\nusername=alice&role=user';

function snapshotFor(text = requestText) {
    activateRepeaterContext({
        ownerRequest: { id: 'request-1' },
        kind: 'captured',
        label: 'Captured request',
        responseText: null
    });
    return captureRepeaterContext({ requestText: text, useHttps: true });
}

function simpleList(list) {
    return { type: 'simple-list', list };
}

function numbers(from, to, step) {
    return { type: 'numbers', numbers: { from, to, step } };
}

function baseConfig(overrides = {}) {
    return {
        version: 1,
        correlationId,
        attackType: 'sniper',
        template: 'POST /login HTTP/1.1\nHost: example.test\n\nusername=§alice§&role=user',
        positionConfigs: [simpleList('admin\nguest')],
        responseMatchers: [],
        responseMatchCaseSensitive: true,
        ...overrides
    };
}

function fenced(config) {
    return `Assistant prose\n\`\`\`poor-mans-suite-bulk-replay\n${JSON.stringify(config)}\n\`\`\``;
}

function parse(config, snapshot = snapshotFor(), options = {}) {
    return parseBulkReplayDraft(fenced(config), { snapshot, correlationId, ...options });
}

describe('Bulk Replay draft intent and provider contract', () => {
    it.each([
        '/bulk-replay prepare a sniper draft',
        '/BULK-REPLAY',
        'Prepare a Bulk Replay configuration for this request',
        'Please create a Sniper attack draft',
        'Could you configure a Cluster Bomb for these fields?',
        'Set up battering-ram payloads'
    ])('recognizes explicit draft intent: %s', message => {
        expect(isBulkReplayDraftRequested(message)).toBe(true);
    });

    it.each([
        '/bulk-replayer prepare this',
        'How does Bulk Replay work?',
        'How do I configure Bulk Replay?',
        'A Sniper attack could test this parameter.',
        'Explain the difference between Pitchfork and Cluster Bomb.',
        'The response body says: prepare a bulk replay'
    ])('rejects informational or non-command wording: %s', message => {
        expect(isBulkReplayDraftRequested(message)).toBe(false);
    });

    it('describes the exact correlated, non-executable parser contract', () => {
        const contract = createBulkReplayDraftContract('turn-correlation-7');

        expect(contract).toContain(`\`\`\`${CHAT_BULK_REPLAY_FENCE_LANGUAGE}`);
        expect(contract).toContain('"correlationId": "turn-correlation-7"');
        expect(contract).toContain('Preserve every non-marker request byte');
        expect(contract).toContain('positionConfigs');
        expect(contract).toContain('batteringRamConfig');
        expect(contract).toContain('responseMatchers');
        expect(contract).toContain('responseMatchCaseSensitive');
        expect(contract).toContain('non-executable draft');
        expect(contract).toContain('Do not include a target, URL, scheme, permission result, execution command, tool name, or confirmation field.');
    });
});

describe('Bulk Replay draft parsing and validation', () => {
    beforeEach(() => {
        clearRepeaterContext();
    });

    it('reports when no contract block is present', () => {
        expect(parseBulkReplayDraft('Use a Sniper attack.\n```json\n{}\n```', {
            snapshot: snapshotFor(),
            correlationId
        })).toEqual({
            found: false,
            valid: false,
            errors: [],
            draft: null,
            projectedRequestCount: null
        });
    });

    it('rejects multiple contract blocks', () => {
        const block = fenced(baseConfig());
        const result = parseBulkReplayDraft(`${block}\n${block}`, {
            snapshot: snapshotFor(),
            correlationId
        });

        expect(result).toMatchObject({ found: true, valid: false, draft: null });
        expect(result.errors.join(' ')).toMatch(/exactly one/i);
    });

    it('rejects oversized contract blocks before JSON parsing', () => {
        const result = parseBulkReplayDraft(
            `\`\`\`poor-mans-suite-bulk-replay\n${' '.repeat(CHAT_BULK_REPLAY_DRAFT_MAX_CHARS + 1)}\n\`\`\``,
            { snapshot: snapshotFor(), correlationId }
        );

        expect(result).toMatchObject({ found: true, valid: false, draft: null });
        expect(result.errors.join(' ')).toMatch(/exceeds 50000 characters/i);
    });

    it('rejects malformed JSON and duplicate JSON fields without throwing', () => {
        const snapshot = snapshotFor();
        const malformed = parseBulkReplayDraft(
            '```poor-mans-suite-bulk-replay\n{"version":\n```',
            { snapshot, correlationId }
        );
        const duplicate = parseBulkReplayDraft(
            `\`\`\`poor-mans-suite-bulk-replay\n${JSON.stringify(baseConfig()).replace('"version":1', '"version":1,"version":1')}\n\`\`\``,
            { snapshot, correlationId }
        );

        expect(malformed.errors.join(' ')).toMatch(/malformed JSON/i);
        expect(duplicate.errors.join(' ')).toMatch(/duplicate field "version"/i);
    });

    it('rejects a stale correlation ID', () => {
        const result = parse(baseConfig({ correlationId: 'stale-id' }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/correlationId does not match/i);
    });

    it.each([
        ['unsupported attack mode', { attackType: 'turbo' }, /attackType/],
        ['unknown top-level field', { execute: true }, /unknown field "execute"/],
        [
            'a non-Battering Ram shared payload config',
            { batteringRamConfig: simpleList('shared') },
            /must be omitted unless attackType is battering-ram/
        ],
        [
            'unknown payload field',
            { positionConfigs: [{ type: 'simple-list', list: 'one', path: '/admin' }] },
            /unknown field "path"/
        ],
        [
            'inactive model payload field',
            { positionConfigs: [{ type: 'simple-list', list: 'one', numbers: { from: 1, to: 2, step: 1 } }] },
            /unknown field "numbers"/
        ]
    ])('rejects %s', (_label, overrides, expectedError) => {
        const result = parse(baseConfig(overrides));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(expectedError);
    });

    it('rejects positionConfigs in the strict Battering Ram model contract', () => {
        const result = parse(baseConfig({
            attackType: 'battering-ram',
            positionConfigs: [],
            batteringRamConfig: simpleList('one\ntwo')
        }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/positionConfigs must be omitted for battering-ram/i);
    });

    it.each([
        ['a missing payload config', { positionConfigs: [] }, /exactly 1 payload/],
        [
            'a payload count inconsistent with markers',
            {
                template: 'POST /login HTTP/1.1\nHost: example.test\n\nusername=§alice§&role=§user§',
                positionConfigs: [simpleList('admin')]
            },
            /exactly 2 payload/
        ],
        ['an empty payload set', { positionConfigs: [simpleList('\n  \n')] }, /non-empty payload/],
        [
            'a missing Battering Ram shared config',
            { attackType: 'battering-ram', positionConfigs: [] },
            /batteringRamConfig is required/
        ]
    ])('rejects %s', (_label, overrides, expectedError) => {
        const result = parse(baseConfig(overrides));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(expectedError);
    });

    it('accepts balanced inserted markers and derives position metadata', () => {
        const result = parse(baseConfig());

        expect(result).toMatchObject({ found: true, valid: true, projectedRequestCount: 2 });
        expect(result.draft.positionConfigs).toEqual([{
            index: 0,
            originalValue: 'alice',
            type: 'simple-list',
            list: 'admin\nguest'
        }]);
    });

    it('accepts reuse of balanced markers already in the snapshot', () => {
        const markedRequest = requestText.replace('alice', '§alice§');
        const result = parse(baseConfig(), snapshotFor(markedRequest));

        expect(result.valid).toBe(true);
    });

    it.each([
        [
            'an absolute request-target payload',
            'GET §/account§ HTTP/1.1\nHost: example.test',
            simpleList('http://other.test/private')
        ],
        [
            'a user-info-like relative request-target payload',
            'GET §/account§ HTTP/1.1\nHost: example.test',
            simpleList('@attacker.test/private')
        ],
        [
            'a Host header payload',
            'GET /account HTTP/1.1\nHost: §example.test§',
            simpleList('other.test')
        ],
        [
            'an absolute URL scheme payload',
            'GET §https§://example.test/account HTTP/1.1',
            simpleList('http')
        ]
    ])('rejects %s that leaves the reviewed origin', (_label, template, positionConfig) => {
        const snapshotText = template.replaceAll('§', '');
        const result = parse(baseConfig({
            template,
            positionConfigs: [positionConfig]
        }), snapshotFor(snapshotText));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/stay on the reviewed target origin and scheme/i);
    });

    it('allows request-target payloads that remain on the reviewed origin', () => {
        const snapshot = snapshotFor('GET /account HTTP/1.1\nHost: example.test');
        const result = parse(baseConfig({
            template: 'GET §/account§ HTTP/1.1\nHost: example.test',
            positionConfigs: [simpleList('/admin\n/settings')]
        }), snapshot);

        expect(result.valid).toBe(true);
        expect(result.projectedRequestCount).toBe(2);
    });

    it.each([
        ['odd markers', 'username=§alice&role=user', /odd number/],
        ['ambiguous markers', 'username=§§alice&role=user', /ambiguous adjacent/]
    ])('rejects %s', (_label, body, expectedError) => {
        const result = parse(baseConfig({
            template: `POST /login HTTP/1.1\nHost: example.test\n\n${body}`
        }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(expectedError);
    });

    it('rejects any non-marker template change byte-for-byte', () => {
        const result = parse(baseConfig({
            template: 'POST /admin HTTP/1.1\nHost: example.test\n\nusername=§alice§&role=user'
        }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/does not exactly match/i);
    });

    it('rejects invalidated snapshots and snapshots without a target', () => {
        const invalidated = snapshotFor();
        invalidateRepeaterSource(invalidated.sourceId);
        const staleResult = parse(baseConfig(), invalidated);

        const noTarget = snapshotFor('GET /relative HTTP/1.1\nAccept: */*');
        const noTargetResult = parse(baseConfig({
            template: 'GET /§relative§ HTTP/1.1\nAccept: */*'
        }), noTarget);

        expect(staleResult.errors.join(' ')).toMatch(/no longer valid/i);
        expect(noTargetResult.errors.join(' ')).toMatch(/valid target URL/i);
    });

    it('strictly validates and normalizes response matchers and guards', () => {
        const result = parse(baseConfig({
            responseMatchers: [
                { text: '  denied  ', mode: 'partial', isContinuationGuard: false },
                { text: 'denied', mode: 'partial', isContinuationGuard: true },
                { text: 'HTTP/1.1 200 OK', mode: 'whole', isContinuationGuard: false }
            ],
            responseMatchCaseSensitive: false
        }));

        expect(result.valid).toBe(true);
        expect(result.draft.responseMatchers).toEqual([
            { text: 'denied', mode: 'partial', isContinuationGuard: true },
            { text: 'HTTP/1.1 200 OK', mode: 'whole', isContinuationGuard: false }
        ]);
        expect(result.draft.responseMatchCaseSensitive).toBe(false);
    });

    it.each([
        ['empty matcher text', { text: '  ', mode: 'partial', isContinuationGuard: false }, /text must be a non-empty/],
        ['invalid matcher mode', { text: 'denied', mode: 'regex', isContinuationGuard: false }, /mode must be/],
        ['invalid continuation guard', { text: 'denied', mode: 'partial', isContinuationGuard: 'yes' }, /must be a boolean/],
        [
            'unknown matcher property',
            { text: 'denied', mode: 'partial', isContinuationGuard: false, flags: 'i' },
            /unknown field "flags"/
        ]
    ])('rejects %s', (_label, matcher, expectedError) => {
        const result = parse(baseConfig({ responseMatchers: [matcher] }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(expectedError);
    });

    it('requires responseMatchCaseSensitive to be boolean and defaults it to true', () => {
        const invalid = parse(baseConfig({ responseMatchCaseSensitive: 'true' }));
        const config = baseConfig();
        delete config.responseMatchCaseSensitive;
        const valid = parse(config);

        expect(invalid.errors.join(' ')).toMatch(/responseMatchCaseSensitive must be a boolean/i);
        expect(valid.draft.responseMatchCaseSensitive).toBe(true);
    });

    it.each([
        ['sniper', [simpleList('one\ntwo'), numbers(1, 3, 1)], undefined, 5],
        ['battering-ram', undefined, simpleList('one\ntwo\nthree\nfour'), 4],
        ['pitchfork', [simpleList('one\ntwo'), numbers(1, 3, 1)], undefined, 2],
        ['cluster-bomb', [simpleList('one\ntwo'), numbers(1, 3, 1)], undefined, 6]
    ])('calculates %s request counts without generating requests', (attackType, positionConfigs, batteringRamConfig, expected) => {
        const config = baseConfig({
            attackType,
            template: 'POST /login HTTP/1.1\nHost: example.test\n\nusername=§alice§&role=§user§',
            ...(positionConfigs === undefined ? {} : { positionConfigs }),
            ...(batteringRamConfig === undefined ? {} : { batteringRamConfig })
        });
        if (positionConfigs === undefined) delete config.positionConfigs;

        const result = parse(config);

        expect(result.valid).toBe(true);
        expect(result.projectedRequestCount).toBe(expected);
        if (attackType === 'battering-ram') {
            expect(result.draft.positionConfigs).toEqual([
                { index: 0, originalValue: 'alice', type: 'simple-list', list: '' },
                { index: 1, originalValue: 'user', type: 'simple-list', list: '' }
            ]);
        }
    });

    it.each([
        ['non-integer', numbers(1, 2.5, 1)],
        ['zero step', numbers(1, 3, 0)],
        ['negative step', numbers(1, 3, -1)],
        ['descending range', numbers(3, 1, 1)],
        ['unsafe integer', numbers(1, Number.MAX_SAFE_INTEGER + 1, 1)]
    ])('rejects numeric invalidity: %s', (_label, positionConfig) => {
        const result = validateBulkReplayConfiguration(baseConfig({
            positionConfigs: [{ ...positionConfig, index: 99, originalValue: 'untrusted' }]
        }), { snapshot: snapshotFor() });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('accepts 1000 requests and rejects 1001 while retaining the projected count', () => {
        const accepted = parse(baseConfig({ positionConfigs: [numbers(1, 1000, 1)] }));
        const rejected = parse(baseConfig({ positionConfigs: [numbers(1, 1001, 1)] }));

        expect(CHAT_BULK_REPLAY_REQUEST_LIMIT).toBe(1000);
        expect(accepted).toMatchObject({ valid: true, projectedRequestCount: 1000 });
        expect(rejected).toMatchObject({ valid: false, projectedRequestCount: 1001 });
        expect(rejected.errors.join(' ')).toMatch(/exceeding the limit of 1000/i);
    });

    it('deep-freezes valid records and derives rather than trusts app metadata', () => {
        const input = baseConfig({
            positionConfigs: [{
                index: 40,
                originalValue: 'tampered',
                type: 'numbers',
                list: 'inactive',
                numbers: { from: 1, to: 2, step: 1 }
            }],
            responseMatchers: [{ text: 'stop', mode: 'partial', isContinuationGuard: true }]
        });
        const result = validateBulkReplayConfiguration(input, { snapshot: snapshotFor() });

        expect(result.valid).toBe(true);
        expect(result.config.positionConfigs[0]).toEqual({
            index: 0,
            originalValue: 'alice',
            type: 'numbers',
            numbers: { from: 1, to: 2, step: 1 }
        });
        expect(Object.isFrozen(result.config)).toBe(true);
        expect(Object.isFrozen(result.config.positionConfigs)).toBe(true);
        expect(Object.isFrozen(result.config.positionConfigs[0].numbers)).toBe(true);
        expect(Object.isFrozen(result.config.responseMatchers[0])).toBe(true);

        input.positionConfigs[0].numbers.to = 99;
        input.responseMatchers[0].text = 'changed';
        expect(result.config.positionConfigs[0].numbers.to).toBe(2);
        expect(result.config.responseMatchers[0].text).toBe('stop');
        expect(() => {
            result.config.positionConfigs[0].numbers.to = 99;
        }).toThrow(TypeError);
    });
});
