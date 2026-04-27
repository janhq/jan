import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IconExternalLink, IconRefresh } from '@tabler/icons-react'
import type { OpenClawStatus } from './OpenClawCard'

type StatusColor = 'green' | 'yellow' | 'orange' | 'red'

export interface OpenClawStatusBarProps {
  status: OpenClawStatus
  version?: string
  gatewayUrl?: string
  message?: string
  isLoading: boolean
  onInstall: () => void
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onEditConfig: () => void
  onOpenDashboard: () => void
  onRefresh: () => void | Promise<void>
}

function statusColor(status: OpenClawStatus): StatusColor {
  switch (status) {
    case 'running':
      return 'green'
    case 'installing':
    case 'starting':
    case 'stopping':
      return 'yellow'
    case 'installed':
      return 'orange'
    case 'error':
    case 'not-installed':
    default:
      return 'red'
  }
}

function statusLabel(status: OpenClawStatus): string {
  switch (status) {
    case 'installing':
      return '正在安装'
    case 'installed':
      return '已安装，未运行'
    case 'starting':
      return '正在启动'
    case 'running':
      return '运行中'
    case 'stopping':
      return '正在停止'
    case 'error':
      return '异常'
    case 'not-installed':
    default:
      return '未安装'
  }
}

export function OpenClawStatusBar({
  status,
  gatewayUrl,
  message,
  isLoading,
  onInstall,
  onStart,
  onStop,
  onRestart,
  onEditConfig,
  onOpenDashboard,
  onRefresh,
}: OpenClawStatusBarProps) {
  const color = statusColor(status)
  const showInlineMessage = status === 'error' || status === 'installing' || status === 'starting' || status === 'stopping'
  const dotClass = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
  }

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex items-center gap-3 flex-wrap">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', dotClass[color])} />
          <span className="text-sm font-medium text-foreground">OpenClaw 实例</span>
          <span className="text-xs text-muted-foreground">{statusLabel(status)}</span>
          {gatewayUrl && <code className="text-xs text-muted-foreground">{gatewayUrl}</code>}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {status === 'not-installed' && (
            <Button size="sm" onClick={onInstall} disabled={isLoading}>
              安装
            </Button>
          )}

          {status === 'installed' && (
            <Button size="sm" onClick={onStart} disabled={isLoading}>
              启动
            </Button>
          )}

          {status === 'running' && (
            <>
              <Button size="sm" variant="outline" onClick={onStop} disabled={isLoading}>
                停止
              </Button>
              <Button size="sm" onClick={onRestart} disabled={isLoading}>
                重启
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={onEditConfig}
            disabled={isLoading || status === 'starting' || status === 'stopping'}
          >
            编辑配置
          </Button>

          <Button size="sm" variant="ghost" onClick={onOpenDashboard} disabled={!gatewayUrl}>
            <IconExternalLink size={16} />
            控制台
          </Button>

          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isLoading}>
            <IconRefresh size={16} />
            刷新
          </Button>
        </div>
      </div>

      {message && showInlineMessage && (
        <div className="text-[11px] text-muted-foreground">{message}</div>
      )}
    </div>
  )
}
