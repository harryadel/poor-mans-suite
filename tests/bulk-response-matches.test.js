import { describe, expect, it } from 'vitest';

import {
    findResponseMatches,
    getMatchedResponseMarkers,
    getMatchedResponseMatchers,
    highlightResponseMatches,
    normalizeResponseMatchers,
    parseResponseMarkers,
    responseMatcherMatches
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

    it('normalizes matcher modes, guard flags, and exact duplicates', () => {
        expect(normalizeResponseMatchers([
            { text: ' Invalid username ', mode: 'partial' },
            { text: 'Invalid username', mode: 'partial', isContinuationGuard: true },
            { text: 'Invalid username', mode: 'whole' }
        ])).toEqual([
            { text: 'Invalid username', mode: 'partial', isContinuationGuard: true },
            { text: 'Invalid username', mode: 'whole', isContinuationGuard: false }
        ]);

        expect(normalizeResponseMatchers(['Welcome back'])).toEqual([
            { text: 'Welcome back', mode: 'partial', isContinuationGuard: false }
        ]);
    });

    it('supports contains and whole-response matching per matcher', () => {
        const contains = [{ text: 'Invalid username', mode: 'partial', isContinuationGuard: false }];
        const whole = [{ text: 'Invalid username', mode: 'whole', isContinuationGuard: false }];

        expect(getMatchedResponseMatchers('Invalid username and password', contains)).toEqual(contains);
        expect(getMatchedResponseMatchers('Invalid username and password', whole)).toEqual([]);
        expect(getMatchedResponseMatchers('Invalid username', whole)).toEqual(whole);
    });

    it('applies case sensitivity and exact whitespace to whole-response matchers', () => {
        const whole = [{ text: 'Invalid username', mode: 'whole', isContinuationGuard: false }];

        expect(getMatchedResponseMatchers('invalid username', whole)).toEqual([]);
        expect(getMatchedResponseMatchers('invalid username', whole, { caseSensitive: false })).toEqual(whole);
        expect(getMatchedResponseMatchers('Invalid username\n', whole)).toEqual([]);
    });

    it('evaluates a matcher independently from overlap-aware display matches', () => {
        const shorterGuard = {
            text: 'Invalid username',
            mode: 'partial',
            isContinuationGuard: true
        };
        const longerMatcher = {
            text: 'Invalid username and password',
            mode: 'partial',
            isContinuationGuard: false
        };
        const responseBody = 'Invalid username and password';

        expect(getMatchedResponseMatchers(responseBody, [shorterGuard, longerMatcher])).toEqual([
            longerMatcher
        ]);
        expect(responseMatcherMatches(responseBody, shorterGuard)).toBe(true);
        expect(responseMatcherMatches('invalid username', shorterGuard)).toBe(false);
        expect(responseMatcherMatches('invalid username', shorterGuard, { caseSensitive: false })).toBe(true);
        expect(responseMatcherMatches('Invalid username\n', { ...shorterGuard, mode: 'whole' })).toBe(false);
        expect(responseMatcherMatches('', shorterGuard)).toBe(false);
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
