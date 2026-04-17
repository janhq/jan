/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useOllamaStatus } from '@/hooks/useOllamaStatus'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { IconRefresh } from '@tabler/icons-react'

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
})

function HubContent() {
  const {
    isRunning: ollamaRunning,
    isInstalled: ollamaInstalled,
    version: ollamaVersion,
    models: ollamaModels,
    refresh: refreshOllama,
    isInstalling: ollamaInstalling,
    installProgress: ollamaInstallProgress,
    installMessage: ollamaInstallMessage,
    installOllama,
    startOllama,
  } = useOllamaStatus(5000)

  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full">
        <HeaderPage>
          <div className={cn("pr-3 py-3 h-10 w-full flex items-center relative z-20", !IS_MACOS && "pr-30")}>
            <span className="text-sm font-medium text-foreground">
              {t('common:inferenceCenter')}
            </span>
          </div>
        </HeaderPage>
        <div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">
          <div className="flex flex-col gap-4 gap-y-3 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* Ollama Status Card */}
            <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    ollamaRunning ? 'bg-green-500' : ollamaInstalling ? 'bg-yellow-500' : ollamaInstalled ? 'bg-orange-400' : 'bg-red-500'
                  )} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {ollamaRunning
                        ? 'Ollama 运行中'
                        : ollamaInstalling
                          ? '正在安装 Ollama...'
                          : ollamaInstalled
                            ? 'Ollama 已安装但未启动'
                            : 'Ollama 未安装'}
                    </span>
                    {ollamaRunning && (
                      <span className="text-xs text-muted-foreground">
                        版本 {ollamaVersion} · 已安装 {ollamaModels.length} 个模型
                      </span>
                    )}
                    {!ollamaRunning && !ollamaInstalling && ollamaInstalled && (
                      <span className="text-xs text-muted-foreground">
                        点击"启动 Ollama"按钮即可运行
                      </span>
                    )}
                    {!ollamaRunning && !ollamaInstalling && !ollamaInstalled && (
                      <span className="text-xs text-muted-foreground">
                        需要 Ollama 才能使用本地模型
                      </span>
                    )}
                    {ollamaInstalling && (
                      <span className="text-xs text-muted-foreground">
                        {ollamaInstallMessage}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!ollamaRunning && !ollamaInstalling && ollamaInstalled && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={startOllama}
                    >
                      启动 Ollama
                    </Button>
                  )}
                  {!ollamaRunning && !ollamaInstalling && !ollamaInstalled && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={installOllama}
                    >
                      一键安装
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={refreshOllama}
                    disabled={ollamaInstalling}
                  >
                    <IconRefresh size={16} className="text-muted-foreground" />
                  </Button>
                </div>
              </div>
              {ollamaInstalling && (
                <Progress value={ollamaInstallProgress} className="h-1.5" />
              )}
            </div>

            {/* Placeholder for more Ollama management features */}
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="text-base font-medium mb-2">
                推理中心
              </div>
              <div className="text-sm">
                更多 Ollama 管理功能开发中
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
