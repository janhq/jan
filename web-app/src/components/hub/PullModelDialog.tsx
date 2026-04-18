import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { cn, toGigabytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  IconDownload,
  IconX,
  IconSearch,
} from '@tabler/icons-react'
import { invoke } from '@tauri-apps/api/core'
import type { ModelScopeModelsResult } from '@/services/modelscope/types'

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

export interface PullModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPull: (modelName: string) => void
  onCancel?: () => void
  progress?: PullProgress | null
  isPulling?: boolean
  className?: string
}

export function PullModelDialog({
  open,
  onOpenChange,
  onPull,
  onCancel,
  progress,
  isPulling = false,
  className,
}: PullModelDialogProps) {
  const [modelName, setModelName] = useState('')
  const [suggestions, setSuggestions] = useState<
    Array<{
      id: string
      display_name?: string | null
      tasks?: string[] | null
    }>
  >([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = modelName.trim()
    if (!trimmed || isPulling) return
    setShowSuggestions(false)
    onPull(trimmed)
  }

  const handleCancel = () => {
    onCancel?.()
  }

  const handleClose = () => {
    if (isPulling) return
    onOpenChange(false)
    setModelName('')
    setSuggestions([])
    setShowSuggestions(false)
  }

  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    setSuggestionsLoading(true)
    try {
      const result = await invoke<ModelScopeModelsResult>(
        'list_modelscope_models',
        {
          params: { search: input, page_size: 8, page_number: 1 },
          token: null,
        }
      )
      setSuggestions(result.models)
      setShowSuggestions(result.models.length > 0)
    } catch (e) {
      console.error('Failed to fetch suggestions:', e)
      setSuggestions([])
      setShowSuggestions(false)
    } finally {
      setSuggestionsLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setModelName(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(value.trim())
      }, 300)
    } else {
      setShowSuggestions(false)
      setSuggestions([])
    }
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const progressPercent = useMemo(() => {
    if (!progress?.total || progress.total === 0) return 0
    return Math.min(
      100,
      Math.round(((progress.completed || 0) / progress.total) * 100)
    )
  }, [progress])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn('sm:max-w-md', className)}
        showCloseButton={!isPulling}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconDownload size={18} />
            拉取模型
          </DialogTitle>
          <DialogDescription>
            从 ModelScope 搜索并下载模型到本地
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Model name input with suggestions */}
          <div className="flex flex-col gap-2 relative">
            <Label htmlFor="model-name">模型名称</Label>
            <div className="relative">
              <Input
                id="model-name"
                placeholder="搜索 ModelScope 模型..."
                value={modelName}
                onChange={handleInputChange}
                disabled={isPulling}
                autoComplete="off"
              />
              {suggestionsLoading && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 top-[60px] rounded-md border border-border bg-popover shadow-md max-h-60 overflow-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    onClick={() => {
                      setModelName(s.id)
                      setShowSuggestions(false)
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <IconSearch
                        size={14}
                        className="text-muted-foreground"
                      />
                      <span>{s.display_name || s.id}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {s.tasks?.[0]}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              输入 ModelScope 模型 ID（如 Qwen/Qwen2.5-7B-Instruct-GGUF）或直接搜索
            </p>
          </div>

          {/* Progress area */}
          {isPulling && progress && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">
                  {progress.status}
                </span>
                <span className="text-muted-foreground font-mono">
                  {progress.completed !== undefined &&
                  progress.total !== undefined &&
                  progress.total > 0
                    ? `${toGigabytes(progress.completed)} / ${toGigabytes(progress.total)}`
                    : ''}
                </span>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {progress.digest
                    ? progress.digest.slice(0, 19) + '…'
                    : ''}
                </span>
                <span>{progressPercent}%</span>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2">
            {isPulling ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="gap-1"
              >
                <IconX size={14} />
                取消
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!modelName.trim()}
                  className="gap-1"
                >
                  <IconDownload size={14} />
                  开始下载
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
