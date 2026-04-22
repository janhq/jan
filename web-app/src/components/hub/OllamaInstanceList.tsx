import { Button } from '@/components/ui/button'
import { toGigabytes } from '@/lib/utils'
import { IconCpu } from '@tabler/icons-react'

export type OllamaInstanceStatus = 'running' | 'warning' | 'error'

export interface OllamaInstanceItem {
  id: string
  status: OllamaInstanceStatus
  modelName: string
  port: string
  parameterSummary: string
  unloadKey: string
}

interface OllamaInstanceListProps {
  items: OllamaInstanceItem[]
  isLoading: boolean
  totalVram: number
  onViewDetails: (item: OllamaInstanceItem) => void
  onUnload: (item: OllamaInstanceItem) => void
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

export function OllamaInstanceList({
  items,
  isLoading,
  totalVram,
  onViewDetails,
  onUnload,
}: OllamaInstanceListProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          运行实例 ({items.length})
        </span>
        {totalVram > 0 && (
          <span className="text-xs text-muted-foreground">
            总 VRAM: {toGigabytes(totalVram)}
          </span>
        )}
      </div>

      {isLoading && items.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          正在获取运行实例...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-6 text-muted-foreground">
          <IconCpu size={24} className="opacity-50" />
          <span className="text-sm">暂无运行实例</span>
          <span className="text-xs">使用上方运行面板选择模型并启动</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-border/60 bg-card px-4 py-3"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-xs font-medium ${STATUS_STYLES[item.status]}`}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {item.modelName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      端口 {item.port}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onViewDetails(item)}
                  >
                    查看详情
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onUnload(item)}
                  >
                    卸载
                  </Button>
                </div>
              </div>

              {item.parameterSummary && (
                <div className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  启动参数摘要: {item.parameterSummary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
