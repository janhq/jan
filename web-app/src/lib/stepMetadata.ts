import type { LanguageModelUsage } from 'ai'

/** The speed block the transcript's token-speed popover reads. */
export type TokenSpeedMeta = {
  tokenSpeed: number
  promptSpeed?: number
  tokenCount: number
  durationMs: number
}

/** What a finished step leaves on its message, as `MessageItem` reads it. */
export type StepMetadata = {
  finishReason?: string
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

/**
 * Shared chat/subagent finish metadata. Prefer engine timings; otherwise measure
 * from the first content part to exclude prompt processing.
 */
export function createStepMetadata() {
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

      let tokenSpeed = 0
      if (durationMs > 0 && outputTokens > 0) {
        tokenSpeed =
          tokensPerSecond > 0
            ? tokensPerSecond
            : outputTokens / (durationMs / 1000)
      }

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
          tokenCount: outputTokens,
          durationMs,
        },
      }
    },
  }
}
