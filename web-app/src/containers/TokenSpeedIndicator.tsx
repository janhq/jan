import { memo } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { toNumber } from '@/utils/number'
import { Gauge } from 'lucide-react'

interface TokenSpeedIndicatorProps {
  metadata?: Record<string, unknown>
  streaming?: boolean
}

export const TokenSpeedIndicator = memo(({
  metadata,
  streaming,
}: TokenSpeedIndicatorProps) => {
  // Only re-render when the rounded token speed changes to prevent constant updates
  const roundedTokenSpeed = useAppState((state) =>
    state.tokenSpeed ? Math.round(state.tokenSpeed.tokenSpeed) : 0
  )
  const persistedTokenSpeed =
    (metadata?.tokenSpeed as { tokenSpeed: number })?.tokenSpeed || 0

  const nonStreamingAssistantParam =
    typeof metadata?.assistant === 'object' &&
    metadata?.assistant !== null &&
    'parameters' in metadata.assistant
      ? (metadata.assistant as { parameters?: { stream?: boolean } }).parameters
          ?.stream === false
      : undefined

  if (nonStreamingAssistantParam) return

  return (
    <div className="flex items-center gap-1 text-main-view-fg/60 text-xs">
      <Gauge size={16} />
      <span>
        {streaming ? roundedTokenSpeed : Math.round(toNumber(persistedTokenSpeed))}
        &nbsp;tokens/sec
      </span>
    </div>
  )
})

export default memo(TokenSpeedIndicator)
