import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { TelegramWizard as TelegramWizardDialog } from '@/containers/dialogs/TelegramWizardDialog'
import { WhatsAppWizardDialog, WhatsAppConfig } from '@/containers/dialogs/WhatsAppWizardDialog'
import { DiscordWizardDialog, DiscordConfig } from '@/containers/dialogs/DiscordWizardDialog'
import { AddChannelDialog, ChannelType } from '@/containers/dialogs/AddChannelDialog'
import { TailscaleSetupDialog } from '@/containers/dialogs/TailscaleSetupDialog'
import { SecurityConfigDialog } from '@/containers/dialogs/SecurityConfigDialog'
import { TunnelSelectionDialog } from '@/containers/dialogs/TunnelSelectionDialog'
import { ChannelCard, TelegramConfig as ChannelTelegramConfig, WhatsAppConfig as ChannelWhatsAppConfig, DiscordConfig as ChannelDiscordConfig } from '@/containers/ChannelCard'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { setOpenClawRunningState } from '@/utils/openclaw'
import {
  IconPlugConnected,
  IconLink,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconCopy,
  IconExternalLink,
} from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.remote_access as any)({
  component: RemoteAccess,
})

// OpenClaw Status types (mirroring Rust backend)
interface OpenClawStatus {
  installed: boolean
  running: boolean
  node_version: string | null
  openclaw_version: string | null
  port_available: boolean
  error: string | null
}

interface InstallResult {
  success: boolean
  version: string | null
  error: string | null
}

// Telegram configuration
interface TelegramConfig {
  bot_token: string
  bot_username: string | null
  connected: boolean
  pairing_code: string | null
  paired_users: number
}


const OPENCLAW_PORT = 18789

// Tunnel types (mirroring Rust backend)
type TunnelProvider = 'none' | 'tailscale' | 'ngrok' | 'cloudflare' | 'localonly'

interface TunnelInfo {
  provider: TunnelProvider
  url: string
  started_at: string
  port: number
  is_public: boolean
}

interface TunnelProvidersStatus {
  tailscale: { installed: boolean; authenticated: boolean; version: string | null }
  ngrok: { installed: boolean; authenticated: boolean; version: string | null }
  cloudflare: { installed: boolean; authenticated: boolean; version: string | null }
  active_provider: TunnelProvider
  active_tunnel: TunnelInfo | null
}

interface SecurityStatus {
  auth_mode: 'token' | 'password' | 'none'
  has_token: boolean
  has_password: boolean
  require_pairing: boolean
  approved_device_count: number
  recent_auth_failures: number
}

// Convert backend config types to ChannelCard types
const convertTelegramConfig = (config: TelegramConfig | null): ChannelTelegramConfig | null => {
  if (!config) return null
  return {
    bot_token: config.bot_token,
    bot_username: config.bot_username,
    connected: config.connected,
    pairing_code: config.pairing_code,
    paired_users: config.paired_users,
  }
}

const convertWhatsAppConfig = (config: WhatsAppConfig | null): ChannelWhatsAppConfig | null => {
  if (!config) return null
  return {
    account_id: config.account_id,
    session_path: config.session_path,
    connected: config.connected,
    phone_number: config.phone_number,
    qr_code: config.qr_code,
    contacts_count: config.contacts_count,
  }
}

const convertDiscordConfig = (config: DiscordConfig | null): ChannelDiscordConfig | null => {
  if (!config) return null
  return {
    account_id: config.account_id,
    bot_token: config.bot_token,
    bot_username: config.bot_username,
    bot_discriminator: config.bot_discriminator,
    connected: config.connected,
    guilds_count: config.guilds_count,
    channels_count: config.channels_count,
  }
}

