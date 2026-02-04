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
<<<<<<< HEAD
import { toast } from 'sonner'
import { route } from '@/constants/routes'
import { useNavigate } from '@tanstack/react-router'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
  const navigate = useNavigate()
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  const quant =
    model.quants.find((e) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((m) =>
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

  if (model.quants.length === 0) {
    return (
      <div className="flex items-center gap-2">
<<<<<<< HEAD
        <Button
          size="sm"
          onClick={() => {
            window.open(`https://huggingface.co/${model.model_name}`, '_blank')
          }}
        >
          View on HuggingFace
        </Button>
=======
        <a
          href={`https://huggingface.co/${model.model_name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm">View on HuggingFace</Button>
        </a>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
    // Preflight check for gated repos/artifacts
    const preflight = await serviceHub
      .models()
      .preflightArtifactAccess(modelUrl, huggingfaceToken)

    if (!preflight.ok) {
      const repoPage = `https://huggingface.co/${model.model_name}`

      if (preflight.reason === 'AUTH_REQUIRED') {
        toast.error('Hugging Face token required', {
          description:
            'This model requires a Hugging Face access token. Add your token in Settings and retry.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      if (preflight.reason === 'LICENSE_NOT_ACCEPTED') {
        toast.error('Accept model license on Hugging Face', {
          description:
            'You must accept the model’s license on its Hugging Face page before downloading.',
          action: {
            label: 'Open model page',
            onClick: () => window.open(repoPage, '_blank'),
          },
        })
        return
      }

      if (preflight.reason === 'RATE_LIMITED') {
        toast.error('Rate limited by Hugging Face', {
          description:
            'You have been rate-limited. Adding a token can increase rate limits. Please try again later.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      if (preflight.reason === 'NOT_FOUND') {
        toast.error('File not found', {
          description:
            'The requested artifact was not found in the repository. Try another quant or check the model page.',
          action: {
            label: 'Open model page',
            onClick: () => window.open(repoPage, '_blank'),
          },
        })
        return
      }

      toast.error('Model download error', {
        description:
          'We could not start the download. Check your network or try again later.',
      })
      return
    }

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
          <Progress value={downloadProgress * 100} />
          <span className="text-xs text-center text-main-view-fg/70">
=======
          <Progress className='border' value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      )}
      {isDownloaded ? (
        <Button
<<<<<<< HEAD
          variant="link"
          size="sm"
          className="p-0"
          onClick={() => handleUseModel(modelId)}
          data-test-id={`hub-model-${modelId}`}
        >
          <div className="rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1">
            {t('hub:newChat')}
          </div>
=======
          variant="default"
          size="sm"
          onClick={() => handleUseModel(modelId)}
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:newChat')}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        </Button>
      ) : (
        <Button
          data-test-id={`hub-model-${modelId}`}
<<<<<<< HEAD
=======
          variant="outline"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
