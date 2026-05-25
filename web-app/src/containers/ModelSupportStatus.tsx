import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useHardware } from '@/hooks/useHardware'
import {
  DEFAULT_CTX_LENGTH,
  estimateModelFit,
  type FitTier,
} from '@/lib/modelCompatibility'

interface ModelSupportStatusProps {
  modelId: string | undefined
  provider: string | undefined
  contextSize: number
  className?: string
}

const TIER_STYLES: Record<FitTier, { dot: string; label: string }> = {
  green: { dot: 'bg-green-500', label: 'Should run comfortably on your device' },
  yellow: {
    dot: 'bg-yellow-500',
    label: 'Will run but leaves little memory headroom',
  },
  red: { dot: 'bg-red-500', label: 'Likely exceeds your available memory' },
  unknown: { dot: 'bg-secondary', label: 'Fit unknown' },
}

export const ModelSupportStatus = ({
  modelId,
  provider,
  contextSize,
  className,
}: ModelSupportStatusProps) => {
  const serviceHub = useServiceHub()
  const hardwareData = useHardware((s) => s.hardwareData)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)

  useEffect(() => {
    if (!modelId || provider !== 'llamacpp') {
      setSizeBytes(null)
      return
    }
    let cancelled = false
    serviceHub
      .models()
      .fetchModels()
      .then((infos) => {
        if (cancelled) return
        const match = infos.find(
          (i) => i.id === modelId && i.providerId === provider
        )
        setSizeBytes(match?.sizeBytes ?? null)
      })
      .catch(() => {
        if (!cancelled) setSizeBytes(null)
      })
    return () => {
      cancelled = true
    }
  }, [modelId, provider, serviceHub])

  if (!modelId || provider !== 'llamacpp') return null

  const tier = estimateModelFit(
    sizeBytes,
    contextSize || DEFAULT_CTX_LENGTH,
    hardwareData
  )
  if (tier === 'unknown') return null

  const style = TIER_STYLES[tier]
  const tooltip = `${style.label} (estimated)`

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'size-2 flex items-center justify-center rounded-full',
              style.dot,
              className
            )}
            aria-label={`Device compatibility: ${tier}`}
          />
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
