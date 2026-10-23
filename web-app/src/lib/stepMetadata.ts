import type { LanguageModelUsage } from 'ai'

/**
 * The speed block the transcript's token-speed popover reads. It describes the
 * whole reply, across every request it took (see createStepMetadata).
 */
export type TokenSpeedMeta = {
  tokenSpeed: number
  promptSpeed?: number
  tokenCount: number
  durationMs: number
}

/** What a finished step leaves on its message, as `MessageItem` reads it. */
export type StepMetadata = {
  finishReason?: string
  /**
   * The last request's usage: how big the context now is, which the token
   * counter and the context-limit check read. Not summed across requests.
   */
  usage: {
    inputTokens?: number
    outputTokens: number
    totalTokens: number
  }
  tokenSpeed: TokenSpeedMeta
}

type StreamPart = {
  type: string
  providerMetadata?: unknown
  totalUsage?: unknown
  finishReason?: unknown
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Time spent generating `tokens` at `speed` tokens/s; 0 when not measured. */
const generationMs = (tokens: number, speed: number) =>
  speed > 0 ? (tokens / speed) * 1000 : 0

/**
 * Shared chat/subagent finish metadata. Prefer engine timings; otherwise measure
 * from the first content part to exclude prompt processing.
 *
 * A reply can take several requests: after each tool Jan runs, it sends a new
 * one that continues the same reply. `earlier` is the speed block the reply
 * had so far; this request is added to it, so the token count is the reply's
 * total and the speed its total output over its total generation time.
 */
export function createStepMetadata(earlier?: TokenSpeedMeta) {
  let startedAt: number | undefined
  let tokensPerSecond = 0
  let promptPerSecond = 0

  return {
    /** Feed the parts the AI SDK hands `messageMetadata`; returns the metadata
     * once the step finishes, and `undefined` for every other part. */
    onPart(part: StreamPart): StepMetadata | undefined {
      const startsContent =
        part.type === 'text-start' || part.type === 'reasoning-start'
      if (startedAt === undefined && startsContent) startedAt = Date.now()

      if (part.type === 'finish-step') {
        const timings = (
          part.providerMetadata as
            | { providerMetadata?: Record<string, unknown> }
            | undefined
        )?.providerMetadata
        tokensPerSecond = (timings?.tokensPerSecond as number) || 0
        promptPerSecond = (timings?.promptPerSecond as number) || 0
        return undefined
      }

      if (part.type !== 'finish') return undefined

      const usage = part.totalUsage as LanguageModelUsage | undefined
      const durationMs = startedAt ? Date.now() - startedAt : 0
      const outputTokens = usage?.outputTokens ?? 0
      const inputTokens = usage?.inputTokens

      let callSpeed = 0
      if (durationMs > 0 && outputTokens > 0) {
        callSpeed =
          tokensPerSecond > 0
            ? tokensPerSecond
            : outputTokens / (durationMs / 1000)
      }

      // Earlier tokens whose speed was never measured are counted, but their
      // generation time is not guessed.
      const earlierTokens = earlier?.tokenCount ?? 0
      const earlierSpeed = earlier?.tokenSpeed ?? 0
      const timedTokens =
        (earlierSpeed > 0 ? earlierTokens : 0) + (callSpeed > 0 ? outputTokens : 0)
      const timedMs =
        generationMs(earlierTokens, earlierSpeed) +
        generationMs(outputTokens, callSpeed)
      const tokenSpeed = timedMs > 0 ? timedTokens / (timedMs / 1000) : 0

      return {
        finishReason: part.finishReason as string | undefined,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
        },
        tokenSpeed: {
          tokenSpeed: round2(tokenSpeed),
          promptSpeed: promptPerSecond ? round2(promptPerSecond) : undefined,
          tokenCount: earlierTokens + outputTokens,
          durationMs: (earlier?.durationMs ?? 0) + durationMs,
        },
      }
    },
  }
}
