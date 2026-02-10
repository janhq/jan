import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { IconInfoCircle } from '@tabler/icons-react'
import { CatalogModel, ModelQuant } from '@/services/models/types'

interface ModelInfoHoverCardProps {
  model: CatalogModel
  variant?: ModelQuant
  isDefaultVariant?: boolean
  defaultModelQuantizations: string[]
  modelSupportStatus: Record<string, string>
  onCheckModelSupport: (variant: ModelQuant) => void
  children?: React.ReactNode
}

export const ModelInfoHoverCard = ({
  model,
  variant,
  isDefaultVariant,
  defaultModelQuantizations,
  modelSupportStatus,
  onCheckModelSupport,
  children,
}: ModelInfoHoverCardProps) => {
  const displayVariant =
    variant ||
    model.quants?.find((m: ModelQuant) =>
      defaultModelQuantizations.some((e) =>
        m.model_id.toLowerCase().includes(e)
      )
    ) ||
    model.quants?.[0]

  const handleMouseEnter = () => {
    if (displayVariant) {
      onCheckModelSupport(displayVariant)
    }
  }

  const getCompatibilityStatus = () => {
    const status = displayVariant
      ? modelSupportStatus[displayVariant.model_id]
      : null

    if (status === 'LOADING') {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 border border-t-transparent rounded-full animate-spin mt-1"></div>
          <span className="text-muted-foreground">Checking...</span>
        </div>
      )
    } else if (status === 'GREEN') {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 bg-green-500 rounded-full mt-1"></div>
          <span className="text-green-500 font-medium">
            Recommended for your device
          </span>
        </div>
      )
    } else if (status === 'YELLOW') {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 bg-yellow-500 rounded-full mt-1"></div>
          <span className="text-yellow-500 font-medium">
            May be slow on your device
          </span>
        </div>
      )
    } else if (status === 'RED') {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 bg-red-500 rounded-full mt-1"></div>
          <span className="text-red-500 font-medium">
            May be incompatible with your device
          </span>
        </div>
      )
    } else if (status === 'GREY') {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 bg-neutral-500 rounded-full mt-1"></div>
          <span className="text-neutral-500 font-medium">
            Unable to determine model compatibility with your current device
          </span>
        </div>
      )
    } else {
      return (
        <div className="flex items-start gap-2">
          <div className="size-2 shrink-0 bg-gray-400 rounded-full mt-1"></div>
          <span className="text-gray-500">Unknown</span>
        </div>
      )
    }
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild onMouseEnter={handleMouseEnter}>
        {children || (
          <div className="cursor-pointer">
            <IconInfoCircle
              size={isDefaultVariant ? 20 : 14}
              className="mt-0.5 text-muted-foreground transition-colors"
            />
          </div>
        )}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-4" side="left">
        <div className="space-y-4">
          {/* Header */}
          <div className="border-b pb-3">
            <h4 className="text-sm font-semibold">
              {!isDefaultVariant ? variant?.model_id : model?.model_name}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {!isDefaultVariant
                ? 'Model Variant Information'
                : 'Model Information'}
            </p>
          </div>

          {/* Main Info Grid */}
          <div className="grid grid-cols-1 gap-4 text-xs">
            <div className="space-y-2">
              <>
                <div>
                  <span className="text-muted-foreground block">
                    {isDefaultVariant ? 'Default Quantization' : 'Quantization'}
                  </span>
                  <span className="font-medium mt-1 inline-block">
                    {variant?.model_id.split('-').pop()?.toUpperCase() || 'N/A'}
                  </span>
                </div>
              </>
            </div>

            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground block">
                  Compatibility
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  {getCompatibilityStatus()}
                </div>
              </div>
            </div>
          </div>

          {/* Features Section */}
          {((model.num_mmproj ?? 0) > 0 || model.tools || ((model.num_mmproj ?? 0) > 0 && model.tools)) && (
            <div className="border-t  pt-3">
              <h5 className="text-xs font-medium text-muted-foreground mb-2">
                Features
              </h5>
              <div className="flex flex-wrap gap-2">
                {model.tools && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-sm">
                    <span className="text-xs font-medium">
                      Tools
                    </span>
                  </div>
                )}
                {(model.num_mmproj ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-sm">
                    <span className="text-xs font-medium">
                      Vision
                    </span>
                  </div>
                )}
                {(model.num_mmproj ?? 0) > 0 && model.tools && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-sm">
                    <span className="text-xs font-medium">
                      Proactive
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
