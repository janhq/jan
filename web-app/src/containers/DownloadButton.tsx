import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import {
  extractModelName,
  extractQuantLabel,
  selectDefaultQuant,
} from '@/lib/models'
import { toast } from 'sonner'
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
  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
    setResumeParams,
  } = useDownloadStore(
    useShallow((state) => ({
      downloads: state.downloads,
      localDownloadingModels: state.localDownloadingModels,
      addLocalDownloadingModel: state.addLocalDownloadingModel,
      removeLocalDownloadingModel: state.removeLocalDownloadingModel,
      setResumeParams: state.setResumeParams,
    }))
  )
  const { t } = useTranslation()
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const llamaProvider = getProviderByName('llamacpp')

  const serviceHub = useServiceHub()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const [isDownloaded, setDownloaded] = useState<boolean>(false)

  const quant = selectDefaultQuant(model.quants, DEFAULT_MODEL_QUANTIZATIONS)

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
    const handler = (state: DownloadState) => {
      if (state.modelId === modelId) setDownloaded(true)
    }
    events.on(DownloadEvent.onFileDownloadAndVerificationSuccess, handler)
    return () => {
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, handler)
    }
  }, [modelId])

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

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

  const modelUrl = quant?.path || modelId
  const isDownloading =
    localDownloadingModels.has(modelId) ||
    downloadProcesses.some((e) => e.id === modelId)

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0

  const isRecommended = isRecommendedModel(model.model_name)

  const handleDownload = async () => {
    addLocalDownloadingModel(modelId)
    const mmprojPath = (
      model.mmproj_models?.find(
        (e) => e.model_id.toLowerCase() === 'mmproj-f16'
      ) || model.mmproj_models?.[0]
    )?.path
    setResumeParams(modelId, {
      modelPath: modelUrl,
      mmprojPath,
      hfToken: huggingfaceToken,
    })
    try {
      await serviceHub
        .models()
        .pullModelWithMetadata(modelId, modelUrl, mmprojPath, huggingfaceToken)
    } catch (err) {
      removeLocalDownloadingModel(modelId)
      console.error('Failed to start download:', err)
      toast.error(
        t('hub:downloadFailed', { defaultValue: 'Failed to start download' }),
        { description: err instanceof Error ? err.message : String(err) }
      )
    }
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
          {(() => {
            const label = extractQuantLabel(quant?.model_id)
            return label
              ? `${t('hub:download')} · ${label}`
              : t('hub:download')
          })()}
        </Button>
      )}
    </div>
  )
}
