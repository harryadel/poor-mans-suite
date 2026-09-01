import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events, EVENT_NAMES } from '../js/core/events.js';
import {
    activateRepeaterContext,
    canActivateRepeaterSource,
    captureRepeaterContext,
    clearRepeaterContext,
    getActiveRepeaterContext,
    invalidateRepeaterOwner,
    invalidateRepeaterSource,
    isRepeaterOwnerValid,
    isRepeaterSnapshotValid,
    isRepeaterSourceValid
} from '../js/features/repeater-context.js';

const requestText = 'GET /users?id=7 HTTP/1.1\nHost: api.example.test\nAccept: application/json';

describe('Repeater context controller', () => {
    beforeEach(() => {
        events.removeAllListeners();
        clearRepeaterContext();
    });

    it('publishes immutable activation and invalidation payloads', () => {
        const activated = vi.fn();
        const invalidated = vi.fn();
        const ownerRequest = { id: 'request-1' };
        events.on(EVENT_NAMES.REPEATER_CONTEXT_ACTIVATED, activated);
        events.on(EVENT_NAMES.REPEATER_CONTEXT_INVALIDATED, invalidated);

        const context = activateRepeaterContext({
            ownerRequest,
            sourceId: 'observable-source',
            kind: 'captured',
            label: 'Captured request',
            responseText: null
        });
        invalidateRepeaterSource(context.sourceId);

        expect(activated).toHaveBeenCalledWith(context);
        expect(Object.isFrozen(activated.mock.calls[0][0])).toBe(true);
        expect(invalidated).toHaveBeenCalledWith({
            sourceId: 'observable-source',
            ownerRequest
        });
        expect(Object.isFrozen(invalidated.mock.calls[0][0])).toBe(true);
    });

    it.each([
        ['captured', 'Captured request'],
        ['resend', 'Resend response'],
        ['bulk-result', 'Bulk Replay result 3']
    ])('captures a valid %s source', (kind, label) => {
        const ownerRequest = { id: 'request-1' };
        const active = activateRepeaterContext({
            ownerRequest,
            kind,
            label,
            responseText: 'HTTP/1.1 200 OK\n\nresponse'
        });
        const snapshot = captureRepeaterContext({ requestText, useHttps: true });

        expect(active).toEqual({
            ownerRequest,
            sourceId: expect.stringMatching(/^repeater-source-/),
            kind,
            label,
            responseText: 'HTTP/1.1 200 OK\n\nresponse'
        });
        expect(snapshot).toMatchObject({
            snapshotId: expect.stringMatching(/^repeater-snapshot-/),
            ownerRequest,
            sourceId: active.sourceId,
            kind,
            label,
            requestText,
            responseText: 'HTTP/1.1 200 OK\n\nresponse',
            useHttps: true,
            targetUrl: 'https://api.example.test/users?id=7'
        });
        expect(isRepeaterSnapshotValid(snapshot)).toBe(true);
    });

    it('records an explicit missing response without replacing an empty response', () => {
        const ownerRequest = { id: 'request-1' };
        activateRepeaterContext({
            ownerRequest,
            kind: 'captured',
            label: 'No response',
            responseText: null
        });
        const missingResponse = captureRepeaterContext({ requestText, useHttps: false });

        activateRepeaterContext({
            ownerRequest,
            kind: 'resend',
            label: 'Empty response',
            responseText: ''
        });
        const emptyResponse = captureRepeaterContext({ requestText, useHttps: false });

        expect(missingResponse.responseText).toBeNull();
        expect(emptyResponse.responseText).toBe('');
    });

    it('keeps exact snapshot values after input mutation and later activation', () => {
        const firstOwner = { id: 'request-1' };
        const activation = {
            ownerRequest: firstOwner,
            sourceId: 'captured-request-1',
            kind: 'captured',
            label: 'Captured request 1',
            responseText: 'HTTP/1.1 201 Created\r\nX-Exact:  value\r\n\r\nbody  '
        };
        const input = {
            requestText: 'POST /exact HTTP/1.1\r\nHost: exact.example\r\nX-Exact:  value\r\n\r\nbody  ',
            useHttps: true
        };

        activateRepeaterContext(activation);
        const snapshot = captureRepeaterContext(input);

        activation.label = 'Changed label';
        activation.responseText = 'changed response';
        input.requestText = 'GET /changed HTTP/1.1\nHost: changed.example';
        input.useHttps = false;
        activateRepeaterContext({
            ownerRequest: { id: 'request-2' },
            kind: 'bulk-result',
            label: 'Another source',
            responseText: 'another response'
        });

        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            ownerRequest: firstOwner,
            sourceId: 'captured-request-1',
            kind: 'captured',
            label: 'Captured request 1',
            requestText: 'POST /exact HTTP/1.1\r\nHost: exact.example\r\nX-Exact:  value\r\n\r\nbody  ',
            responseText: 'HTTP/1.1 201 Created\r\nX-Exact:  value\r\n\r\nbody  ',
            useHttps: true,
            targetUrl: 'https://exact.example/exact'
        });
        expect(isRepeaterSnapshotValid(snapshot)).toBe(true);
        expect(() => {
            snapshot.requestText = 'mutated';
        }).toThrow(TypeError);
    });

    it('prefers an absolute request target over the Host header and HTTPS flag', () => {
        activateRepeaterContext({
            ownerRequest: { id: 'request-1' },
            kind: 'resend',
            label: 'Absolute target',
            responseText: null
        });

        const snapshot = captureRepeaterContext({
            requestText: 'GET http://origin.example:8080/path?q=one HTTP/1.1\nHost: ignored.example',
            useHttps: true
        });

        expect(snapshot.targetUrl).toBe('http://origin.example:8080/path?q=one');
        expect(snapshot.useHttps).toBe(true);
        expect(snapshot.scheme).toBe('http');
    });

    it('invalidates a source snapshot and clears only that active source', () => {
        const ownerRequest = { id: 'request-1' };
        const first = activateRepeaterContext({
            ownerRequest,
            sourceId: 'source-1',
            kind: 'captured',
            label: 'Captured',
            responseText: null
        });
        const firstSnapshot = captureRepeaterContext({ requestText, useHttps: false });

        const second = activateRepeaterContext({
            ownerRequest,
            sourceId: 'source-2',
            kind: 'resend',
            label: 'Resend',
            responseText: 'response'
        });
        const secondSnapshot = captureRepeaterContext({ requestText, useHttps: false });

        invalidateRepeaterSource(first.sourceId);
        expect(isRepeaterSnapshotValid(firstSnapshot)).toBe(false);
        expect(isRepeaterSnapshotValid(secondSnapshot)).toBe(true);
        expect(getActiveRepeaterContext()).toBe(second);

        invalidateRepeaterSource(second.sourceId);
        expect(isRepeaterSnapshotValid(secondSnapshot)).toBe(false);
        expect(getActiveRepeaterContext()).toBeNull();
    });

    it('tombstones invalidated source IDs so they cannot be reactivated', () => {
        const ownerRequest = { id: 'request-1' };
        activateRepeaterContext({
            ownerRequest,
            sourceId: 'removed-result',
            kind: 'bulk-result',
            label: 'Removed result',
            responseText: 'response'
        });

        invalidateRepeaterSource('removed-result');

        expect(isRepeaterSourceValid('removed-result', ownerRequest)).toBe(false);
        expect(() => activateRepeaterContext({
            ownerRequest,
            sourceId: 'removed-result',
            kind: 'bulk-result',
            label: 'Restored result',
            responseText: 'response'
        })).toThrow(/invalidated/i);
    });

    it('invalidates every source owned by a request without affecting another owner', () => {
        const firstOwner = { id: 'request-1' };
        const secondOwner = { id: 'request-2' };

        activateRepeaterContext({
            ownerRequest: firstOwner,
            kind: 'captured',
            label: 'Captured',
            responseText: null
        });
        const capturedSnapshot = captureRepeaterContext({ requestText, useHttps: false });

        activateRepeaterContext({
            ownerRequest: firstOwner,
            kind: 'resend',
            label: 'Resend',
            responseText: 'response'
        });
        const resendSnapshot = captureRepeaterContext({ requestText, useHttps: false });

        const otherContext = activateRepeaterContext({
            ownerRequest: secondOwner,
            kind: 'bulk-result',
            label: 'Other result',
            responseText: 'other response'
        });
        const otherSnapshot = captureRepeaterContext({ requestText, useHttps: false });

        invalidateRepeaterOwner(firstOwner);
        expect(isRepeaterSnapshotValid(capturedSnapshot)).toBe(false);
        expect(isRepeaterSnapshotValid(resendSnapshot)).toBe(false);
        expect(isRepeaterOwnerValid(firstOwner)).toBe(false);
        expect(canActivateRepeaterSource('new-result', firstOwner)).toBe(false);
        expect(() => activateRepeaterContext({
            ownerRequest: firstOwner,
            sourceId: 'new-result',
            kind: 'bulk-result',
            label: 'Late result',
            responseText: 'late response'
        })).toThrow(/owner has been invalidated/i);
        expect(isRepeaterSnapshotValid(otherSnapshot)).toBe(true);
        expect(getActiveRepeaterContext()).toBe(otherContext);

        invalidateRepeaterOwner(secondOwner);
        expect(isRepeaterSnapshotValid(otherSnapshot)).toBe(false);
        expect(getActiveRepeaterContext()).toBeNull();
    });

    it('clears active context and invalidates all existing snapshots', () => {
        activateRepeaterContext({
            ownerRequest: { id: 'request-1' },
            kind: 'captured',
            label: 'Captured',
            responseText: null
        });
        const snapshot = captureRepeaterContext({ requestText, useHttps: false });

        clearRepeaterContext();

        expect(getActiveRepeaterContext()).toBeNull();
        expect(isRepeaterSnapshotValid(snapshot)).toBe(false);
        expect(captureRepeaterContext({ requestText, useHttps: false })).toBeNull();
    });
});
