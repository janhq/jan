/**
 * Helpers for mapping a DOM text selection back to the assistant markdown source
 * and building a focused edit prompt (Gemini Canvas–style paragraph editing).
 */

export type SourceSpan = { start: number; end: number }

function indicesOf(haystack: string, needle: string): number[] {
  if (needle.length === 0) return []
  const out: number[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) break
    out.push(i)
    from = i + 1
  }
  return out
}

/**
 * Map selected visible text to a unique substring range in `source`.
 * Returns null if the passage cannot be located or matches more than once.
 */
export function findSelectedSpan(
  source: string,
  selected: string
): SourceSpan | null {
  const t = selected.trim()
  if (!t) return null

  let idxs = indicesOf(source, t)
  if (idxs.length === 1) {
    const start = idxs[0]
    return { start, end: start + t.length }
  }
  if (idxs.length > 1) return null

  const minLen = 12
  for (let len = Math.min(t.length, 2000); len >= minLen; len--) {
    const prefix = t.slice(0, len)
    idxs = indicesOf(source, prefix)
    if (idxs.length !== 1) continue
    const start = idxs[0]
    if (
      start + t.length <= source.length &&
      source.slice(start, start + t.length) === t
    ) {
      return { start, end: start + t.length }
    }
  }

  return null
}

export function applySpanReplacement(
  source: string,
  span: SourceSpan,
  replacement: string
): string {
  return source.slice(0, span.start) + replacement + source.slice(span.end)
}

const CONTEXT_CHARS = 1200

export function buildParagraphEditPrompts(params: {
  fullSource: string
  span: SourceSpan
  userInstruction: string
}): { system: string; user: string } {
  const { fullSource, span, userInstruction } = params
  const selected = fullSource.slice(span.start, span.end)
  const before = fullSource.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start)
  const after = fullSource.slice(
    span.end,
    Math.min(fullSource.length, span.end + CONTEXT_CHARS)
  )

  const system = `You revise a short passage from a markdown message. Reply with ONLY the revised passage text: no surrounding quotes, no markdown code fences, and no preamble or explanation (do not start with "Here is" or similar). Preserve markdown inline/block syntax that belongs to that passage when appropriate.`

  const user = `The full message is markdown. Use the context only for tone and consistency; do not repeat it.

--- Context before (reference only) ---
${before}
--- End context before ---

--- Passage to revise ---
${selected}
--- End passage ---

--- Context after (reference only) ---
${after}
--- End context after ---

Instruction: ${userInstruction.trim()}`

  return { system, user }
}

/** If the model wrapped the answer in a single fenced block, unwrap it. */
export function unwrapModelPassage(text: string): string {
  let s = text.trim()
  if (!s.startsWith('```')) return s
  const firstBreak = s.indexOf('\n')
  if (firstBreak === -1) return s
  s = s.slice(firstBreak + 1)
  const close = s.lastIndexOf('```')
  if (close !== -1) s = s.slice(0, close)
  return s.trimEnd()
}
