import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getJanDataFolderPath, joinPath, fs } from '@janhq/core'
import { useServiceHub } from '@/hooks/useServiceHub'

interface ModelSupportStatusProps {
  modelId: string | undefined
  provider: string | undefined
  contextSize: number
  className?: string
}

type CheckResult = {
  status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | null
  effectiveCtx: number
}

const readTrainContext = async (
  modelPath: string
): Promise<number | undefined> => {
  try {
    const result = await invoke<{ metadata?: Record<string, string> }>(
      'plugin:llamacpp|read_gguf_metadata',
      { path: modelPath }
    )
    const meta = result?.metadata
    const arch = meta?.['general.architecture']
    if (!arch) return undefined
    const raw = meta?.[`${arch}.context_length`]
    const parsed = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  } catch (e) {
    console.error('Error reading GGUF context length:', e)
    return undefined
  }
}

export const ModelSupportStatus = ({
  modelId,
  provider,
  contextSize,
  className,
}: ModelSupportStatusProps) => {
  const [modelSupportStatus, setModelSupportStatus] = useState<
    'RED' | 'YELLOW' | 'GREEN' | 'LOADING' | null | 'GREY'
  >(null)
  const [effectiveCtx, setEffectiveCtx] = useState<number>(contextSize)
  const serviceHub = useServiceHub()

  // Helper function to check model support with proper path resolution
  const checkModelSupportWithPath = useCallback(
    async (id: string, ctxSize: number): Promise<CheckResult> => {
      try {
        const janDataFolder = await getJanDataFolderPath()

        // First try the standard downloaded model path
        const ggufModelPath = await joinPath([
          janDataFolder,
          'llamacpp',
          'models',
          id,
          'model.gguf',
        ])

        let actualModelPath: string | null = null
        if (await fs.existsSync(ggufModelPath)) {
          actualModelPath = ggufModelPath
        } else {
          // If model.gguf doesn't exist, try reading from model.yml (for imported models)
          const modelConfigPath = await joinPath([
            janDataFolder,
            'llamacpp',
            'models',
            id,
            'model.yml',
          ])

          if (!(await fs.existsSync(modelConfigPath))) {
            console.error(
              `Neither model.gguf nor model.yml found for model: ${id}`
            )
            return { status: null, effectiveCtx: ctxSize }
          }

          const modelConfig = await serviceHub
            .app()
            .readYaml<{ model_path: string }>(
              `llamacpp/models/${id}/model.yml`
            )

          actualModelPath =
            modelConfig.model_path.startsWith('/') ||
            modelConfig.model_path.match(/^[A-Za-z]:/)
              ? modelConfig.model_path
              : await joinPath([janDataFolder, modelConfig.model_path])
        }

        const trainCtx = await readTrainContext(actualModelPath)
        const ctxForCheck = trainCtx
          ? Math.min(ctxSize, trainCtx)
          : ctxSize
        const status = await serviceHub
          .models()
          .isModelSupported(actualModelPath, ctxForCheck)
        return { status, effectiveCtx: trainCtx ?? ctxSize }
      } catch (error) {
        console.error(
          'Error checking model support with path resolution:',
          error
        )
        return { status: null, effectiveCtx: ctxSize }
      }
    },
    [serviceHub]
  )

  // Helper function to get icon color based on model support status
  const getStatusColor = (): string => {
    switch (modelSupportStatus) {
      case 'GREEN':
        return 'bg-green-500'
      case 'YELLOW':
        return 'bg-yellow-500'
      case 'RED':
        return 'bg-red-500'
      case 'LOADING':
        return 'bg-secondary'
      default:
        return 'bg-secondary'
    }
  }

  // Helper function to get tooltip text based on model support status
  const getStatusTooltip = (): string => {
    switch (modelSupportStatus) {
      case 'GREEN':
        return `Works Well on your device (ctx: ${effectiveCtx})`
      case 'YELLOW':
        return `Might work on your device (ctx: ${effectiveCtx})`
      case 'RED':
        return `Doesn't work on your device  (ctx: ${effectiveCtx})`
      case 'LOADING':
        return 'Checking device compatibility...'
      default:
        return 'Unknown'
    }
  }

  // Check model support when model changes
  useEffect(() => {
    const checkModelSupport = async () => {
      if (modelId && provider === 'llamacpp') {
        // Set loading state immediately
        setModelSupportStatus('LOADING')
        try {
          const { status, effectiveCtx: ctx } = await checkModelSupportWithPath(
            modelId,
            contextSize
          )
          setEffectiveCtx(ctx)
          setModelSupportStatus(status)
        } catch (error) {
          console.error('Error checking model support:', error)
          setModelSupportStatus('RED')
        }
      } else {
        // Only show status for llamacpp models since isModelSupported is specific to llamacpp
        setModelSupportStatus(null)
      }
    }

    checkModelSupport()
  }, [modelId, provider, contextSize, checkModelSupportWithPath])

  // Don't render anything if no status or not llamacpp
  if (!modelSupportStatus || provider !== 'llamacpp') {
    return null
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'size-2 flex items-center justify-center rounded-full',
              modelSupportStatus === 'LOADING'
                ? 'size-2.5 border border-t-transparent animate-spin'
                : getStatusColor(),
              className
            )}
          />
        </TooltipTrigger>
        <TooltipContent>
          <p>{getStatusTooltip()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
