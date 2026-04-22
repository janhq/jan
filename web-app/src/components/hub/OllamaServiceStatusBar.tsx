import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IconRefresh } from '@tabler/icons-react'

type StatusColor = 'green' | 'yellow' | 'orange' | 'red'

export interface OllamaServiceStatusBarProps {
  isInstalled: boolean
  isRunning: boolean
  isInstalling: boolean
  version?: string
  portLabel: string
  instanceCount: number
  onManage: () => void
  onRefresh: () => void | Promise<void>
}

function statusColor(
  isInstalled: boolean,
  isRunning: boolean,
  isInstalling: boolean
): StatusColor {
  if (isRunning) return 'green'
  if (isInstalling) return 'yellow'
  if (isInstalled) return 'orange'
  return 'red'
}

function statusText(isInstalled: boolean, isRunning: boolean, isInstalling: boolean) {
  return {
    install: isInstalling ? '安装中' : isInstalled ? '已安装' : '未安装',
    running: isRunning ? '运行中' : '未运行',
  }
}

export function OllamaServiceStatusBar({
  isInstalled,
  isRunning,
  isInstalling,
  version,
  portLabel,
  instanceCount,
  onManage,
  onRefresh,
}: OllamaServiceStatusBarProps) {
  const color = statusColor(isInstalled, isRunning, isInstalling)
  const labels = statusText(isInstalled, isRunning, isInstalling)
  const dotClass = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
  }

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex items-center gap-3 flex-wrap">
        <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', dotClass[color])} />
        <span className="text-sm font-medium text-foreground">Ollama 进程</span>
        <span className="text-xs text-muted-foreground">安装 {labels.install}</span>
        <span className="text-xs text-muted-foreground">运行 {labels.running}</span>
        <span className="text-xs text-muted-foreground">{`版本 ${version ?? '-'}`}</span>
        <span className="text-xs text-muted-foreground">{`端口 ${portLabel}`}</span>
        <span className="text-xs text-muted-foreground">{`实例 ${instanceCount}`}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="outline" onClick={onManage}>
          管理
        </Button>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isInstalling}>
          <IconRefresh size={16} className="text-muted-foreground" />
          刷新
        </Button>
      </div>
    </div>
  )
}
