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
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'

type ModelProps = {
  model: CatalogModel
  handleUseModel: (modelId: string) => void
}
const defaultModelQuantizations = ['iq4_xs', 'q4_k_m']

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

  const quant =
    model.quants.find((e) =>
      defaultModelQuantizations.some((m) =>
        e.model_id.toLowerCase().includes(m)
      )
    ) ?? model.quants[0]

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

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

  if (model.quants.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            window.open(`https://huggingface.co/${model.model_name}`, '_blank')
          }}
        >
          View on HuggingFace
        </Button>
      </div>
    )
  }

  const modelUrl = quant?.path || modelId
  const isDownloading =
    localDownloadingModels.has(modelId) ||
    downloadProcesses.some((e) => e.id === modelId)

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0
  const isDownloaded = llamaProvider?.models.some(
    (m: { id: string }) =>
      m.id === modelId ||
      m.id === `${model.developer}/${sanitizeModelId(modelId)}`
  )
  const isRecommended = isRecommendedModel(model.model_name)

  const handleDownload = () => {
    // Immediately set local downloading state
    addLocalDownloadingModel(modelId)
    const mmprojPath = model.mmproj_models?.[0]?.path
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
          <Progress value={downloadProgress * 100} />
          <span className="text-xs text-center text-main-view-fg/70">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      )}
      {isDownloaded ? (
        <Button
          size="sm"
          onClick={() => handleUseModel(modelId)}
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:use')}
        </Button>
      ) : (
        <Button
          data-test-id={`hub-model-${modelId}`}
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
