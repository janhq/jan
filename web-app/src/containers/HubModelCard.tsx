import { useEffect, useMemo, useState } from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconCpu,
  IconCode,
  IconExternalLink,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import {
  extractModelName,
  getMlxTotalFileSize,
  getTotalDownloadFileSize,
} from '@/lib/models'
import {
  fetchModelStats,
  type ModelStats,
  deriveCapabilities,
  deriveContext,
  deriveParams,
  estimateFit,
  formatDownloads,
  getMemoryBudgetBytes,
  HARDWARE_FIT,
  modelFormat,
  parseFileSizeToBytes,
  quantLabel,
  type HardwareFit,
} from '@/lib/model-card'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { ModelLogo } from '@/containers/ModelLogo'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { useHardware } from '@/hooks/useHardware'
import { useShallow } from 'zustand/shallow'

type DownloadedModel = { provider: ModelProvider; modelId: string }

export type HubModelCardProps = {
  model: CatalogModel
  expanded: boolean
  isRecommended?: boolean
  onToggleVariants: () => void
  onOpenModel: () => void
  handleUseModel: (modelId: string) => void
  getDownloadedModel: (
    model: CatalogModel,
    variant?: { model_id: string }
  ) => DownloadedModel | null | undefined
}

function pickDefaultQuant(model: CatalogModel): ModelQuant | undefined {
  return (
    model.quants?.find((q) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
        q.model_id.toLowerCase().includes(e)
      )
    ) ?? model.quants?.[0]
  )
}

/**
 * Rectangular format badge — outlined-tinted, with proper light + dark variants
 * (same canon as the capability badges / FIT_BADGE_CLASS). GGUF = orange,
 * MLX = neutral slate.
 */
function FormatBadge({ format }: { format: 'gguf' | 'mlx' }) {
  const base =
    'text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-[6px] uppercase leading-tight inline-block border'
  const color =
    format === 'mlx'
      ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200'
      : 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/45 dark:text-orange-200'
  return (
    <span className={cn(base, color)}>{format === 'mlx' ? 'MLX' : 'GGUF'}</span>
  )
}

//* Тот же приём, что и у capability-пилюль / RecommendedModelChip — чтобы
//* саммари-бейдж совместимости был выразительным и в тёмной теме.
const FIT_BADGE_CLASS: Record<HardwareFit, string> = {
  ok: 'border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200',
  maybe:
    'border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-200',
  no: 'border border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/45 dark:text-red-200',
}

const FIT_ICON_CLASS: Record<HardwareFit, string> = {
  ok: 'bg-[#22b264]',
  maybe: 'bg-[#e0991f]',
  no: 'bg-[#e0564e]',
}

