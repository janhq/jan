import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { markDownloadCancellationRequested } from '@/lib/downloadCancellation'
import { CatalogModel } from '@/services/models/types'
import { IconDownload, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

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
  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    addLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
  } = useDownloadStore()
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
          threadModel: {
            id: modelId,
            provider: 'llamacpp',
          },
        },
      })
    },
    [navigate]
  )

  const handleDownloadModel = useCallback(async () => {
    clearResumableDownload(variant.model_id)
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
        huggingfaceToken,
        true,
        resumableDownloads.has(variant.model_id)
      )
  }, [
    serviceHub,
    variant.path,
    variant.model_id,
    huggingfaceToken,
    model.mmproj_models,
    addLocalDownloadingModel,
    clearResumableDownload,
    resumableDownloads,
  ])

  const handleCancelDownload = useCallback(() => {
    markResumableDownload(variant.model_id)
    markDownloadCancellationRequested(variant.model_id)
    void serviceHub.models().abortDownload(variant.model_id)
  }, [markResumableDownload, serviceHub, variant.model_id])

  const isDownloading =
    localDownloadingModels.has(variant.model_id) ||
    downloadProcesses.some((e) => e.id === variant.model_id)
  const downloadProgress =
    downloadProcesses.find((e) => e.id === variant.model_id)?.progress || 0
  const isDownloaded = useModelProvider((state) =>
    state.providers
      .find((p) => p.provider === 'llamacpp')
      ?.models.some((m: { id: string }) => m.id === variant.model_id)
  )

  if (isDownloading) {
    return (
      <div className="flex items-center gap-1 w-24">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Progress className="border flex-1" value={downloadProgress * 100} />
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
    )
  }

  if (isDownloaded) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() => handleUseModel(variant.model_id)}
        title={t('hub:useModel')}
      >
        {t('hub:newChat')}
      </Button>
    )
  }

  return (
    <div
      className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out"
      title={t('hub:downloadModel')}
      onClick={handleDownloadModel}
    >
      <IconDownload size={16} className="text-muted-foreground" />
    </div>
  )
}
