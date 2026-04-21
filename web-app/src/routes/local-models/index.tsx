import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn, toGigabytes } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'
import { useOllamaStatus, type OllamaModel } from '@/hooks/useOllamaStatus'
import { useLocalGgufModels, type LocalGgufModel } from '@/hooks/useLocalGgufModels'
import { GgufModelCard } from '@/components/hub/GgufModelCard'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
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
  IconSearch,
  IconTrash,
  IconCube,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'

export const Route = createFileRoute(route.localModels.index as any)({
  component: LocalModelsPage,
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
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (lower.includes('phi')) return 'Phi'
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

function getGgufFamilies(models: LocalGgufModel[]): string[] {
  const set = new Set<string>()
  models.forEach((m) => {
    set.add(m.family || 'Other')
  })
  return Array.from(set).sort()
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function ModelCardItem({
  model,
  onDelete,
}: {
  model: OllamaModel
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

      <div className="flex items-center justify-end mt-auto pt-1">
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

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */

function LocalModelsPage() {
  const {
    isRunning: ollamaRunning,
    models: ollamaModels,
    refresh: refreshOllama,
  } = useOllamaStatus(10000)

  const {
    models: ggufModels,
    loading: ggufLoading,
    refresh: refreshGguf,
  } = useLocalGgufModels()

  /* -- local state -- */
  const [view, setView] = useState<'ollama' | 'gguf'>('ollama')
  const [search, setSearch] = useState('')
  const [activeFamily, setActiveFamily] = useState<string>('全部')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OllamaModel | LocalGgufModel | null>(null)
  const [deleteTargetType, setDeleteTargetType] = useState<'ollama' | 'gguf'>('ollama')
  const [isDeleting, setIsDeleting] = useState(false)

  /* -- families -- */
  const families = useMemo(() => {
    const fams = view === 'ollama'
      ? getFamilies(ollamaModels)
      : getGgufFamilies(ggufModels)
    const common = ['Llama', 'Qwen', 'Gemma', 'Embedding']
    const all = new Set(['全部', ...common, ...fams])
    return Array.from(all)
  }, [view, ollamaModels, ggufModels])

  /* -- filtered ollama models -- */
  const filteredOllamaModels = useMemo(() => {
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

  /* -- filtered gguf models -- */
  const filteredGgufModels = useMemo(() => {
    let list = ggufModels
    if (activeFamily !== '全部') {
      list = list.filter((m) => {
        const fam = m.family || 'Other'
        return fam === activeFamily
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => m.name.toLowerCase().includes(q))
    }
    return list
  }, [ggufModels, activeFamily, search])

  /* -- delete model -- */
  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      if (deleteTargetType === 'gguf' && deleteTarget) {
        const serviceHub = getServiceHub()
        await serviceHub.models().deleteModel((deleteTarget as LocalGgufModel).id, 'llamacpp')
        refreshGguf()
      } else {
        await invoke('ollama_delete_model', { model: deleteTarget.name })
        refreshOllama()
      }
      toast.success(`模型 ${deleteTarget.name} 已删除`)
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch (e) {
      toast.error('删除失败: ' + String(e))
    } finally {
      setIsDeleting(false)
    }
  }

  /* -- load gguf model -- */
  const handleLoadGguf = (model: LocalGgufModel) => {
    toast.info(`正在加载模型: ${model.name}`)
    // TODO: invoke llamacpp load command
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3 h-10 w-full flex items-center justify-between',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="text-sm font-medium text-foreground">
              本地模型管理
            </span>
          </div>
        </HeaderPage>

        <div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">
          <div className="flex flex-col gap-5 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* Search */}
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

              {/* View toggle */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setView('ollama')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                    view === 'ollama'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  Ollama 模型
                </button>
                <button
                  onClick={() => setView('gguf')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                    view === 'gguf'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  本地 GGUF 模型
                </button>
              </div>
            </div>

            {/* Model Grid */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {view === 'ollama'
                    ? `本地模型 (${filteredOllamaModels.length})`
                    : `本地 GGUF 模型 (${filteredGgufModels.length})`}
                </span>
              </div>
              {view === 'ollama' ? (
                filteredOllamaModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
                    <IconCube size={28} className="opacity-50" />
                    <span className="text-sm">暂无模型</span>
                    <span className="text-xs">
                      {ollamaRunning
                        ? 'Ollama 运行中，暂无已安装模型'
                        : '请先启动 Ollama'}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredOllamaModels.map((model) => (
                      <ModelCardItem
                        key={model.digest || model.name}
                        model={model}
                        onDelete={(m) => {
                          setDeleteTarget(m)
                          setDeleteTargetType('ollama')
                          setDeleteOpen(true)
                        }}
                      />
                    ))}
                  </div>
                )
              ) : (
                <>
                  {ggufLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
                      <IconCube size={28} className="opacity-50 animate-pulse" />
                      <span className="text-sm">正在扫描本地 GGUF 模型...</span>
                    </div>
                  ) : filteredGgufModels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
                      <IconCube size={28} className="opacity-50" />
                      <span className="text-sm">暂无 GGUF 模型</span>
                      <span className="text-xs">
                        切换到 Ollama 模型或从 ModelScope 下载
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredGgufModels.map((model) => (
                        <GgufModelCard
                          key={model.id}
                          model={model}
                          onLoad={handleLoadGguf}
                          onDelete={(m) => {
                            setDeleteTarget(m)
                            setDeleteTargetType('gguf')
                            setDeleteOpen(true)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

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
