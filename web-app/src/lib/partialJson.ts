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
  for (const value of scanJsonStrings(raw, field)) return value
  return undefined
}

/**
 * Every occurrence of a string-valued field, in order.
 *
 * `edit` carries an array of `{old_string, new_string}` objects, so its
 * arguments are only readable as repeated fields -- there is no single value to
 * pull out the way a `write`'s body is.
 */
export function partialJsonStrings(raw: string, field: string): string[] {
  return [...scanJsonStrings(raw, field)]
}

function* scanJsonStrings(raw: string, field: string): Generator<string> {
  const needle = `"${field}"`
  let rest = raw
  for (;;) {
    const at = rest.indexOf(needle)
    if (at === -1) return
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
    let end = -1
    for (let i = 0; i < value.length; i++) {
      const c = value[i]
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') {
        end = i
        break
      }
    }
    if (end === -1) {
      // No closing quote: the value is still streaming, so it is all of the
      // rest -- and necessarily the last one.
      yield value
      return
    }
    yield value.slice(0, end)
    rest = value.slice(end + 1)
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
 * The arguments a tool card can be built from, read out of a buffer that is
 * still arriving.
 *
 * String fields only, plus `edit`'s array of them: a number or an id arrives
 * whole or not at all, and half a number is a lie rather than a preview. A
 * field that has not started streaming is absent, which the card renders as an
 * empty bar.
 *
 * The result is shaped like the real arguments, not like a bag of fragments, so
 * everything downstream reads a streaming call and a settled one the same way.
 */
const PREVIEW_FIELDS = [
  'path',
  'content',
  'command',
  'query',
  'url',
  'pattern',
  'name',
  'subagent_name',
  'description',
] as const

export type PartialEdit = { old_string: string; new_string?: string }

export function partialToolInput(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PREVIEW_FIELDS) {
    const value = partialJsonField(raw, field)
    if (value !== undefined) out[field] = unescapePartialJsonString(value)
  }
  const edits = partialEdits(raw)
  if (edits.length > 0) out.edits = edits
  return out
}

/**
 * `edit`'s replacement pairs, as far as they have arrived.
 *
 * The two fields are emitted in order within each array element, so the n-th
 * `old_string` belongs with the n-th `new_string`; a trailing `old_string` with
 * no partner is the pair currently streaming, which is exactly the one worth
 * watching.
 */
function partialEdits(raw: string): PartialEdit[] {
  const olds = partialJsonStrings(raw, 'old_string')
  const news = partialJsonStrings(raw, 'new_string')
  return olds.map((old, i) => {
    const pair: PartialEdit = { old_string: unescapePartialJsonString(old) }
    if (i < news.length) {
      pair.new_string = unescapePartialJsonString(news[i])
    }
    return pair
  })
}
