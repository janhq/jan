import {
  IconAlertTriangle,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconRotateClockwise,
  IconSettings,
  IconSquare,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type OpenClawStatus =
  | 'not-installed'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'degraded'
  | 'error'

const statusConfigMap: Record<
  OpenClawStatus,
  { dotColor: string; title: string; description: string }
> = {
  'not-installed': {
    dotColor: 'bg-red-500',
    title: 'OpenClaw 实例',
    description: '未安装 OpenClaw CLI',
  },
  installing: {
    dotColor: 'bg-yellow-500',
    title: 'OpenClaw 实例',
    description: '正在安装 OpenClaw',
  },
  installed: {
    dotColor: 'bg-orange-400',
    title: 'OpenClaw 实例',
    description: 'CLI 已安装，Gateway 当前未运行',
  },
  starting: {
    dotColor: 'bg-yellow-500',
    title: 'OpenClaw 实例',
    description: '正在启动 Gateway',
  },
  running: {
    dotColor: 'bg-green-500',
    title: 'OpenClaw 实例',
    description: 'Gateway 运行正常',
  },
  stopping: {
    dotColor: 'bg-yellow-500',
    title: 'OpenClaw 实例',
    description: '正在停止 Gateway',
  },
  degraded: {
    dotColor: 'bg-amber-500',
    title: 'OpenClaw 实例',
    description: 'Gateway 部分可用，但状态异常',
  },
  error: {
    dotColor: 'bg-red-500',
    title: 'OpenClaw 实例',
    description: '状态探测失败',
  },
}

export interface OpenClawCardProps {
  status: OpenClawStatus
  version?: string
  gatewayUrl?: string
  installProgress?: number
  installMessage?: string
  serviceStatus?: string
  rpcStatus?: string
  configStatus?: string
  onInstall?: () => void
  onStart?: () => void
  onStop?: () => void
  onRestart?: () => void
  onOpenDashboard?: () => void
  onConfigure?: () => void
  onRefresh?: () => void | Promise<void>
  isLoading?: boolean
  className?: string
}

export function OpenClawCard({
  status,
  version,
  gatewayUrl,
  installProgress = 0,
  installMessage = '',
  serviceStatus,
  rpcStatus,
  configStatus,
  onInstall,
  onStart,
  onStop,
  onRestart,
  onOpenDashboard,
  onConfigure,
  onRefresh,
  isLoading = false,
  className,
}: OpenClawCardProps) {
  const baseConfig = statusConfigMap[status] ?? {
    dotColor: 'bg-gray-400',
    title: 'OpenClaw 实例',
    description: '状态信息不可用',
  }

  const showInlineMessage =
    status === 'error' ||
    status === 'degraded' ||
    status === 'installing' ||
    status === 'starting' ||
    status === 'stopping'

  const summaryItems = [
    version ? { label: '版本', value: version } : null,
    gatewayUrl ? { label: 'Gateway', value: gatewayUrl, mono: true } : null,
    serviceStatus ? { label: '服务', value: serviceStatus } : null,
    rpcStatus ? { label: 'RPC', value: rpcStatus } : null,
    configStatus ? { label: '配置', value: configStatus } : null,
  ].filter(Boolean) as { label: string; value: string; mono?: boolean }[]

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4 flex flex-col gap-3 shadow-sm',
        status === 'running' && 'border-green-500/30',
        status === 'degraded' && 'border-amber-500/30',
        className
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex items-center gap-3">
          <div
            role="status"
            aria-label={baseConfig.title}
            className={cn('w-2.5 h-2.5 rounded-full shrink-0', baseConfig.dotColor)}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{baseConfig.title}</div>
            <div className="text-xs text-muted-foreground">{baseConfig.description}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {status === 'not-installed' && (
            <Button size="sm" onClick={onInstall} disabled={isLoading}>
              {isLoading ? <IconLoader2 size={14} className="animate-spin" /> : <IconDownload size={14} />}
              安装
            </Button>
          )}

          {status === 'installed' && (
            <Button size="sm" onClick={onStart} disabled={isLoading}>
              {isLoading ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPlay size={14} />}
              启动
            </Button>
          )}

          {(status === 'running' || status === 'degraded') && (
            <>
              <Button size="sm" variant="outline" onClick={onStop} disabled={isLoading}>
                <IconSquare size={14} />
                停止
              </Button>
              <Button size="sm" onClick={onRestart} disabled={isLoading}>
                <IconRotateClockwise size={14} />
                重启
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={onConfigure}
            disabled={isLoading || status === 'starting' || status === 'stopping'}
          >
            <IconSettings size={14} />
            编辑配置
          </Button>

          <Button size="sm" variant="ghost" onClick={onOpenDashboard} disabled={!gatewayUrl}>
            <IconExternalLink size={14} />
            打开控制台
          </Button>

          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isLoading}>
            <IconRefresh size={14} />
            刷新
          </Button>
        </div>
      </div>

      {summaryItems.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{item.label}</div>
              <div
                className={cn('mt-1 text-xs text-foreground truncate', item.mono && 'font-mono')}
                title={item.value}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {showInlineMessage && installMessage && (
        <div
          className={cn(
            'text-[11px] flex items-start gap-1.5',
            status === 'degraded' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          )}
        >
          {status === 'degraded' && <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span>{installMessage}</span>
        </div>
      )}

      {status === 'installing' && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${installProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
