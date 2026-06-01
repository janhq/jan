import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconCpu,
  IconCode,
  IconCheck,
  IconExclamationMark,
  IconX,
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
  cardDescription,
  fetchReadmeDescription,
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
  //* Доп. бейдж рядом с названием (например, категория рекомендации
  //* «Everyday use» / «For MLX»). Для блока All Models не передаётся.
  chip?: ReactNode
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

/** Rectangular format badge: GGUF = soft orange, MLX = metallic. */
function FormatBadge({ format }: { format: 'gguf' | 'mlx' }) {
  const base =
    'text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-[6px] uppercase leading-tight inline-block'
  if (format === 'mlx') {
    return (
      <span
        className={cn(base, 'border')}
        style={{
          color: '#3a3e45',
          background:
            'linear-gradient(135deg,#eef0f3 0%,#ced3da 45%,#b0b6bf 70%,#cfd3da 100%)',
          borderColor: '#bcc1c9',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,.8), 0 1px 2px rgba(0,0,0,.10)',
          textShadow: '0 1px 0 rgba(255,255,255,.5)',
        }}
      >
        MLX
      </span>
    )
  }
  return (
    <span
      className={cn(base, 'border')}
      style={{ color: '#c2620a', background: '#ffe9d2', borderColor: '#fbd6ad' }}
    >
      GGUF
    </span>
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
  ok: 'bg-emerald-500',
  maybe: 'bg-amber-500',
  no: 'bg-red-400',
}

/** Per-quant traffic-light status icon with HF-wording tooltip. */
function StatusIcon({ fit }: { fit: HardwareFit }) {
  const Glyph =
    fit === 'ok' ? IconCheck : fit === 'maybe' ? IconExclamationMark : IconX
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center justify-center size-[17px] rounded-[5px] text-white',
            FIT_ICON_CLASS[fit]
          )}
        >
          <Glyph size={12} stroke={3} />
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
  chip,
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

  //* Описание: берём человеческий первый абзац. Если в каталоге лежит только
  //* ссылка на README (или ничего полезного), подтягиваем README с HF и
  //* вытаскиваем первый абзац (с кэшем). Иначе используем то, что уже есть.
  const existingDescription = useMemo(() => cardDescription(model), [model])
  const [fetchedDescription, setFetchedDescription] = useState('')
  useEffect(() => {
    if (existingDescription) return
    let active = true
    fetchReadmeDescription(model.model_name).then((text) => {
      if (active) setFetchedDescription(text)
    })
    return () => {
      active = false
    }
  }, [existingDescription, model.model_name])
  const description = existingDescription || fetchedDescription

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
            <div className="flex items-center gap-2">
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
              <FormatBadge format={format} />
              {chip}
            </div>
            {/* Резервируем высоту в одну строку: описание (README) и
                params/context подгружаются с HF уже после маунта карточки.
                Без фиксированной высоты карточка «подрастает» при загрузке,
                из-за чего виртуальный список переразмеряет десятки строк во
                время скролла — это и есть «дёрганый» скролл. min-h держит
                высоту строки стабильной независимо от того, есть текст или нет. */}
            <p className="text-[13px] text-muted-foreground mt-1 line-clamp-1 min-h-[18px]">
              {description}
            </p>
          </div>
        </div>
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
      </div>

      {/* Capabilities */}
      {caps.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
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
      )}

      {/* Meta + actions */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-3.5 flex-wrap text-[13px] text-foreground/70">
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
        <div className="mt-3 pt-1">
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
                    <StatusIcon fit={vFit} />
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
