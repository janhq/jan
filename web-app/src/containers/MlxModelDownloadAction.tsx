import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { CatalogModel } from '@/services/models/types'
import { cn } from '@/lib/utils'
import { DownloadEvent, events } from '@janhq/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'

export const MlxModelDownloadAction = ({ model }: { model: CatalogModel }) => {
  const serviceHub = useServiceHub()
  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const navigate = useNavigate()

  const [isDownloaded, setDownloaded] = useState(false)

  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
  } = useDownloadStore((state) => ({
    downloads: state.downloads,
    localDownloadingModels: state.localDownloadingModels,
    addLocalDownloadingModel: state.addLocalDownloadingModel,
    removeLocalDownloadingModel: state.removeLocalDownloadingModel,
  }))

  // Construct the model ID - use just the sanitized model name if developer is same as org
  // e.g., "mlx-community/Qwen3-VL-2B-Thinking-4bit" -> "Qwen3-VL-2B-Thinking-4bit"
  const modelName = model.model_name.split('/').pop() ?? model.model_name
  const modelId = sanitizeModelId(modelName)

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

  const isDownloading =
    localDownloadingModels.has(modelId) ||
    downloadProcesses.some((e) => e.id === modelId)

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0

  // Check if MLX model is already downloaded
  useEffect(() => {
    const mlxProvider = useModelProvider.getState().getProviderByName('mlx')
    const downloaded = mlxProvider?.models.some(
      (m: { id: string }) => m.id === modelId
    )
    setDownloaded(!!downloaded)
  }, [modelId])

  // Listen for download success
  useEffect(() => {
    const onDownloadSuccess = (state: { modelId: string }) => {
      if (state.modelId === modelId) {
        setDownloaded(true)
      }
    }
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      onDownloadSuccess
    )
    return () => {
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        onDownloadSuccess
      )
    }
  }, [modelId])

  const handleUseModel = useCallback(() => {
    navigate({
      to: route.home,
      params: {},
      search: {
        model: {
          id: modelId,
          provider: 'mlx',
        },
      },
    })
  }, [navigate, modelId])

  const handleDownloadMlxModel = useCallback(async () => {
    addLocalDownloadingModel(modelId)

    try {
      // Fetch repository info to get all files
      const repoInfo = await serviceHub
        .models()
        .fetchHuggingFaceRepo(model.model_name, huggingfaceToken)

      if (!repoInfo || !repoInfo.siblings) {
        throw new Error('Failed to fetch repository files')
      }

      // Filter relevant model files for MLX
      const modelFiles = repoInfo.siblings.filter((file) => {
        const name = file.rfilename.toLowerCase()
        // Include files starting with model. or known config files
        if (name.startsWith('model.')) return true
        if (name === 'config.json') return true
        if (name === 'tokenizer.json') return true
        if (name === 'tokenizer_config.json') return true
        if (name === 'special_tokens_map.json') return true
        if (name === 'README.md') return true
        if (name === 'chat_template.jinja') return true
        if (name === 'preprocessor_config.json') return true
        if (name === 'image_processor_config.json') return true
        if (name === 'generation_config.json') return true
        if (name === 'model.py') return true
        return false
      })

      if (modelFiles.length === 0) {
        throw new Error('No MLX model files found in repository')
      }

      // Get the MLX engine and import
      const engine = (await import('@janhq/core')).EngineManager.instance().get(
        'mlx'
      )
      if (!engine) {
        throw new Error('MLX engine not found')
      }

      // For MLX, we download the first safetensors file as the main model
      // and the extension will download all related files
      const mainSafetensorsFile = modelFiles.find((f) =>
        f.rfilename.toLowerCase().endsWith('.safetensors')
      )

      if (!mainSafetensorsFile) {
        throw new Error('No safetensors file found in repository')
      }

      const modelUrl = `https://huggingface.co/${model.model_name}/resolve/main/${mainSafetensorsFile.rfilename}`

      // Prepare additional files to download (all model files except main safetensors)
      // Don't pass sha256/size to skip verification for MLX models
      const extraFiles = modelFiles
        .filter((f) => f.rfilename !== mainSafetensorsFile.rfilename)
        .map((file) => ({
          url: `https://huggingface.co/${model.model_name}/resolve/main/${file.rfilename}`,
          filename: file.rfilename,
        }))

      await engine.import(modelId, {
        modelPath: modelUrl,
        files: extraFiles,
      })

      toast.success('MLX model downloaded successfully', {
        description: `${modelId} has been downloaded and is ready to use`,
      })
    } catch (error) {
      console.error('Error downloading MLX model:', error)
      removeLocalDownloadingModel(modelId)
      toast.error('Failed to download MLX model', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [serviceHub, model, huggingfaceToken, addLocalDownloadingModel, modelId])

  return (
    <div className="flex items-center">
      {isDownloading && !isDownloaded && (
        <div className="flex items-center gap-2 w-20">
          <Progress className="border" value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      )}
      {isDownloaded ? (
        <Button
          variant="default"
          size="sm"
          onClick={handleUseModel}
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:newChat')}
        </Button>
      ) : (
        <Button
          data-test-id={`hub-model-${modelId}`}
          variant="outline"
          size="sm"
          onClick={handleDownloadMlxModel}
          className={cn(isDownloading && 'hidden')}
        >
          {t('hub:download')}
        </Button>
      )}
    </div>
  )
}

// Helper function to sanitize model ID
function sanitizeModelId(id: string): string {
  return id.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_./]/g, '')
}
