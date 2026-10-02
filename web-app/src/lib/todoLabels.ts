// Models often prefix a task label with their own status marker ("✅ Ship it",
// "[x] Ship it", "- Ship it"). The todo panel already renders status as an
// icon, so showing the marker too gives every task two competing indicators.
//
// The marker set is single code points each allowed one trailing variation
// selector (`✔` + U+FE0F is one grapheme but two code points, so listing the
// composed form inside a character class would match its halves separately).
const LEADING_MARKER = /^\s*(?:[✅✓✔☑❌✗☐🔲🔳⬜◻]️?|\[[ xX~-]?\]|[-*•])\s+/u

/**
 * Drop a single leading status marker from a model-written task label. Anything
 * else — including a marker used mid-sentence — is left exactly as written, and
 * a label made up of nothing but a marker is kept rather than blanked out.
 */
export function cleanTaskLabel(content: string): string {
  return content.replace(LEADING_MARKER, '').trim() || content.trim()
}
