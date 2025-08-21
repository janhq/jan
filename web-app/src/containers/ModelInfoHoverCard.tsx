import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { IconInfoCircle } from '@tabler/icons-react'
import { CatalogModel, ModelQuant } from '@/services/models'
import { extractDescription } from '@/lib/models'

interface ModelInfoHoverCardProps {
  model: CatalogModel
  variant?: ModelQuant
  defaultModelQuantizations: string[]
  modelSupportStatus: Record<string, string>
  onCheckModelSupport: (variant: ModelQuant) => void
  children?: React.ReactNode
}

export const ModelInfoHoverCard = ({
  model,
  variant,
  defaultModelQuantizations,
  modelSupportStatus,
  onCheckModelSupport,
  children,
}: ModelInfoHoverCardProps) => {
  const isVariantMode = !!variant
  const displayVariant =
    variant ||
    model.quants.find((m) =>
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
          <div className="size-2 shrink-0 border border-main-view-fg/50 border-t-transparent rounded-full animate-spin mt-1"></div>
          <span className="text-main-view-fg/50">Checking...</span>
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
              size={14}
              className="mt-0.5 text-main-view-fg/50 hover:text-main-view-fg/80 transition-colors"
            />
          </div>
        )}
      </HoverCardTrigger>
      <HoverCardContent className="w-96 p-4" side="left">
        <div className="space-y-4">
          {/* Header */}
          <div className="border-b border-main-view-fg/10 pb-3">
            <h4 className="text-sm font-semibold text-main-view-fg">
              {isVariantMode ? variant.model_id : model.model_name}
            </h4>
            <p className="text-xs text-main-view-fg/60 mt-1">
              {isVariantMode
                ? 'Model Variant Information'
                : 'Model Information'}
            </p>
          </div>

          {/* Main Info Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-2">
              {isVariantMode ? (
                <>
                  <div>
                    <span className="text-main-view-fg/50 block">
                      File Size
                    </span>
                    <span className="text-main-view-fg font-medium mt-1 inline-block">
                      {variant.file_size}
                    </span>
                  </div>
                  <div>
                    <span className="text-main-view-fg/50 block">
                      Quantization
                    </span>
                    <span className="text-main-view-fg font-medium mt-1 inline-block">
                      {variant.model_id.split('-').pop()?.toUpperCase() ||
                        'N/A'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-main-view-fg/50 block">
                      Downloads
                    </span>
                    <span className="text-main-view-fg font-medium mt-1 inline-block">
                      {model.downloads?.toLocaleString() || '0'}
                    </span>
                  </div>
                  <div>
                    <span className="text-main-view-fg/50 block">Variants</span>
                    <span className="text-main-view-fg font-medium mt-1 inline-block">
                      {model.quants?.length || 0}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              {!isVariantMode && (
                <div>
                  <span className="text-main-view-fg/50 block">
                    Default Size
                  </span>
                  <span className="text-main-view-fg font-medium mt-1 inline-block">
                    {displayVariant?.file_size || 'N/A'}
                  </span>
                </div>
              )}
              <div>
                <span className="text-main-view-fg/50 block">
                  Compatibility
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  {getCompatibilityStatus()}
                </div>
              </div>
            </div>
          </div>

          {/* Features Section */}
          {(model.num_mmproj > 0 || model.tools) && (
            <div className="border-t border-main-view-fg/10 pt-3">
              <h5 className="text-xs font-medium text-main-view-fg/70 mb-2">
                Features
              </h5>
              <div className="flex flex-wrap gap-2">
                {model.num_mmproj > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-main-view-fg/10 rounded-md">
                    <span className="text-xs text-main-view-fg font-medium">
                      Vision
                    </span>
                  </div>
                )}
                {model.tools && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-main-view-fg/10 rounded-md">
                    <span className="text-xs text-main-view-fg font-medium">
                      Tools
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Content Section */}
          <div className="border-t border-main-view-fg/10 pt-3">
            <h5 className="text-xs font-medium text-main-view-fg/70 mb-1">
              {isVariantMode ? 'Download URL' : 'Description'}
            </h5>
            <div className="text-xs text-main-view-fg/60 bg-main-view-fg/5 rounded p-2">
              {isVariantMode ? (
                <div className="font-mono break-all">{variant.path}</div>
              ) : (
                extractDescription(model?.description) ||
                'No description available'
              )}
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