// Inline glyphs (not icon-font) for crisp, bold, perfectly centered strokes.
// Stroke width goes through inline `style` so the global `svg { stroke-width: 2 }`
// rule in index.css can't override it (a stylesheet rule beats the SVG attribute).
function FitGlyph({ fit }: { fit: HardwareFit }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#fff',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (fit === 'ok') {
    return (
      <svg {...common} style={{ strokeWidth: 3.5 }}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  if (fit === 'maybe') {
    return (
      <svg {...common} style={{ strokeWidth: 3 }}>
        <line x1="12" y1="5" x2="12" y2="13" />
        <line x1="12" y1="18" x2="12" y2="18" />
      </svg>
    )
  }
  return (
    <svg {...common} style={{ strokeWidth: 3.5 }}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/** Per-quant traffic-light status icon with HF-wording tooltip. */
function StatusIcon({ fit }: { fit: HardwareFit }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center justify-center size-[17px] rounded-[5px]',
            FIT_ICON_CLASS[fit]
          )}
        >
          <FitGlyph fit={fit} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{HARDWARE_FIT[fit].tip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function HubModelCard({
  model,
  expanded,
  isRecommended,
  onToggleVariants,
  onOpenModel,
  handleUseModel,
  getDownloadedModel,
}: HubModelCardProps) {
  const { t } = useTranslation()
  const { total_memory, gpus } = useHardware(
    useShallow((s) => ({
      total_memory: s.hardwareData.total_memory,
      gpus: s.hardwareData.gpus,
    }))
  )

  const budgetBytes = useMemo(
    () => getMemoryBudgetBytes({ total_memory, gpus }),
    [total_memory, gpus]
  )

  const fitKnown = budgetBytes > 0

  const format = modelFormat(model)
  const caps = useMemo(() => deriveCapabilities(model), [model])

  //* params/context: точные значения из HF model API (safetensors.total /
  //* gguf.total и gguf.context_length / config.json), с фолбэком на эвристику
  //* по имени модели. Кэшируется per-model, грузится только для видимых карточек.
  const [stats, setStats] = useState<ModelStats>({})
  useEffect(() => {
    let active = true
    fetchModelStats(model.model_name).then((s) => {
      if (active) setStats(s)
    })
    return () => {
      active = false
    }
  }, [model.model_name])
  const params = stats.params ?? deriveParams(model)
  const context = stats.context ?? deriveContext(model)

  const defaultVariant = pickDefaultQuant(model)
  const sizeText = model.is_mlx
    ? getMlxTotalFileSize(model)
    : getTotalDownloadFileSize(model, defaultVariant)
  const sizeBytes = parseFileSizeToBytes(sizeText)
  const cardFit = estimateFit(sizeBytes, budgetBytes)

  const downloadedDefault = getDownloadedModel(model, defaultVariant)
  //* model_name часто уже содержит префикс автора (напр. "mlx-community/X").
  //* Подставляем developer только если в id нет "/", иначе получим дубль
  //* "mlx-community/mlx-community/X" → 404.
  const repoId = model.model_name.includes('/')
    ? model.model_name
    : `${model.developer ? `${model.developer}/` : ''}${model.model_name}`
  const hfUrl = `https://huggingface.co/${repoId}`
  const hasVariants = (model.quants?.length ?? 0) > 1
  const name = extractModelName(model.model_name) || model.model_name || ''

  return (
    <div className="bg-card rounded-2xl border border-border px-[18px] py-4 shadow-sm">
      {/* Top: logo + name/desc + compatibility summary */}
      <div className="flex items-start justify-between gap-x-3">
        <div className="flex items-start gap-3 min-w-0">
          <ModelLogo
            author={model.developer}
            name={model.model_name}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <h1
              className={cn(
                'text-foreground font-semibold text-base truncate cursor-pointer capitalize',
                isRecommended && 'hub-model-card-step'
              )}
              title={name}
              onClick={onOpenModel}
            >
              {name}
            </h1>
            {/* By author · downloads · params · context. params/context
                подгружаются с HF после маунта и лишь дополняют строку — высота
                не меняется, поэтому виртуальный список не дёргается. */}
            <div className="flex items-center gap-3.5 flex-wrap text-[13px] text-foreground/70 mt-1 min-h-[18px]">
              {model.developer && (
                <span className="capitalize">
                  {t('hub:by')} {model.developer}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <IconDownload size={14} className="text-muted-foreground" />
                {formatDownloads(model.downloads)}
              </span>
              {params && (
                <span className="inline-flex items-center gap-1.5">
                  <IconCpu size={14} className="text-muted-foreground" />
                  {params} params
                </span>
              )}
              {context && (
                <span className="inline-flex items-center gap-1.5">
                  <IconCode size={14} className="text-muted-foreground" />
                  {context} context
                </span>
              )}
            </div>
          </div>
        </div>
        {fitKnown && (
          <div className="shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'text-xs font-semibold px-2.5 py-1 rounded-[6px] whitespace-nowrap',
                    FIT_BADGE_CLASS[cardFit]
                  )}
                >
                  {HARDWARE_FIT[cardFit].label}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{HARDWARE_FIT[cardFit].tip}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Format badge + capability tags + actions */}
      <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <FormatBadge format={format} />
          {caps.map((c) => (
            <span
              key={c.label}
              className={cn(
                'text-[11.5px] font-semibold px-2.5 py-0.5 rounded-[6px]',
                c.className
              )}
            >
              {c.label}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {hasVariants && cardFit !== 'no' && (
            <button
              className="hub-show-variants-step inline-flex items-center gap-1 text-[13px] font-semibold text-foreground whitespace-nowrap cursor-pointer"
              onClick={onToggleVariants}
            >
              {expanded ? t('hub:hideVariants') : t('hub:showVariants')}
              {expanded ? (
                <IconChevronUp size={15} className="text-muted-foreground" />
              ) : (
                <IconChevronDown size={15} className="text-muted-foreground" />
              )}
            </button>
          )}

          {cardFit === 'no' && !downloadedDefault ? (
            <a href={hfUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="link" size="sm" className="gap-1.5">
                <IconExternalLink size={14} />
                {t('hub:viewOnHuggingFace')}
              </Button>
            </a>
          ) : (
            <>
              {sizeText && (
                <span className="text-muted-foreground font-medium text-xs whitespace-nowrap">
                  {sizeText}
                </span>
              )}
              {downloadedDefault && (
                <DialogDeleteModel
                  provider={downloadedDefault.provider}
                  modelId={downloadedDefault.modelId}
                />
              )}
              {model.is_mlx ? (
                <MlxModelDownloadAction model={model} />
              ) : (
                <DownloadButtonPlaceholder
                  model={model}
                  handleUseModel={handleUseModel}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Variants (LM Studio style) */}
      {expanded && hasVariants && cardFit !== 'no' && (
        <div className="mt-3 pt-1 animate-in fade-in-0 slide-in-from-top-1 duration-300 ease-out">
          {model.quants?.map((variant, idx) => {
            const vSizeText = getTotalDownloadFileSize(model, variant)
            const vFit = estimateFit(
              parseFileSizeToBytes(vSizeText),
              budgetBytes
            )
            const vDownloaded = getDownloadedModel(model, variant)
            return (
              <div key={variant.model_id}>
                {/* Прямой разделитель отдельным элементом: border-top на самой
                    строке скругляется по её border-radius и «загибается» на
                    концах. Линия без радиуса даёт ровную черту. */}
                {idx > 0 && <div className="h-px bg-border" />}
                <div className="flex items-center justify-between gap-3 -mx-2 px-2 py-3 rounded-[10px] hover:bg-muted/40">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {fitKnown && <StatusIcon fit={vFit} />}
                    <span className="text-[13px] font-medium text-foreground truncate">
                      {name}
                    </span>
                    <span className="font-mono text-[11px] font-semibold px-[7px] py-0.5 rounded-[5px] bg-secondary text-muted-foreground shrink-0">
                      {quantLabel(variant.model_id)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {vSizeText && (
                      <span className="text-muted-foreground text-xs font-medium whitespace-nowrap">
                        {vSizeText}
                      </span>
                    )}
                    {vDownloaded && (
                      <DialogDeleteModel
                        provider={vDownloaded.provider}
                        modelId={vDownloaded.modelId}
                      />
                    )}
                    {vFit === 'no' && !vDownloaded ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled
                        className="font-semibold"
                      >
                        {t('hub:download')}
                      </Button>
                    ) : model.is_mlx ? (
                      <MlxModelDownloadAction model={model} />
                    ) : (
                      <ModelDownloadAction
                        variant={variant}
                        model={model}
                        asButton
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