function RemoteAccess() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<OpenClawStatus | null>(null)
  const [, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isTelegramWizardOpen, setIsTelegramWizardOpen] = useState(false)
  const [isWhatsAppWizardOpen, setIsWhatsAppWizardOpen] = useState(false)
  const [isDiscordWizardOpen, setIsDiscordWizardOpen] = useState(false)
  const [isAddChannelDialogOpen, setIsAddChannelDialogOpen] = useState(false)
  const [isTailscaleDialogOpen, setIsTailscaleDialogOpen] = useState(false)
  const [isSecurityDialogOpen, setIsSecurityDialogOpen] = useState(false)
  const [isTunnelDialogOpen, setIsTunnelDialogOpen] = useState(false)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelProvidersStatus | null>(null)
  const [, setSecurityStatus] = useState<SecurityStatus | null>(null)
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null)
  const [whatsappConfig, setWhatsAppConfig] = useState<WhatsAppConfig | null>(null)
  const [discordConfig, setDiscordConfig] = useState<DiscordConfig | null>(null)

  // Fetch status on mount
  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      const statusData = await invoke<OpenClawStatus>('openclaw_status')
      setStatus(statusData)

      // If OpenClaw is running, ensure Jan's origin is configured for WebSocket access
      // This handles cases where OpenClaw was started externally
      if (statusData.running) {
        await invoke('openclaw_ensure_jan_origin').catch((err) => {
          console.debug('Failed to ensure Jan origin (may be expected):', err)
        })
      }
    } catch (error) {
      console.error('Failed to fetch OpenClaw status:', error)
      toast.error(t('settings:remoteAccess.startError'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Fetch Telegram config on mount
  const fetchTelegramConfig = useCallback(async () => {
    try {
      const config = await invoke<TelegramConfig>('telegram_get_config')
      setTelegramConfig(config)
    } catch (error) {
      console.error('Failed to fetch Telegram config:', error)
    }
  }, [])

  useEffect(() => {
    fetchTelegramConfig()
  }, [fetchTelegramConfig])

  const handleTelegramWizardConnected = useCallback((config: TelegramConfig) => {
    setTelegramConfig(config)
  }, [])

  const handleWhatsAppWizardConnected = useCallback((config: WhatsAppConfig) => {
    setWhatsAppConfig(config)
  }, [])

  // Fetch Discord config on mount
  const fetchDiscordConfig = useCallback(async () => {
    try {
      const config = await invoke<DiscordConfig>('discord_get_config')
      setDiscordConfig(config)
    } catch (error) {
      console.error('Failed to fetch Discord config:', error)
    }
  }, [])

  useEffect(() => {
    fetchDiscordConfig()
  }, [fetchDiscordConfig])

  const handleDiscordWizardConnected = useCallback((config: DiscordConfig) => {
    setDiscordConfig(config)
  }, [])

  // Fetch WhatsApp config on mount
  const fetchWhatsAppConfig = useCallback(async () => {
    try {
      const config = await invoke<WhatsAppConfig>('whatsapp_get_config')
      setWhatsAppConfig(config)
    } catch (error) {
      console.error('Failed to fetch WhatsApp config:', error)
    }
  }, [])

  useEffect(() => {
    fetchWhatsAppConfig()
  }, [fetchWhatsAppConfig])

  // Fetch tunnel status on mount
  const fetchTunnelStatus = useCallback(async () => {
    try {
      const tunnelData = await invoke<TunnelProvidersStatus>('tunnel_get_providers')
      setTunnelStatus(tunnelData)
    } catch (error) {
      console.error('Failed to fetch tunnel status:', error)
    }
  }, [])

  useEffect(() => {
    fetchTunnelStatus()
  }, [fetchTunnelStatus])

  // Fetch security status on mount
  const fetchSecurityStatus = useCallback(async () => {
    try {
      const securityData = await invoke<SecurityStatus>('security_get_status')
      setSecurityStatus(securityData)
    } catch (error) {
      console.error('Failed to fetch security status:', error)
    }
  }, [])

  useEffect(() => {
    fetchSecurityStatus()
  }, [fetchSecurityStatus])

  // Refresh all status data
  const refreshAllStatus = useCallback(async () => {
    await Promise.all([
      fetchStatus(),
      fetchTunnelStatus(),
      fetchSecurityStatus(),
    ])
  }, [fetchStatus, fetchTunnelStatus, fetchSecurityStatus])

  // Copy URL to clipboard
  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url)
    toast.success(t('settings:remoteAccess.urlCopied'))
  }, [t])

  // Get display name for tunnel provider
  const getTunnelProviderName = (provider: TunnelProvider): string => {
    switch (provider) {
      case 'tailscale':
        return 'Tailscale'
      case 'ngrok':
        return 'ngrok'
      case 'cloudflare':
        return 'Cloudflare Tunnel'
      case 'localonly':
        return t('settings:remoteAccess.localNetworkOnly')
      case 'none':
      default:
        return t('settings:remoteAccess.notConfigured')
    }
  }

  const handleStart = async () => {
    try {
      setIsStarting(true)
      await invoke('openclaw_start')
      // Update the OpenClaw running cache immediately so model sync works
      setOpenClawRunningState(true)
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
      // Update the OpenClaw running cache immediately
      setOpenClawRunningState(false)
      toast.success(t('settings:remoteAccess.stopped'))
      await fetchStatus()
    } catch (error) {
      console.error('Failed to stop OpenClaw:', error)
      toast.error(t('settings:remoteAccess.stopError'))
    } finally {
      setIsStopping(false)
    }
  }

  const handleInstall = async () => {
    try {
      setIsInstalling(true)
      const result = await invoke<InstallResult>('openclaw_install')
      if (result.success) {
        // Install now auto-configures and starts the Gateway
        setOpenClawRunningState(true)
        toast.success(t('settings:remoteAccess.backendInstallSuccess'))
        await fetchStatus()
      } else {
        toast.error(result.error || t('settings:remoteAccess.installError'))
      }
    } catch (error) {
      console.error('Failed to install OpenClaw:', error)
      toast.error(t('settings:remoteAccess.installError'))
    } finally {
      setIsInstalling(false)
    }
  }

  const getChannelName = (channel: string): string => {
    switch (channel) {
      case 'telegram':
        return t('settings:remoteAccess.telegram')
      case 'whatsapp':
        return t('settings:remoteAccess.whatsapp')
      case 'discord':
        return t('settings:remoteAccess.discord')
      default:
        return channel
    }
  }

  // Channel management handlers
  const handleAddChannel = (channel: ChannelType) => {
    switch (channel) {
      case 'telegram':
        setIsTelegramWizardOpen(true)
        break
      case 'whatsapp':
        setIsWhatsAppWizardOpen(true)
        break
      case 'discord':
        setIsDiscordWizardOpen(true)
        break
    }
  }

  const handleChannelSettings = (channel: ChannelType) => {
    handleAddChannel(channel)
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
        case 'discord':
          await invoke('discord_disconnect')
          setDiscordConfig(null)
          break
      }
      toast.success(
        t('settings:remoteAccess.channelDisconnected', { channel: getChannelName(channel) })
      )
    } catch (error) {
      console.error(`Failed to disconnect ${channel}:`, error)
      toast.error(t('settings:remoteAccess.disconnectError'))
    }
  }

  // Get connected channels list
  const getConnectedChannels = (): ChannelType[] => {
    const channels: ChannelType[] = []
    if (telegramConfig?.connected) channels.push('telegram')
    if (whatsappConfig?.connected) channels.push('whatsapp')
    if (discordConfig?.connected) channels.push('discord')
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
            <Card title={t('settings:remoteAccess.status')}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isRunning ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-foreground font-medium">
                  {isRunning
                    ? t('settings:remoteAccess.enabled')
                    : t('settings:remoteAccess.disabled')}
                </span>
              </div>
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
                            (whatsappConfig?.contacts_count ?? 0) +
                            (discordConfig?.guilds_count ?? 0)
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
                  actions={
                    <span className="text-foreground">{status.node_version}</span>
                  }
                />
              )}
              {status?.openclaw_version && (
                <CardItem
                  title={t('settings:remoteAccess.openclawVersion')}
                  actions={
                    <span className="text-foreground">
                      {status.openclaw_version}
                    </span>
                  }
                />
              )}
            </Card>

            {/* Quick Setup Card */}
            <Card title={t('settings:remoteAccess.quickSetup')}>
              {/* Enable/Disable Remote Access */}
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
                          {isStopping ? (
                            <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
                          ) : (
                            <IconPlayerStop className="mr-2 h-4 w-4" />
                          )}
                          {t('settings:remoteAccess.stop')}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleStart}
                          disabled={isStarting}
                        >
                          {isStarting ? (
                            <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
                          ) : (
                            <IconPlayerPlay className="mr-2 h-4 w-4" />
                          )}
                          {t('settings:remoteAccess.start')}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleInstall}
                        disabled={isInstalling}
                      >
                        {isInstalling ? (
                          <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
                        ) : (
                          <IconPlugConnected className="mr-2 h-4 w-4" />
                        )}
                        {t('settings:remoteAccess.install')}
                      </Button>
                    )}
                  </div>
                }
              />

              {/* Connect Channels - New Unified Channel Management */}
              <CardItem
                title={t('settings:remoteAccess.channels')}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddChannelDialogOpen(true)}
                  >
                    <IconPlus className="mr-2 h-4 w-4" />
                    {t('settings:remoteAccess.addChannel.title')}
                  </Button>
                }
              />

              {/* Channel Cards */}
              <div className="space-y-3 mt-4">
                <ChannelCard
                  type="telegram"
                  config={convertTelegramConfig(telegramConfig)}
                  onSettings={() => handleChannelSettings('telegram')}
                  onDisconnect={() => handleDisconnectChannel('telegram')}
                />
                <ChannelCard
                  type="whatsapp"
                  config={convertWhatsAppConfig(whatsappConfig)}
                  onSettings={() => handleChannelSettings('whatsapp')}
                  onDisconnect={() => handleDisconnectChannel('whatsapp')}
                />
                <ChannelCard
                  type="discord"
                  config={convertDiscordConfig(discordConfig)}
                  onSettings={() => handleChannelSettings('discord')}
                  onDisconnect={() => handleDisconnectChannel('discord')}
                />
              </div>

              {/* Share Access */}
              <CardItem
                title={t('settings:remoteAccess.shareAccess')}
                actions={
                  <Button variant="outline" size="sm">
                    <IconLink className="mr-2 h-4 w-4" />
                    {t('settings:remoteAccess.generateInviteLink')}
                  </Button>
                }
              />
            </Card>

            {/* Active Tunnel Status Card */}
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

      {/* Telegram Wizard Dialog */}
      <TelegramWizardDialog
        isOpen={isTelegramWizardOpen}
        onOpenChange={setIsTelegramWizardOpen}
        onConnected={handleTelegramWizardConnected}
      />

      {/* WhatsApp Wizard Dialog */}
      <WhatsAppWizardDialog
        isOpen={isWhatsAppWizardOpen}
        onOpenChange={setIsWhatsAppWizardOpen}
        onConnected={handleWhatsAppWizardConnected}
      />

      {/* Discord Wizard Dialog */}
      <DiscordWizardDialog
        isOpen={isDiscordWizardOpen}
        onOpenChange={setIsDiscordWizardOpen}
        onConnected={handleDiscordWizardConnected}
      />

      {/* Add Channel Dialog */}
      <AddChannelDialog
        isOpen={isAddChannelDialogOpen}
        onOpenChange={setIsAddChannelDialogOpen}
        onSelectChannel={handleAddChannel}
        connectedChannels={getConnectedChannels()}
      />

      {/* Tailscale Setup Dialog */}
      <TailscaleSetupDialog
        isOpen={isTailscaleDialogOpen}
        onClose={() => setIsTailscaleDialogOpen(false)}
        onSuccess={refreshAllStatus}
      />

      {/* Security Config Dialog */}
      <SecurityConfigDialog
        isOpen={isSecurityDialogOpen}
        onClose={() => setIsSecurityDialogOpen(false)}
        onSave={refreshAllStatus}
      />

      {/* Tunnel Selection Dialog */}
      <TunnelSelectionDialog
        isOpen={isTunnelDialogOpen}
        onClose={() => setIsTunnelDialogOpen(false)}
        onTailscaleSetup={() => {
          setIsTunnelDialogOpen(false)
          setIsTailscaleDialogOpen(true)
        }}
        onSave={refreshAllStatus}
      />
    </div>
  )
}