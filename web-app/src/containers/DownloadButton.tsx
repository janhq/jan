import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { markDownloadCancellationRequested } from '@/lib/downloadCancellation'
import { extractModelName } from '@/lib/models'
import { cn, sanitizeModelId } from '@/lib/utils'
import { CatalogModel } from '@/services/models/types'
import { IconX } from '@tabler/icons-react'
import { DownloadEvent, DownloadState, events } from '@janhq/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/shallow'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'

type ModelProps = {
  model: CatalogModel
  handleUseModel: (modelId: string) => void
}

export function DownloadButtonPlaceholder({
  model,
  handleUseModel,
}: ModelProps) {
  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    downloadOriginByModelId,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
    setDownloadOrigin,
    clearDownloadOrigin,
  } = useDownloadStore(
    useShallow((state) => ({
      downloads: state.downloads,
      localDownloadingModels: state.localDownloadingModels,
      resumableDownloads: state.resumableDownloads,
      downloadOriginByModelId: state.downloadOriginByModelId,
      addLocalDownloadingModel: state.addLocalDownloadingModel,
      removeLocalDownloadingModel: state.removeLocalDownloadingModel,
      markResumableDownload: state.markResumableDownload,
      clearResumableDownload: state.clearResumableDownload,
      setDownloadOrigin: state.setDownloadOrigin,
      clearDownloadOrigin: state.clearDownloadOrigin,
    }))
  )
  const { t } = useTranslation()
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const llamaProvider = getProviderByName('llamacpp')

  const serviceHub = useServiceHub()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const [isDownloaded, setDownloaded] = useState<boolean>(false)

  const quant =
    model.quants?.find((e) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((m) =>
        e.model_id.toLowerCase().includes(m)
      )
    ) ?? model.quants?.[0]

  const modelId = quant?.model_id || model.model_name

  // Get the actual downloaded model ID (with or without developer prefix)
  const downloadedModelId = useMemo(() => {
    const foundModel = llamaProvider?.models.find(
      (m: { id: string }) =>
        m.id === modelId ||
        m.id === `${model.developer}/${sanitizeModelId(modelId)}`
    )
    return foundModel?.id || modelId
  }, [llamaProvider, modelId, model.developer])

  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  useEffect(() => {
    const isDownloaded = llamaProvider?.models.some(
      (m: { id: string }) =>
        m.id === modelId ||
        m.id === `${model.developer}/${sanitizeModelId(modelId)}`
    )
    setDownloaded(!!isDownloaded)
  }, [llamaProvider, modelId, model.developer])

  useEffect(() => {
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      (state: DownloadState) => {
        if (state.modelId === modelId) setDownloaded(true)
      }
    )
  }, [modelId])

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

  const modelUrl = quant?.path || modelId
  // Defensive guard against catalog-level `quant.model_id` collisions
  // across different repos (e.g. `unsloth/Qwen3.5-4B-GGUF` and
  // `unsloth/Qwen3.5-4B-MTP-GGUF` both ship a file called
  // `Qwen3.5-4B-Q4_K_M.gguf`). The scraper now disambiguates colliding
  // ids at catalog build time; this check keeps clients running on an
  // older cached catalog from showing the progress bar on a card that
  // did not initiate the download. When no origin is recorded (legacy
  // sessions, post-reload, etc.) we fall through to the legacy behaviour.
  const downloadOrigin = downloadOriginByModelId[modelId]
  const isOriginConflict =
    downloadOrigin !== undefined && downloadOrigin !== model.model_name
  const isDownloading =
    !isOriginConflict &&
    (localDownloadingModels.has(modelId) ||
      downloadProcesses.some((e) => e.id === modelId))

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0

  const isRecommended = isRecommendedModel(model.model_name)
  const shouldResume = resumableDownloads.has(modelId)

  const handleDownload = async () => {
    if (!quant) {
      return
    }

    // Immediately set local downloading state and start download
    clearResumableDownload(modelId)
    addLocalDownloadingModel(modelId)
    setDownloadOrigin(modelId, model.model_name)
    const mmprojPath = (
      model.mmproj_models?.find(
        (e) => e.model_id.toLowerCase() === 'mmproj-f16'
      ) || model.mmproj_models?.[0]
    )?.path
    try {
      await serviceHub
        .models()
        .pullModelWithMetadata(
          modelId,
          modelUrl,
          mmprojPath,
          huggingfaceToken,
          true,
          shouldResume
        )
    } catch (error) {
      // If pull rejects before any DownloadEvent fires, the global listener in
      // DownloadManegement.tsx never clears localDownloadingModels and the
      // button is stuck. Clear it ourselves.
      console.error('[DownloadButton] pullModelWithMetadata failed:', error)
      removeLocalDownloadingModel(modelId)
      clearDownloadOrigin(modelId)
      markResumableDownload(modelId)
      toast.error(t('hub:downloadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleCancelDownload = useCallback(() => {
    markDownloadCancellationRequested(modelId)
    markResumableDownload(modelId)
    void serviceHub.models().abortDownload(modelId)
  }, [modelId, markResumableDownload, serviceHub])

  if ((model.quants?.length ?? 0) === 0) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={`https://huggingface.co/${model.developer ? `${model.developer}/` : ''}${model.model_name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm">View on HuggingFace</Button>
        </a>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center',
        isRecommended && 'hub-download-button-step'
      )}
    >
      {isDownloading && !isDownloaded && (
        <div className={cn('flex items-center gap-1 w-24')}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Progress
              className="border flex-1"
              value={downloadProgress * 100}
            />
            <span className="text-xs text-center text-muted-foreground">
              {Math.round(downloadProgress * 100)}%
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleCancelDownload}
            title={t('common:cancelDownload')}
            aria-label={t('common:cancelDownload')}
            className="shrink-0"
          >
            <IconX size={12} className="text-muted-foreground" />
          </Button>
        </div>
      )}
      {isDownloaded ? (
        <Button
          variant="default"
          size="sm"
          onClick={() => handleUseModel(downloadedModelId)}
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:newChat')}
        </Button>
      ) : (
        <Button
          data-test-id={`hub-model-${modelId}`}
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className={cn(isDownloading && 'hidden')}
        >
          {t('hub:download')}
        </Button>
      )}
    </div>
  )
}
