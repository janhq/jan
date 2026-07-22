/**
 * Split a reasoning trace into paragraph "steps". Models separate distinct
 * thoughts with a blank line, so a run of 2+ newlines starts a new step; a
 * single newline stays within the current step (soft wrap / list item).
 *
 * Because the caller passes the full accumulated text on every streaming tick,
 * the last element is the paragraph currently being written; earlier elements
 * are completed steps. No external accumulator state is needed.
 */
export function splitReasoningParagraphs(text: string): string[] {
  if (!text) return []
  return text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+$/, ''))
    .filter((p) => p.trim().length > 0)
}
