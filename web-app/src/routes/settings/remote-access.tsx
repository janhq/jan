import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { TelegramWizard as TelegramWizardDialog } from '@/containers/dialogs/TelegramWizardDialog'
import { WhatsAppWizardDialog } from '@/containers/dialogs/WhatsAppWizardDialog'
import { AddChannelDialog } from '@/containers/dialogs/AddChannelDialog'
import { TailscaleSetupDialog } from '@/containers/dialogs/TailscaleSetupDialog'
import { SecurityConfigDialog } from '@/containers/dialogs/SecurityConfigDialog'
import { TunnelSelectionDialog } from '@/containers/dialogs/TunnelSelectionDialog'
import { EnableProgressDialog } from '@/containers/dialogs/EnableProgressDialog'
import { ChannelCard } from '@/containers/ChannelCard'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { setOpenClawRunningState, syncAllModelsToOpenClaw } from '@/utils/openclaw'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  IconPlugConnected,
  IconLink,
  IconLoader2,
  IconPlus,
  IconCopy,
  IconExternalLink,
} from '@tabler/icons-react'
import type {
  ChannelType,
  TelegramConfig,
  WhatsAppConfig,
  OpenClawStatus,
  TunnelProvider,
  TunnelProvidersStatus,
  SecurityStatus,
} from '@/types/openclaw'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.remote_access as any)({
  component: RemoteAccess,
})

// const OPENCLAW_PORT = 18789

