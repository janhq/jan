import { useAppState } from '@/hooks/useAppState'
import { Gauge } from 'lucide-react'

interface TokenSpeedIndicatorProps {
  metadata?: Record<string, unknown>
  streaming?: boolean
}

export const TokenSpeedIndicator = ({
  metadata,
  streaming,
}: TokenSpeedIndicatorProps) => {
  const { tokenSpeed } = useAppState()
  const persistedTokenSpeed = (metadata?.tokenSpeed as { tokenSpeed: number })
    ?.tokenSpeed

  return (
    <div className="flex items-center gap-1 text-main-view-fg/60 text-xs">
      <Gauge size={16} />

      <span>
        {Math.round(
          streaming ? Number(tokenSpeed?.tokenSpeed) : persistedTokenSpeed
        )}
        &nbsp;tokens/sec
      </span>
    </div>
  )
}

export default TokenSpeedIndicator
