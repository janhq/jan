import { memo } from 'react'
import { toNumber } from '@/utils/number'
import { Gauge } from 'lucide-react'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface TokenSpeedMeta {
  tokenSpeed: number
  promptSpeed?: number
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
    const rawSpeed = toNumber(persisted?.tokenSpeed ?? 0)
    const displaySpeed = Math.round(rawSpeed)
    const displayTokenCount = usage?.outputTokens ?? persisted?.tokenCount ?? 0
    const promptSpeed = persisted?.promptSpeed

    if (displaySpeed === 0 && displayTokenCount === 0) return null

    if (showTokenSpeed) {
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

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Token speed details"
            className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
          >
            <Gauge size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3 text-xs">
          <div className="flex flex-col gap-1">
            {rawSpeed > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Generation</span>
                <span className="font-mono">{rawSpeed.toFixed(2)} tps</span>
              </div>
            )}
            {promptSpeed && promptSpeed > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Reading</span>
                <span className="font-mono">{promptSpeed.toFixed(2)} tps</span>
              </div>
            )}
            {displayTokenCount > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Tokens</span>
                <span className="font-mono">{displayTokenCount}</span>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    )
  }
)

export default memo(TokenSpeedIndicator)
