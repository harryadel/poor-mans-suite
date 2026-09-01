import { describe, expect, it, vi } from 'vitest';

import {
    calculateAttackRequestCount,
    generateAttackRequests
} from '../js/features/bulk-replay/engine.js';

const template = 'GET /?first=§one§&second=§two§ HTTP/1.1\nHost: example.test\n\n';

function simpleList(list, originalValue = '') {
    return { type: 'simple-list', list, originalValue };
}

function numbers(from, to, step, originalValue = '') {
    return { type: 'numbers', numbers: { from, to, step }, originalValue };
}

describe('Bulk Replay attack request cardinality', () => {
    const positionConfigs = [
        simpleList('alpha\n\n beta \n   \n', 'one'),
        numbers(1, 5, 2, 'two')
    ];

    it.each([
        ['sniper', 5],
        ['battering-ram', 2],
        ['pitchfork', 2],
        ['cluster-bomb', 6]
    ])('counts %s requests using its mode semantics', (attackType, expectedCount) => {
        expect(calculateAttackRequestCount(attackType, positionConfigs)).toBe(expectedCount);
    });

    it.each(['sniper', 'battering-ram', 'pitchfork', 'cluster-bomb']) (
        'matches generated request array length for %s',
        attackType => {
            expect(calculateAttackRequestCount(attackType, positionConfigs)).toBe(
                generateAttackRequests(attackType, positionConfigs, template).length
            );
        }
    );

    it('counts only non-empty simple-list lines using current whitespace semantics', () => {
        const config = [simpleList('first\n \n\t\nsecond\n')];

        expect(calculateAttackRequestCount('sniper', config)).toBe(2);
        expect(generateAttackRequests('sniper', config, '§value§')).toHaveLength(2);
    });

    it('uses floor division for ascending numeric ranges', () => {
        const config = [numbers(2, 10, 3)];

        expect(calculateAttackRequestCount('sniper', config)).toBe(3);
        expect(generateAttackRequests('sniper', config, '§value§').map(request => request.payloads[0]))
            .toEqual(['2', '5', '8']);
    });

    it('generates exact numeric payloads when Number intermediates would lose precision', () => {
        const from = Number.MIN_SAFE_INTEGER;
        const step = 6_004_799_503_160_659;
        const config = [numbers(from, Number.MAX_SAFE_INTEGER, step)];
        const expected = Array.from({ length: 4 }, (_, index) =>
            (BigInt(from) + (BigInt(index) * BigInt(step))).toString()
        );

        expect(generateAttackRequests('sniper', config, '§value§').map(request => request.payloads[0]))
            .toEqual(expected);
    });

    it('returns zero for a Cluster Bomb with an empty payload position', () => {
        const configs = [simpleList(''), numbers(1, 3, 1)];

        expect(calculateAttackRequestCount('cluster-bomb', configs)).toBe(0);
        expect(generateAttackRequests('cluster-bomb', configs, template)).toEqual([]);
    });

    it.each([
        ['NaN', numbers(Number.NaN, 3, 1)],
        ['infinity', numbers(1, Number.POSITIVE_INFINITY, 1)],
        ['non-integer', numbers(1, 3.5, 1)],
        ['unsafe integer', numbers(1, Number.MAX_SAFE_INTEGER + 1, 1)],
        ['zero step', numbers(1, 3, 0)],
        ['negative step', numbers(1, 3, -1)],
        ['descending range', numbers(3, 1, 1)]
    ])('rejects invalid numeric config: %s', (_label, config) => {
        expect(() => calculateAttackRequestCount('sniper', [config])).toThrow();
    });

    it('prevents generation from looping on an invalid numeric step', () => {
        const config = [numbers(1, 3, 0)];

        expect(() => generateAttackRequests('sniper', config, '§value§')).toThrow(
            'Number payload step must be positive'
        );
    });

    it.each([
        [null],
        [{ type: 'simple-list' }],
        [{ type: 'numbers' }],
        [{ type: 'unsupported', list: 'value' }]
    ])('rejects invalid payload position config %#', config => {
        expect(() => calculateAttackRequestCount('sniper', [config])).toThrow();
    });

    it('rejects unsupported attack types', () => {
        expect(() => calculateAttackRequestCount('unknown', [simpleList('value')])).toThrow(
            'Unknown attack type: unknown'
        );
        expect(() => generateAttackRequests('unknown', [simpleList('value')], '§value§')).toThrow(
            'Unknown attack type: unknown'
        );
    });

    it.each([[], null, {}])('rejects missing position configs: %#', positionConfigs => {
        expect(() => calculateAttackRequestCount('sniper', positionConfigs)).toThrow(
            'At least one payload position is required'
        );
    });

    it('rejects unsafe payload counts and Sniper sums', () => {
        expect(() => calculateAttackRequestCount('sniper', [
            numbers(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1)
        ])).toThrow('Payload count exceeds the safe integer limit');

        expect(() => calculateAttackRequestCount('sniper', [
            numbers(1, Number.MAX_SAFE_INTEGER, 1),
            simpleList('one')
        ])).toThrow('Attack request count exceeds the safe integer limit');
    });

    it('rejects an unsafe Cluster Bomb product without materializing requests', () => {
        const hugeConfigs = [
            numbers(1, 10_000, 1),
            numbers(1, 10_000, 1),
            numbers(1, 10_000, 1),
            numbers(1, 10_000, 1)
        ];
        const flatMapSpy = vi.spyOn(Array.prototype, 'flatMap')
            .mockImplementation(() => {
                throw new Error('Cartesian product was materialized');
            });

        try {
            expect(() => calculateAttackRequestCount('cluster-bomb', hugeConfigs)).toThrow(
                'Attack request count exceeds the safe integer limit'
            );
            expect(() => generateAttackRequests('cluster-bomb', hugeConfigs, template)).toThrow(
                'Attack request count exceeds the safe integer limit'
            );
            expect(flatMapSpy).not.toHaveBeenCalled();
        } finally {
            flatMapSpy.mockRestore();
        }
    });
});
