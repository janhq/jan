import type { UIMessage } from 'ai'
import { uiMessageHasMeaningfulContent } from '@/lib/messages'
import { isContextOverflowMessage } from '@/utils/error'
import { readCtxLen } from '@/lib/llamacppRouterProps'

// Used when a local model has neither a ctx_len value nor a known launched n_ctx.
const DEFAULT_CTX_LEN = 32768

/**
 * Only local engines read the per-model `ctx_len` setting; for cloud providers
 * the context window is fixed server-side, so neither the context-limit
 * heuristic nor the "Increase Context Size" action means anything there.
 */
export function providerHasContextSetting(provider: string | undefined): boolean {
  return provider === 'llamacpp' || provider === 'mlx'
}

/**
 * Whether a `finishReason === 'length'` stop means the local context window
 * filled up (offer a bigger context) rather than the output-token cap being
 * hit (keep the partial and offer Continue). Cloud providers always report
 * the latter: their `ctx_len` is absent, so the fallback would misfire.
 */
export function isContextLimitStop({
  provider,
  usage,
  ctxLen,
  launchedCtxLen,
}: {
  provider: string | undefined
  usage: { inputTokens?: number; outputTokens?: number } | undefined
  ctxLen: unknown
  /** n_ctx the model actually launched with; decides when ctx_len auto-fits. */
  launchedCtxLen?: number
}): boolean {
  if (!providerHasContextSetting(provider)) return false
  const limit =
    readCtxLen(ctxLen) ?? readCtxLen(launchedCtxLen) ?? DEFAULT_CTX_LEN
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  return totalTokens >= limit * 0.9
}

/**
 * A completed assistant turn that produced nothing to show. Aborted and
 * errored turns are excluded (the user stopped it, or the error banner already
 * explains it), as are tool-call turns whose content arrives in a later step.
 */
export function isEmptyReply({
  message,
  isAbort,
  isError,
  finishReason,
}: {
  message: UIMessage
  isAbort: boolean
  isError: boolean
  finishReason: string | undefined
}): boolean {
  if (isAbort || isError || message.role !== 'assistant') return false
  if (finishReason === 'tool-calls') return false
  return !uiMessageHasMeaningfulContent(message)
}

/**
 * Show "Increase Context Size" only where raising ctx_len can help. The
 * keyword fallback keeps llama-server wordings the strict matcher misses
 * ("input (N tokens) is larger than the max context size").
 */
export function offersContextIncrease(
  provider: string | undefined,
  errorMessage: string | undefined
): boolean {
  if (!providerHasContextSetting(provider) || !errorMessage) return false
  const lower = errorMessage.toLowerCase()
  return (
    isContextOverflowMessage(errorMessage) ||
    (lower.includes('context') && /size|length|limit/.test(lower))
  )
}
