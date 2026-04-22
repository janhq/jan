import { Button } from '@/components/ui/button'
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
  version?: string
  installPath?: string
  portLabel: string
  instanceCount: number
  isInstalling: boolean
  installMessage: string
  onInstall: () => void | Promise<void>
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
}

export function OllamaLifecycleDialog({
  open,
  onOpenChange,
  isInstalled,
  isRunning,
  version,
  installPath,
  portLabel,
  instanceCount,
  isInstalling,
  installMessage,
  onInstall,
  onStart,
  onStop,
}: OllamaLifecycleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ollama 生命周期管理</DialogTitle>
          <DialogDescription>
            管理本地 Ollama 服务安装、启动与停止。
          </DialogDescription>
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
            <div className="text-sm font-medium text-foreground">生命周期操作</div>
            <Button onClick={onInstall} disabled={isInstalling}>
              安装
            </Button>
            <Button
              variant="secondary"
              onClick={onStart}
              disabled={isInstalling || !isInstalled || isRunning}
            >
              启动
            </Button>
            <Button
              variant="secondary"
              onClick={onStop}
              disabled={isInstalling || !isRunning}
            >
              停止
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
