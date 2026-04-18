import { useState, useMemo } from 'react'
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
  IconWorld,
  IconServer,
} from '@tabler/icons-react'

export type MirrorSource = 'ollama' | 'modelscope'

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

export interface PullModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPull: (modelName: string, mirror: MirrorSource) => void
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
  const [mirror, setMirror] = useState<MirrorSource>('ollama')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = modelName.trim()
    if (!trimmed || isPulling) return
    onPull(trimmed, mirror)
  }

  const handleCancel = () => {
    onCancel?.()
  }

  const handleClose = () => {
    if (isPulling) return
    onOpenChange(false)
    setModelName('')
    setMirror('ollama')
  }

  const progressPercent = useMemo(() => {
    if (!progress?.total || progress.total === 0) return 0
    return Math.min(100, Math.round((progress.completed || 0) / progress.total * 100))
  }, [progress])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn('sm:max-w-md', className)} showCloseButton={!isPulling}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconDownload size={18} />
            拉取模型
          </DialogTitle>
          <DialogDescription>
            从远端仓库拉取模型到本地 Ollama
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Model name input */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-name">模型名称</Label>
            <Input
              id="model-name"
              placeholder="qwen2.5:7b"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              disabled={isPulling}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              格式: model:tag，如 llama3.2:latest、qwen2.5:7b
            </p>
          </div>

          {/* Mirror source */}
          <div className="flex flex-col gap-2">
            <Label>镜像源</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMirror('ollama')}
                disabled={isPulling}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
                  mirror === 'ollama'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent'
                )}
              >
                <IconWorld size={14} />
                Ollama 官方
              </button>
              <button
                type="button"
                onClick={() => setMirror('modelscope')}
                disabled={isPulling}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
                  mirror === 'modelscope'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent'
                )}
              >
                <IconServer size={14} />
                ModelScope
              </button>
            </div>
          </div>

          {/* Progress area */}
          {isPulling && progress && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">{progress.status}</span>
                <span className="text-muted-foreground font-mono">
                  {progress.completed !== undefined && progress.total !== undefined && progress.total > 0
                    ? `${toGigabytes(progress.completed)} / ${toGigabytes(progress.total)}`
                    : ''}
                </span>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{progress.digest ? progress.digest.slice(0, 19) + '…' : ''}</span>
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
                  开始拉取
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
