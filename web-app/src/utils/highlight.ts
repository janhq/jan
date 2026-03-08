// web-app/src/utils/highlight.ts
export function highlightFzfMatch(text: string, positions: number[], highlightClassName: string = "search-highlight") {
    if (!text || !positions || !positions.length) return text;

    const parts: { text: string; highlight: boolean }[] = [];
    let lastIndex = 0;

    // Sort positions to ensure we process them in order
    const sortedPositions = [...positions].sort((a, b) => a - b);

    sortedPositions.forEach((pos) => {
        if (pos > lastIndex) {
            parts.push({
                text: text.substring(lastIndex, pos),
                highlight: false
            });
        }
        if (pos < text.length) { // Ensure pos is within bounds
            parts.push({
                text: text[pos],
                highlight: true
            });
        }
        lastIndex = pos + 1;
    });

    if (lastIndex < text.length) {
        parts.push({
            text: text.substring(lastIndex),
            highlight: false
        });
    }

    return parts
        .map(part =>
            part.highlight
                ? `<span class="${highlightClassName}">${part.text}</span>`
                : part.text
        )
        .join('');
}
