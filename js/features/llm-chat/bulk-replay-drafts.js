import { calculateAttackRequestCount, generateAttackRequests } from '../bulk-replay/engine.js';
import { normalizeResponseMatchers } from '../bulk-replay/response-matches.js';
import { isRepeaterSnapshotValid } from '../repeater-context.js';

export const CHAT_BULK_REPLAY_REQUEST_LIMIT = 1000;
export const CHAT_BULK_REPLAY_DRAFT_MAX_CHARS = 50_000;
export const CHAT_BULK_REPLAY_FENCE_LANGUAGE = 'poor-mans-suite-bulk-replay';

const BULK_REPLAY_COMMAND = /^\/bulk-replay(?=\s|$)/i;
const BULK_REPLAY_SUBJECT = /\b(?:bulk[\s-]+replay|sniper|battering[\s-]+ram|pitchfork|cluster[\s-]+bomb)\b/i;
const BULK_REPLAY_IMPERATIVE = /^(?:please\s+)?(?:prepare|configure|create|draft|set\s+up|build|generate)\b/i;
const BULK_REPLAY_POLITE_IMPERATIVE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:prepare|configure|create|draft|set\s+up|build|generate)\b/i;

const ATTACK_TYPES = new Set(['sniper', 'battering-ram', 'pitchfork', 'cluster-bomb']);
const TOP_LEVEL_FIELDS = new Set([
    'version',
    'correlationId',
    'attackType',
    'template',
    'positionConfigs',
    'batteringRamConfig',
    'responseMatchers',
    'responseMatchCaseSensitive'
]);
const APP_POSITION_FIELDS = new Set(['type', 'list', 'numbers', 'index', 'originalValue']);
const RESPONSE_MATCHER_FIELDS = new Set(['text', 'mode', 'isContinuationGuard']);
const NUMBER_FIELDS = new Set(['from', 'to', 'step']);

function deriveRequestOrigin(requestText, scheme) {
    const lines = requestText.split(/\r?\n/);
    const requestTarget = lines[0]?.trim().split(/\s+/)[1];
    if (!requestTarget) throw new Error('generated request line is invalid');

    if (/^https?:\/\//i.test(requestTarget)) {
        return new URL(requestTarget).origin;
    }

    let host = '';
    for (const line of lines.slice(1)) {
        if (line.trim() === '') break;
        const colonIndex = line.indexOf(':');
        if (colonIndex <= 0) continue;
        if (line.slice(0, colonIndex).trim().toLowerCase() === 'host') {
            host = line.slice(colonIndex + 1).trim();
        }
    }
    if (!host) throw new Error('generated request is missing a Host header');
    return new URL(`${scheme}://${host}${requestTarget}`).origin;
}

export function isBulkReplayDraftRequested(message) {
    if (typeof message !== 'string') return false;

    const normalized = message.trimStart();
    if (BULK_REPLAY_COMMAND.test(normalized)) return true;
    if (!BULK_REPLAY_SUBJECT.test(normalized)) return false;

    return BULK_REPLAY_IMPERATIVE.test(normalized) || BULK_REPLAY_POLITE_IMPERATIVE.test(normalized);
}

