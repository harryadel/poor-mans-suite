// Bulk Replay payload positions - pure helpers for marker-aware template edits.
// A position is a pair of § markers; the text between them is the position's value.

export const PAYLOAD_MARKER = '§';
const MARKER_PATTERN = /§[\s\S]*?§/g;

/**
 * Lists every marker pair in the template in document order.
 * @param {string} template
 * @returns {Array<{ index: number, start: number, end: number, value: string }>}
 */
export function findTemplatePositions(template) {
    const text = String(template ?? '');
    const positions = [];
    const pattern = new RegExp(MARKER_PATTERN.source, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
        positions.push({
            index: positions.length,
            start: match.index,
            end: match.index + match[0].length,
            value: match[0].slice(1, -1)
        });
    }
    return positions;
}

/**
 * Drops the markers of one position, keeping its text in place.
 * Returns the template unchanged when the index does not exist.
 */
export function removeTemplatePosition(template, index) {
    const text = String(template ?? '');
    const position = findTemplatePositions(text)[index];
    if (!position) return text;
    return text.slice(0, position.start) + position.value + text.slice(position.end);
}

/**
 * Replaces the text between one position's markers.
 * The marker character is not allowed inside a value because it would change the position count.
 */
export function setTemplatePositionValue(template, index, value) {
    const text = String(template ?? '');
    const nextValue = String(value ?? '');
    if (nextValue.includes(PAYLOAD_MARKER)) {
        throw new Error(`A position value cannot contain the ${PAYLOAD_MARKER} marker.`);
    }
    const position = findTemplatePositions(text)[index];
    if (!position) return text;
    return text.slice(0, position.start) + PAYLOAD_MARKER + nextValue + PAYLOAD_MARKER + text.slice(position.end);
}
