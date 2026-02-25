import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  IconBrandDiscord,
  IconCheck,
  IconArrowRight,
  IconArrowLeft,
  IconLoader2,
  IconAlertCircle,
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
import { Input } from '@/components/ui/input'

// Types mirroring Rust backend
interface DiscordTokenValidation {
  valid: boolean
  bot_username: string | null
  bot_discriminator: string | null
  error: string | null
}

export interface DiscordConfig {
  account_id: string
  bot_token: string
  bot_username: string | null
  bot_discriminator: string | null
  connected: boolean
  guilds_count: number
  channels_count: number
}

interface DiscordWizardDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: (config: DiscordConfig) => void
}

type WizardStep = 'instructions' | 'token' | 'configure' | 'success'

const TOTAL_STEPS = 4

export function DiscordWizardDialog({
  isOpen,
  onOpenChange,
}: DiscordWizardDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>('instructions')
  const [token, setToken] = useState('')
  const [validation, setValidation] = useState<DiscordTokenValidation | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [config, setConfig] = useState<DiscordConfig | null>(null)

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setStep('instructions')
      setToken('')
      setValidation(null)
      setConfig(null)
    }
  }, [isOpen])

  const getStepNumber = (): number => {
    const stepMap: Record<WizardStep, number> = {
      instructions: 1,
      token: 2,
      configure: 3,
      success: 4,
    }
    return stepMap[step]
  }

  const handleValidateToken = async () => {
    if (!token.trim()) {
      toast.error(t('settings:remoteAccess.discordWizard.errors.tokenRequired'))
      return
    }

    setIsValidating(true)
    try {
      const result = await invoke<DiscordTokenValidation>('discord_validate_token', {
        token: token.trim(),
      })
      setValidation(result)
      if (result.valid) {
        toast.success(
          t('settings:remoteAccess.discordWizard.step2.validToken', {
            username: result.bot_username,
          })
        )
      } else {
        toast.error(
          result.error || t('settings:remoteAccess.discordWizard.step2.invalidToken')
        )
      }
    } catch (error) {
      console.error('Token validation error:', error)
      toast.error(t('settings:remoteAccess.discordWizard.errors.networkError'))
    } finally {
      setIsValidating(false)
    }
  }

  const handleConfigure = async () => {
    if (!validation?.valid) return

    setIsConfiguring(true)
    try {
      const result = await invoke<DiscordConfig>('discord_configure', {
        token: token.trim(),
      })
      setConfig(result)
      setStep('success')
      toast.success(t('settings:remoteAccess.discordWizard.step3.success'))
    } catch (error) {
      console.error('Configure error:', error)
      toast.error(
        t('settings:remoteAccess.discordWizard.step3.error', {
          error: error instanceof Error ? error.message : String(error),
        })
      )
    } finally {
      setIsConfiguring(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await invoke('discord_disconnect')
      setConfig(null)
      setToken('')
      setValidation(null)
      setStep('instructions')
      toast.success(t('settings:remoteAccess.discordWizard.status.notConnected'))
    } catch (error) {
      console.error('Disconnect error:', error)
    }
  }

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
            {i + 1 < currentStep ? (
              <IconCheck size={16} />
            ) : (
              i + 1
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderInstructionsStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-center">
        {t('settings:remoteAccess.discordWizard.description')}
      </DialogDescription>

      <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
        <h4 className="font-medium text-foreground">
          {t('settings:remoteAccess.discordWizard.step1.title')}
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>{t('settings:remoteAccess.discordWizard.step1.instruction1')}</li>
          <li>{t('settings:remoteAccess.discordWizard.step1.instruction2')}</li>
          <li>{t('settings:remoteAccess.discordWizard.step1.instruction3')}</li>
          <li>{t('settings:remoteAccess.discordWizard.step1.instruction4')}</li>
          <li>{t('settings:remoteAccess.discordWizard.step1.instruction5')}</li>
        </ol>
      </div>

      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => window.open('https://discord.com/developers/applications', '_blank')}
          className="gap-2"
        >
          <IconBrandDiscord size={18} />
          Open Discord Developer Portal
        </Button>
      </div>
    </div>
  )

  const renderTokenStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-center">
        {t('settings:remoteAccess.discordWizard.step2.title')}
      </DialogDescription>

      <div className="space-y-2">
        <Input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value)
            setValidation(null)
          }}
          placeholder={t('settings:remoteAccess.discordWizard.step2.placeholder')}
          className="font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isValidating) {
              handleValidateToken()
            }
          }}
        />
      </div>

      {validation?.valid && (
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <IconCheck size={16} />
          <span>
            {t('settings:remoteAccess.discordWizard.step2.validToken', {
              username: validation.bot_username,
            })}
          </span>
        </div>
      )}

      {validation && !validation.valid && (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <IconAlertCircle size={16} />
          <span>{validation.error}</span>
        </div>
      )}

      <Button
        onClick={handleValidateToken}
        disabled={isValidating || !token.trim()}
        className="w-full"
      >
        {isValidating ? (
          <>
            <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
            {t('settings:remoteAccess.discordWizard.step2.validating')}
          </>
        ) : (
          t('settings:remoteAccess.discordWizard.step2.validate')
        )}
      </Button>
    </div>
  )

  const renderConfigureStep = () => (
    <div className="space-y-4">
      <DialogDescription className="text-center">
        {t('settings:remoteAccess.discordWizard.step3.title')}
      </DialogDescription>

      <div className="flex flex-col items-center justify-center py-8">
        <IconBrandDiscord size={48} className="text-indigo-500 mb-4" />
        <p className="text-muted-foreground">
          {isConfiguring
            ? t('settings:remoteAccess.discordWizard.step3.connecting')
            : validation?.bot_username
            ? validation.bot_username
            : ''}
        </p>
      </div>

      {isConfiguring && (
        <div className="flex justify-center">
          <IconLoader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      )}
    </div>
  )

  const renderSuccessStep = () => (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
          <IconCheck size={32} className="text-green-500" />
        </div>
        <DialogTitle className="text-center">
          {t('settings:remoteAccess.discordWizard.step4.success')}
        </DialogTitle>
      </div>

      <DialogDescription className="text-center">
        {t('settings:remoteAccess.discordWizard.step4.instruction')}
      </DialogDescription>

      <div className="bg-secondary/50 rounded-lg p-4 text-center space-y-2">
        {config?.bot_username && (
          <p className="text-foreground">
            {t('settings:remoteAccess.discordWizard.step4.botUsername', {
              username: config.bot_username,
            })}
          </p>
        )}
      </div>

      <Button variant="outline" onClick={handleDisconnect} className="w-full">
        {t('settings:remoteAccess.discordWizard.buttons.disconnect')}
      </Button>
    </div>
  )

  const renderStep = () => {
    switch (step) {
      case 'instructions':
        return renderInstructionsStep()
      case 'token':
        return renderTokenStep()
      case 'configure':
        return renderConfigureStep()
      case 'success':
        return renderSuccessStep()
      default:
        return null
    }
  }

  const handleNext = () => {
    switch (step) {
      case 'instructions':
        setStep('token')
        break
      case 'token':
        if (validation?.valid) {
          setStep('configure')
          handleConfigure()
        }
        break
      case 'configure':
        // Handled by configure function
        break
      case 'success':
        onOpenChange(false)
        break
    }
  }

  const handleBack = () => {
    switch (step) {
      case 'token':
        setStep('instructions')
        break
      case 'configure':
        setStep('token')
        setValidation(null)
        break
      case 'success':
        // Cannot go back from success
        break
    }
  }

  const canGoNext = (): boolean => {
    switch (step) {
      case 'instructions':
        return true
      case 'token':
        return validation?.valid ?? false
      case 'configure':
        return false // Auto-progresses
      case 'success':
        return true
      default:
        return false
    }
  }

  const canGoBack = (): boolean => {
    return step !== 'instructions' && step !== 'success' && step !== 'configure'
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-w-[90vw]">
        <DialogHeader>
          <div className="flex items-center justify-center gap-2 mb-2">
            <IconBrandDiscord size={24} className="text-indigo-500" />
            <DialogTitle>{t('settings:remoteAccess.discordWizard.title')}</DialogTitle>
          </div>
        </DialogHeader>

        {renderStepIndicator()}

        {renderStep()}

        {step !== 'configure' && step !== 'success' && (
          <DialogFooter className="gap-2 sm:gap-0">
            {canGoBack() && (
              <Button variant="outline" onClick={handleBack} className="gap-1">
                <IconArrowLeft size={16} />
                {t('settings:remoteAccess.discordWizard.buttons.back')}
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={!canGoNext()}
              className="gap-1"
            >
              {t('settings:remoteAccess.discordWizard.buttons.next')}
              <IconArrowRight size={16} />
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}