export function createBulkReplayDraftContract(correlationId) {
    if (typeof correlationId !== 'string' || correlationId === '') {
        throw new TypeError('A non-empty Bulk Replay correlation ID is required.');
    }

    return `The user explicitly requested a Bulk Replay configuration draft for this turn. This is a non-executable draft: never claim that it starts traffic, grants permission, or confirms execution.

If you can produce a complete supported draft, return at most one fenced block whose language is exactly ${CHAT_BULK_REPLAY_FENCE_LANGUAGE}. You may include explanatory prose outside the block. Use only this JSON contract and no unknown fields:

\`\`\`${CHAT_BULK_REPLAY_FENCE_LANGUAGE}
{
  "version": 1,
  "correlationId": "${correlationId}",
  "attackType": "sniper | battering-ram | pitchfork | cluster-bomb",
  "template": "the exact current request with balanced section-sign payload markers",
  "positionConfigs": [
    { "type": "simple-list", "list": "one payload per non-empty line" },
    { "type": "numbers", "numbers": { "from": 1, "to": 10, "step": 1 } }
  ],
  "batteringRamConfig": { "type": "simple-list", "list": "shared payloads" },
  "responseMatchers": [
    { "text": "response text", "mode": "partial | whole", "isContinuationGuard": false }
  ],
  "responseMatchCaseSensitive": true
}
\`\`\`

Set version to 1 and correlationId to exactly "${correlationId}". attackType must be exactly one of sniper, battering-ram, pitchfork, or cluster-bomb. The only accepted top-level fields are version, correlationId, attackType, template, positionConfigs, batteringRamConfig, responseMatchers, and responseMatchCaseSensitive.

Preserve every non-marker request byte. The template may only add or reuse balanced § delimiters around payload positions; removing every § from the template must reproduce the exact current request byte-for-byte. Do not alter the request line, target, headers, whitespace, line endings, or body outside those marker delimiters. Every generated payload request must retain the current request's origin and scheme; do not use payloads that can change the absolute target or Host header to another origin.

For sniper, pitchfork, and cluster-bomb, positionConfigs is required and must contain exactly one entry per marked position. Each entry is either {"type":"simple-list","list":"..."} or {"type":"numbers","numbers":{"from":integer,"to":integer,"step":positiveInteger}}. For battering-ram, omit positionConfigs and provide batteringRamConfig in one of those two payload forms. Omit batteringRamConfig for other modes.

responseMatchers may be omitted or be an array whose entries contain only text, mode, and isContinuationGuard. mode is partial or whole, text is non-empty, and isContinuationGuard is boolean. responseMatchCaseSensitive may be omitted and defaults to true, or must be boolean. Do not include a target, URL, scheme, permission result, execution command, tool name, or confirmation field. If the draft cannot satisfy this exact contract, explain the limitation without emitting the fenced block.`;
}

function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function addUnknownFieldErrors(value, allowedFields, label, errors) {
    Object.keys(value).forEach(field => {
        if (!allowedFields.has(field)) errors.push(`${label} contains unknown field "${field}".`);
    });
}

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(child => deepFreeze(child, seen));
    return Object.freeze(value);
}

function invalidValidation(errors, projectedRequestCount = null) {
    return {
        valid: false,
        errors,
        config: null,
        projectedRequestCount
    };
}

function invalidParse(errors, projectedRequestCount = null) {
    return {
        found: true,
        valid: false,
        errors,
        draft: null,
        projectedRequestCount
    };
}

function resolveRequestLimit(maxRequests, errors) {
    if (maxRequests === undefined) return CHAT_BULK_REPLAY_REQUEST_LIMIT;
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
        errors.push('maxRequests must be a positive safe integer.');
        return CHAT_BULK_REPLAY_REQUEST_LIMIT;
    }
    return Math.min(maxRequests, CHAT_BULK_REPLAY_REQUEST_LIMIT);
}

function analyzeMarkers(text, label, { required = false } = {}, errors) {
    if (typeof text !== 'string') {
        errors.push(`${label} must be a string.`);
        return null;
    }

    const markerIndexes = [];
    for (let index = text.indexOf('§'); index !== -1; index = text.indexOf('§', index + 1)) {
        markerIndexes.push(index);
    }

    if (markerIndexes.length === 0) {
        if (required) errors.push(`${label} must contain at least one payload marker.`);
        return { stripped: text, positions: [] };
    }
    if (markerIndexes.length % 2 !== 0) {
        errors.push(`${label} contains an odd number of section signs.`);
        return null;
    }
    if (text.includes('§§')) {
        errors.push(`${label} contains ambiguous adjacent section signs.`);
        return null;
    }

    const positions = [];
    for (let index = 0; index < markerIndexes.length; index += 2) {
        positions.push({
            index: index / 2,
            originalValue: text.slice(markerIndexes[index] + 1, markerIndexes[index + 1])
        });
    }

    return {
        stripped: text.replaceAll('§', ''),
        positions
    };
}

