import { Button } from '@/components/ui/button'
import { useJanModelPromptDismissed } from '@/hooks/useJanModelPrompt'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useMemo } from 'react'
import { SETUP_SCREEN_QUANTIZATIONS } from '@/constants/models'
import { useLatestJanModel } from '@/hooks/useLatestJanModel'

export function PromptJanModel() {

  const { setDismissedModelName } = useJanModelPromptDismissed()
  const serviceHub = useServiceHub()
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const { model: janNewModel, loading: isLoading } = useLatestJanModel()

  const defaultVariant = useMemo(() => {
    if (!janNewModel) return null

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return janNewModel.quants?.[0]
  }, [janNewModel])

  const isDownloading = useMemo(() => {
    if (!defaultVariant) return false
    return (
      localDownloadingModels.has(defaultVariant.model_id) ||
      Object.values(downloads).some((d) => d.id === defaultVariant.model_id)
    )
  }, [defaultVariant, localDownloadingModels, downloads])

  const handleDismiss = () => {
    if (janNewModel) setDismissedModelName(janNewModel.model_name)
  }

  const handleDownload = () => {
    if (!defaultVariant || !janNewModel) return

    addLocalDownloadingModel(defaultVariant.model_id)
    serviceHub.models().pullModelWithMetadata(
      defaultVariant.model_id,
      defaultVariant.path,
      (
        janNewModel.mmproj_models?.find(
          (e) => e.model_id.toLowerCase() === 'mmproj-f16'
        ) || janNewModel.mmproj_models?.[0]
      )?.path,
      huggingfaceToken,
      true
    )
    if (janNewModel) setDismissedModelName(janNewModel.model_name)
  }

  if (isLoading || !janNewModel) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="flex items-center gap-2">
        <img src="/images/jan-logo.png" alt="Jan" className="size-5" />
        <h2 className="font-medium">
          {janNewModel?.display_name ?? janNewModel?.model_name ?? 'Jan Model'}
          {defaultVariant && (
          <span className="text-muted-foreground">
            {' '}
            ({defaultVariant.file_size})
          </span>
        )}
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Get started with {janNewModel?.display_name ?? 'Jan'}, our recommended local AI model optimized for your device.
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={handleDismiss}
        >
          Later
        </Button>
        <Button
          onClick={handleDownload}
          disabled={!defaultVariant || isDownloading}
          size="sm"
        >
          {isDownloading ? 'Downloading' : 'Download'}
        </Button>
      </div>
    </div>
  )
}
