import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  IconPlayerPlay,
  IconSquare,
  IconExternalLink,
  IconSettings,
  IconLoader2,
  IconDownload,
} from '@tabler/icons-react'


export type OpenClawStatus = 'not-installed' | 'installing' | 'installed' | 'running'

const statusConfigMap: Record<
  OpenClawStatus,
  { dotColor: string; title: string; description: string }
> = {
  'not-installed': {
    dotColor: 'bg-red-500',
    title: 'OpenClaw 未安装',
    description: '需要 Node.js 环境才能运行 OpenClaw',
  },
  installing: {
    dotColor: 'bg-yellow-500',
    title: '正在安装 OpenClaw',
    description: '请稍候...',
  },
  installed: {
    dotColor: 'bg-orange-400',
    title: 'OpenClaw 已安装',
    description: '选择模型并启动 Gateway',
  },
  running: {
    dotColor: 'bg-green-500',
    title: 'OpenClaw 运行中',
    description: 'Gateway 已就绪',
  },
}

export interface OpenClawCardProps {
  status: OpenClawStatus
  version?: string
  gatewayUrl?: string
  boundModel?: string
  installProgress?: number
  installMessage?: string
  onInstall?: () => void
  onStart?: () => void
  onStop?: () => void
  onOpenDashboard?: () => void
  onConfigure?: () => void
  isLoading?: boolean
  className?: string
}

export function OpenClawCard({
  status,
  version,
  gatewayUrl,
  boundModel,
  installProgress = 0,
  installMessage = '',
  onInstall,
  onStart,
  onStop,
  onOpenDashboard,
  onConfigure,
  isLoading = false,
  className,
}: OpenClawCardProps) {

  const baseConfig = statusConfigMap[status] ?? {
    dotColor: 'bg-gray-400',
    title: '未知状态',
    description: '状态信息不可用',
  }

  const title = baseConfig.title
  const dotColor = baseConfig.dotColor
  let description = baseConfig.description
  if (status === 'installed' && version) {
    description = `版本 ${version} · 选择模型并启动 Gateway`
  } else if (status === 'running' && boundModel) {
    description = `绑定模型: ${boundModel}`
  } else if (status === 'installing' && installMessage) {
    description = installMessage
  }

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4 flex flex-col gap-3 shadow-sm',
        status === 'running' && 'border-green-500/30',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            role="status"
            aria-label={title}
            className={cn('w-2.5 h-2.5 rounded-full shrink-0', dotColor)}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {title}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {description}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {status === 'running' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1"
                type="button"
                onClick={onConfigure}
              >
                <IconSettings size={14} />
                <span className="hidden sm:inline">配置</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1"
                type="button"
                onClick={onOpenDashboard}
              >
                <IconExternalLink size={14} />
                <span className="hidden sm:inline">面板</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                type="button"
                onClick={onStop}
                disabled={isLoading}
              >
                <IconSquare size={14} />
                停止
              </Button>
            </>
          )}

          {status === 'installed' && (
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1"
              type="button"
              onClick={onStart}
              disabled={isLoading}
            >
              {isLoading ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconPlayerPlay size={14} />
              )}
              一键启动
            </Button>
          )}

          {status === 'not-installed' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1"
              type="button"
              onClick={onInstall}
              disabled={isLoading}
            >
              {isLoading ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconDownload size={14} />
              )}
              安装
            </Button>
          )}
        </div>
      </div>

      {/* Install progress */}
      {status === 'installing' && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${installProgress}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {installMessage}
          </span>
        </div>
      )}

      {/* Running details */}
      {status === 'running' && gatewayUrl && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 mt-0.5">
          <span className="text-[11px] text-muted-foreground shrink-0">Gateway:</span>
          <code className="text-[11px] font-mono text-foreground truncate">
            {gatewayUrl}
          </code>
        </div>
      )}
    </div>
  )
}
