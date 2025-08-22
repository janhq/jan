import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isModelSupported } from '@/services/models'
import { getJanDataFolderPath, joinPath } from '@janhq/core'

interface ModelSupportStatusProps {
  modelId: string | undefined
  provider: string | undefined
  contextSize: number
  className?: string
}

export const ModelSupportStatus = ({
  modelId,
  provider,
  contextSize,
  className,
}: ModelSupportStatusProps) => {
  const [modelSupportStatus, setModelSupportStatus] = useState<
    'RED' | 'YELLOW' | 'GREEN' | 'LOADING' | null
  >(null)

  // Helper function to check model support with proper path resolution
  const checkModelSupportWithPath = useCallback(
    async (
      id: string,
      ctxSize: number
    ): Promise<'RED' | 'YELLOW' | 'GREEN'> => {
      try {
        // Get Jan's data folder path and construct the full model file path
        // Following the llamacpp extension structure: <Jan's data folder>/llamacpp/models/<modelId>/model.gguf
        const janDataFolder = await getJanDataFolderPath()
        const modelFilePath = await joinPath([
          janDataFolder,
          'llamacpp',
          'models',
          id,
          'model.gguf',
        ])

        return await isModelSupported(modelFilePath, ctxSize)
      } catch (error) {
        console.error(
          'Error checking model support with constructed path:',
          error
        )
        // If path construction or model support check fails, assume not supported
        return 'RED'
      }
    },
    []
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
        return 'bg-main-view-fg/50'
      default:
        return 'bg-main-view-fg/50'
    }
  }

  // Helper function to get tooltip text based on model support status
  const getStatusTooltip = (): string => {
    switch (modelSupportStatus) {
      case 'GREEN':
        return `Works Well on your device (ctx: ${contextSize})`
      case 'YELLOW':
        return `Might work on your device (ctx: ${contextSize})`
      case 'RED':
        return `Doesn't work on your device  (ctx: ${contextSize})`
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
          const supportStatus = await checkModelSupportWithPath(
            modelId,
            contextSize
          )
          setModelSupportStatus(supportStatus)
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
                ? 'size-2.5 border border-main-view-fg/50 border-t-transparent animate-spin'
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
