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
// Small, whole-or-nothing string fields. `content` is handled apart from these
// because it is the one field that grows without bound.
const HEADER_FIELDS = [
  'path',
  'command',
  'query',
  'url',
  'pattern',
  'name',
  'subagent_name',
  'description',
] as const

export type PartialEdit = { old_string: string; new_string?: string }

/**
 * A `write`'s body is unbounded and streams to the end of the buffer, so
 * unescaping the whole of it on every frame is O(n) work that grows with the
 * file -- O(n^2) over the write, which is what froze the card. Only the last
 * `CONTENT_PREVIEW_BUDGET` raw chars are read; the preview windows onto the tail
 * anyway (`writeTail`), so nothing shown is lost. The trade: past the budget the
 * streaming line numbers count from the window, not the file. The settled diff,
 * which is exact, supersedes the preview the moment the call lands.
 */
const CONTENT_PREVIEW_BUDGET = 16 * 1024

const isJsonWs = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r'

/**
 * Index of the first char of a `content` value, or -1 while it has not opened.
 * Skips a `"content"` occurring inside an earlier value (it is not followed by
 * `:` and a quote), the same guard `scanJsonStrings` uses.
 */
function contentValueStart(raw: string): number {
  const needle = '"content"'
  let from = 0
  for (;;) {
    const at = raw.indexOf(needle, from)
    if (at === -1) return -1
    let j = at + needle.length
    while (j < raw.length && isJsonWs(raw[j])) j++
    if (raw[j] !== ':') {
      from = at + 1
      continue
    }
    j++
    while (j < raw.length && isJsonWs(raw[j])) j++
    if (j >= raw.length) return -1
    if (raw[j] !== '"') {
      from = at + 1
      continue
    }
    return j + 1
  }
}

/** The tail of the content value, unescaped, capped at the preview budget. */
function boundedContentTail(raw: string, valueStart: number): string {
  let start = Math.max(valueStart, raw.length - CONTENT_PREVIEW_BUDGET)
  // A cut landing after an odd run of backslashes is inside an escape; drop the
  // escaped payload char so the tail starts on a clean boundary.
  if (start > valueStart) {
    let b = start - 1
    let slashes = 0
    while (b >= valueStart && raw[b] === '\\') {
      slashes++
      b--
    }
    if (slashes % 2 === 1) start++
  }
  return unescapePartialJsonString(raw.slice(start))
}

export function partialToolInput(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const cut = contentValueStart(raw)
  if (cut >= 0) {
    // `write`: read the header fields off the small prefix, then the body off
    // its tail, so neither scan walks the whole growing buffer.
    scanHeaderFields(raw.slice(0, cut), out)
    out.content = boundedContentTail(raw, cut)
    return out
  }
  const editsAt = raw.indexOf('"edits"')
  scanHeaderFields(editsAt >= 0 ? raw.slice(0, editsAt) : raw, out)
  const edits = partialEdits(raw)
  if (edits.length > 0) out.edits = edits
  return out
}

function scanHeaderFields(header: string, out: Record<string, unknown>): void {
  for (const field of HEADER_FIELDS) {
    const value = partialJsonField(header, field)
    if (value !== undefined) out[field] = unescapePartialJsonString(value)
  }
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
