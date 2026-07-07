const HEX = /[0-9a-fA-F]/

/**
 * Re-escapes backslashes inside JSON string literals as literal path
 * separators. Intended for tool-call arguments that FAILED to parse: smaller
 * local models emit Windows paths like `C:\Users\name\file.txt` verbatim, where
 * `\U`, `\n`, `\f`, ... are treated as (invalid or unintended) JSON escapes and
 * the path is corrupted or dropped. Every backslash is doubled except a genuine
 * `\uXXXX` unicode escape, which is preserved. Do not run this on already-valid
 * JSON (see `repairToolArgs`, which parses first).
 */
export function sanitizeInvalidJsonEscapes(raw: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '\\') {
      const isUnicode =
        raw[i + 1] === 'u' &&
        HEX.test(raw[i + 2] ?? '') &&
        HEX.test(raw[i + 3] ?? '') &&
        HEX.test(raw[i + 4] ?? '') &&
        HEX.test(raw[i + 5] ?? '')
      if (isUnicode) {
        out += raw.slice(i, i + 6)
        i += 5
      } else {
        out += '\\\\'
      }
      continue
    }
    if (ch === '"') inString = false
    out += ch
  }
  return out
}

/**
 * Parses tool-call argument JSON, repairing malformed backslash escapes (the
 * common Windows-path failure) only when a plain parse fails. Returns the parsed
 * object, or null if it still cannot be parsed as an object.
 */
export function repairToolArgs(raw: string): Record<string, unknown> | null {
  for (const candidate of [raw, sanitizeInvalidJsonEscapes(raw)]) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // try next candidate
    }
  }
  return null
}
