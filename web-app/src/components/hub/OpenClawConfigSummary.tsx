import { IconExternalLink } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

export interface OpenClawConfigSummaryProps {
  launchMode: 'existing-config' | 'local-ollama-injected'
  selectedModel?: string
  gatewayPort?: number
  onOpenDashboard: () => void
  isActionDisabled?: boolean
}

function launchModeLabel(launchMode: OpenClawConfigSummaryProps['launchMode']) {
  return launchMode === 'local-ollama-injected'
    ? '注入本地 Ollama 模型'
    : '按 OpenClaw 当前配置运行'
}

export function OpenClawConfigSummary({
  launchMode,
  selectedModel,
  gatewayPort,
  onOpenDashboard,
  isActionDisabled = false,
}: OpenClawConfigSummaryProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">配置摘要</div>
          <p className="mt-1 text-xs text-muted-foreground">
            这里仅展示当前页面关注的常用运行配置。更完整的高级管理继续交给 OpenClaw 控制台。
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenDashboard}
            disabled={isActionDisabled}
            className="gap-1"
          >
            <IconExternalLink size={14} />
            打开 OpenClaw 控制台
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">运行方式</div>
          <div className="mt-1 text-xs text-foreground">{launchModeLabel(launchMode)}</div>
        </div>

        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Gateway 端口</div>
          <div className="mt-1 text-xs text-foreground">{gatewayPort ?? '-'}</div>
        </div>

        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">本地模型</div>
          <div className="mt-1 text-xs text-foreground">{selectedModel ?? '-'}</div>
        </div>
      </div>
    </div>
  )
}
