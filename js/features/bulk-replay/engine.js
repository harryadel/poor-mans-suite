// Attack Mode Engine for Poor Man's Suite Bulk Replay
// Implements Burp Suite Intruder-style attack modes

const SUPPORTED_ATTACK_TYPES = new Set(['sniper', 'battering-ram', 'pitchfork', 'cluster-bomb']);
const MAX_SAFE_REQUEST_COUNT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Calculate the number of requests an attack will generate.
 * @param {string} attackType - 'sniper', 'battering-ram', 'pitchfork', or 'cluster-bomb'
 * @param {Array} positionConfigs - Array of position configurations
 * @returns {number} Number of requests
 */
export function calculateAttackRequestCount(attackType, positionConfigs) {
    if (!SUPPORTED_ATTACK_TYPES.has(attackType)) {
        throw new Error(`Unknown attack type: ${attackType}`);
    }
    if (!Array.isArray(positionConfigs) || positionConfigs.length === 0) {
        throw new Error('At least one payload position is required');
    }

    if (attackType === 'battering-ram') {
        return calculatePayloadCount(positionConfigs[0]);
    }

    const payloadCounts = positionConfigs.map(calculatePayloadCount);

    if (attackType === 'pitchfork') {
        return payloadCounts.reduce((minimum, count) => Math.min(minimum, count));
    }
    if (attackType === 'cluster-bomb' && payloadCounts.includes(0)) {
        return 0;
    }

    let requestCount = attackType === 'cluster-bomb' ? 1n : 0n;
    for (const payloadCount of payloadCounts) {
        requestCount = attackType === 'cluster-bomb'
            ? requestCount * BigInt(payloadCount)
            : requestCount + BigInt(payloadCount);
        if (requestCount > MAX_SAFE_REQUEST_COUNT) {
            throw new RangeError('Attack request count exceeds the safe integer limit');
        }
    }

    return Number(requestCount);
}

/**
 * Generate attack requests based on attack type
 * @param {string} attackType - 'sniper', 'battering-ram', 'pitchfork', or 'cluster-bomb'
 * @param {Array} positionConfigs - Array of position configurations
 * @param {string} template - Request template with § markers
 * @returns {Array} Array of {payloads: Array, requestContent: string}
 */
export function generateAttackRequests(attackType, positionConfigs, template) {
    calculateAttackRequestCount(attackType, positionConfigs);

    switch (attackType) {
        case 'sniper':
            return generateSniperRequests(positionConfigs, template);
        case 'battering-ram':
            return generateBatteringRamRequests(positionConfigs, template);
        case 'pitchfork':
            return generatePitchforkRequests(positionConfigs, template);
        case 'cluster-bomb':
            return generateClusterBombRequests(positionConfigs, template);
        default:
            throw new Error(`Unknown attack type: ${attackType}`);
    }
}

/**
 * Sniper Mode: One position at a time
 * For each position, iterate through its payloads while keeping others at original value
 */
function generateSniperRequests(positionConfigs, template) {
    const requests = [];

    positionConfigs.forEach((config, posIndex) => {
        const payloads = generatePayloadsForPosition(config);

        payloads.forEach(payload => {
            const payloadArray = positionConfigs.map((c, i) =>
                i === posIndex ? payload : c.originalValue
            );
            const requestContent = replacePositions(template, payloadArray);
            requests.push({ payloads: payloadArray, requestContent });
        });
    });

    return requests;
}

/**
 * Battering Ram Mode: Same payload for all positions
 * Uses first position's config for payload generation
 */
function generateBatteringRamRequests(positionConfigs, template) {
    const requests = [];

    // Use first position's config (or shared config if implemented)
    const payloads = generatePayloadsForPosition(positionConfigs[0]);

    payloads.forEach(payload => {
        const payloadArray = positionConfigs.map(() => payload);
        const requestContent = replacePositions(template, payloadArray);
        requests.push({ payloads: payloadArray, requestContent });
    });

    return requests;
}

/**
 * Pitchfork Mode: Zip payloads across positions (index-wise)
 * Stops when shortest list ends
 */
function generatePitchforkRequests(positionConfigs, template) {
    const requests = [];

    // Generate payloads for each position
    const allPayloads = positionConfigs.map(config => generatePayloadsForPosition(config));

    // Find shortest length
    const minLength = Math.min(...allPayloads.map(p => p.length));

    // Zip payloads
    for (let i = 0; i < minLength; i++) {
        const payloadArray = allPayloads.map(payloads => payloads[i]);
        const requestContent = replacePositions(template, payloadArray);
        requests.push({ payloads: payloadArray, requestContent });
    }

    return requests;
}

/**
 * Cluster Bomb Mode: Full Cartesian product
 * Generates all combinations of payloads across positions
 */
function generateClusterBombRequests(positionConfigs, template) {
    const requests = [];

    // Generate payloads for each position
    const allPayloads = positionConfigs.map(config => generatePayloadsForPosition(config));

    // Generate Cartesian product
    const cartesian = (...arrays) => {
        return arrays.reduce((acc, array) =>
            acc.flatMap(x => array.map(y => [...x, y])),
            [[]]
        );
    };

    const combinations = cartesian(...allPayloads);

    combinations.forEach(payloadArray => {
        const requestContent = replacePositions(template, payloadArray);
        requests.push({ payloads: payloadArray, requestContent });
    });

    return requests;
}

/**
 * Generate payloads for a single position based on its config
 */
function generatePayloadsForPosition(config) {
    const payloadCount = calculatePayloadCount(config);

    if (config.type === 'simple-list') {
        return config.list.split('\n').filter(line => line.trim() !== '');
    }

    const payloads = [];
    const { from, step } = config.numbers;
    const fromValue = BigInt(from);
    const stepValue = BigInt(step);
    for (let index = 0; index < payloadCount; index++) {
        payloads.push((fromValue + (BigInt(index) * stepValue)).toString());
    }
    return payloads;
}

function calculatePayloadCount(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('Payload position config must be an object');
    }

    if (config.type === 'simple-list') {
        if (typeof config.list !== 'string') {
            throw new TypeError('Simple-list payloads must be a string');
        }
        return config.list.split('\n').filter(line => line.trim() !== '').length;
    }

    if (config.type !== 'numbers') {
        throw new Error(`Unsupported payload type: ${config.type}`);
    }
    if (!config.numbers || typeof config.numbers !== 'object' || Array.isArray(config.numbers)) {
        throw new TypeError('Numbers payload config must be an object');
    }

    const { from, to, step } = config.numbers;
    if (![from, to, step].every(value => Number.isFinite(value) && Number.isInteger(value))) {
        throw new TypeError('Number payload values must be finite integers');
    }
    if (![from, to, step].every(Number.isSafeInteger)) {
        throw new RangeError('Number payload values must be safe integers');
    }
    if (step <= 0) {
        throw new RangeError('Number payload step must be positive');
    }
    if (from > to) {
        throw new RangeError('Number payload range must be ascending');
    }

    const payloadCount = ((BigInt(to) - BigInt(from)) / BigInt(step)) + 1n;
    if (payloadCount > MAX_SAFE_REQUEST_COUNT) {
        throw new RangeError('Payload count exceeds the safe integer limit');
    }
    return Number(payloadCount);
}

/**
 * Replace all § markers in template with payloads
 * @param {string} template - Request template with § markers
 * @param {Array} payloads - Array of payload values (one per position)
 * @returns {string} Request content with markers replaced
 */
function replacePositions(template, payloads) {
    let index = 0;
    return template.replace(/§[\s\S]*?§/g, () => {
        return payloads[index++] || '';
    });
}
