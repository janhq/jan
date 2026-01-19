import { memo } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { toNumber } from '@/utils/number'
import { Gauge } from 'lucide-react'

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface TokenSpeed {
  tokenSpeed: number
  tokenCount?: number
  durationMs?: number
}

interface TokenSpeedIndicatorProps {
  metadata?: Record<string, unknown>
  streaming?: boolean
}

export const TokenSpeedIndicator = memo(
  ({ metadata, streaming }: TokenSpeedIndicatorProps) => {
    // Only re-render when the rounded token speed changes to prevent constant updates
    const roundedTokenSpeed = useAppState((state) =>
      state.tokenSpeed ? Math.round(state.tokenSpeed.tokenSpeed) : 0
    )

    const persistedTokenSpeed =
      (metadata?.tokenSpeed as TokenSpeed)?.tokenSpeed || 0
    const usage = metadata?.usage as TokenUsage | undefined

    const nonStreamingAssistantParam =
      typeof metadata?.assistant === 'object' &&
      metadata?.assistant !== null &&
      'parameters' in metadata.assistant
        ? (metadata.assistant as { parameters?: { stream?: boolean } })
            .parameters?.stream === false
        : undefined

    if (nonStreamingAssistantParam) return

    const displaySpeed = streaming
      ? roundedTokenSpeed
      : Math.round(toNumber(persistedTokenSpeed))

    // Hide the indicator if token speed is 0 and not streaming
    if (!streaming && displaySpeed === 0) return

    return (
      <div className="flex items-center gap-2 text-main-view-fg/60 text-xs">
        {!streaming &&
          usage &&
          usage.outputTokens != null &&
          usage.outputTokens > 0 && (
            <>
              <div className="flex items-center gap-1">
                <Gauge size={16} />
                <span>{displaySpeed} tokens/sec</span>
              </div>
              <span className="text-main-view-fg/40">
                ({usage.outputTokens} tokens)
              </span>
            </>
          )}
      </div>
    )
  }
)

export default memo(TokenSpeedIndicator)
