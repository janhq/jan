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
    // Get real-time token speed from global state during streaming
    const streamingTokenSpeed = useAppState((state) =>
      state.tokenSpeed ? Math.round(state.tokenSpeed.tokenSpeed) : 0
    )
    const streamingTokenCount = useAppState((state) =>
      state.tokenSpeed?.tokenCount || 0
    )

    // Fallback to persisted metadata when not streaming
    const persistedTokenSpeed =
      (metadata?.tokenSpeed as TokenSpeed)?.tokenSpeed || 0
    const persistedTokenCount =
      (metadata?.tokenSpeed as TokenSpeed)?.tokenCount || 0
    const usage = metadata?.usage as TokenUsage | undefined

    const nonStreamingAssistantParam =
      typeof metadata?.assistant === 'object' &&
      metadata?.assistant !== null &&
      'parameters' in metadata.assistant
        ? (metadata.assistant as { parameters?: { stream?: boolean } })
            .parameters?.stream === false
        : undefined

    if (nonStreamingAssistantParam) return

    // Use streaming data if available, otherwise fall back to metadata
    const displaySpeed = streaming
      ? streamingTokenSpeed
      : Math.round(toNumber(persistedTokenSpeed))

    const displayTokenCount = streaming
      ? streamingTokenCount
      : (usage?.outputTokens ?? persistedTokenCount)

    // Hide the indicator if token speed is 0 and not streaming
    if (!streaming && displaySpeed === 0) return

    // Show indicator during streaming OR when we have persisted data
    const shouldShow = streaming || (displaySpeed > 0 && displayTokenCount > 0)

    if (!shouldShow) return

    return (
      <div className="flex items-center gap-2 text-main-view-fg/60 text-xs">
        <div className="flex items-center gap-1">
          <Gauge size={16} />
          <span>{displaySpeed} tokens/sec</span>
        </div>
        {displayTokenCount > 0 && (
          <span className="text-main-view-fg/40">
            ({displayTokenCount} tokens)
          </span>
        )}
      </div>
    )
  }
)

export default memo(TokenSpeedIndicator)
