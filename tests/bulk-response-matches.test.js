import { describe, expect, it } from 'vitest';

import {
    findResponseMatches,
    getMatchedResponseMarkers,
    highlightResponseMatches,
    parseResponseMarkers
} from '../js/features/bulk-replay/response-matches.js';

describe('Bulk Replay response markers', () => {
    it('parses one unique marker per non-empty line', () => {
        expect(parseResponseMarkers(' Invalid username \n\nInvalid username and password\nInvalid username')).toEqual([
            'Invalid username',
            'Invalid username and password'
        ]);
    });

    it('gives longer overlapping markers priority', () => {
        const markers = ['Invalid username', 'Invalid username and password'];

        expect(getMatchedResponseMarkers('Invalid username and password', markers)).toEqual([
            'Invalid username and password'
        ]);
        expect(getMatchedResponseMarkers('Invalid username', markers)).toEqual([
            'Invalid username'
        ]);
    });

    it('supports case-sensitive and case-insensitive matching', () => {
        const markers = ['Invalid username'];

        expect(findResponseMatches('invalid username', markers)).toHaveLength(0);
        expect(findResponseMatches('invalid username', markers, { caseSensitive: false })).toHaveLength(1);
    });

    it('highlights matches without replacing existing response markup', () => {
        const response = document.createElement('div');
        response.innerHTML = '<span class="json-string">Invalid username</span><span> or try again</span>';

        expect(highlightResponseMatches(response, ['Invalid username'])).toBe(1);
        expect(response.querySelector('.json-string')).not.toBeNull();
        expect(response.querySelector('mark.response-match-highlight')?.textContent).toBe('Invalid username');
        expect(response.textContent).toBe('Invalid username or try again');
    });

    it('can highlight a marker that crosses syntax-highlighted nodes', () => {
        const response = document.createElement('div');
        response.innerHTML = '<span>Invalid </span><span>username</span>';

        expect(highlightResponseMatches(response, ['Invalid username'])).toBe(1);
        expect(response.querySelectorAll('mark.response-match-highlight')).toHaveLength(2);
        expect(response.textContent).toBe('Invalid username');
    });
});
