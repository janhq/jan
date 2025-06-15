import { IconBrandSpeedtest } from '@tabler/icons-react'

interface TokenSpeedIndicatorProps {
  metadata?: Record<string, unknown>
}

export const TokenSpeedIndicator = ({
  metadata
}: TokenSpeedIndicatorProps) => {
  const persistedTokenSpeed = (metadata?.tokenSpeed as { tokenSpeed: number })?.tokenSpeed

  return (
    <div className="flex items-center gap-1 text-main-view-fg/60 text-xs">
      <IconBrandSpeedtest size={16} />
      <span>
        {Math.round(persistedTokenSpeed)} tokens/sec
      </span>
    </div>
  )
}

export default TokenSpeedIndicator
