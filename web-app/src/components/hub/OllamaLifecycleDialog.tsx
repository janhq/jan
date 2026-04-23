import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface OllamaLifecycleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isInstalled: boolean
  isRunning: boolean
  phase: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  switchChecked: boolean
  switchDisabled: boolean
  version?: string
  installPath?: string
  portLabel: string
  instanceCount: number
  isInstalling: boolean
  installMessage: string
  errorMessage?: string
  onInstall: () => void | Promise<void>
  onToggleDesiredRunning: (checked: boolean) => void | Promise<void>
}

export function OllamaLifecycleDialog({
  open,
  onOpenChange,
  isInstalled,
  isRunning,
  phase,
  switchChecked,
  switchDisabled,
  version,
  installPath,
  portLabel,
  instanceCount,
  isInstalling,
  installMessage,
  errorMessage,
  onInstall,
  onToggleDesiredRunning,
}: OllamaLifecycleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ollama 生命周期管理</DialogTitle>
          <DialogDescription>管理本地 Ollama 服务的声明式期望状态与安装。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
            <div className="text-sm font-medium text-foreground">服务摘要</div>
            <div className="text-xs text-muted-foreground">{`安装状态: ${isInstalling ? '安装中' : isInstalled ? '已安装' : '未安装'}`}</div>
            <div className="text-xs text-muted-foreground">{`运行状态: ${isRunning ? '运行中' : '未运行'}`}</div>
            <div className="text-xs text-muted-foreground">{`版本: ${version ?? '-'}`}</div>
            <div className="text-xs text-muted-foreground">{`端口: ${portLabel}`}</div>
            <div className="text-xs text-muted-foreground">{`实例: ${instanceCount}`}</div>
            <div className="text-xs text-muted-foreground break-all">
              {`安装路径: ${installPath ?? '未检测到'}`}
            </div>
            {isInstalling && installMessage && (
              <div className="text-xs text-muted-foreground">{installMessage}</div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
            <div className="text-sm font-medium text-foreground">期望状态</div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm text-foreground">
                  {switchChecked ? '期望运行' : '期望停止'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {phase === 'starting' || phase === 'stopping'
                    ? '正在调整到期望状态'
                    : phase === 'error'
                      ? errorMessage ?? '未达到期望状态'
                      : '用最终期望状态控制 Ollama'}
                </div>
              </div>
              <Switch
                aria-label="期望运行 Ollama（管理面板）"
                checked={switchChecked}
                disabled={switchDisabled || !isInstalled}
                loading={phase === 'starting' || phase === 'stopping'}
                onCheckedChange={onToggleDesiredRunning}
              />
            </div>
            {errorMessage && (
              <div className="text-xs text-destructive">{errorMessage}</div>
            )}
            <div className="mt-2 text-sm font-medium text-foreground">安装操作</div>
            <Button onClick={onInstall} disabled={isInstalling || isInstalled}>
              安装
            </Button>
            <Button variant="outline" disabled>
              卸载
            </Button>
            <Button variant="outline" disabled>
              配置
            </Button>
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
