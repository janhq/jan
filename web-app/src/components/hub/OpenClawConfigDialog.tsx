import { useEffect, useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconRotateClockwise,
  IconSettings,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface OpenClawDialogConfig {
  gatewayPort?: number
  injectLocalModel: boolean
  selectedModel?: string
}

export interface OpenClawConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableModels: string[]
  defaultModel?: string
  mode?: 'launch' | 'manage'
  gatewayPort?: number
  initialInjectLocalModel?: boolean
  onConfirm: (model?: string) => void
  onSave?: (config: OpenClawDialogConfig) => void
  onSaveAndRestart?: (config: OpenClawDialogConfig) => void
  onOpenDashboard?: () => void
  isLoading?: boolean
}

function buildConfig(
  gatewayPort: number | undefined,
  injectLocalModel: boolean,
  selectedModel: string
): OpenClawDialogConfig {
  return {
    gatewayPort,
    injectLocalModel,
    selectedModel: injectLocalModel && selectedModel ? selectedModel : undefined,
  }
}

export function OpenClawConfigDialog({
  open,
  onOpenChange,
  availableModels,
  defaultModel,
  mode = 'launch',
  gatewayPort = 18789,
  initialInjectLocalModel = false,
  onConfirm,
  onSave,
  onSaveAndRestart,
  onOpenDashboard,
  isLoading = false,
}: OpenClawConfigDialogProps) {
  const fallbackModel = useMemo(
    () => defaultModel || availableModels[0] || '',
    [availableModels, defaultModel]
  )

  const [selectedModel, setSelectedModel] = useState(fallbackModel)
  const [injectLocalModel, setInjectLocalModel] = useState(initialInjectLocalModel)

  useEffect(() => {
    if (!open) return

    setInjectLocalModel(initialInjectLocalModel)
    setSelectedModel(fallbackModel)
  }, [fallbackModel, initialInjectLocalModel, open])

  const requiresModel = injectLocalModel && !selectedModel

  const handleConfirm = () => {
    if (!injectLocalModel) {
      onConfirm(undefined)
      return
    }

    if (selectedModel) {
      onConfirm(selectedModel)
    }
  }

  const handleSave = () => {
    onSave?.(buildConfig(gatewayPort, injectLocalModel, selectedModel))
    onOpenChange(false)
  }

  const handleSaveAndRestart = () => {
    onSaveAndRestart?.(buildConfig(gatewayPort, injectLocalModel, selectedModel))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'manage' ? <IconSettings size={18} /> : <IconPlayerPlay size={18} />}
            {mode === 'manage' ? '管理 OpenClaw 运行配置' : '启动 OpenClaw Gateway'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'manage'
              ? '这里用于调整本次运行要使用的常用配置。更完整的高级配置，请直接打开 OpenClaw 控制台处理。'
              : '默认按 OpenClaw 当前已有配置启动。你也可以选择一键注入本地 Ollama 模型配置。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2.5 dark:border-amber-900 dark:bg-amber-950/30">
            <IconAlertTriangle
              size={18}
              className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                安全提示
              </span>
              <span className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                OpenClaw 在启用工具时可以读取文件和执行操作。不当的提示词可能诱使它执行不安全的操作。请确保你了解相关风险后再继续。
              </span>
            </div>
          </div>

          {mode === 'manage' && (
            <div className="rounded-lg border border-border p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">常用配置</div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    当前页面只管理运行时常用项。复杂配置请交给 OpenClaw 自带控制台。
                  </p>
                </div>
                <div className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                  Gateway 端口 {gatewayPort}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">控制台入口</div>
                  <code className="text-xs text-foreground">http://127.0.0.1:{gatewayPort}/</code>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">配置方式</div>
                  <div className="text-xs text-foreground">声明式管理当前运行实例</div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {mode === 'manage' ? '模型接入' : '一键注入本地 Ollama 模型'}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {mode === 'manage'
                    ? '关闭时，按 OpenClaw 当前配置运行。开启后，本次启动会额外注入一个本地 Ollama 模型。'
                    : '关闭时，直接按 OpenClaw 当前配置启动。开启后，会临时写入本地 Ollama 模型配置。'}
                </p>
              </div>
              <Switch
                aria-label="Inject local Ollama model"
                checked={injectLocalModel}
                onCheckedChange={setInjectLocalModel}
              />
            </div>

            {injectLocalModel && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">选择 Ollama 模型</label>
                {availableModels.length === 0 ? (
                  <div
                    className="text-xs text-destructive"
                    data-testid="openclaw-local-model-empty"
                  >
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
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  OpenClaw 将使用该本地模型进行推理和工具调用。
                </p>
              </div>
            )}
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

          {mode === 'manage' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDashboard}
                disabled={isLoading}
                className="gap-1"
              >
                <IconExternalLink size={14} />
                打开 OpenClaw 控制台
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={isLoading || requiresModel}
                className="gap-1"
              >
                <IconDeviceFloppy size={14} />
                保存
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAndRestart}
                disabled={isLoading || requiresModel}
                className="gap-1"
              >
                {isLoading ? (
                  <IconLoader2 size={14} className="animate-spin" />
                ) : (
                  <IconRotateClockwise size={14} />
                )}
                保存并重启
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isLoading || requiresModel}
              className="gap-1"
            >
              {isLoading ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconPlayerPlay size={14} />
              )}
              确认启动
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
