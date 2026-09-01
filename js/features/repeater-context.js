import { events, EVENT_NAMES } from '../core/events.js';

const SOURCE_KINDS = new Set(['captured', 'resend', 'bulk-result']);

let nextSourceId = 0;
let nextSnapshotId = 0;
let activeContext = null;
let activeSourceRecord = null;

const sourceRecords = new Map();
const snapshotSources = new WeakMap();
const invalidatedSourceIds = new Set();
const invalidatedOwners = new WeakSet();

function createSourceId() {
    nextSourceId += 1;
    return `repeater-source-${nextSourceId}`;
}

function createSnapshotId() {
    nextSnapshotId += 1;
    return `repeater-snapshot-${nextSnapshotId}`;
}

function emitInvalidation(sourceId, ownerRequest) {
    events.emit(EVENT_NAMES.REPEATER_CONTEXT_INVALIDATED, Object.freeze({
        sourceId,
        ownerRequest
    }));
}

function deriveTargetUrl(requestText, useHttps) {
    const lines = requestText.split(/\r?\n/);
    const requestLineParts = (lines[0] || '').trim().split(/\s+/);
    const requestTarget = requestLineParts[1];

    if (!requestTarget) return null;

    if (/^https?:\/\//i.test(requestTarget)) {
        try {
            return new URL(requestTarget).href;
        } catch {
            return null;
        }
    }

    let host = null;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') break;

        const colonIndex = line.indexOf(':');
        if (colonIndex <= 0) continue;

        const name = line.slice(0, colonIndex).trim();
        if (name.toLowerCase() === 'host') {
            host = line.slice(colonIndex + 1).trim();
            break;
        }
    }

    if (!host) return null;

    const scheme = useHttps ? 'https' : 'http';
    const path = requestTarget.startsWith('/') ? requestTarget : `/${requestTarget}`;

    try {
        return new URL(`${scheme}://${host}${path}`).href;
    } catch {
        return null;
    }
}

export function activateRepeaterContext({ ownerRequest, kind, label, responseText, sourceId } = {}) {
    if (ownerRequest === null || ownerRequest === undefined) {
        throw new TypeError('ownerRequest is required');
    }
    if (invalidatedOwners.has(ownerRequest)) {
        throw new Error('Repeater context owner has been invalidated');
    }
    if (!SOURCE_KINDS.has(kind)) {
        throw new TypeError(`Unsupported Repeater source kind: ${kind}`);
    }
    if (typeof label !== 'string') {
        throw new TypeError('label must be a string');
    }
    if (responseText !== null && responseText !== undefined && typeof responseText !== 'string') {
        throw new TypeError('responseText must be a string or null');
    }

    const resolvedSourceId = sourceId ?? createSourceId();
    if (typeof resolvedSourceId !== 'string' || resolvedSourceId.length === 0) {
        throw new TypeError('sourceId must be a non-empty string');
    }
    if (invalidatedSourceIds.has(resolvedSourceId)) {
        throw new Error(`Repeater source ${resolvedSourceId} has been invalidated`);
    }

    let sourceRecord = sourceRecords.get(resolvedSourceId);
    if (sourceRecord && sourceRecord.ownerRequest !== ownerRequest) {
        throw new Error(`Repeater source ${resolvedSourceId} already belongs to another request`);
    }
    if (!sourceRecord) {
        sourceRecord = { ownerRequest, valid: true };
        sourceRecords.set(resolvedSourceId, sourceRecord);
    }

    activeSourceRecord = sourceRecord;
    activeContext = Object.freeze({
        ownerRequest,
        sourceId: resolvedSourceId,
        kind,
        label,
        responseText: responseText ?? null
    });

    events.emit(EVENT_NAMES.REPEATER_CONTEXT_ACTIVATED, activeContext);

    return activeContext;
}

export function getActiveRepeaterContext() {
    return activeContext;
}

