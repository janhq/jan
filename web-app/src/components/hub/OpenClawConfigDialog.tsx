import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  IconAlertTriangle,
  IconPlayerPlay,
  IconLoader2,
} from '@tabler/icons-react'

export interface OpenClawConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableModels: string[]
  defaultModel?: string
  onConfirm: (model: string) => void
  isLoading?: boolean
}

export function OpenClawConfigDialog({
  open,
  onOpenChange,
  availableModels,
  defaultModel,
  onConfirm,
  isLoading = false,
}: OpenClawConfigDialogProps) {
  const [selectedModel, setSelectedModel] = useState(defaultModel || availableModels[0] || '')

  useEffect(() => {
    if (open) {
      setSelectedModel(defaultModel || availableModels[0] || '')
    }
  }, [open, defaultModel, availableModels])

  const handleConfirm = () => {
    if (selectedModel) {
      onConfirm(selectedModel)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPlayerPlay size={18} />
            启动 OpenClaw Gateway
          </DialogTitle>
          <DialogDescription>
            将 OpenClaw 连接到本地 Ollama 模型，启动 AI 助手 Gateway。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Security notice */}
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 flex gap-2.5">
            <IconAlertTriangle
              size={18}
              className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                安全提示
              </span>
              <span className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                OpenClaw 在启用工具时可以读取文件和执行操作。
                不当的提示词可能诱使它执行不安全的操作。
                请确保您了解相关风险后再继续。
              </span>
            </div>
          </div>

          {/* Model selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">
              选择 Ollama 模型
            </label>
            {availableModels.length === 0 ? (
              <div className="text-xs text-destructive">
                没有可用的 Ollama 模型，请先拉取或导入模型。
              </div>
            ) : (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className={cn(
                  'w-full h-9 px-2.5 text-sm rounded-md border border-input bg-background',
                  'outline-none focus:ring-1 focus:ring-primary focus:border-primary'
                )}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-muted-foreground">
              OpenClaw 将使用该模型进行推理和工具调用。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isLoading || !selectedModel || availableModels.length === 0}
            className="gap-1"
          >
            {isLoading ? (
              <IconLoader2 size={14} className="animate-spin" />
            ) : (
              <IconPlayerPlay size={14} />
            )}
            确认启动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
