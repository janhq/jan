import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { extractModelName } from '@/lib/models'
import { cn, sanitizeModelId } from '@/lib/utils'
import { CatalogModel } from '@/services/models/types'
import { DownloadEvent, DownloadState, events } from '@janhq/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore(
      useShallow((state) => ({
        downloads: state.downloads,
        localDownloadingModels: state.localDownloadingModels,
        addLocalDownloadingModel: state.addLocalDownloadingModel,
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

  if ((model.quants?.length ?? 0) === 0) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={`https://huggingface.co/${model.model_name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm">View on HuggingFace</Button>
        </a>
      </div>
    )
  }

  const modelUrl = quant?.path || modelId
  const isDownloading =
    localDownloadingModels.has(modelId) ||
    downloadProcesses.some((e) => e.id === modelId)

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0

  const isRecommended = isRecommendedModel(model.model_name)

  const handleDownload = async () => {
    // Immediately set local downloading state and start download
    addLocalDownloadingModel(modelId)
    const mmprojPath = (
      model.mmproj_models?.find(
        (e) => e.model_id.toLowerCase() === 'mmproj-f16'
      ) || model.mmproj_models?.[0]
    )?.path
    serviceHub
      .models()
      .pullModelWithMetadata(modelId, modelUrl, mmprojPath, huggingfaceToken)
  }

  return (
    <div
      className={cn(
        'flex items-center',
        isRecommended && 'hub-download-button-step'
      )}
    >
      {isDownloading && !isDownloaded && (
        <div className={cn('flex items-center gap-2 w-20')}>
          <Progress className='border' value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      )}
      {isDownloaded ? (
        <Button
          variant="default"
          size="sm"
          onClick={() => handleUseModel(modelId)}
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
