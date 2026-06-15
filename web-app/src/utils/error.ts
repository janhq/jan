export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

export const MODEL_ACCESS_DENIED_TITLE = 'Model not available for your API key'
export const MODEL_ACCESS_DENIED_MESSAGE =
  "This model needs to be enabled in your provider's key settings. Add it to the allowed models list and try again."

export const CONTEXT_OVERFLOW_TITLE = 'Context window full'
export const CONTEXT_OVERFLOW_MESSAGE =
  'This message — including search results and tool output — is longer than the model can process at once. Increase the context size, or reduce the amount of attached / retrieved content (e.g. fewer web-search results) and try again.'

/**
 * Detects errors raised when a request exceeds the model's context window.
 *
 * Mirrors the Rust `is_context_limit_error` matcher in
 * `src-tauri/src/core/server/proxy.rs` so the UI classifies the same engine
 * error bodies the proxy does. llama-server and mlx-server are both
 * OpenAI-compatible but phrase overflow differently: mlx-vlm rejects an
 * over-budget request with `... but MAX_KV_SIZE is N` (ATO-170), llama.cpp
 * references "context" + a size/length/limit keyword. Keep patterns lower-case.
 */
export function isContextLimitError(error: unknown): boolean {
  if (!error) return false
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''
  if (!raw) return false
  const b = raw.toLowerCase()
  if (b.includes(OUT_OF_CONTEXT_SIZE)) return true
  if (
    b.includes('max_kv_size') ||
    b.includes('max-kv-size') ||
    b.includes('max kv size')
  ) {
    return true
  }
  if (
    b.includes('kv cache') &&
    (b.includes('exceed') || b.includes('overflow') || b.includes('too'))
  ) {
    return true
  }
  if (!b.includes('context')) return false
  return (
    b.includes('size') ||
    b.includes('length') ||
    b.includes('limit') ||
    b.includes('exceed') ||
    b.includes('overflow') ||
    b.includes('too long') ||
    b.includes('too large')
  )
}

/**
 * Detects provider errors that occur when the API key is valid but does not
 * have permission to call the selected model. This happens most often with
 * OpenAI (newly released / gated models, project-scoped keys with an allow
 * list), but also with Anthropic, Gemini and xAI when a project / tier is
 * missing the right entitlement.
 *
 * We match against common wording instead of a specific error code because
 * different SDKs wrap the upstream response differently and the same class of
 * failure can surface with different shapes. Keep patterns lower-case and
 * narrow enough to avoid false positives for unrelated "not found" errors.
 */
export function isModelAccessError(error: unknown): boolean {
  if (!error) return false
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''
  if (!raw) return false
  const msg = raw.toLowerCase()

  // OpenAI: "The model `gpt-X` does not exist or you do not have access to it."
  if (
    msg.includes('does not exist or you do not have access') ||
    msg.includes('do not have access to') ||
    msg.includes("don't have access to") ||
    msg.includes('model_not_found') ||
    msg.includes("model doesn't exist") ||
    msg.includes('model does not exist')
  ) {
    return true
  }

  // Anthropic / Gemini / xAI flavours that imply a permission / entitlement
  // problem scoped to a model rather than a global auth failure.
  if (
    (msg.includes('permission') &&
      (msg.includes('model') || msg.includes('access'))) ||
    (msg.includes('not authorized') && msg.includes('model')) ||
    (msg.includes('not allowed') && msg.includes('model')) ||
    (msg.includes('unsupported') && msg.includes('model')) ||
    msg.includes('model is not available') ||
    msg.includes('model not available')
  ) {
    return true
  }

  return false
}
