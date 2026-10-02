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

/**
 * Character budget per step, roughly five lines at the chat column's width.
 * Exact line count depends on the rendered width, so the view still caps its
 * own height; this budget only decides when a step is considered finished.
 */
export const REASONING_STEP_MAX_CHARS = 400

/** A break this early would emit a stub step, so keep looking. */
const MIN_STEP_RATIO = 0.4

const SENTENCE_END = /[.!?。！？](?=\s)/g
const WHITESPACE = /\s/

/**
 * Offset just past the best break in `window`, or -1 when none is usable.
 * Preference order: sentence end, then line break, then word boundary.
 */
function findBreak(window: string, minChars: number): number {
  let sentence = -1
  for (const match of window.matchAll(SENTENCE_END)) {
    sentence = match.index + 1
  }
  if (sentence >= minChars) return sentence

  const newline = window.lastIndexOf('\n')
  if (newline >= minChars) return newline + 1

  for (let i = window.length - 1; i >= minChars; i--) {
    if (WHITESPACE.test(window[i])) return i + 1
  }
  return -1
}

/**
 * Split a reasoning trace into steps that always advance. Blank lines still
 * take precedence, but any paragraph longer than `maxChars` is subdivided, so a
 * model that streams one unbroken block still produces completed steps instead
 * of a single ever-growing one.
 *
 * Segmentation is greedy from the start, so a step's boundary depends only on
 * the text before it: re-segmenting a longer prefix on the next streaming tick
 * leaves already-settled steps untouched. As with splitReasoningParagraphs, the
 * last element is the step currently being written.
 */
export function segmentReasoningSteps(
  text: string,
  maxChars: number = REASONING_STEP_MAX_CHARS
): string[] {
  const minChars = Math.floor(maxChars * MIN_STEP_RATIO)
  const steps: string[] = []

  for (const paragraph of splitReasoningParagraphs(text)) {
    let rest = paragraph
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars)
      const cut = findBreak(window, minChars)
      const end = cut === -1 ? maxChars : cut
      const step = rest.slice(0, end).trim()
      if (step) steps.push(step)
      rest = rest.slice(end).trimStart()
    }
    const tail = rest.trim()
    if (tail) steps.push(tail)
  }

  return steps
}
