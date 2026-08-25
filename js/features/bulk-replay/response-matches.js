export function parseResponseMarkers(value) {
    const seen = new Set();

    return String(value || '')
        .split(/\r?\n/)
        .map(marker => marker.trim())
        .filter(marker => {
            if (!marker || seen.has(marker)) return false;
            seen.add(marker);
            return true;
        });
}

export function findResponseMatches(text, markers, { caseSensitive = true } = {}) {
    const source = String(text || '');
    if (!source || !Array.isArray(markers) || markers.length === 0) return [];

    const haystack = caseSensitive ? source : source.toLocaleLowerCase();
    const occupied = new Uint8Array(source.length);
    const matches = [];
    const rules = markers
        .map((marker, index) => ({ marker: String(marker), index }))
        .filter(rule => rule.marker.length > 0)
        .sort((a, b) => b.marker.length - a.marker.length || a.index - b.index);

    rules.forEach(rule => {
        const needle = caseSensitive ? rule.marker : rule.marker.toLocaleLowerCase();
        let searchFrom = 0;

        while (searchFrom <= haystack.length - needle.length) {
            const start = haystack.indexOf(needle, searchFrom);
            if (start === -1) break;

            const end = start + needle.length;
            let overlaps = false;
            for (let offset = start; offset < end; offset++) {
                if (occupied[offset]) {
                    overlaps = true;
                    break;
                }
            }

            if (!overlaps) {
                occupied.fill(1, start, end);
                matches.push({ marker: rule.marker, start, end, markerIndex: rule.index });
            }

            searchFrom = start + 1;
        }
    });

    return matches.sort((a, b) => a.start - b.start || a.markerIndex - b.markerIndex);
}

export function getMatchedResponseMarkers(text, markers, options) {
    const matched = new Set(findResponseMatches(text, markers, options).map(match => match.marker));
    return markers.filter(marker => matched.has(marker));
}

export function highlightResponseMatches(element, markers, options) {
    if (!element || !Array.isArray(markers) || markers.length === 0) return 0;

    const doc = element.ownerDocument || document;
    const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT || 4;
    const walker = doc.createTreeWalker(element, showText);
    const textNodes = [];
    let node;
    let offset = 0;

    while ((node = walker.nextNode())) {
        const start = offset;
        offset += node.nodeValue.length;
        textNodes.push({ node, start, end: offset });
    }

    const matches = findResponseMatches(element.textContent || '', markers, options);
    if (matches.length === 0) return 0;

    textNodes.reverse().forEach(entry => {
        const intersections = matches
            .filter(match => match.start < entry.end && match.end > entry.start)
            .map(match => ({
                marker: match.marker,
                start: Math.max(0, match.start - entry.start),
                end: Math.min(entry.node.nodeValue.length, match.end - entry.start)
            }))
            .sort((a, b) => b.start - a.start);

        intersections.forEach(intersection => {
            if (intersection.start >= intersection.end) return;

            const matchedNode = entry.node.splitText(intersection.start);
            matchedNode.splitText(intersection.end - intersection.start);
            const mark = doc.createElement('mark');
            mark.className = 'response-match-highlight';
            mark.title = `Response marker: ${intersection.marker}`;
            matchedNode.parentNode.replaceChild(mark, matchedNode);
            mark.appendChild(matchedNode);
        });
    });

    return matches.length;
}