function normalizeNumbers(value, label, errors) {
    if (!isRecord(value)) {
        errors.push(`${label} must be an object.`);
        return null;
    }
    addUnknownFieldErrors(value, NUMBER_FIELDS, label, errors);

    const values = ['from', 'to', 'step'].map(field => value[field]);
    if (!values.every(Number.isFinite) || !values.every(Number.isInteger)) {
        errors.push(`${label} values must be finite integers.`);
        return null;
    }
    if (!values.every(Number.isSafeInteger)) {
        errors.push(`${label} values must be safe integers.`);
        return null;
    }
    if (value.step <= 0) {
        errors.push(`${label} step must be positive.`);
        return null;
    }
    if (value.from > value.to) {
        errors.push(`${label} range must be ascending.`);
        return null;
    }

    return { from: value.from, to: value.to, step: value.step };
}

function normalizePayloadConfig(value, label, { strictModel, requirePayload }, errors) {
    if (!isRecord(value)) {
        errors.push(`${label} must be an object.`);
        return null;
    }

    const strictFields = value.type === 'simple-list'
        ? new Set(['type', 'list'])
        : value.type === 'numbers'
            ? new Set(['type', 'numbers'])
            : new Set(['type', 'list', 'numbers']);
    addUnknownFieldErrors(value, strictModel ? strictFields : APP_POSITION_FIELDS, label, errors);

    if (value.type === 'simple-list') {
        if (typeof value.list !== 'string') {
            errors.push(`${label}.list must be a string.`);
            return null;
        }
        if (requirePayload && !value.list.split('\n').some(line => line.trim() !== '')) {
            errors.push(`${label}.list must contain at least one non-empty payload.`);
            return null;
        }
        return { type: 'simple-list', list: value.list };
    }

    if (value.type === 'numbers') {
        const numbers = normalizeNumbers(value.numbers, `${label}.numbers`, errors);
        return numbers ? { type: 'numbers', numbers } : null;
    }

    errors.push(`${label}.type must be "simple-list" or "numbers".`);
    return null;
}

function normalizeMatchers(value, errors) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        errors.push('responseMatchers must be an array.');
        return null;
    }

    const matchers = [];
    value.forEach((matcher, index) => {
        const label = `responseMatchers[${index}]`;
        if (!isRecord(matcher)) {
            errors.push(`${label} must be an object.`);
            return;
        }
        addUnknownFieldErrors(matcher, RESPONSE_MATCHER_FIELDS, label, errors);
        if (typeof matcher.text !== 'string' || matcher.text.trim() === '') {
            errors.push(`${label}.text must be a non-empty string.`);
        }
        if (matcher.mode !== 'partial' && matcher.mode !== 'whole') {
            errors.push(`${label}.mode must be "partial" or "whole".`);
        }
        if (typeof matcher.isContinuationGuard !== 'boolean') {
            errors.push(`${label}.isContinuationGuard must be a boolean.`);
        }
        if (
            typeof matcher.text === 'string' && matcher.text.trim() !== '' &&
            (matcher.mode === 'partial' || matcher.mode === 'whole') &&
            typeof matcher.isContinuationGuard === 'boolean'
        ) {
            matchers.push({
                text: matcher.text,
                mode: matcher.mode,
                isContinuationGuard: matcher.isContinuationGuard
            });
        }
    });

    return normalizeResponseMatchers(matchers);
}

