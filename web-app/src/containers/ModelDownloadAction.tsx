import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { sanitizeModelId } from '@/lib/utils'
import { CatalogModel } from '@/services/models/types'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { IconDownload } from '@tabler/icons-react'
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
    model.mmproj_models,
    addLocalDownloadingModel,
  ])

  const isDownloading =
    localDownloadingModels.has(variant.model_id) ||
    downloadProcesses.some((e) => e.id === variant.model_id)
  const downloadProgress =
    downloadProcesses.find((e) => e.id === variant.model_id)?.progress || 0
  const llamaProvider = useModelProvider((state) =>
    state.getProviderByName('llamacpp')
  )
  const downloadedModel = llamaProvider?.models.find(
    (m: { id: string }) =>
      m.id === variant.model_id ||
      m.id === `${model.developer}/${sanitizeModelId(variant.model_id)}`
  )
  const isDownloaded = !!downloadedModel

  if (isDownloading) {
    return (
      <>
        <div className="flex items-center gap-2 w-20">
          <Progress className="border" value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      </>
    )
  }

  if (isDownloaded && llamaProvider && downloadedModel) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => handleUseModel(downloadedModel.id)}
          title={t('hub:useModel')}
        >
          {t('hub:newChat')}
        </Button>
        <DialogDeleteModel
          provider={llamaProvider}
          modelId={downloadedModel.id}
        />
      </div>
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
