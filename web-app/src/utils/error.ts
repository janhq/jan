export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

// Context-overflow wordings by source, so cloud overflows reach the same
// context banner as local ones (the banner keeps a provider's own text):
//   llama-server: "request (N tokens) exceeds the available context size ..."
//   Anthropic:    "prompt is too long: ...",
//                 "input length and `max_tokens` exceed context limit: ..."
//   OpenAI:       "This model's maximum context length is N tokens ...",
//                 code context_length_exceeded
// Anthropic's 413 request_too_large is deliberately absent: it is a byte limit
// on the HTTP body (large images/files), not the token window, so it keeps the
// provider's own message instead of the generic context banner.
const LOCAL_CONTEXT_OVERFLOW = /exceeds the available context size/i

const CONTEXT_OVERFLOW_PATTERNS = [
  LOCAL_CONTEXT_OVERFLOW,
  /prompt is too long/i,
  /exceed context limit/i,
  /context_length_exceeded/i,
  /maximum context length/i,
]

export function isContextOverflowMessage(message: string): boolean {
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message))
}

// llama-server's own wording, which the banner localizes; anything else that
// matched isContextOverflowMessage came from a cloud provider.
export function isLocalContextOverflowMessage(message: string): boolean {
  return LOCAL_CONTEXT_OVERFLOW.test(message)
}

export interface ContextOverflowInfo {
  requestTokens: number
  contextTokens: number
}

// Pulls the two token counts out of llama-server's overflow messages so the
// banner/popup can show the request that actually overflowed (the popup's
// own usage reflects the last *successful* turn, not this failed one):
//   "request (N tokens) exceeds the available context size (M tokens)…"
//   "input (N tokens) is larger than the max context size (M tokens)…"
export function parseContextOverflow(
  message: string
): ContextOverflowInfo | null {
  const m = message.match(/\((\d+)\s+tokens?\)[^(]*?\((\d+)\s+tokens?\)/i)
  if (!m) return null
  const requestTokens = parseInt(m[1], 10)
  const contextTokens = parseInt(m[2], 10)
  if (!Number.isFinite(requestTokens) || !Number.isFinite(contextTokens))
    return null
  return { requestTokens, contextTokens }
}
