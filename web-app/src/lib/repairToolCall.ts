import { jsonrepair } from 'jsonrepair'

/**
 * Attempt to repair the stringified-JSON arguments of a tool call.
 *
 * Coder models (e.g. Qwen3-Coder) frequently emit invalid JSON for file-writing
 * tools like `write_file`: the `content` field carries source code with
 * unescaped newlines/quotes/backslashes, and long files get truncated
 * mid-string ("Unterminated string"). The AI SDK then throws
 * `InvalidToolInputError` and the whole turn fails instead of degrading
 * gracefully.
 *
 * `jsonrepair` fixes the common structural problems — unterminated strings
 * (it closes them), unescaped control characters, missing closing brackets,
 * trailing commas — turning the broken payload into parseable JSON. The result
 * may be truncated (when the model itself ran out of tokens), but a partial
 * file is far better than a hard crash.
 *
 * @returns the repaired JSON string if it parses, otherwise `null` (caller
 *   should keep the original error).
 */
export function repairToolCallArguments(rawInput: string): string | null {
  if (typeof rawInput !== 'string' || rawInput.trim().length === 0) {
    return null
  }

  // Already valid — nothing to repair (the error was likely schema-related,
  // which a JSON fixer can't help with).
  try {
    JSON.parse(rawInput)
    return null
  } catch {
    // fall through to repair
  }

  try {
    const repaired = jsonrepair(rawInput)
    // Tool-call arguments are always a JSON object. jsonrepair will happily
    // coerce arbitrary garbage into a quoted string ("foo"), which is valid
    // JSON but useless here — reject anything that isn't a plain object so we
    // don't feed a bogus scalar back into schema validation.
    const parsed = JSON.parse(repaired)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return repaired
  } catch {
    return null
  }
}