function validateConfiguration(config, { snapshot, maxRequests, strictModel, correlationId } = {}) {
    const errors = [];
    const requestLimit = resolveRequestLimit(maxRequests, errors);

    if (!isRepeaterSnapshotValid(snapshot)) {
        errors.push('The Repeater snapshot is no longer valid.');
    }
    if (snapshot?.targetUrl === null || typeof snapshot?.targetUrl !== 'string' || snapshot.targetUrl === '') {
        errors.push('The Repeater snapshot does not have a valid target URL.');
    }
    if (!isRecord(config)) {
        errors.push('Bulk Replay configuration must be a JSON object.');
        return invalidValidation(errors);
    }
    addUnknownFieldErrors(config, TOP_LEVEL_FIELDS, 'Bulk Replay configuration', errors);

    if (config.version !== 1) errors.push('version must be 1.');
    if (typeof config.correlationId !== 'string' || config.correlationId === '') {
        errors.push('correlationId must be a non-empty string.');
    }
    if (correlationId !== undefined) {
        if (typeof correlationId !== 'string' || correlationId === '') {
            errors.push('A valid expected correlation ID is required.');
        } else if (config.correlationId !== correlationId) {
            errors.push('correlationId does not match the requested draft.');
        }
    }
    if (!ATTACK_TYPES.has(config.attackType)) {
        errors.push('attackType must be sniper, battering-ram, pitchfork, or cluster-bomb.');
    }

    const templateMarkers = analyzeMarkers(config.template, 'template', { required: true }, errors);
    const snapshotMarkers = analyzeMarkers(snapshot?.requestText, 'snapshot.requestText', {}, errors);
    if (templateMarkers && snapshotMarkers && templateMarkers.stripped !== snapshotMarkers.stripped) {
        errors.push('template does not exactly match the Repeater snapshot after removing payload markers.');
    }

    let normalizedPositionConfigs = [];
    const positions = templateMarkers?.positions || [];
    const rawPositionConfigs = config.positionConfigs;
    const isBatteringRam = config.attackType === 'battering-ram';

    if (strictModel && isBatteringRam && rawPositionConfigs !== undefined) {
        errors.push('positionConfigs must be omitted for battering-ram.');
    } else if (rawPositionConfigs !== undefined && !Array.isArray(rawPositionConfigs)) {
        errors.push('positionConfigs must be an array.');
    } else if (!isBatteringRam && !Array.isArray(rawPositionConfigs)) {
        errors.push('positionConfigs is required for this attack type.');
    } else if (!isBatteringRam && rawPositionConfigs.length !== positions.length) {
        errors.push(`positionConfigs must contain exactly ${positions.length} payload configuration(s).`);
    }

    if (isBatteringRam) {
        if (Array.isArray(rawPositionConfigs) && rawPositionConfigs.length > 0) {
            if (rawPositionConfigs.length !== positions.length) {
                errors.push(`positionConfigs must be empty or contain exactly ${positions.length} payload configuration(s).`);
            }
            rawPositionConfigs.forEach((positionConfig, index) => {
                normalizePayloadConfig(positionConfig, `positionConfigs[${index}]`, {
                    strictModel,
                    requirePayload: strictModel
                }, errors);
            });
        }
        normalizedPositionConfigs = positions.map(position => ({
            ...position,
            type: 'simple-list',
            list: ''
        }));
    } else if (Array.isArray(rawPositionConfigs)) {
        normalizedPositionConfigs = positions.map((position, index) => {
            const payloadConfig = normalizePayloadConfig(
                rawPositionConfigs[index],
                `positionConfigs[${index}]`,
                { strictModel, requirePayload: true },
                errors
            );
            return payloadConfig ? { ...position, ...payloadConfig } : null;
        }).filter(Boolean);
    }

    let normalizedBatteringRamConfig;
    if (config.batteringRamConfig === undefined) {
        if (isBatteringRam) errors.push('batteringRamConfig is required for battering-ram.');
    } else {
        if (strictModel && !isBatteringRam) {
            errors.push('batteringRamConfig must be omitted unless attackType is battering-ram.');
        }
        normalizedBatteringRamConfig = normalizePayloadConfig(
            config.batteringRamConfig,
            'batteringRamConfig',
            { strictModel, requirePayload: isBatteringRam },
            errors
        );
    }

    const normalizedMatchers = normalizeMatchers(config.responseMatchers, errors);
    const responseMatchCaseSensitive = config.responseMatchCaseSensitive ?? true;
    if (typeof responseMatchCaseSensitive !== 'boolean') {
        errors.push('responseMatchCaseSensitive must be a boolean.');
    }

    let projectedRequestCount = null;
    const hasCompletePositions = positions.length > 0 && normalizedPositionConfigs.length === positions.length;
    const effectivePositionConfigs = isBatteringRam && normalizedBatteringRamConfig
        ? positions.map(() => normalizedBatteringRamConfig)
        : normalizedPositionConfigs;
    if (ATTACK_TYPES.has(config.attackType) && hasCompletePositions && effectivePositionConfigs.length > 0) {
        try {
            projectedRequestCount = calculateAttackRequestCount(config.attackType, effectivePositionConfigs);
            if (projectedRequestCount < 1) {
                errors.push('The attack must generate at least one request.');
            } else if (projectedRequestCount > requestLimit) {
                errors.push(`The attack would generate ${projectedRequestCount} requests, exceeding the limit of ${requestLimit}.`);
            }
        } catch (error) {
            errors.push(`Unable to calculate the attack request count: ${error.message}`);
        }
    }

    if (errors.length === 0 && projectedRequestCount !== null) {
        try {
            const scheme = snapshot.scheme || (snapshot.useHttps ? 'https' : 'http');
            const reviewedOrigin = new URL(snapshot.targetUrl).origin;
            const generatedRequests = generateAttackRequests(
                config.attackType,
                effectivePositionConfigs,
                config.template
            );
            if (generatedRequests.length !== projectedRequestCount) {
                errors.push('Generated request count does not match the reviewed projection.');
            } else if (generatedRequests.some(({ requestContent }) =>
                deriveRequestOrigin(requestContent, scheme) !== reviewedOrigin
            )) {
                errors.push('Every generated request must stay on the reviewed target origin and scheme.');
            }
        } catch (error) {
            errors.push(`Unable to validate generated request targets: ${error.message}.`);
        }
    }

    if (errors.length > 0) return invalidValidation(errors, projectedRequestCount);

    const normalized = {
        version: 1,
        correlationId: config.correlationId,
        attackType: config.attackType,
        template: config.template,
        positionConfigs: normalizedPositionConfigs,
        responseMatchers: normalizedMatchers,
        responseMatchCaseSensitive
    };
    if (normalizedBatteringRamConfig) normalized.batteringRamConfig = normalizedBatteringRamConfig;

    return {
        valid: true,
        errors: [],
        config: deepFreeze(normalized),
        projectedRequestCount
    };
}

