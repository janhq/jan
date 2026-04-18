/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn, toGigabytes } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useOllamaStatus, type OllamaModel } from '@/hooks/useOllamaStatus'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  IconRefresh,
  IconSearch,
  IconPlayerPlay,
  IconTrash,
  IconPlus,
  IconSettings,
  IconCube,
  IconCpu,
  IconGauge,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { OpenClawCard, type OpenClawStatus } from '@/components/hub/OpenClawCard'
import {
  PullModelDialog,
  type MirrorSource,
  type PullProgress,
} from '@/components/hub/PullModelDialog'

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
})

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatFamily(name?: string): string {
  if (!name) return 'Other'
  const lower = name.toLowerCase()
  if (lower.includes('qwen')) return 'Qwen'
  if (lower.includes('llama')) return 'Llama'
  if (lower.includes('gemma')) return 'Gemma'
  if (lower.includes('mistral')) return 'Mistral'
  if (lower.includes('embed')) return 'Embedding'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function getFamilies(models: OllamaModel[]): string[] {
  const set = new Set<string>()
  models.forEach((m) => {
    const fam = m.details?.family || 'Other'
    set.add(formatFamily(fam))
  })
  return Array.from(set).sort()
}

function timeLeftLabel(expiresAt?: string): string {
  if (!expiresAt) return ''
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return '即将卸载'
  const mins = Math.ceil(diff / 60000)
  if (mins < 60) return `${mins}min left`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hrs}h ${rem}min left`
}

function processorLabel(ps: OllamaPsModel): string {
  if (!ps.size_vram || ps.size_vram === 0) return 'CPU'
  if (ps.size_vram >= ps.size) return 'GPU'
  return 'Mixed'
}

/* ------------------------------------------------------------------ */
/*  Types (local + placeholder for future Rust commands)              */
/* ------------------------------------------------------------------ */

interface OllamaPsModel {
  name: string
  model: string
  size: number
  size_vram: number
  digest: string
  details?: OllamaModel['details']
  expires_at: string
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

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

function OllamaStatusCard() {
  const {
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
  } = useOllamaStatus(5000)

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
                点击"启动 Ollama"按钮即可运行
              </span>
            )}
            {!isRunning && !isInstalling && !isInstalled && (
              <span className="text-xs text-muted-foreground">
                需要 Ollama 才能使用本地模型
              </span>
            )}
            {isInstalling && (
              <span className="text-xs text-muted-foreground">
                {installMessage}
              </span>
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

function ModelCardItem({
  model,
  onRun,
  onDelete,
}: {
  model: OllamaModel
  onRun: (m: OllamaModel) => void
  onDelete: (m: OllamaModel) => void
}) {
  const family = formatFamily(model.details?.family)
  const params = model.details?.parameter_size || ''
  const quant = model.details?.quantization_level || ''

  return (
    <div className="group flex flex-col rounded-lg border border-border bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:border-border/80 transition-all duration-200 ease-out p-4 gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <h3
            className="text-sm font-medium text-foreground truncate"
            title={model.name}
          >
            {model.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
              {family}
            </span>
            {params && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                {params}
              </span>
            )}
            {quant && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                {quant}
              </span>
            )}
          </div>
        </div>
        <IconCube
          size={18}
          className="text-muted-foreground shrink-0 mt-0.5"
        />
      </div>

      <div className="text-xs text-muted-foreground font-mono">
        {toGigabytes(model.size)}
      </div>

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs flex-1"
          onClick={() => onRun(model)}
        >
          <IconPlayerPlay size={14} className="mr-1" />
          Run
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(model)}
        >
          <IconTrash size={14} />
        </Button>
      </div>
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
  const vramText = toGigabytes(ps.size_vram, { hideUnit: true }) + 'GB VRAM'
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
        Unload
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */

function HubContent() {
  const { t } = useTranslation()
  const {
    isRunning: ollamaRunning,
    models: ollamaModels,
    refresh: refreshOllama,
  } = useOllamaStatus(10000)

  /* -- local state -- */
  const [search, setSearch] = useState('')
  const [activeFamily, setActiveFamily] = useState<string>('全部')
  const [showPullDialog, setShowPullDialog] = useState(false)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [isPulling, setIsPulling] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OllamaModel | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [runningModels, setRunningModels] = useState<OllamaPsModel[]>([])
  const [psLoading, setPsLoading] = useState(false)
  const unlistenPullRef = useRef<UnlistenFn | null>(null)

  /* -- openclaw state -- */
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawStatus>('not-installed')
  const [openClawGatewayUrl, setOpenClawGatewayUrl] = useState<string>()
  const [openClawBoundModel, setOpenClawBoundModel] = useState<string>()
  const [isOpenClawLoading, setIsOpenClawLoading] = useState(false)

  /* -- families -- */
  const families = useMemo(() => {
    const fams = getFamilies(ollamaModels)
    // Ensure common families exist as options even if empty
    const common = ['Llama', 'Qwen', 'Gemma', 'Embedding']
    const all = new Set(['全部', ...common, ...fams])
    return Array.from(all)
  }, [ollamaModels])

  /* -- filtered models -- */
  const filteredModels = useMemo(() => {
    let list = ollamaModels
    if (activeFamily !== '全部') {
      list = list.filter((m) => {
        const fam = formatFamily(m.details?.family)
        return fam === activeFamily
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => m.name.toLowerCase().includes(q))
    }
    return list
  }, [ollamaModels, activeFamily, search])

  /* -- fetch running models (/api/ps) -- */
  const fetchRunningModels = useCallback(async () => {
    if (!ollamaRunning) {
      setRunningModels([])
      return
    }
    setPsLoading(true)
    try {
      // TODO: replace with real Rust command when ready:
      // const result = await invoke<OllamaPsModel[]>('ollama_ps')
      // setRunningModels(result)

      // Placeholder: simulate empty or demo data
      setRunningModels([])
    } catch (e) {
      console.error('Failed to fetch running models:', e)
      setRunningModels([])
    } finally {
      setPsLoading(false)
    }
  }, [ollamaRunning])

  useEffect(() => {
    fetchRunningModels()
    const timer = setInterval(fetchRunningModels, 15000)
    return () => clearInterval(timer)
  }, [fetchRunningModels])

  /* -- pull model -- */
  const handlePullModel = useCallback(async (model: string, mirror: MirrorSource) => {
    if (!model) {
      toast.error('请输入模型名称')
      return
    }
    setIsPulling(true)
    setPullProgress(null)

    try {
      const unlisten = await listen<PullProgress>('ollama-pull-progress', (e) => {
        setPullProgress(e.payload)
      })
      unlistenPullRef.current = unlisten

      toast.info(`开始拉取模型: ${model} (via ${mirror})`)
      for (let i = 0; i <= 10; i++) {
        await new Promise((r) => setTimeout(r, 500))
        setPullProgress({
          status: i < 10 ? 'pulling manifest' : 'success',
          completed: i * 100,
          total: 1000,
        })
      }
      toast.success(`模型 ${model} 拉取完成`)
      refreshOllama()
      setShowPullDialog(false)
    } catch (e) {
      toast.error('拉取失败: ' + String(e))
    } finally {
      if (unlistenPullRef.current) {
        unlistenPullRef.current()
        unlistenPullRef.current = null
      }
      setIsPulling(false)
      setPullProgress(null)
    }
  }, [refreshOllama])

  const handleCancelPull = useCallback(() => {
    setIsPulling(false)
    setPullProgress(null)
    if (unlistenPullRef.current) {
      unlistenPullRef.current()
      unlistenPullRef.current = null
    }
    toast.info('拉取已取消')
  }, [])

  /* -- openclaw -- */
  const handleStartOpenClaw = useCallback(async () => {
    setIsOpenClawLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 1200))
      setOpenClawStatus('running')
      setOpenClawGatewayUrl('http://localhost:3456')
      toast.success('OpenClaw 已启动')
    } catch (e) {
      toast.error('启动失败: ' + String(e))
    } finally {
      setIsOpenClawLoading(false)
    }
  }, [])

  const handleStopOpenClaw = useCallback(async () => {
    setIsOpenClawLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 600))
      setOpenClawStatus('installed')
      setOpenClawGatewayUrl(undefined)
      setOpenClawBoundModel(undefined)
      toast.success('OpenClaw 已停止')
    } catch (e) {
      toast.error('停止失败: ' + String(e))
    } finally {
      setIsOpenClawLoading(false)
    }
  }, [])

  /* -- delete model -- */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      // TODO: invoke('ollama_delete_model', { model: deleteTarget.name })
      await new Promise((r) => setTimeout(r, 600))
      toast.success(`模型 ${deleteTarget.name} 已删除`)
      refreshOllama()
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch (e) {
      toast.error('删除失败: ' + String(e))
    } finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, refreshOllama])

  /* -- run model -- */
  const handleRun = useCallback((model: OllamaModel) => {
    toast.info(`正在加载模型: ${model.name}`)
    // TODO: invoke('ollama_run_model', { model: model.name })
    // This will pre-load the model into VRAM via /api/generate with keep_alive
  }, [])

  /* -- unload model -- */
  const handleUnload = useCallback(async (name: string) => {
    try {
      // TODO: invoke('ollama_unload_model', { model: name })
      toast.success(`模型 ${name} 已卸载`)
      fetchRunningModels()
    } catch (e) {
      toast.error('卸载失败: ' + String(e))
    }
  }, [fetchRunningModels])

  /* -- derived stats -- */
  const totalVram = runningModels.reduce((sum, m) => sum + (m.size_vram || 0), 0)

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
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OllamaStatusCard />
              <OpenClawCard
                status={openClawStatus}
                gatewayUrl={openClawGatewayUrl}
                boundModel={openClawBoundModel}
                onStart={handleStartOpenClaw}
                onStop={handleStopOpenClaw}
                isLoading={isOpenClawLoading}
              />
            </div>

            {/* Search + Pull */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <IconSearch
                    size={16}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    placeholder="搜索本地模型..."
                    className="pl-8 h-9 text-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1 shrink-0"
                  onClick={() => setShowPullDialog(true)}
                  disabled={!ollamaRunning}
                >
                  <IconPlus size={16} />
                  拉取模型
                </Button>
              </div>

              {/* Family filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {families.map((fam) => (
                  <button
                    key={fam}
                    onClick={() => setActiveFamily(fam)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                      activeFamily === fam
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    )}
                  >
                    {fam}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Grid */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  本地模型 ({filteredModels.length})
                </span>
              </div>
              {filteredModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
                  <IconCube size={28} className="opacity-50" />
                  <span className="text-sm">暂无模型</span>
                  <span className="text-xs">
                    {ollamaRunning
                      ? '点击"拉取模型"添加你的第一个模型'
                      : '请先启动 Ollama'}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredModels.map((model) => (
                    <ModelCardItem
                      key={model.digest || model.name}
                      model={model}
                      onRun={handleRun}
                      onDelete={(m) => {
                        setDeleteTarget(m)
                        setDeleteOpen(true)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Running Models */}
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
                  <span className="text-sm">没有运行中的模型</span>
                  <span className="text-xs">
                    点击模型卡片的 Run 按钮加载模型到内存
                  </span>
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

      {/* Pull Model Dialog */}
      <PullModelDialog
        open={showPullDialog}
        onOpenChange={setShowPullDialog}
        onPull={handlePullModel}
        onCancel={handleCancelPull}
        progress={pullProgress}
        isPulling={isPulling}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除模型 <strong>{deleteTarget?.name}</strong> 吗？
              <br />
              此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false)
                setDeleteTarget(null)
              }}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