export function captureRepeaterContext({ requestText, useHttps } = {}) {
    if (!activeContext || !activeSourceRecord?.valid) return null;
    if (typeof requestText !== 'string') {
        throw new TypeError('requestText must be a string');
    }

    const https = Boolean(useHttps);
    const targetUrl = deriveTargetUrl(requestText, https);
    let scheme = https ? 'https' : 'http';
    if (targetUrl) {
        try {
            scheme = new URL(targetUrl).protocol.replace(':', '').toLowerCase();
        } catch {
            // Keep the captured Repeater toggle when the target is not parseable.
        }
    }
    const snapshot = Object.freeze({
        snapshotId: createSnapshotId(),
        ownerRequest: activeContext.ownerRequest,
        sourceId: activeContext.sourceId,
        kind: activeContext.kind,
        label: activeContext.label,
        requestText,
        responseText: activeContext.responseText,
        useHttps: https,
        targetUrl,
        scheme
    });

    snapshotSources.set(snapshot, activeSourceRecord);
    return snapshot;
}

export function isRepeaterSnapshotValid(snapshot) {
    return snapshotSources.get(snapshot)?.valid === true;
}

export function isRepeaterSourceValid(sourceId, ownerRequest) {
    if (typeof sourceId !== 'string' || invalidatedSourceIds.has(sourceId)) return false;
    const sourceRecord = sourceRecords.get(sourceId);
    return sourceRecord?.valid === true &&
        (ownerRequest === undefined || sourceRecord.ownerRequest === ownerRequest);
}

export function canActivateRepeaterSource(sourceId, ownerRequest) {
    if (!ownerRequest || invalidatedOwners.has(ownerRequest)) return false;
    if (typeof sourceId !== 'string' || sourceId.length === 0 || invalidatedSourceIds.has(sourceId)) return false;
    const sourceRecord = sourceRecords.get(sourceId);
    return !sourceRecord || sourceRecord.ownerRequest === ownerRequest;
}

export function isRepeaterOwnerValid(ownerRequest) {
    return Boolean(ownerRequest) && !invalidatedOwners.has(ownerRequest);
}

export function invalidateRepeaterSource(sourceId) {
    if (typeof sourceId !== 'string' || sourceId.length === 0) return;
    invalidatedSourceIds.add(sourceId);
    const sourceRecord = sourceRecords.get(sourceId);
    if (!sourceRecord) return;

    sourceRecord.valid = false;
    sourceRecords.delete(sourceId);

    if (activeSourceRecord === sourceRecord) {
        activeContext = null;
        activeSourceRecord = null;
    }

    emitInvalidation(sourceId, sourceRecord.ownerRequest);
}

export function invalidateRepeaterOwner(ownerRequest) {
    if (!ownerRequest || (typeof ownerRequest !== 'object' && typeof ownerRequest !== 'function')) return;
    invalidatedOwners.add(ownerRequest);
    const invalidatedSources = [];
    for (const [sourceId, sourceRecord] of sourceRecords) {
        if (sourceRecord.ownerRequest !== ownerRequest) continue;

        sourceRecord.valid = false;
        sourceRecords.delete(sourceId);
        invalidatedSourceIds.add(sourceId);
        invalidatedSources.push(sourceId);
    }

    if (activeContext?.ownerRequest === ownerRequest) {
        activeContext = null;
        activeSourceRecord = null;
    }

    invalidatedSources.forEach(sourceId => emitInvalidation(sourceId, ownerRequest));
}

export function clearRepeaterContext() {
    const invalidatedSources = [];
    for (const [sourceId, sourceRecord] of sourceRecords) {
        sourceRecord.valid = false;
        invalidatedSourceIds.add(sourceId);
        invalidatedOwners.add(sourceRecord.ownerRequest);
        invalidatedSources.push([sourceId, sourceRecord.ownerRequest]);
    }
    sourceRecords.clear();
    activeContext = null;
    activeSourceRecord = null;
    invalidatedSources.forEach(([sourceId, ownerRequest]) => emitInvalidation(sourceId, ownerRequest));
}
