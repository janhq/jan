import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  IconLoader2,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconCopy,
  IconRefresh,
  IconPlayerPlay,
  IconPlayerStop,
  IconAlertCircle,
} from '@tabler/icons-react'

// Types mirroring Rust backend
type TunnelProvider = 'none' | 'tailscale' | 'ngrok' | 'cloudflare' | 'localonly'

interface TunnelProviderStatus {
  provider: TunnelProvider
  installed: boolean
  authenticated: boolean
  version: string | null
  error: string | null
}

interface TunnelProvidersStatus {
  tailscale: TunnelProviderStatus
  ngrok: TunnelProviderStatus
  cloudflare: TunnelProviderStatus
  active_provider: TunnelProvider
  active_tunnel: TunnelInfo | null
}

interface TunnelInfo {
  provider: TunnelProvider
  url: string
  started_at: string
  port: number
  is_public: boolean
}

interface TunnelConfig {
  preferred_provider: TunnelProvider
  ngrok_auth_token: string | null
  cloudflare_tunnel_id: string | null
  auto_start: boolean
}

interface TunnelSelectionDialogProps {
  isOpen: boolean
  onClose: () => void
  onTailscaleSetup?: () => void
  onSave?: () => void
}

interface ProviderCardProps {
  provider: TunnelProvider
  name: string
  description: string
  features: string[]
  status: TunnelProviderStatus | null
  selected: boolean
  onSelect: () => void
  installUrl?: string
  isLoading?: boolean
  children?: React.ReactNode
}