function RemoteAccess() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<OpenClawStatus | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isTelegramWizardOpen, setIsTelegramWizardOpen] = useState(false)
  const [isWhatsAppWizardOpen, setIsWhatsAppWizardOpen] = useState(false)
  const [isAddChannelDialogOpen, setIsAddChannelDialogOpen] = useState(false)
  const [isTailscaleDialogOpen, setIsTailscaleDialogOpen] = useState(false)
  const [isSecurityDialogOpen, setIsSecurityDialogOpen] = useState(false)
  const [isTunnelDialogOpen, setIsTunnelDialogOpen] = useState(false)
  const [isEnableDialogOpen, setIsEnableDialogOpen] = useState(false)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelProvidersStatus | null>(null)
  const [, setSecurityStatus] = useState<SecurityStatus | null>(null)
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null)
  const [whatsappConfig, setWhatsAppConfig] = useState<WhatsAppConfig | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const statusData = await invoke<OpenClawStatus>('openclaw_status')
      setStatus(statusData)

      // Ensure Jan's origin is configured when OpenClaw was started externally
      if (statusData.running) {
        await invoke('openclaw_ensure_jan_origin').catch(() => {})
      }
    } catch {
      toast.error(t('settings:remoteAccess.startError'))
    }
  }, [t])

  const fetchTelegramConfig = useCallback(async () => {
    try {
      const config = await invoke<TelegramConfig>('telegram_get_config')
      setTelegramConfig(config)
    } catch {
      // Telegram may not be configured yet
    }
  }, [])

  const fetchWhatsAppConfig = useCallback(async () => {
    try {
      const config = await invoke<WhatsAppConfig>('whatsapp_get_config')
      setWhatsAppConfig(config)
    } catch {
      // WhatsApp may not be configured yet
    }
  }, [])

  const fetchTunnelStatus = useCallback(async () => {
    try {
      const tunnelData = await invoke<TunnelProvidersStatus>('tunnel_get_providers')
      setTunnelStatus(tunnelData)
    } catch {
      // Tunnel providers may not be available
    }
  }, [])

  const fetchSecurityStatus = useCallback(async () => {
    try {
      const securityData = await invoke<SecurityStatus>('security_get_status')
      setSecurityStatus(securityData)
    } catch {
      // Security config may not be available
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchTelegramConfig()
    fetchWhatsAppConfig()
    fetchTunnelStatus()
    fetchSecurityStatus()
  }, [fetchStatus, fetchTelegramConfig, fetchWhatsAppConfig, fetchTunnelStatus, fetchSecurityStatus])

  const refreshAllStatus = useCallback(async () => {
    await Promise.all([fetchStatus(), fetchTunnelStatus(), fetchSecurityStatus()])
  }, [fetchStatus, fetchTunnelStatus, fetchSecurityStatus])

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url)
    toast.success(t('settings:remoteAccess.urlCopied'))
  }, [t])

  const getTunnelProviderName = (provider: TunnelProvider): string => {
    switch (provider) {
      case 'tailscale': return 'Tailscale'
      case 'ngrok': return 'ngrok'
      case 'cloudflare': return 'Cloudflare Tunnel'
      case 'localonly': return t('settings:remoteAccess.localNetworkOnly')
      default: return t('settings:remoteAccess.notConfigured')
    }
  }

  const bulkSyncModels = useCallback(async () => {
    const { providers, selectedModel } = useModelProvider.getState()
    await syncAllModelsToOpenClaw(providers, selectedModel?.id)
  }, [])

  const handleStart = async () => {
    try {
      setIsStarting(true)
      await invoke('openclaw_start')
      setOpenClawRunningState(true)
      await bulkSyncModels()
      toast.success(t('settings:remoteAccess.running'))
      await fetchStatus()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('Node.js')) {
        toast.error(t('settings:remoteAccess.nodeRequired'))
      } else if (errorMsg.includes('Port')) {
        toast.error(t('settings:remoteAccess.portInUse'))
      } else {
        toast.error(t('settings:remoteAccess.startError'))
      }
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      setIsStopping(true)
      await invoke('openclaw_stop')
      setOpenClawRunningState(false)
      setStatus((prev) => prev ? { ...prev, running: false } : prev)
      toast.success(t('settings:remoteAccess.stopped'))
    } catch {
      toast.error(t('settings:remoteAccess.stopError'))
    } finally {
      setIsStopping(false)
    }
  }

  const getChannelName = (channel: string): string => {
    switch (channel) {
      case 'telegram': return t('settings:remoteAccess.telegram')
      case 'whatsapp': return t('settings:remoteAccess.whatsapp')
      default: return channel
    }
  }

  const handleAddChannel = (channel: ChannelType) => {
    switch (channel) {
      case 'telegram': setIsTelegramWizardOpen(true); break
      case 'whatsapp': setIsWhatsAppWizardOpen(true); break
    }
  }

  const handleDisconnectChannel = async (channel: ChannelType) => {
    try {
      switch (channel) {
        case 'telegram':
          await invoke('telegram_disconnect')
          setTelegramConfig(null)
          break
        case 'whatsapp':
          await invoke('whatsapp_disconnect')
          setWhatsAppConfig(null)
          break
      }
      toast.success(
        t('settings:remoteAccess.channelDisconnected', { channel: getChannelName(channel) })
      )
    } catch {
      toast.error(t('settings:remoteAccess.disconnectError'))
    }
  }

  const getConnectedChannels = (): ChannelType[] => {
    const channels: ChannelType[] = []
    if (telegramConfig?.connected) channels.push('telegram')
    if (whatsappConfig?.connected) channels.push('whatsapp')
    return channels
  }

  const isRunning = status?.running ?? false
  const isInstalled = status?.installed ?? false

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Status Card */}
            {/* <Card title={t('settings:remoteAccess.title')}>
              <CardItem 
                title={t('settings:remoteAccess.status')}
                actions={
                  <div className="flex items-center gap-2">
                    <div
                      className={cn("size-2 rounded-full",
                        isRunning ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                    <span className="text-foreground font-medium">
                      {isRunning
                        ? t('settings:remoteAccess.enabled')
                        : t('settings:remoteAccess.disabled')}
                    </span>
                  </div>
                }
              />
              <CardItem
                title={t('settings:remoteAccess.activeChannels')}
                actions={
                  <span className="text-foreground">
                    {isRunning && getConnectedChannels().length > 0
                      ? getConnectedChannels()
                          .map((ch) => getChannelName(ch))
                          .join(', ')
                      : '-'}
                  </span>
                }
              />
              <CardItem
                title={t('settings:remoteAccess.connectedUsers')}
                actions={
                  <span className="text-foreground">
                    {isRunning
                      ? String(
                          (telegramConfig?.paired_users ?? 0) +
                            (whatsappConfig?.contacts_count ?? 0)
                        )
                      : '0'}
                  </span>
                }
              />
              <CardItem
                title={t('settings:remoteAccess.port')}
                actions={<span className="text-foreground">{OPENCLAW_PORT}</span>}
              />
              {status?.node_version && (
                <CardItem
                  title={t('settings:remoteAccess.nodeVersion')}
                  actions={<span className="text-foreground">{status.node_version}</span>}
                />
              )}
              {status?.openclaw_version && (
                <CardItem
                  title={t('settings:remoteAccess.openclawVersion')}
                  actions={<span className="text-foreground">{status.openclaw_version}</span>}
                />
              )}
            </Card> */}

            <Card title={t('settings:remoteAccess.quickSetup')}>
              <CardItem
                title={
                  isRunning
                    ? t('settings:remoteAccess.disableRemoteAccess')
                    : t('settings:remoteAccess.enableRemoteAccess')
                }
                actions={
                  <div className="flex items-center gap-2">
                    {isInstalled ? (
                      isRunning ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleStop}
                          disabled={isStopping}
                        >
                          {isStopping && <IconLoader2 className="animate-spin size-4" />}
                          {t('settings:remoteAccess.stop')}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={handleStart} disabled={isStarting}>
                          {isStarting && <IconLoader2 className="animate-spin size-4" />}
                          {t('settings:remoteAccess.start')}
                        </Button>
                      )
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setIsEnableDialogOpen(true)}>
                        <IconPlugConnected className="size-4 text-muted-foreground" />
                        {t('settings:remoteAccess.install')}
                      </Button>
                    )}
                  </div>
                }
              />

              <CardItem
                title={t('settings:remoteAccess.channels')}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddChannelDialogOpen(true)}
                  >
                    <IconPlus className="size-4 text-muted-foreground" />
                    {t('settings:remoteAccess.addChannel.title')}
                  </Button>
                }
              />

              <div className="space-y-3 mt-4">
                <ChannelCard
                  type="telegram"
                  config={telegramConfig}
                  onSettings={() => handleAddChannel('telegram')}
                  onDisconnect={() => handleDisconnectChannel('telegram')}
                  OCIsInstalled={isInstalled}
                />
                <ChannelCard
                  type="whatsapp"
                  config={whatsappConfig}
                  onSettings={() => handleAddChannel('whatsapp')}
                  onDisconnect={() => handleDisconnectChannel('whatsapp')}
                  OCIsInstalled={isInstalled}
                />
              </div>

              <CardItem
                title={t('settings:remoteAccess.shareAccess')}
                className='mt-5'
                actions={
                  <Button variant="outline" size="sm">
                    <IconLink className="size-4 text-muted-foreground" />
                    {t('settings:remoteAccess.generateInviteLink')}
                  </Button>
                }
              />
            </Card>

            {tunnelStatus?.active_tunnel && (
              <Card title={t('settings:remoteAccess.activeTunnel')}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-foreground font-medium">
                    {getTunnelProviderName(tunnelStatus.active_tunnel.provider)}
                  </span>
                  {tunnelStatus.active_tunnel.is_public && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/30">
                      {t('settings:remoteAccess.publicAccess')}
                    </span>
                  )}
                </div>
                <CardItem
                  title={t('settings:remoteAccess.tunnelUrl')}
                  actions={
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-foreground bg-secondary px-2 py-1 rounded max-w-[200px] truncate">
                        {tunnelStatus.active_tunnel.url}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleCopyUrl(tunnelStatus.active_tunnel!.url)}
                        title={t('settings:remoteAccess.copyUrl')}
                      >
                        <IconCopy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => window.open(tunnelStatus.active_tunnel!.url, '_blank')}
                        title={t('settings:remoteAccess.openUrl')}
                      >
                        <IconExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  }
                />
                <CardItem
                  title={t('settings:remoteAccess.port')}
                  actions={
                    <span className="text-foreground">{tunnelStatus.active_tunnel.port}</span>
                  }
                />
              </Card>
            )}
          </div>
        </div>
      </div>

      <TelegramWizardDialog
        isOpen={isTelegramWizardOpen}
        onOpenChange={setIsTelegramWizardOpen}
        onConnected={setTelegramConfig}
      />
      <WhatsAppWizardDialog
        isOpen={isWhatsAppWizardOpen}
        onOpenChange={setIsWhatsAppWizardOpen}
        onConnected={setWhatsAppConfig}
      />
      <AddChannelDialog
        isOpen={isAddChannelDialogOpen}
        onOpenChange={setIsAddChannelDialogOpen}
        onSelectChannel={handleAddChannel}
        connectedChannels={getConnectedChannels()}
      />
      <TailscaleSetupDialog
        isOpen={isTailscaleDialogOpen}
        onClose={() => setIsTailscaleDialogOpen(false)}
        onSuccess={refreshAllStatus}
      />
      <SecurityConfigDialog
        isOpen={isSecurityDialogOpen}
        onClose={() => setIsSecurityDialogOpen(false)}
        onSave={refreshAllStatus}
      />
      <TunnelSelectionDialog
        isOpen={isTunnelDialogOpen}
        onClose={() => setIsTunnelDialogOpen(false)}
        onTailscaleSetup={() => {
          setIsTunnelDialogOpen(false)
          setIsTailscaleDialogOpen(true)
        }}
        onSave={refreshAllStatus}
      />
      <EnableProgressDialog
        isOpen={isEnableDialogOpen}
        onOpenChange={setIsEnableDialogOpen}
        onSuccess={fetchStatus}
      />
    </div>
  )
}
