import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type {
  OllamaInstanceItem,
  OllamaInstanceStatus,
} from '@/components/hub/OllamaInstanceList'

interface OllamaInstanceDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: OllamaInstanceItem | null
}

const STATUS_LABELS: Record<OllamaInstanceStatus, string> = {
  running: '运行中',
  warning: '异常预警',
  error: '异常',
}

const STATUS_STYLES: Record<OllamaInstanceStatus, string> = {
  running:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
}

export function OllamaInstanceDetailDialog({
  open,
  onOpenChange,
  instance,
}: OllamaInstanceDetailDialogProps) {
  if (!instance) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>运行实例详情</DialogTitle>
          <DialogDescription>
            查看当前 Ollama 已启动模型实例的状态、端口和参数摘要。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">实例概览</div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>状态</span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${STATUS_STYLES[instance.status]}`}
                >
                  {STATUS_LABELS[instance.status]}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span>模型名称</span>
                <span className="text-right text-foreground">
                  {instance.modelName}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span>端口</span>
                <span className="text-foreground">{instance.port}</span>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">启动参数摘要</div>
              <div>{instance.parameterSummary || '暂无可展示的参数摘要'}</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">配置入口</div>
            <div className="text-sm text-muted-foreground">
              本轮先提供详情与编辑壳子，后续会在这里接入配置编辑与自动重启流程。
            </div>

            <Button variant="outline">修改配置</Button>
            <Button disabled>保存并自动重启</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
