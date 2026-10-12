import { describe, expect, it } from 'vitest';
import {
    findTemplatePositions,
    removeTemplatePosition,
    setTemplatePositionValue
} from '../js/features/bulk-replay/positions.js';

const template = 'POST /login?u=§alice§&r=§§ HTTP/1.1\nHost: example.test\n\n{"pass":"§line1\nline2§"}';

describe('findTemplatePositions', () => {
    it('lists positions in order with offsets and values, including empty and multi-line ones', () => {
        const positions = findTemplatePositions(template);
        expect(positions.map(p => p.value)).toEqual(['alice', '', 'line1\nline2']);
        expect(positions.map(p => p.index)).toEqual([0, 1, 2]);
        expect(template.slice(positions[0].start, positions[0].end)).toBe('§alice§');
        expect(template.slice(positions[1].start, positions[1].end)).toBe('§§');
    });

    it('returns nothing for a template without markers or with a lone marker', () => {
        expect(findTemplatePositions('GET / HTTP/1.1')).toEqual([]);
        expect(findTemplatePositions('GET /§ HTTP/1.1')).toEqual([]);
        expect(findTemplatePositions(null)).toEqual([]);
    });
});

describe('removeTemplatePosition', () => {
    it('strips only the chosen pair and keeps its text', () => {
        expect(removeTemplatePosition(template, 1)).toBe(
            'POST /login?u=§alice§&r= HTTP/1.1\nHost: example.test\n\n{"pass":"§line1\nline2§"}'
        );
        expect(removeTemplatePosition(template, 0)).toBe(
            'POST /login?u=alice&r=§§ HTTP/1.1\nHost: example.test\n\n{"pass":"§line1\nline2§"}'
        );
    });

    it('leaves the template alone for an unknown index', () => {
        expect(removeTemplatePosition(template, 3)).toBe(template);
        expect(removeTemplatePosition(template, -1)).toBe(template);
    });

    it('handles adjacent pairs without merging them', () => {
        expect(removeTemplatePosition('§a§§b§', 0)).toBe('a§b§');
        expect(removeTemplatePosition('§a§§b§', 1)).toBe('§a§b');
    });
});

describe('setTemplatePositionValue', () => {
    it('rewrites the value between the markers of one position', () => {
        expect(setTemplatePositionValue(template, 0, 'bob')).toBe(
            'POST /login?u=§bob§&r=§§ HTTP/1.1\nHost: example.test\n\n{"pass":"§line1\nline2§"}'
        );
        expect(setTemplatePositionValue(template, 1, 'x')).toContain('&r=§x§ ');
        expect(findTemplatePositions(setTemplatePositionValue(template, 2, '')).map(p => p.value)).toEqual(['alice', '', '']);
    });

    it('rejects values containing the marker character and ignores unknown indexes', () => {
        expect(() => setTemplatePositionValue(template, 0, 'a§b')).toThrow(/marker/);
        expect(setTemplatePositionValue(template, 9, 'x')).toBe(template);
    });
});
