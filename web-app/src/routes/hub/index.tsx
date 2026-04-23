/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { IconSettings } from '@tabler/icons-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { OllamaInstanceDetailDialog } from '@/components/hub/OllamaInstanceDetailDialog'
import {
  OllamaInstanceList,
  type OllamaInstanceItem,
} from '@/components/hub/OllamaInstanceList'
import { OllamaLifecycleDialog } from '@/components/hub/OllamaLifecycleDialog'
import { OllamaRunPanel } from '@/components/hub/OllamaRunPanel'
import { OllamaServiceStatusBar } from '@/components/hub/OllamaServiceStatusBar'
import { Button } from '@/components/ui/button'
import HeaderPage from '@/containers/HeaderPage'
import { route } from '@/constants/routes'
import { useOllamaLifecycleController } from '@/hooks/useOllamaLifecycleController'
import { useOllamaStatus } from '@/hooks/useOllamaStatus'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, toGigabytes } from '@/lib/utils'

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
})

interface OllamaPsModel {
  name: string
  model: string
  size: number
  size_vram: number
  digest: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
  expires_at: string
}

function timeLeftLabel(expiresAt?: string): string {
  if (!expiresAt) return ''

  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return '即将卸载'

  const minutes = Math.ceil(diff / 60000)
  if (minutes < 60) return `${minutes} 分钟后卸载`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours} 小时 ${remainingMinutes} 分钟后卸载`
}

function processorLabel(ps: OllamaPsModel): string {
  if (!ps.size_vram || ps.size_vram === 0) return 'CPU'
  if (ps.size_vram >= ps.size) return 'GPU'
  return 'Mixed'
}

function buildParameterSummary(ps: OllamaPsModel): string {
  const parts = [processorLabel(ps)]

  if (ps.details?.parameter_size) {
    parts.push(ps.details.parameter_size)
  }

  if (ps.details?.quantization_level) {
    parts.push(ps.details.quantization_level)
  }

  if (ps.size_vram > 0) {
    parts.push(`${toGigabytes(ps.size_vram)} VRAM`)
  }

  const timeLeft = timeLeftLabel(ps.expires_at)
  if (timeLeft) {
    parts.push(timeLeft)
  }

  return parts.join(' · ')
}

export function HubContent() {
  const { t } = useTranslation()
  const {
    isRunning: ollamaRunning,
    isInstalled: ollamaInstalled,
    version: ollamaVersion,
    models: ollamaModels,
    installPath: ollamaInstallPath,
    refresh: refreshOllamaStatus,
    isInstalling,
    installMessage,
    installOllama,
  } = useOllamaStatus(10000)

  const [runningModels, setRunningModels] = useState<OllamaPsModel[]>([])
  const [psLoading, setPsLoading] = useState(false)
  const [isSubmittingRun, setIsSubmittingRun] = useState(false)
  const [lifecycleDialogOpen, setLifecycleDialogOpen] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  )
  const fetchSequenceRef = useRef(0)

  const fetchRunningModels = useCallback(async () => {
    const sequence = ++fetchSequenceRef.current

    if (!ollamaRunning) {
      if (sequence === fetchSequenceRef.current) {
        setRunningModels([])
        setPsLoading(false)
      }
      return
    }

    setPsLoading(true)
    try {
      const result = await invoke<OllamaPsModel[]>('ollama_ps')
      if (sequence !== fetchSequenceRef.current) return
      setRunningModels(result)
    } catch (error) {
      if (sequence !== fetchSequenceRef.current) return
      console.error('Failed to fetch running models:', error)
      setRunningModels([])
    } finally {
      if (sequence !== fetchSequenceRef.current) return
      setPsLoading(false)
    }
  }, [ollamaRunning])

  useEffect(() => {
    fetchRunningModels()
    const timer = setInterval(fetchRunningModels, 15000)
    return () => clearInterval(timer)
  }, [fetchRunningModels])

  const lifecycle = useOllamaLifecycleController({
    isInstalled: ollamaInstalled,
    isRunning: ollamaRunning,
    refresh: async () => {
      await refreshOllamaStatus()
      await fetchRunningModels()
    },
  })

  const handleRunModel = useCallback(
    async (request: Record<string, unknown>) => {
      setIsSubmittingRun(true)
      try {
        await invoke('ollama_run_model', { request })
        toast.success('启动请求已发送')
        await fetchRunningModels()
      } catch (error) {
        toast.error(String(error))
      } finally {
        setIsSubmittingRun(false)
      }
    },
    [fetchRunningModels]
  )

  const handleUnload = useCallback(
    async (item: OllamaInstanceItem) => {
      try {
        await invoke('ollama_unload_model', { model: item.unloadKey })
        toast.success(`模型 ${item.modelName} 已卸载`)
        await fetchRunningModels()
      } catch (error) {
        toast.error(`卸载失败: ${String(error)}`)
      }
    },
    [fetchRunningModels]
  )

  const handleRefreshService = useCallback(async () => {
    await refreshOllamaStatus()
    await fetchRunningModels()
  }, [fetchRunningModels, refreshOllamaStatus])

  const handleViewInstanceDetails = useCallback((item: OllamaInstanceItem) => {
    setSelectedInstanceId(item.id)
  }, [])

  const handleDetailDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setSelectedInstanceId(null)
    }
  }, [])

  const totalVram = runningModels.reduce(
    (sum, model) => sum + (model.size_vram || 0),
    0
  )
  const servicePortLabel = '11434'

  const instanceItems: OllamaInstanceItem[] = runningModels.map((model) => ({
    id: `${model.name}:${model.digest}`,
    status: 'running',
    modelName: model.name,
    port: servicePortLabel,
    parameterSummary: buildParameterSummary(model),
    unloadKey: model.name,
  }))

  const selectedInstance =
    instanceItems.find((item) => item.id === selectedInstanceId) ?? null

  useEffect(() => {
    if (selectedInstanceId && !selectedInstance) {
      setSelectedInstanceId(null)
    }
  }, [selectedInstance, selectedInstanceId])

  return (
    <div className="flex h-svh w-full flex-col">
      <div className="flex h-full w-full flex-col">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3 h-10 w-full flex items-center justify-between',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="text-sm font-medium text-foreground">
              {t('common:inferenceCenter')}
            </span>
            <Link to={route.settings.index} className="relative z-20">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <IconSettings size={16} className="text-muted-foreground" />
              </Button>
            </Link>
          </div>
        </HeaderPage>

        <div className="h-[calc(100%-60px)] w-full overflow-y-auto p-4">
          <div className="mx-auto flex w-full flex-col gap-5 md:w-4/5 xl:w-4/6">
            <OllamaServiceStatusBar
              isInstalled={ollamaInstalled}
              isRunning={ollamaRunning}
              isInstalling={isInstalling}
              phase={lifecycle.phase}
              switchChecked={lifecycle.switchChecked}
              switchDisabled={lifecycle.switchDisabled}
              version={ollamaVersion}
              portLabel={servicePortLabel}
              instanceCount={runningModels.length}
              message={lifecycle.errorMessage}
              onToggleDesiredRunning={lifecycle.setDesiredRunning}
              onManage={() => setLifecycleDialogOpen(true)}
              onRefresh={handleRefreshService}
            />

            <OllamaRunPanel
              models={ollamaModels.map((model) => model.name)}
              isSubmitting={isSubmittingRun}
              onSubmit={handleRunModel}
            />

            <OllamaInstanceList
              items={instanceItems}
              isLoading={psLoading}
              totalVram={totalVram}
              onViewDetails={handleViewInstanceDetails}
              onUnload={handleUnload}
            />

            <OllamaLifecycleDialog
              open={lifecycleDialogOpen}
              onOpenChange={setLifecycleDialogOpen}
              isInstalled={ollamaInstalled}
              isRunning={ollamaRunning}
              phase={lifecycle.phase}
              switchChecked={lifecycle.switchChecked}
              switchDisabled={lifecycle.switchDisabled}
              version={ollamaVersion}
              installPath={ollamaInstallPath}
              portLabel={servicePortLabel}
              instanceCount={runningModels.length}
              isInstalling={isInstalling}
              installMessage={installMessage}
              errorMessage={lifecycle.errorMessage}
              onInstall={installOllama}
              onToggleDesiredRunning={lifecycle.setDesiredRunning}
            />

            <OllamaInstanceDetailDialog
              open={selectedInstance !== null}
              onOpenChange={handleDetailDialogChange}
              instance={selectedInstance}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
