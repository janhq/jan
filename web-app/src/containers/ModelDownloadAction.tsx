import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { CatalogModel } from '@/services/models/types'
import { IconDownload } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

export const ModelDownloadAction = ({
  variant,
  model,
}: {
  variant: { model_id: string; path: string }
  model: CatalogModel
}) => {
  const serviceHub = useServiceHub()

  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
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

  const navigate = useNavigate()

  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider: 'llamacpp',
          },
        },
      })
    },
    [navigate]
  )

  const handleDownloadModel = useCallback(async () => {
    const preflight = await serviceHub
      .models()
      .preflightArtifactAccess(variant.path, huggingfaceToken)

    const repoPage = `https://huggingface.co/${model.model_name}`

    if (!preflight.ok) {
      if (preflight.reason === 'AUTH_REQUIRED') {
        toast.error('Hugging Face token required', {
          description:
            'This model requires a Hugging Face access token. Add your token in Settings and retry.',
          action: {
            label: 'Open Settings',
            onClick: () =>
              navigate({
                to: route.settings.general,
                params: {},
              }),
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
            onClick: () =>
              navigate({
                to: route.settings.general,
                params: {},
              }),
          },
        })
        return
      }

      if (preflight.reason === 'NOT_FOUND') {
        toast.error('Model file not found', {
          description:
            'The requested model could not be found. Please verify the model URL',
          action: {
            label: 'Open model page',
            onClick: () => window.open(repoPage, '_blank'),
          },
        })
        return
      }

      toast.error('Unable to start download', {
        description:
          'Jan encountered an issue. Please check your connection and try again.',
      })
      return
    }

    addLocalDownloadingModel(variant.model_id)
    serviceHub
      .models()
      .pullModelWithMetadata(
        variant.model_id,
        variant.path,
        (
          model.mmproj_models?.find(
            (e) => e.model_id.toLowerCase() === 'mmproj-f16'
          ) || model.mmproj_models?.[0]
        )?.path,
        huggingfaceToken
      )
  }, [
    serviceHub,
    variant.path,
    variant.model_id,
    huggingfaceToken,
    model.model_name,
    model.mmproj_models,
    navigate,
    addLocalDownloadingModel,
  ])

  const isDownloading =
    localDownloadingModels.has(variant.model_id) ||
    downloadProcesses.some((e) => e.id === variant.model_id)
  const downloadProgress =
    downloadProcesses.find((e) => e.id === variant.model_id)?.progress || 0
  const isDownloaded = useModelProvider
    .getState()
    .getProviderByName('llamacpp')
    ?.models.some((m: { id: string }) => m.id === variant.model_id)

  if (isDownloading) {
    return (
      <>
        <div className="flex items-center gap-2 w-20">
          <Progress value={downloadProgress * 100} />
          <span className="text-xs text-center text-main-view-fg/70">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      </>
    )
  }

  if (isDownloaded) {
    return (
      <Button
        variant="link"
        size="sm"
        className="p-0"
        onClick={() => handleUseModel(variant.model_id)}
        title={t('hub:useModel')}
      >
        <div className="rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1">
          {t('hub:newChat')}
        </div>
      </Button>
    )
  }

  return (
    <div
      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
      title={t('hub:downloadModel')}
      onClick={handleDownloadModel}
    >
      <IconDownload size={16} className="text-main-view-fg/80" />
    </div>
  )
}
