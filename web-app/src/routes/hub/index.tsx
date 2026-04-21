/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn, toGigabytes } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useOllamaStatus } from '@/hooks/useOllamaStatus'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { OllamaRunPanel } from '@/components/hub/OllamaRunPanel'
import {
  IconRefresh,
  IconSettings,
  IconCpu,
  IconGauge,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
})

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

function StatusDot({
  color,
}: {
  color: 'green' | 'yellow' | 'orange' | 'red' | 'gray'
}) {
  const map = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-400',
    red: 'bg-red-500',
    gray: 'bg-gray-400',
  }

  return <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', map[color])} />
}

type OllamaStatusCardProps = {
  isRunning: boolean
  isInstalled: boolean
  version?: string
  models: Array<{ name: string }>
  refresh: () => void | Promise<void>
  isInstalling: boolean
  installProgress: number
  installMessage: string
  installOllama: () => void | Promise<void>
  startOllama: () => void | Promise<void>
}

function OllamaStatusCard({
  isRunning,
  isInstalled,
  version,
  models,
  refresh,
  isInstalling,
  installProgress,
  installMessage,
  installOllama,
  startOllama,
}: OllamaStatusCardProps) {
  const statusColor: 'green' | 'yellow' | 'orange' | 'red' = isRunning
    ? 'green'
    : isInstalling
      ? 'yellow'
      : isInstalled
        ? 'orange'
        : 'red'

  const statusText = isRunning
    ? 'Ollama 运行中'
    : isInstalling
      ? '正在安装 Ollama...'
      : isInstalled
        ? 'Ollama 已安装但未启动'
        : 'Ollama 未安装'

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot color={statusColor} />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {statusText}
            </span>
            {isRunning && (
              <span className="text-xs text-muted-foreground">
                版本 {version} · 已安装 {models.length} 个模型
              </span>
            )}
            {!isRunning && !isInstalling && isInstalled && (
              <span className="text-xs text-muted-foreground">
                点击“启动 Ollama”即可运行
              </span>
            )}
            {!isRunning && !isInstalling && !isInstalled && (
              <span className="text-xs text-muted-foreground">
                需要 Ollama 才能使用本地模型
              </span>
            )}
            {isInstalling && (
              <span className="text-xs text-muted-foreground">{installMessage}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isRunning && !isInstalling && isInstalled && (
            <Button variant="default" size="sm" onClick={startOllama}>
              启动 Ollama
            </Button>
          )}
          {!isRunning && !isInstalling && !isInstalled && (
            <Button variant="default" size="sm" onClick={installOllama}>
              一键安装
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isInstalling}
          >
            <IconRefresh size={16} className="text-muted-foreground" />
          </Button>
        </div>
      </div>
      {isInstalling && <Progress value={installProgress} className="h-1.5" />}
    </div>
  )
}

function RunningModelRow({
  ps,
  onUnload,
}: {
  ps: OllamaPsModel
  onUnload: (name: string) => void
}) {
  const proc = processorLabel(ps)
  const vramText = `${toGigabytes(ps.size_vram, { hideUnit: true })}GB VRAM`
  const timeLeft = timeLeftLabel(ps.expires_at)

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/40 border border-border/50">
      <div className="flex items-center gap-3 min-w-0">
        <IconGauge size={16} className="text-muted-foreground shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {ps.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {proc} · {vramText}
            {timeLeft ? ` · ${timeLeft}` : ''}
          </span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs shrink-0"
        onClick={() => onUnload(ps.name)}
      >
        卸载
      </Button>
    </div>
  )
}

export function HubContent() {
  const { t } = useTranslation()
  const {
    isRunning: ollamaRunning,
    isInstalled: ollamaInstalled,
    version: ollamaVersion,
    models: ollamaModels,
    refresh: refreshOllamaStatus,
    isInstalling,
    installProgress,
    installMessage,
    installOllama,
    startOllama,
  } = useOllamaStatus(10000)

  const [runningModels, setRunningModels] = useState<OllamaPsModel[]>([])
  const [psLoading, setPsLoading] = useState(false)
  const [isSubmittingRun, setIsSubmittingRun] = useState(false)
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
    async (name: string) => {
      try {
        await invoke('ollama_unload_model', { model: name })
        toast.success(`模型 ${name} 已卸载`)
        await fetchRunningModels()
      } catch (error) {
        toast.error(`卸载失败: ${String(error)}`)
      }
    },
    [fetchRunningModels]
  )

  const totalVram = runningModels.reduce((sum, model) => sum + (model.size_vram || 0), 0)

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3 h-10 w-full flex items-center justify-between relative z-20',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="text-sm font-medium text-foreground">
              {t('common:inferenceCenter')}
            </span>
            <Link to={route.settings.index}>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <IconSettings size={16} className="text-muted-foreground" />
              </Button>
            </Link>
          </div>
        </HeaderPage>

        <div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">
          <div className="flex flex-col gap-5 w-full md:w-4/5 xl:w-4/6 mx-auto">
            <OllamaStatusCard
              isRunning={ollamaRunning}
              isInstalled={ollamaInstalled}
              version={ollamaVersion}
              models={ollamaModels}
              refresh={refreshOllamaStatus}
              isInstalling={isInstalling}
              installProgress={installProgress}
              installMessage={installMessage}
              installOllama={installOllama}
              startOllama={startOllama}
            />

            <OllamaRunPanel
              models={ollamaModels.map((model) => model.name)}
              isSubmitting={isSubmittingRun}
              onSubmit={handleRunModel}
            />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  运行中模型 ({runningModels.length})
                </span>
                {totalVram > 0 && (
                  <span className="text-xs text-muted-foreground">
                    总 VRAM: {toGigabytes(totalVram)}
                  </span>
                )}
              </div>

              {psLoading && runningModels.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  正在获取运行状态...
                </div>
              ) : runningModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
                  <IconCpu size={24} className="opacity-50" />
                  <span className="text-sm">暂无运行中的模型</span>
                  <span className="text-xs">使用上方运行面板选择模型并启动</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {runningModels.map((ps) => (
                    <RunningModelRow
                      key={ps.name}
                      ps={ps}
                      onUnload={handleUnload}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
