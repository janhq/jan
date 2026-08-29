import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  IconAlertTriangle,
  IconCheck,
  IconDeviceDesktopQuestion,
  IconX,
} from '@tabler/icons-react'
import { CatalogModel, ModelQuant } from '@/services/models/types'
import { selectDefaultQuant, extractQuantLabel } from '@/lib/models'
import { useHardware } from '@/hooks/useHardware'
import {
  DEFAULT_CTX_LENGTH,
  estimateModelFit,
  parseFileSize,
  sumMlxModelBytes,
  type FitTier,
} from '@/lib/modelCompatibility'
import { cn } from '@/lib/utils'

interface ModelInfoHoverCardProps {
  model: CatalogModel
  variant?: ModelQuant
  isDefaultVariant?: boolean
  defaultModelQuantizations: readonly string[]
  children?: React.ReactNode
}

type TriggerStyle = {
  icon: typeof IconCheck
  label: string
  detail: string
  pill: string
  dot: string
}

const TRIGGER_STYLES: Record<FitTier, TriggerStyle> = {
  green: {
    icon: IconCheck,
    label: 'hub:fitFits',
    detail: 'hub:fitFitsDetail',
    pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  yellow: {
    icon: IconAlertTriangle,
    label: 'hub:fitSlow',
    detail: 'hub:fitSlowDetail',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  red: {
    icon: IconX,
    label: 'hub:fitNo',
    detail: 'hub:fitNoDetail',
    pill: 'bg-red-500/10 text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
  },
  unknown: {
    icon: IconDeviceDesktopQuestion,
    label: 'hub:fitUnknown',
    detail: 'hub:fitUnknownDetail',
    pill: 'bg-secondary text-muted-foreground',
    dot: 'bg-neutral-400',
  },
}

export const ModelInfoHoverCard = ({
  model,
  variant,
  isDefaultVariant,
  defaultModelQuantizations,
  children,
}: ModelInfoHoverCardProps) => {
  const { t } = useTranslation()
  const hardwareData = useHardware((s) => s.hardwareData)

  const displayVariant = model.is_mlx
    ? undefined
    : variant ?? selectDefaultQuant(model.quants, defaultModelQuantizations)

  const fileSizeBytes = model.is_mlx
    ? sumMlxModelBytes(model) || null
    : parseFileSize(displayVariant?.file_size)
  const tier: FitTier = estimateModelFit(
    fileSizeBytes,
    DEFAULT_CTX_LENGTH,
    hardwareData
  )
  const style = TRIGGER_STYLES[tier]
  const Icon = style.icon

  const trigger = children ?? (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded font-medium cursor-pointer transition-colors',
        isDefaultVariant ? 'text-xs px-2 py-1' : 'text-[11px] px-1.5 py-0.5',
        style.pill
      )}
      aria-label={`${t('hub:deviceCompatibility')}: ${t(style.label, { defaultValue: style.label })}`}
    >
      <Icon size={isDefaultVariant ? 14 : 12} />
      {isDefaultVariant && <span>{t(style.label, { defaultValue: style.label })}</span>}
    </button>
  )

  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent className="w-80 p-4" side="left">
        <div className="space-y-4">
          <div className="border-b pb-3">
            <h4 className="text-sm font-semibold">
              {!isDefaultVariant ? variant?.model_id : model?.model_name}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {!isDefaultVariant
                ? t('hub:modelVariantInformation')
                : t('hub:modelInformation')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 text-xs">
            {!model.is_mlx && (
              <div>
                <span className="text-muted-foreground block">
                  {isDefaultVariant
                    ? t('hub:defaultQuantization')
                    : t('hub:quantization')}
                </span>
                <span className="font-medium mt-1 inline-block">
                  {extractQuantLabel(displayVariant?.model_id) || 'N/A'}
                </span>
              </div>
            )}

            <div>
              <span className="text-muted-foreground block">
                {t('hub:deviceCompatibility')}
              </span>
              <div className="flex items-start gap-2 mt-1">
                <div
                  className={cn(
                    'size-2 shrink-0 rounded-full mt-1',
                    style.dot
                  )}
                />
                <div>
                  <p className="font-medium">{t(style.label, { defaultValue: style.label })}</p>
                  <p className="text-muted-foreground mt-0.5">{t(style.detail, { defaultValue: style.detail })}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                {t('hub:fitUnknownHint')}
              </p>
            </div>
          </div>

          {((model.num_mmproj ?? 0) > 0 || model.tools) && (
            <div className="border-t pt-3">
              <h5 className="text-xs font-medium text-muted-foreground mb-2">
                {t('hub:features')}
              </h5>
              <div className="flex flex-wrap gap-2">
                {model.tools && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-sm">
                    <span className="text-xs font-medium">{t('common:tools')}</span>
                  </div>
                )}
                {(model.num_mmproj ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-sm">
                    <span className="text-xs font-medium">{t('common:vision')}</span>
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