function findDuplicateJsonProperty(text) {
    let index = 0;
    let duplicate = null;

    function skipWhitespace() {
        while (/\s/.test(text[index] || '')) index += 1;
    }

    function readString() {
        const start = index;
        index += 1;
        while (index < text.length) {
            if (text[index] === '\\') {
                index += 2;
            } else if (text[index] === '"') {
                index += 1;
                break;
            } else {
                index += 1;
            }
        }
        return JSON.parse(text.slice(start, index));
    }

    function readValue() {
        skipWhitespace();
        if (text[index] === '{') {
            readObject();
        } else if (text[index] === '[') {
            readArray();
        } else if (text[index] === '"') {
            readString();
        } else {
            while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
        }
    }

    function readObject() {
        const keys = new Set();
        index += 1;
        skipWhitespace();
        if (text[index] === '}') {
            index += 1;
            return;
        }
        while (index < text.length) {
            skipWhitespace();
            const key = readString();
            if (keys.has(key) && duplicate === null) duplicate = key;
            keys.add(key);
            skipWhitespace();
            index += 1;
            readValue();
            skipWhitespace();
            if (text[index] === '}') {
                index += 1;
                return;
            }
            index += 1;
        }
    }

    function readArray() {
        index += 1;
        skipWhitespace();
        if (text[index] === ']') {
            index += 1;
            return;
        }
        while (index < text.length) {
            readValue();
            skipWhitespace();
            if (text[index] === ']') {
                index += 1;
                return;
            }
            index += 1;
        }
    }

    readValue();
    return duplicate;
}

