/**
 * Reading a JSON object that is still streaming, and is therefore almost
 * certainly truncated mid-value.
 *
 * Port of the TUI's `partial_json_field` / `unescape_partial_json_string`
 * (`core::cli::tui`), which exist for the same reason: a real parser cannot help
 * with a prefix like `{"path":"a.html","content":"<!doctype html>\n<html` --
 * there is no closing quote and no closing brace. Both surfaces show a `write`
 * as it arrives, so both need to read the body out of a fragment.
 */

/**
 * One *string-valued* field of a streaming JSON object, still escaped.
 *
 * Scans for `"<field>"` followed by `:` and an opening quote, then walks the
 * value honouring backslash escapes, stopping at the closing quote or at the
 * end of the input -- whichever comes first.
 */
export function partialJsonField(
  raw: string,
  field: string
): string | undefined {
  const needle = `"${field}"`
  let rest = raw
  for (;;) {
    const at = rest.indexOf(needle)
    if (at === -1) return undefined
    const after = rest.slice(at + needle.length)
    const afterColon = after.trimStart()
    // The name can also appear inside an earlier string value; if what follows
    // is not `: "`, keep looking.
    if (!afterColon.startsWith(':')) {
      rest = after
      continue
    }
    const opened = afterColon.slice(1).trimStart()
    if (!opened.startsWith('"')) {
      rest = after
      continue
    }
    const value = opened.slice(1)
    let escaped = false
    for (let i = 0; i < value.length; i++) {
      const c = value[i]
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') return value.slice(0, i)
    }
    // No closing quote: the value is still streaming, so take all of it.
    return value
  }
}

/**
 * Turn a raw JSON string body into display text, tolerating a truncated tail.
 *
 * The stream can cut anywhere, including the middle of an escape sequence, so a
 * dangling `\` and a partial `\uXXXX` are dropped before parsing. Falls back to
 * the raw text if it still will not parse: a preview is never worth failing a
 * render over.
 */
export function unescapePartialJsonString(raw: string): string {
  let s = raw
  // Partial `\uXXXX`: 0-3 hex digits have arrived so far.
  const at = s.lastIndexOf('\\u')
  if (at !== -1) {
    const tail = s.slice(at + 2)
    if (tail.length < 4 && /^[0-9a-fA-F]*$/.test(tail)) s = s.slice(0, at)
  }
  // Dangling escape: an odd number of trailing backslashes means the last one
  // is opening an escape whose payload has not arrived.
  const slashes = /\\*$/.exec(s)?.[0].length ?? 0
  if (slashes % 2 === 1) s = s.slice(0, -1)
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

/**
 * The string arguments a tool card can be built from, read out of a buffer that
 * is still arriving.
 *
 * Only string fields: a number or an id arrives whole or not at all, and half a
 * number is a lie rather than a preview. A field that has not started streaming
 * is absent, which the card renders as an empty bar.
 */
const PREVIEW_FIELDS = [
  'path',
  'content',
  'command',
  'query',
  'url',
  'pattern',
  'name',
] as const

export function partialToolInput(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of PREVIEW_FIELDS) {
    const value = partialJsonField(raw, field)
    if (value !== undefined) out[field] = unescapePartialJsonString(value)
  }
  return out
}
