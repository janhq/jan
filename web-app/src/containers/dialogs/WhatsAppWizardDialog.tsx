import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  IconBrandWhatsapp,
  IconQrcode,
  IconCheck,
  IconX,
  IconRefresh,
  IconArrowLeft,
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

// WhatsApp configuration types (mirroring Rust backend)
export interface WhatsAppConfig {
  account_id: string
  session_path: string
  connected: boolean
  phone_number: string | null
  qr_code: string | null
  contacts_count: number
}

// WhatsApp authentication status
export interface WhatsAppAuthStatus {
  in_progress: boolean
  qr_code_ready: boolean
  qr_code: string | null
  authenticated: boolean
  error: string | null
}

interface WhatsAppWizardDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (config: WhatsAppConfig) => void
}

type WizardStep = 'welcome' | 'setting_up' | 'scanning' | 'verifying' | 'success' | 'error'

export function WhatsAppWizardDialog({
  isOpen,
  onOpenChange,
  onConnected,
}: WhatsAppWizardDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>('welcome')
  const [isLoading, setIsLoading] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)
  const [, setAuthStatus] = useState<WhatsAppAuthStatus | null>(null)
  const [qrCodeImage, setQrCodeImage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])

  // Stop polling when dialog closes
  useEffect(() => {
    if (!isOpen && pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
  }, [isOpen, pollingInterval])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('welcome')
      setIsLoading(false)
      setIsPolling(false)
      setAuthStatus(null)
      setQrCodeImage(null)
      setErrorMessage(null)
      setConfig(null)
      if (pollingInterval) {
        clearInterval(pollingInterval)
        setPollingInterval(null)
      }
    }
  }, [isOpen])

  const startAuthentication = useCallback(async () => {
    try {
      setIsLoading(true)
      setErrorMessage(null)

      // Show "setting up" step while OpenClaw is being configured
      setStep('setting_up')

      // Start WhatsApp authentication (this now handles all setup automatically)
      // - Installs OpenClaw if needed
      // - Starts the Gateway if not running
      // - Configures allowed origins
      // - Handles device pairing
      // - Enables WhatsApp plugin
      const status = await invoke<WhatsAppAuthStatus>('whatsapp_start_auth')
      setAuthStatus(status)

      // Check if there was an error during setup
      if (status.error) {
        setErrorMessage(status.error)
        setStep('error')
        return
      }

      // Check if already authenticated (WhatsApp was already linked)
      if (status.authenticated) {
        // Get the final config
        const whatsappConfig = await invoke<WhatsAppConfig>('whatsapp_get_config')
        setConfig(whatsappConfig)
        setStep('success')
        onConnected(whatsappConfig)
        return
      }

      // Check if QR code is already available in the response
      if (status.qr_code) {
        setQrCodeImage(status.qr_code)
      }

      // Move to scanning step
      setStep('scanning')
      startPolling()
    } catch (error) {
      console.error('Failed to start WhatsApp auth:', error)
      setErrorMessage(
        error instanceof Error ? error.message : String(error)
      )
      setStep('error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const startPolling = useCallback(() => {
    // Poll for QR code and authentication status
    const interval = setInterval(async () => {
      try {
        const status = await invoke<WhatsAppAuthStatus>('whatsapp_check_auth')
        setAuthStatus(status)

        // If we get a QR code, display it
        if (status.qr_code) {
          setQrCodeImage(status.qr_code)
        }

        // If authenticated, stop polling and show success
        if (status.authenticated) {
          clearInterval(interval)
          setPollingInterval(null)
          setIsPolling(false)

          // Get the final config
          const whatsappConfig = await invoke<WhatsAppConfig>('whatsapp_get_config')
          setConfig(whatsappConfig)
          setStep('success')
          onConnected(whatsappConfig)
        }

        // If there's an error, check if it's a fatal error or transient
        // Transient errors (like 515 stream errors) should not stop polling
        // as the connection often succeeds on retry
        // "not linked" and "not configured" are not errors - they just mean waiting for QR scan
        if (status.error && !status.in_progress) {
          // Only stop polling if the error is final (not in progress anymore)
          // Transient errors during connection attempts should be ignored
          const isFatalError = !status.error.includes('515') &&
                               !status.error.includes('restart required') &&
                               !status.error.includes('Stream Errored') &&
                               !status.error.includes('not linked') &&
                               !status.error.includes('not configured');

          if (isFatalError) {
            clearInterval(interval)
            setPollingInterval(null)
            setIsPolling(false)
            setErrorMessage(status.error)
            setStep('error')
          } else {
            // Transient error, log it but keep polling
            console.log('Transient WhatsApp error, continuing to poll:', status.error)
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 2000)

    setPollingInterval(interval)
    setIsPolling(true)
  }, [onConnected])

  const handleDisconnect = useCallback(async () => {
    try {
      setIsLoading(true)
      await invoke('whatsapp_disconnect')
      setStep('welcome')
      setConfig(null)
      setQrCodeImage(null)
      if (pollingInterval) {
        clearInterval(pollingInterval)
        setPollingInterval(null)
      }
      setIsPolling(false)
    } catch (error) {
      console.error('Failed to disconnect WhatsApp:', error)
      toast.error(t('settings:remoteAccess.disconnectError'))
    } finally {
      setIsLoading(false)
    }
  }, [pollingInterval, t])

  const handleClose = useCallback(() => {
    // Stop polling before closing
    if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
    onOpenChange(false)
  }, [pollingInterval, onOpenChange])

  const renderStepContent = () => {
    switch (step) {
      case 'welcome':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <IconBrandWhatsapp size={32} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.setupTitle')}
            </h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs">
              {t('settings:remoteAccess.whatsappWizard.setupDescription')}
            </p>
            <div className="bg-muted/50 rounded-lg p-4 w-full text-left">
              <h4 className="font-medium text-sm mb-2">
                {t('settings:remoteAccess.whatsappWizard.howItWorks')}
              </h4>
              <ol className="text-muted-foreground text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">1.</span>
                  {t('settings:remoteAccess.whatsappWizard.whatsappStep1')}
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">2.</span>
                  {t('settings:remoteAccess.whatsappWizard.whatsappStep2')}
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium text-foreground">3.</span>
                  {t('settings:remoteAccess.whatsappWizard.whatsappStep3')}
                </li>
              </ol>
            </div>
          </div>
        )

      case 'setting_up':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <IconRefresh size={32} className="text-blue-500 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.settingUp') || 'Setting up...'}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('settings:remoteAccess.whatsappWizard.settingUpDescription') || 'Configuring OpenClaw and preparing WhatsApp connection. This may take a moment...'}
            </p>
            <div className="bg-muted/50 rounded-lg p-4 w-full text-left">
              <ol className="text-muted-foreground text-sm space-y-2">
                <li className="flex items-center gap-2">
                  <IconCheck size={16} className="text-green-500" />
                  <span>{t('settings:remoteAccess.whatsappWizard.checkingOpenClaw') || 'Checking OpenClaw installation'}</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconRefresh size={16} className="animate-spin" />
                  <span>{t('settings:remoteAccess.whatsappWizard.configuringGateway') || 'Configuring Gateway connection'}</span>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground/50">
                  <span className="w-4 h-4" />
                  <span>{t('settings:remoteAccess.whatsappWizard.enablingWhatsApp') || 'Enabling WhatsApp channel'}</span>
                </li>
              </ol>
            </div>
          </div>
        )

      case 'scanning':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <IconQrcode size={32} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.scanQrCode')}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('settings:remoteAccess.whatsappWizard.qrCodeInstructions')}
            </p>

            {/* QR Code Display */}
            <div className="bg-white p-4 rounded-lg mb-4 min-h-[200px] min-w-[200px] flex items-center justify-center">
              {qrCodeImage ? (
                <img
                  src={qrCodeImage}
                  alt="WhatsApp QR Code"
                  className="w-48 h-48"
                />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground">
                  <IconQrcode size={48} className="mb-2" />
                  <span className="text-sm">
                    {t('settings:remoteAccess.whatsappWizard.generatingQrCode')}
                  </span>
                </div>
              )}
            </div>

            {isPolling && (
              <p className="text-muted-foreground text-xs">
                {t('settings:remoteAccess.whatsappWizard.waitingForScan')}
              </p>
            )}
          </div>
        )

      case 'verifying':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <IconRefresh size={32} className="text-blue-500 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.verifyingConnection')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t('settings:remoteAccess.whatsappWizard.pleaseWait')}
            </p>
          </div>
        )

      case 'success':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <IconCheck size={32} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.whatsappConnected')}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('settings:remoteAccess.whatsappWizard.whatsappConnectedDescription')}
            </p>
            {config?.phone_number && (
              <div className="bg-muted/50 rounded-lg px-4 py-2">
                <span className="text-sm font-medium">{config.phone_number}</span>
              </div>
            )}
          </div>
        )

      case 'error':
        return (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <IconX size={32} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t('settings:remoteAccess.whatsappWizard.connectionFailed')}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {errorMessage || t('settings:remoteAccess.whatsappWizard.unknownError')}
            </p>
          </div>
        )

      default:
        return null
    }
  }

  const renderFooter = () => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <Button variant="outline" onClick={handleClose}>
              {t('common:cancel')}
            </Button>
            <Button onClick={startAuthentication} disabled={isLoading}>
              {isLoading ? t('settings:remoteAccess.whatsappWizard.connecting') : t('settings:remoteAccess.whatsappWizard.startSetup')}
            </Button>
          </>
        )

      case 'scanning':
        return (
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (pollingInterval) {
                  clearInterval(pollingInterval)
                  setPollingInterval(null)
                }
                setIsPolling(false)
                setStep('welcome')
              }}
              disabled={isLoading}
            >
              <IconArrowLeft className="mr-2 h-4 w-4" />
              {t('settings:remoteAccess.whatsappWizard.back')}
            </Button>
            <Button onClick={startAuthentication} disabled={isLoading}>
              <IconRefresh className="mr-2 h-4 w-4" />
              {t('settings:remoteAccess.whatsappWizard.refreshQrCode')}
            </Button>
          </>
        )

      case 'verifying':
        return null // No buttons while verifying

      case 'success':
        return (
          <>
            <Button variant="outline" onClick={handleDisconnect} disabled={isLoading}>
              {t('settings:remoteAccess.disconnect')}
            </Button>
            <Button onClick={handleClose}>
              {t('common:done')}
            </Button>
          </>
        )

      case 'error':
        return (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setStep('welcome')
                setErrorMessage(null)
              }}
            >
              <IconArrowLeft className="mr-2 h-4 w-4" />
              {t('settings:remoteAccess.whatsappWizard.tryAgain')}
            </Button>
            <Button onClick={handleClose}>
              {t('common:close')}
            </Button>
          </>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconBrandWhatsapp className="h-5 w-5 text-green-500" />
            {t('settings:remoteAccess.whatsapp')}
          </DialogTitle>
          <DialogDescription>
            {step === 'welcome' && t('settings:remoteAccess.whatsappWizard.whatsappWizardDescription')}
            {step === 'scanning' && t('settings:remoteAccess.whatsappWizard.scanQrCodeDescription')}
            {step === 'verifying' && t('settings:remoteAccess.whatsappWizard.verifyingDescription')}
            {step === 'success' && t('settings:remoteAccess.whatsappWizard.successDescription')}
            {step === 'error' && t('settings:remoteAccess.whatsappWizard.errorDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">{renderStepContent()}</div>

        <DialogFooter className="sm:justify-between">
          {renderFooter()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}