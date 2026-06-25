export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

// Matches OUT_OF_CONTEXT_SIZE and llama-server's verbose variant
// ("request (N tokens) exceeds the available context size (M tokens)…").
export function isContextOverflowMessage(message: string): boolean {
  return /exceeds the available context size/i.test(message)
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
