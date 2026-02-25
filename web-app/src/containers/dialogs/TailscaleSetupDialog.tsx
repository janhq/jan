import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  IconNetwork,
  IconCheck,
  IconX,
  IconArrowRight,
  IconArrowLeft,
  IconLoader2,
  IconAlertCircle,
  IconExternalLink,
  IconWorld,
  IconCopy,
  IconShieldLock,
} from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

// Types mirroring Rust backend
interface TailscaleStatus {
  installed: boolean
  running: boolean
  logged_in: boolean
  version: string | null
  error: string | null
}

interface TailscaleInfo {
  hostname: string | null
  tailnet: string | null
  ip_addresses: string[]
  dns_name: string | null
  serve_enabled: boolean
  funnel_enabled: boolean
  serve_url: string | null
}

interface TailscaleSetupDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

type WizardStep = 'detection' | 'configuration' | 'funnel' | 'success'

const TOTAL_STEPS = 4

export function TailscaleSetupDialog({
  isOpen,
  onClose,
  onSuccess,
}: TailscaleSetupDialogProps) {
  const [step, setStep] = useState<WizardStep>('detection')
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<TailscaleStatus | null>(null)
  const [info, setInfo] = useState<TailscaleInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isConfiguringServe, setIsConfiguringServe] = useState(false)
  const [isConfiguringFunnel, setIsConfiguringFunnel] = useState(false)

  const getStepNumber = (): number => {
    const stepMap: Record<WizardStep, number> = {
      detection: 1,
      configuration: 2,
      funnel: 3,
      success: 4,
    }
    return stepMap[step]
  }

  const fetchTailscaleInfo = useCallback(async () => {
    try {
      const result = await invoke<TailscaleInfo>('tailscale_get_status')
      setInfo(result)
    } catch (error) {
      console.error('Failed to fetch Tailscale info:', error)
    }
  }, [])

  const detectTailscale = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const result = await invoke<TailscaleStatus>('tailscale_detect')
      setStatus(result)

      if (result.error) {
        setErrorMessage(result.error)
      } else if (result.installed && result.running && result.logged_in) {
        // Tailscale is ready, fetch detailed info
        await fetchTailscaleInfo()
      }
    } catch (error) {
      console.error('Failed to detect Tailscale:', error)
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to detect Tailscale'
      )
    } finally {
      setIsLoading(false)
    }
  }, [fetchTailscaleInfo])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('detection')
      setIsLoading(false)
      setStatus(null)
      setInfo(null)
      setErrorMessage(null)
      setIsConfiguringServe(false)
      setIsConfiguringFunnel(false)
    }
  }, [isOpen])

  // Start detection when dialog opens
  useEffect(() => {
    if (isOpen) {
      detectTailscale()
    }
  }, [isOpen, detectTailscale])

  const handleConfigureServe = useCallback(
    async (enable: boolean) => {
      setIsConfiguringServe(true)
      try {
        if (enable) {
          await invoke('tailscale_configure_serve')
          toast.success('Tailscale Serve enabled')
        } else {
          await invoke('tailscale_remove_serve')
          toast.success('Tailscale Serve disabled')
        }
        await fetchTailscaleInfo()
      } catch (error) {
        console.error('Failed to configure Tailscale Serve:', error)
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to configure Tailscale Serve'
        )
      } finally {
        setIsConfiguringServe(false)
      }
    },
    [fetchTailscaleInfo]
  )

  const handleConfigureFunnel = useCallback(
    async (enable: boolean) => {
      setIsConfiguringFunnel(true)
      try {
        if (enable) {
          await invoke('tailscale_enable_funnel')
          toast.success('Tailscale Funnel enabled - Your endpoint is now publicly accessible')
        } else {
          await invoke('tailscale_disable_funnel')
          toast.success('Tailscale Funnel disabled')
        }
        await fetchTailscaleInfo()
      } catch (error) {
        console.error('Failed to configure Tailscale Funnel:', error)
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to configure Tailscale Funnel'
        )
      } finally {
        setIsConfiguringFunnel(false)
      }
    },
    [fetchTailscaleInfo]
  )

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url)
    toast.success('URL copied to clipboard')
  }, [])

  const handleOpenUrl = useCallback((url: string) => {
    window.open(url, '_blank')
  }, [])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSuccess = useCallback(() => {
    if (onSuccess) {
      onSuccess()
    }
    onClose()
  }, [onSuccess, onClose])

  const renderStepIndicator = () => {
    const currentStep = getStepNumber()
    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
              i + 1 < currentStep
                ? 'bg-green-500 text-white'
                : i + 1 === currentStep
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
            }`}
          >
            {i + 1 < currentStep ? <IconCheck size={16} /> : i + 1}
          </div>
        ))}
      </div>
    )
  }

  const renderDetectionStep = () => {
    return (
      <div className="space-y-4">
        <DialogDescription className="text-center">
          Checking Tailscale status on your system
        </DialogDescription>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <IconLoader2 className="animate-spin h-12 w-12 text-primary mb-4" />
            <p className="text-muted-foreground">Detecting Tailscale...</p>
          </div>
        ) : errorMessage ? (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <IconX size={32} className="text-red-500" />
            </div>
            <p className="text-red-500 text-center mb-4">{errorMessage}</p>
            <Button variant="outline" onClick={detectTailscale}>
              Try Again
            </Button>
          </div>
        ) : !status?.installed ? (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-4">
              <IconAlertCircle size={32} className="text-yellow-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              Tailscale Not Installed
            </h3>
            <p className="text-muted-foreground text-center mb-4 max-w-xs">
              Tailscale is required to securely share your OpenClaw endpoint
              across your network.
            </p>
            <div className="bg-secondary/50 rounded-lg p-4 w-full mb-4">
              <h4 className="font-medium text-sm mb-2">Installation Steps:</h4>
              <ol className="text-muted-foreground text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">1.</span>
                  Download Tailscale from the official website
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">2.</span>
                  Install and launch Tailscale
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">3.</span>
                  Sign in with your account
                </li>
              </ol>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                window.open('https://tailscale.com/download', '_blank')
              }
              className="gap-2"
            >
              <IconExternalLink size={16} />
              Download Tailscale
            </Button>
          </div>
        ) : !status?.running ? (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-4">
              <IconAlertCircle size={32} className="text-yellow-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Tailscale Not Running</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-xs">
              Tailscale is installed but not currently running. Please start
              Tailscale and try again.
            </p>
            <Button variant="outline" onClick={detectTailscale} className="gap-2">
              <IconLoader2 size={16} />
              Check Again
            </Button>
          </div>
        ) : !status?.logged_in ? (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-4">
              <IconAlertCircle size={32} className="text-yellow-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Not Logged In</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-xs">
              You need to log in to Tailscale to use this feature.
            </p>
            <div className="bg-secondary/50 rounded-lg p-4 w-full mb-4">
              <p className="text-sm text-muted-foreground mb-2">
                Run this command in your terminal:
              </p>
              <code className="text-sm font-mono bg-background px-3 py-2 rounded block">
                tailscale login
              </code>
            </div>
            <Button variant="outline" onClick={detectTailscale} className="gap-2">
              <IconLoader2 size={16} />
              Check Again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <IconCheck size={32} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Tailscale Ready</h3>
            <p className="text-muted-foreground text-center mb-4">
              {status.version && `Version ${status.version}`}
            </p>
            {info && (
              <div className="bg-secondary/50 rounded-lg p-4 w-full space-y-2 text-sm">
                {info.hostname && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hostname:</span>
                    <span className="text-foreground font-medium">
                      {info.hostname}
                    </span>
                  </div>
                )}
                {info.tailnet && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tailnet:</span>
                    <span className="text-foreground font-medium">
                      {info.tailnet}
                    </span>
                  </div>
                )}
                {info.dns_name && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">DNS Name:</span>
                    <span className="text-foreground font-medium text-xs">
                      {info.dns_name}
                    </span>
                  </div>
                )}
                {info.ip_addresses.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IP Address:</span>
                    <span className="text-foreground font-medium">
                      {info.ip_addresses[0]}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderConfigurationStep = () => {
    return (
      <div className="space-y-4">
        <DialogDescription className="text-center">
          Configure Tailscale Serve to expose OpenClaw on your tailnet
        </DialogDescription>

        <div className="flex flex-col items-center py-4">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
            <IconNetwork size={32} className="text-blue-500" />
          </div>

          <div className="bg-secondary/50 rounded-lg p-4 w-full mb-4">
            <h4 className="font-medium text-sm mb-2">What is Tailscale Serve?</h4>
            <p className="text-muted-foreground text-sm">
              Tailscale Serve allows you to share your local OpenClaw gateway
              with other devices on your tailnet. Only devices connected to your
              tailnet can access it.
            </p>
          </div>

          <div className="w-full border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-medium text-foreground">
                  Enable Tailscale Serve
                </h4>
                <p className="text-muted-foreground text-sm">
                  Share OpenClaw on your tailnet
                </p>
              </div>
              <Switch
                checked={info?.serve_enabled ?? false}
                onCheckedChange={handleConfigureServe}
                disabled={isConfiguringServe}
                loading={isConfiguringServe}
              />
            </div>

            {info?.serve_enabled && info?.serve_url && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">
                  Your tailnet URL:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded truncate">
                    {info.serve_url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyUrl(info.serve_url!)}
                    title="Copy URL"
                  >
                    <IconCopy size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenUrl(info.serve_url!)}
                    title="Open URL"
                  >
                    <IconExternalLink size={16} />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {info && (
            <div className="bg-secondary/50 rounded-lg p-4 w-full mt-4 space-y-2 text-sm">
              {info.hostname && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hostname:</span>
                  <span className="text-foreground font-medium">
                    {info.hostname}
                  </span>
                </div>
              )}
              {info.tailnet && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tailnet:</span>
                  <span className="text-foreground font-medium">
                    {info.tailnet}
                  </span>
                </div>
              )}
              {info.ip_addresses.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IP Addresses:</span>
                  <span className="text-foreground font-medium">
                    {info.ip_addresses.join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderFunnelStep = () => {
    return (
      <div className="space-y-4">
        <DialogDescription className="text-center">
          Optionally enable Tailscale Funnel for public internet access
        </DialogDescription>

        <div className="flex flex-col items-center py-4">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center mb-4">
            <IconWorld size={32} className="text-orange-500" />
          </div>

          <div className="bg-secondary/50 rounded-lg p-4 w-full mb-4">
            <h4 className="font-medium text-sm mb-2">What is Tailscale Funnel?</h4>
            <p className="text-muted-foreground text-sm">
              Funnel exposes your OpenClaw gateway to the public internet. Anyone
              with the URL can access it, not just devices on your tailnet.
            </p>
          </div>

          {/* Warning banner */}
          <div className="w-full bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <IconShieldLock size={20} className="text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-600 dark:text-yellow-400 text-sm">
                  Security Warning
                </h4>
                <p className="text-yellow-600/80 dark:text-yellow-400/80 text-sm mt-1">
                  Enabling Funnel makes your endpoint publicly accessible on the
                  internet. Make sure you have appropriate authentication and
                  access controls in place.
                </p>
              </div>
            </div>
          </div>

          <div className="w-full border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-medium text-foreground">
                  Enable Tailscale Funnel
                </h4>
                <p className="text-muted-foreground text-sm">
                  Public internet access
                </p>
              </div>
              <Switch
                checked={info?.funnel_enabled ?? false}
                onCheckedChange={handleConfigureFunnel}
                disabled={isConfiguringFunnel || !info?.serve_enabled}
                loading={isConfiguringFunnel}
              />
            </div>

            {!info?.serve_enabled && (
              <p className="text-sm text-muted-foreground mt-2">
                Enable Tailscale Serve first to use Funnel
              </p>
            )}

            {info?.funnel_enabled && info?.serve_url && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">
                  Your public URL:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded truncate">
                    {info.serve_url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyUrl(info.serve_url!)}
                    title="Copy URL"
                  >
                    <IconCopy size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenUrl(info.serve_url!)}
                    title="Open URL"
                  >
                    <IconExternalLink size={16} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderSuccessStep = () => {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-4">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <IconCheck size={32} className="text-green-500" />
          </div>
          <DialogTitle className="text-center">
            Tailscale Setup Complete
          </DialogTitle>
        </div>

        <DialogDescription className="text-center">
          Your OpenClaw gateway is now accessible via Tailscale
        </DialogDescription>

        <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tailscale Serve:</span>
            <span
              className={`font-medium ${info?.serve_enabled ? 'text-green-500' : 'text-muted-foreground'}`}
            >
              {info?.serve_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tailscale Funnel:</span>
            <span
              className={`font-medium ${info?.funnel_enabled ? 'text-orange-500' : 'text-muted-foreground'}`}
            >
              {info?.funnel_enabled ? 'Enabled (Public)' : 'Disabled'}
            </span>
          </div>
          {info?.serve_url && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground mb-2">Access URL:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded truncate">
                  {info.serve_url}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopyUrl(info.serve_url!)}
                  title="Copy URL"
                >
                  <IconCopy size={16} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderStepContent = () => {
    switch (step) {
      case 'detection':
        return renderDetectionStep()
      case 'configuration':
        return renderConfigurationStep()
      case 'funnel':
        return renderFunnelStep()
      case 'success':
        return renderSuccessStep()
      default:
        return null
    }
  }

  const canGoNext = (): boolean => {
    switch (step) {
      case 'detection':
        return (
          status?.installed === true &&
          status?.running === true &&
          status?.logged_in === true
        )
      case 'configuration':
        return true // Can always proceed (Serve is optional)
      case 'funnel':
        return true // Can always proceed (Funnel is optional)
      case 'success':
        return true
      default:
        return false
    }
  }

  const canGoBack = (): boolean => {
    return step !== 'detection' && step !== 'success'
  }

  const handleNext = () => {
    switch (step) {
      case 'detection':
        setStep('configuration')
        break
      case 'configuration':
        setStep('funnel')
        break
      case 'funnel':
        setStep('success')
        break
      case 'success':
        handleSuccess()
        break
    }
  }

  const handleBack = () => {
    switch (step) {
      case 'configuration':
        setStep('detection')
        break
      case 'funnel':
        setStep('configuration')
        break
      default:
        break
    }
  }

  const getNextButtonText = (): string => {
    switch (step) {
      case 'detection':
        return 'Continue'
      case 'configuration':
        return 'Next'
      case 'funnel':
        return 'Finish'
      case 'success':
        return 'Done'
      default:
        return 'Next'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] max-w-[90vw]">
        <DialogHeader>
          <div className="flex items-center justify-center gap-2 mb-2">
            <IconNetwork size={24} className="text-blue-500" />
            <DialogTitle>Tailscale Setup</DialogTitle>
          </div>
        </DialogHeader>

        {renderStepIndicator()}

        {renderStepContent()}

        <DialogFooter className="gap-2 sm:gap-0">
          {canGoBack() && (
            <Button variant="outline" onClick={handleBack} className="gap-1">
              <IconArrowLeft size={16} />
              Back
            </Button>
          )}
          {step === 'detection' && !canGoNext() && !isLoading && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {(canGoNext() || step === 'success') && (
            <Button onClick={handleNext} disabled={!canGoNext()} className="gap-1">
              {getNextButtonText()}
              {step !== 'success' && <IconArrowRight size={16} />}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