function ProviderCard({
  provider,
  name,
  description,
  features,
  status,
  selected,
  onSelect,
  installUrl,
  isLoading,
  children,
}: ProviderCardProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(selected)

  useEffect(() => {
    if (selected) {
      setIsExpanded(true)
    }
  }, [selected])

  const isInstalled = status?.installed ?? false

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all cursor-pointer',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div
            className={cn(
              'w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center',
              selected ? 'border-primary bg-primary' : 'border-muted-foreground'
            )}
          >
            {selected && <IconCheck size={10} className="text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-foreground">{name}</h3>
              {provider !== 'none' && provider !== 'localonly' && (
                <div className="flex items-center gap-1.5">
                  {isLoading ? (
                    <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : isInstalled ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-muted-foreground">
                        {status?.version || t('settings:tunnel.installed')}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs text-muted-foreground">
                        {t('settings:tunnel.notInstalled')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
            {features.length > 0 && (
              <ul className="mt-2 space-y-1">
                {features.map((feature, index) => (
                  <li
                    key={index}
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                  >
                    <span className="text-primary">-</span>
                    {feature}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Expandable configuration section */}
      {selected && children && (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger
            className="flex items-center gap-1 text-sm text-muted-foreground mt-3 hover:text-foreground transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <IconChevronDown
              size={16}
              className={cn(
                'transition-transform',
                isExpanded && 'rotate-180'
              )}
            />
            {t('settings:tunnel.configuration')}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div
              className="border-t border-border pt-3"
              onClick={(e) => e.stopPropagation()}
            >
              {!isInstalled && installUrl && (
                <div className="mb-3 p-3 bg-muted/50 rounded-md">
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('settings:tunnel.installRequired')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(installUrl, '_blank')}
                  >
                    <IconExternalLink size={14} className="mr-1.5" />
                    {t('settings:tunnel.installInstructions')}
                  </Button>
                </div>
              )}
              {children}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function TunnelSelectionDialog({
  isOpen,
  onClose,
  onTailscaleSetup,
  onSave,
}: TunnelSelectionDialogProps) {
  const { t } = useTranslation()

  // State
  const [providersStatus, setProvidersStatus] = useState<TunnelProvidersStatus | null>(null)
  // Config is used for initial state hydration
  const [, setConfig] = useState<TunnelConfig | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<TunnelProvider>('none')
  const [isDetecting, setIsDetecting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showStopConfirm, setShowStopConfirm] = useState(false)

  // Configuration inputs
  const [ngrokToken, setNgrokToken] = useState('')
  const [cloudflareTunnelId, setCloudflareTunnelId] = useState('')
  const [autoStart, setAutoStart] = useState(false)

  const fetchProvidersStatus = useCallback(async () => {
    try {
      setIsDetecting(true)
      const status = await invoke<TunnelProvidersStatus>('tunnel_get_providers')
      setProvidersStatus(status)
      if (status.active_provider) {
        setSelectedProvider(status.active_provider)
      }
    } catch (error) {
      console.error('Failed to fetch tunnel providers status:', error)
      toast.error(t('settings:tunnel.fetchStatusError'))
    } finally {
      setIsDetecting(false)
    }
  }, [t])

  const fetchConfig = useCallback(async () => {
    try {
      const tunnelConfig = await invoke<TunnelConfig>('tunnel_get_config')
      setConfig(tunnelConfig)
      setSelectedProvider(tunnelConfig.preferred_provider || 'none')
      setNgrokToken(tunnelConfig.ngrok_auth_token || '')
      setCloudflareTunnelId(tunnelConfig.cloudflare_tunnel_id || '')
      setAutoStart(tunnelConfig.auto_start)
    } catch (error) {
      console.error('Failed to fetch tunnel config:', error)
    }
  }, [])

  // Fetch providers status and config on open
  useEffect(() => {
    if (isOpen) {
      fetchProvidersStatus()
      fetchConfig()
    }
  }, [isOpen, fetchProvidersStatus, fetchConfig])

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setShowStopConfirm(false)
    }
  }, [isOpen])

  const handleDetectAll = useCallback(async () => {
    try {
      setIsDetecting(true)
      const status = await invoke<TunnelProvidersStatus>('tunnel_detect_all')
      setProvidersStatus(status)
      toast.success(t('settings:tunnel.detectionComplete'))
    } catch (error) {
      console.error('Failed to detect tunnel providers:', error)
      toast.error(t('settings:tunnel.detectionError'))
    } finally {
      setIsDetecting(false)
    }
  }, [t])

  const handleSelectProvider = useCallback(async (provider: TunnelProvider) => {
    setSelectedProvider(provider)
  }, [])

  const handleSaveNgrokToken = useCallback(async () => {
    if (!ngrokToken.trim()) {
      toast.error(t('settings:tunnel.ngrok.tokenRequired'))
      return
    }
    try {
      await invoke('tunnel_set_ngrok_token', { token: ngrokToken.trim() })
      toast.success(t('settings:tunnel.ngrok.tokenSaved'))
      await fetchProvidersStatus()
    } catch (error) {
      console.error('Failed to save ngrok token:', error)
      toast.error(t('settings:tunnel.ngrok.tokenSaveError'))
    }
  }, [ngrokToken, t, fetchProvidersStatus])

  const handleSaveCloudflareTunnel = useCallback(async () => {
    if (!cloudflareTunnelId.trim()) {
      toast.error(t('settings:tunnel.cloudflare.tunnelIdRequired'))
      return
    }
    try {
      await invoke('tunnel_set_cloudflare_tunnel', { tunnelId: cloudflareTunnelId.trim() })
      toast.success(t('settings:tunnel.cloudflare.tunnelIdSaved'))
      await fetchProvidersStatus()
    } catch (error) {
      console.error('Failed to save Cloudflare tunnel ID:', error)
      toast.error(t('settings:tunnel.cloudflare.tunnelIdSaveError'))
    }
  }, [cloudflareTunnelId, t, fetchProvidersStatus])

  const handleStartTunnel = useCallback(async () => {
    try {
      setIsStarting(true)
      await invoke('tunnel_set_provider', { provider: selectedProvider })
      await invoke('tunnel_start')
      toast.success(t('settings:tunnel.startSuccess'))
      await fetchProvidersStatus()
    } catch (error) {
      console.error('Failed to start tunnel:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(t('settings:tunnel.startError', { error: errorMsg }))
    } finally {
      setIsStarting(false)
    }
  }, [selectedProvider, t, fetchProvidersStatus])

  const handleStopTunnel = useCallback(async () => {
    try {
      setIsStopping(true)
      await invoke('tunnel_stop')
      toast.success(t('settings:tunnel.stopSuccess'))
      setShowStopConfirm(false)
      await fetchProvidersStatus()
    } catch (error) {
      console.error('Failed to stop tunnel:', error)
      toast.error(t('settings:tunnel.stopError'))
    } finally {
      setIsStopping(false)
    }
  }, [t, fetchProvidersStatus])

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true)
      await invoke('tunnel_set_provider', { provider: selectedProvider })
      toast.success(t('settings:tunnel.saved'))
      onSave?.()
      onClose()
    } catch (error) {
      console.error('Failed to save tunnel settings:', error)
      toast.error(t('settings:tunnel.saveError'))
    } finally {
      setIsSaving(false)
    }
  }, [selectedProvider, t, onSave, onClose])

  const handleCopyUrl = useCallback(() => {
    if (providersStatus?.active_tunnel?.url) {
      navigator.clipboard.writeText(providersStatus.active_tunnel.url)
      toast.success(t('settings:tunnel.urlCopied'))
    }
  }, [providersStatus?.active_tunnel?.url, t])

  const activeTunnel = providersStatus?.active_tunnel
  const hasTunnelRunning = !!activeTunnel

  // Get provider status helper
  const getProviderStatus = (provider: TunnelProvider): TunnelProviderStatus | null => {
    if (!providersStatus) return null
    switch (provider) {
      case 'tailscale':
        return providersStatus.tailscale
      case 'ngrok':
        return providersStatus.ngrok
      case 'cloudflare':
        return providersStatus.cloudflare
      default:
        return null
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('settings:tunnel.title')}</DialogTitle>
          <DialogDescription>
            {t('settings:tunnel.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Active Tunnel Status */}
        {hasTunnelRunning && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <div>
                  <p className="font-medium text-foreground">
                    {t('settings:tunnel.activeStatus')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('settings:tunnel.provider')}: {activeTunnel.provider}
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopConfirm(true)}
                disabled={isStopping}
              >
                {isStopping ? (
                  <IconLoader2 className="animate-spin mr-1.5 h-4 w-4" />
                ) : (
                  <IconPlayerStop className="mr-1.5 h-4 w-4" />
                )}
                {t('settings:tunnel.stop')}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={activeTunnel.url}
                readOnly
                className="font-mono text-sm bg-background"
              />
              <Button variant="outline" size="icon" onClick={handleCopyUrl}>
                <IconCopy size={16} />
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                {t('settings:tunnel.port')}: {activeTunnel.port}
              </span>
              <span>
                {activeTunnel.is_public
                  ? t('settings:tunnel.publicAccess')
                  : t('settings:tunnel.privateAccess')}
              </span>
            </div>
          </div>
        )}

        {/* Stop Confirmation */}
        {showStopConfirm && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <IconAlertCircle className="text-destructive shrink-0 mt-0.5" size={20} />
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  {t('settings:tunnel.stopConfirmTitle')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings:tunnel.stopConfirmDescription')}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleStopTunnel}
                    disabled={isStopping}
                  >
                    {isStopping && (
                      <IconLoader2 className="animate-spin mr-1.5 h-4 w-4" />
                    )}
                    {t('settings:tunnel.confirmStop')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowStopConfirm(false)}
                  >
                    {t('common:cancel')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detect Providers Button */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('settings:tunnel.selectProvider')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDetectAll}
            disabled={isDetecting}
          >
            {isDetecting ? (
              <IconLoader2 className="animate-spin mr-1.5 h-4 w-4" />
            ) : (
              <IconRefresh className="mr-1.5 h-4 w-4" />
            )}
            {t('settings:tunnel.detectProviders')}
          </Button>
        </div>

        {/* Provider Selection */}
        <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
          {/* None / Local Only */}
          <ProviderCard
            provider="none"
            name={t('settings:tunnel.providers.none.name')}
            description={t('settings:tunnel.providers.none.description')}
            features={[]}
            status={null}
            selected={selectedProvider === 'none' || selectedProvider === 'localonly'}
            onSelect={() => handleSelectProvider('none')}
          />

          {/* Tailscale */}
          <ProviderCard
            provider="tailscale"
            name={t('settings:tunnel.providers.tailscale.name')}
            description={t('settings:tunnel.providers.tailscale.description')}
            features={[
              t('settings:tunnel.providers.tailscale.feature1'),
              t('settings:tunnel.providers.tailscale.feature2'),
              t('settings:tunnel.providers.tailscale.feature3'),
            ]}
            status={getProviderStatus('tailscale')}
            selected={selectedProvider === 'tailscale'}
            onSelect={() => handleSelectProvider('tailscale')}
            installUrl="https://tailscale.com/download"
            isLoading={isDetecting}
          >
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('settings:tunnel.providers.tailscale.configInfo')}
              </p>
              {onTailscaleSetup && (
                <Button variant="outline" size="sm" onClick={onTailscaleSetup}>
                  <IconExternalLink size={14} className="mr-1.5" />
                  {t('settings:tunnel.providers.tailscale.openSetup')}
                </Button>
              )}
            </div>
          </ProviderCard>

          {/* ngrok */}
          <ProviderCard
            provider="ngrok"
            name={t('settings:tunnel.providers.ngrok.name')}
            description={t('settings:tunnel.providers.ngrok.description')}
            features={[
              t('settings:tunnel.providers.ngrok.feature1'),
              t('settings:tunnel.providers.ngrok.feature2'),
              t('settings:tunnel.providers.ngrok.feature3'),
            ]}
            status={getProviderStatus('ngrok')}
            selected={selectedProvider === 'ngrok'}
            onSelect={() => handleSelectProvider('ngrok')}
            installUrl="https://ngrok.com/download"
            isLoading={isDetecting}
          >
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  {t('settings:tunnel.providers.ngrok.authToken')}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={ngrokToken}
                    onChange={(e) => setNgrokToken(e.target.value)}
                    placeholder={t('settings:tunnel.providers.ngrok.tokenPlaceholder')}
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveNgrokToken}
                    disabled={!ngrokToken.trim()}
                  >
                    {t('common:save')}
                  </Button>
                </div>
              </div>
              <Button
                variant="link"
                size="sm"
                className="p-0 h-auto"
                onClick={() =>
                  window.open('https://dashboard.ngrok.com/get-started/your-authtoken', '_blank')
                }
              >
                <IconExternalLink size={14} className="mr-1" />
                {t('settings:tunnel.providers.ngrok.getToken')}
              </Button>
            </div>
          </ProviderCard>

          {/* Cloudflare */}
          <ProviderCard
            provider="cloudflare"
            name={t('settings:tunnel.providers.cloudflare.name')}
            description={t('settings:tunnel.providers.cloudflare.description')}
            features={[
              t('settings:tunnel.providers.cloudflare.feature1'),
              t('settings:tunnel.providers.cloudflare.feature2'),
              t('settings:tunnel.providers.cloudflare.feature3'),
            ]}
            status={getProviderStatus('cloudflare')}
            selected={selectedProvider === 'cloudflare'}
            onSelect={() => handleSelectProvider('cloudflare')}
            installUrl="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
            isLoading={isDetecting}
          >
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  {t('settings:tunnel.providers.cloudflare.tunnelId')}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={cloudflareTunnelId}
                    onChange={(e) => setCloudflareTunnelId(e.target.value)}
                    placeholder={t('settings:tunnel.providers.cloudflare.tunnelIdPlaceholder')}
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveCloudflareTunnel}
                    disabled={!cloudflareTunnelId.trim()}
                  >
                    {t('common:save')}
                  </Button>
                </div>
              </div>
              <Button
                variant="link"
                size="sm"
                className="p-0 h-auto"
                onClick={() =>
                  window.open('https://one.dash.cloudflare.com/', '_blank')
                }
              >
                <IconExternalLink size={14} className="mr-1" />
                {t('settings:tunnel.providers.cloudflare.openDashboard')}
              </Button>
            </div>
          </ProviderCard>
        </div>

        {/* Auto-start Toggle */}
        <div className="flex items-center justify-between py-2 border-t border-border">
          <div>
            <p className="font-medium text-foreground">
              {t('settings:tunnel.autoStart')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('settings:tunnel.autoStartDescription')}
            </p>
          </div>
          <Switch
            checked={autoStart}
            onCheckedChange={setAutoStart}
            disabled={selectedProvider === 'none'}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          {!hasTunnelRunning && selectedProvider !== 'none' && (
            <Button
              variant="secondary"
              onClick={handleStartTunnel}
              disabled={isStarting || !getProviderStatus(selectedProvider)?.installed}
            >
              {isStarting ? (
                <IconLoader2 className="animate-spin mr-1.5 h-4 w-4" />
              ) : (
                <IconPlayerPlay className="mr-1.5 h-4 w-4" />
              )}
              {t('settings:tunnel.startTunnel')}
            </Button>
          )}
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <IconLoader2 className="animate-spin mr-1.5 h-4 w-4" />}
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
