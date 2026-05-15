import { memo } from 'react'
import { toNumber } from '@/utils/number'
import { Gauge } from 'lucide-react'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface TokenSpeedMeta {
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
    const showTokenSpeed = useInterfaceSettings((s) => s.showTokenSpeed)
    if (!showTokenSpeed) return null

    const nonStreamingAssistantParam =
      typeof metadata?.assistant === 'object' &&
      metadata?.assistant !== null &&
      'parameters' in metadata.assistant
        ? (metadata.assistant as { parameters?: { stream?: boolean } })
            .parameters?.stream === false
        : undefined

    if (nonStreamingAssistantParam) return null
    if (streaming) return null

    const persisted = metadata?.tokenSpeed as TokenSpeedMeta | undefined
    const usage = metadata?.usage as TokenUsage | undefined
    const displaySpeed = Math.round(toNumber(persisted?.tokenSpeed ?? 0))
    const displayTokenCount = usage?.outputTokens ?? persisted?.tokenCount ?? 0

    if (displaySpeed === 0 && displayTokenCount === 0) return null

    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {displaySpeed > 0 && (
          <div className="flex items-center gap-1">
            <Gauge size={16} />
            <span>{displaySpeed} tokens/sec</span>
          </div>
        )}
        {displayTokenCount > 0 && (
          <span className="text-muted-foreground">
            ({displayTokenCount} tokens)
          </span>
        )}
      </div>
    )
  }
)

export default memo(TokenSpeedIndicator)
