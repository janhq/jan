import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'
import { useOllamaStatus } from '@/hooks/useOllamaStatus'
import { useOpenClaw } from '@/hooks/useOpenClaw'
import { OpenClawCard } from '@/components/hub/OpenClawCard'
import { OpenClawConfigDialog } from '@/components/hub/OpenClawConfigDialog'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.openclaw.index as any)({
  component: OpenClawContent,
})

function OpenClawContent() {
  const { isRunning: ollamaRunning, models: ollamaModels } = useOllamaStatus(10000)

  const {
    status: openClawStatus,
    gatewayUrl: openClawGatewayUrl,
    isLoading: isOpenClawLoading,
    installProgress: openClawInstallProgress,
    installMessage: openClawInstallMessage,
    install: installOpenClaw,
    launch: launchOpenClaw,
    stop: stopOpenClaw,
  } = useOpenClaw(5000)

  const [openClawDialogOpen, setOpenClawDialogOpen] = useState(false)

  const handleStartOpenClaw = useCallback(() => {
    if (!ollamaRunning) {
      toast.error('请先启动 Ollama')
      return
    }
    if (ollamaModels.length === 0) {
      toast.error('没有可用的 Ollama 模型')
      return
    }
    setOpenClawDialogOpen(true)
  }, [ollamaRunning, ollamaModels.length])

  const handleConfirmOpenClawLaunch = useCallback(
    async (model: string) => {
      setOpenClawDialogOpen(false)
      await launchOpenClaw(model)
    },
    [launchOpenClaw]
  )

  const handleStopOpenClaw = useCallback(async () => {
    await stopOpenClaw()
  }, [stopOpenClaw])

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3 h-10 w-full flex items-center justify-between',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="text-sm font-medium text-foreground">
              OpenClaw 实例管理
            </span>
          </div>
        </HeaderPage>

        <div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">
          <div className="flex flex-col gap-5 w-full md:w-4/5 xl:w-4/6 mx-auto">
            <OpenClawCard
              status={openClawStatus}
              gatewayUrl={openClawGatewayUrl}
              boundModel={
                openClawStatus === 'running' ? ollamaModels[0]?.name : undefined
              }
              installProgress={openClawInstallProgress}
              installMessage={openClawInstallMessage}
              onInstall={installOpenClaw}
              onStart={handleStartOpenClaw}
              onStop={handleStopOpenClaw}
              isLoading={isOpenClawLoading}
            />
          </div>
        </div>
      </div>

      <OpenClawConfigDialog
        open={openClawDialogOpen}
        onOpenChange={setOpenClawDialogOpen}
        availableModels={ollamaModels.map((m) => m.name)}
        defaultModel={ollamaModels[0]?.name}
        onConfirm={handleConfirmOpenClawLaunch}
        isLoading={isOpenClawLoading}
      />
    </div>
  )
}