function extractDraftBlock(text) {
    const language = CHAT_BULK_REPLAY_FENCE_LANGUAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openerPattern = new RegExp(`^\`\`\`${language}(?=[ \\t\\r\\n]|$)[^\\r\\n]*(?:\\r?\\n|$)`, 'gm');
    const openers = Array.from(text.matchAll(openerPattern));
    if (openers.length === 0) return { found: false };
    if (openers.length !== 1) return { found: true, error: 'Exactly one Bulk Replay draft block is allowed.' };

    const opener = openers[0];
    const openerLine = opener[0].replace(/\r?\n$/, '');
    if (openerLine !== `\`\`\`${CHAT_BULK_REPLAY_FENCE_LANGUAGE}`) {
        return { found: true, error: `The draft block language must be exactly ${CHAT_BULK_REPLAY_FENCE_LANGUAGE}.` };
    }
    if (!/\r?\n$/.test(opener[0])) {
        return { found: true, error: 'The Bulk Replay draft block is not closed.' };
    }

    const contentStart = opener.index + opener[0].length;
    const closingPattern = /^```[ \t]*(?:\r?\n|$)/gm;
    closingPattern.lastIndex = contentStart;
    const closing = closingPattern.exec(text);
    if (!closing) return { found: true, error: 'The Bulk Replay draft block is not closed.' };

    return { found: true, content: text.slice(contentStart, closing.index) };
}

export function parseBulkReplayDraft(text, options = {}) {
    try {
        const source = typeof text === 'string' ? text : String(text ?? '');
        const extracted = extractDraftBlock(source);
        if (!extracted.found) {
            return {
                found: false,
                valid: false,
                errors: [],
                draft: null,
                projectedRequestCount: null
            };
        }
        if (extracted.error) return invalidParse([extracted.error]);
        if (extracted.content.length > CHAT_BULK_REPLAY_DRAFT_MAX_CHARS) {
            return invalidParse([`The Bulk Replay draft block exceeds ${CHAT_BULK_REPLAY_DRAFT_MAX_CHARS} characters.`]);
        }

        let parsed;
        try {
            parsed = JSON.parse(extracted.content);
        } catch (error) {
            return invalidParse([`The Bulk Replay draft block contains malformed JSON: ${error.message}`]);
        }

        const duplicateProperty = findDuplicateJsonProperty(extracted.content);
        if (duplicateProperty !== null) {
            return invalidParse([`The Bulk Replay draft block contains duplicate field "${duplicateProperty}".`]);
        }

        const safeOptions = isRecord(options) ? options : {};
        const validation = validateConfiguration(parsed, {
            snapshot: safeOptions.snapshot,
            correlationId: safeOptions.correlationId,
            maxRequests: safeOptions.maxRequests,
            strictModel: true
        });
        return {
            found: true,
            valid: validation.valid,
            errors: validation.errors,
            draft: validation.config,
            projectedRequestCount: validation.projectedRequestCount
        };
    } catch (error) {
        return invalidParse([`Unable to parse the Bulk Replay draft: ${error.message}`]);
    }
}

export function validateBulkReplayConfiguration(config, options = {}) {
    try {
        const safeOptions = isRecord(options) ? options : {};
        return validateConfiguration(config, {
            snapshot: safeOptions.snapshot,
            maxRequests: safeOptions.maxRequests,
            strictModel: false
        });
    } catch (error) {
        return invalidValidation([`Unable to validate the Bulk Replay configuration: ${error.message}`]);
    }
}
