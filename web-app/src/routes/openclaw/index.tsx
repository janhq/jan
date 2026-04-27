import { useCallback, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { OpenClawCard } from '@/components/hub/OpenClawCard'
import {
  OpenClawConfigDialog,
  type OpenClawDialogConfig,
} from '@/components/hub/OpenClawConfigDialog'
import { OpenClawConfigSummary } from '@/components/hub/OpenClawConfigSummary'
import HeaderPage from '@/containers/HeaderPage'
import { route } from '@/constants/routes'
import { useOllamaStatus } from '@/hooks/useOllamaStatus'
import { useOpenClaw } from '@/hooks/useOpenClaw'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.openclaw.index as any)({
  component: OpenClawContent,
})

function OpenClawContent() {
  const { models: ollamaModels } = useOllamaStatus(10000)
  const {
    status: openClawStatus,
    gatewayUrl: openClawGatewayUrl,
    version: openClawVersion,
    runtimeSummary,
    diagnostics,
    isLoading: isOpenClawLoading,
    installProgress: openClawInstallProgress,
    installMessage: openClawInstallMessage,
    errorMessage: openClawErrorMessage,
    install: installOpenClaw,
    launch: launchOpenClaw,
    stop: stopOpenClaw,
    restart: restartOpenClaw,
    saveConfig: saveOpenClawConfig,
    openDashboard: openOpenClawDashboard,
    refresh: refreshOpenClaw,
  } = useOpenClaw(5000)

  const [openClawDialogOpen, setOpenClawDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'launch' | 'manage'>('launch')

  const fallbackModel = runtimeSummary.selectedModel ?? ollamaModels[0]?.name
  const injectLocalModel = runtimeSummary.launchMode === 'local-ollama-injected'
  const isTransitioning = openClawStatus === 'starting' || openClawStatus === 'stopping'
  const serviceStatus = diagnostics.serviceLoaded
    ? diagnostics.serviceRuntimeStatus || 'unknown'
    : 'service missing'
  const rpcStatus = diagnostics.rpcOk
    ? 'ready'
    : diagnostics.rpcError
      ? `down: ${diagnostics.rpcError}`
      : 'down'
  const configStatus = diagnostics.configValid
    ? diagnostics.cliConfigExists || diagnostics.daemonConfigExists
      ? 'valid'
      : 'missing'
    : 'invalid'

  const handleStartOpenClaw = useCallback(() => {
    setDialogMode('launch')
    setOpenClawDialogOpen(true)
  }, [])

  const handleManageOpenClaw = useCallback(() => {
    setDialogMode('manage')
    setOpenClawDialogOpen(true)
  }, [])

  const handleConfirmOpenClawLaunch = useCallback(
    async (model?: string) => {
      setOpenClawDialogOpen(false)
      await launchOpenClaw(model)
    },
    [launchOpenClaw]
  )

  const handleStopOpenClaw = useCallback(async () => {
    await stopOpenClaw()
  }, [stopOpenClaw])

  const handleRestartOpenClaw = useCallback(async () => {
    await restartOpenClaw()
  }, [restartOpenClaw])

  const handleSaveOpenClawConfig = useCallback(
    (config: OpenClawDialogConfig) => {
      saveOpenClawConfig(config)
    },
    [saveOpenClawConfig]
  )

  const handleSaveAndRestartOpenClaw = useCallback(
    async (config: OpenClawDialogConfig) => {
      saveOpenClawConfig(config)
      await restartOpenClaw(config)
    },
    [restartOpenClaw, saveOpenClawConfig]
  )

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
            <span className="text-sm font-medium text-foreground">OpenClaw 实例管理</span>
          </div>
        </HeaderPage>

        <div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">
          <div className="flex flex-col gap-5 w-full md:w-4/5 xl:w-4/6 mx-auto">
            <OpenClawCard
              status={openClawStatus}
              version={openClawVersion}
              gatewayUrl={openClawGatewayUrl}
              installProgress={openClawInstallProgress}
              installMessage={openClawErrorMessage ?? openClawInstallMessage}
              serviceStatus={serviceStatus}
              rpcStatus={rpcStatus}
              configStatus={configStatus}
              onInstall={installOpenClaw}
              onStart={handleStartOpenClaw}
              onStop={handleStopOpenClaw}
              onRestart={handleRestartOpenClaw}
              onOpenDashboard={openOpenClawDashboard}
              onConfigure={handleManageOpenClaw}
              onRefresh={refreshOpenClaw}
              isLoading={isOpenClawLoading}
            />

            <OpenClawConfigSummary
              launchMode={runtimeSummary.launchMode}
              selectedModel={runtimeSummary.selectedModel}
              gatewayPort={runtimeSummary.gatewayPort}
              onOpenDashboard={openOpenClawDashboard}
              isActionDisabled={isTransitioning}
            />
          </div>
        </div>
      </div>

      <OpenClawConfigDialog
        open={openClawDialogOpen}
        onOpenChange={setOpenClawDialogOpen}
        availableModels={ollamaModels.map((model) => model.name)}
        defaultModel={fallbackModel}
        mode={dialogMode}
        gatewayPort={runtimeSummary.gatewayPort}
        initialInjectLocalModel={injectLocalModel}
        onConfirm={handleConfirmOpenClawLaunch}
        onSave={handleSaveOpenClawConfig}
        onSaveAndRestart={handleSaveAndRestartOpenClaw}
        onOpenDashboard={openOpenClawDashboard}
        isLoading={isOpenClawLoading}
      />
    </div>
  )
}
