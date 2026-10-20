const ELLIPSIS = '...'

/**
 * Tool arguments reach the UI either as an object (the SDK parses streamed
 * argument deltas for us) or as a raw JSON string from providers that pass it
 * through. Normalize both, leaving unparseable text as-is.
 */
export function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  )
}

/** Pretty JSON for the raw view and for copying. */
export function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2) ?? ''
  } catch {
    return String(input)
  }
}

const collapseWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim()

function previewValue(value: unknown): string {
  if (typeof value === 'string') return collapseWhitespace(value)
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return '{...}'
  return ''
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, Math.max(0, maxLength - ELLIPSIS.length)) + ELLIPSIS
}

/**
 * One-line preview of a tool call's arguments for the collapsed header, so a
 * call reads as "read_file  path: src/app.ts" rather than just "read_file".
 * Nested values collapse to a shape hint; the expanded card shows them in full.
 */
export function summarizeToolInput(input: unknown, maxLength = 72): string {
  const parsed = parseToolInput(input)

  if (parsed === undefined || parsed === null) return ''
  if (typeof parsed === 'string') return truncate(collapseWhitespace(parsed), maxLength)
  if (!isPlainObject(parsed)) return truncate(previewValue(parsed), maxLength)

  const pairs: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue
    const preview = previewValue(value)
    if (preview === '') continue
    pairs.push(`${key}: ${preview}`)
  }

  return truncate(pairs.join(', '), maxLength)
}
