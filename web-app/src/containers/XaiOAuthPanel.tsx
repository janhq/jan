import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  cancelXaiOAuthLogin,
  completeXaiOAuthCallback,
  formatXaiOAuthExpiry,
  getXaiOAuthStatus,
  logoutXaiOAuth,
  onXaiOAuthLoginComplete,
  pollXaiDeviceLogin,
  startXaiDeviceLogin,
  probeNativeXaiOAuthBackend,
  startXaiOAuthLogin,
  type XaiOAuthDeviceLogin,
  type XaiOAuthStatus,
} from '@/lib/xai-oauth'
import { IconCircleCheck, IconLoader, IconLogout } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type XaiOAuthPanelProps = {
  onAuthChange?: (connected: boolean) => void
}

export function XaiOAuthPanel({ onAuthChange }: XaiOAuthPanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<XaiOAuthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [authCodeInput, setAuthCodeInput] = useState('')
  const [showManualCallback, setShowManualCallback] = useState(false)
  const [deviceLogin, setDeviceLogin] = useState<XaiOAuthDeviceLogin | null>(
    null
  )
  const [oauthBackend, setOauthBackend] = useState<'native' | 'client' | null>(
    null
  )

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getXaiOAuthStatus()
      setStatus(next)
      onAuthChange?.(next?.connected ?? false)
    } catch (error) {
      console.error('Failed to load xAI OAuth status', error)
      setStatus({ connected: false, loginInProgress: false })
      onAuthChange?.(false)
    }
  }, [onAuthChange])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!isPlatformTauri()) return
    void probeNativeXaiOAuthBackend().then((native) => {
      const backend = native ? 'native' : 'client'
      setOauthBackend(backend)
      if (!native) setShowManualCallback(true)
    })
  }, [])

  useEffect(() => {
    if (!isPlatformTauri()) return
    let unlisten: (() => void) | undefined
    void onXaiOAuthLoginComplete((result) => {
      setIsLoading(false)
      if (result.success) {
        toast.success(t('providers:xaiOAuth.success'))
        void refreshStatus()
      } else if (result.error) {
        toast.error(t('providers:xaiOAuth.failed'), {
          description: result.error,
        })
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [refreshStatus, t])

  if (!isPlatformTauri()) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('providers:xaiOAuth.desktopOnly')}
      </p>
    )
  }

  const handleBrowserLogin = async () => {
    setIsLoading(true)
    try {
      const authorizeUrl = await startXaiOAuthLogin()
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(authorizeUrl)
      setShowManualCallback(true)
      await refreshStatus()
    } catch (error) {
      setIsLoading(false)
      toast.error(t('providers:xaiOAuth.failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleCancel = async () => {
    await cancelXaiOAuthLogin()
    setIsLoading(false)
    await refreshStatus()
  }

  const handleManualCallback = async () => {
    if (!authCodeInput.trim()) return
    setIsLoading(true)
    try {
      const result = await completeXaiOAuthCallback(authCodeInput.trim())
      if (result.success) {
        toast.success(t('providers:xaiOAuth.success'))
        setAuthCodeInput('')
        setIsLoading(false)
        await refreshStatus()
      } else {
        toast.error(t('providers:xaiOAuth.failed'), {
          description: result.error,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeviceLogin = async () => {
    setIsLoading(true)
    try {
      const started = await startXaiDeviceLogin()
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      const openTarget =
        started.verificationUriComplete ?? started.verificationUri
      await openUrl(openTarget)
      setDeviceLogin(started)

      const result = await pollXaiDeviceLogin(started)

      if (result.success) {
        toast.success(t('providers:xaiOAuth.success'))
        setDeviceLogin(null)
        await refreshStatus()
      } else {
        toast.error(t('providers:xaiOAuth.failed'), {
          description: result.error,
        })
      }
    } catch (error) {
      toast.error(t('providers:xaiOAuth.failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    await logoutXaiOAuth()
    setDeviceLogin(null)
    await refreshStatus()
    toast.success(t('providers:xaiOAuth.signedOut'))
  }

  const expiryLabel = formatXaiOAuthExpiry(status?.expiresAt)

  return (
    <div className="space-y-3 rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-3 py-3">
      <div className="space-y-1">
        <h3 className="font-medium text-sm text-foreground">
          {t('providers:xaiOAuth.title')}
        </h3>
        <p className="text-xs text-muted-foreground leading-normal">
          {t('providers:xaiOAuth.description')}
        </p>
        {oauthBackend === 'client' && (
          <p className="text-xs text-muted-foreground leading-normal">
            {t('providers:xaiOAuth.manualCallbackHint')}
          </p>
        )}
      </div>

      {status?.connected ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <IconCircleCheck size={16} />
            <span>{t('providers:xaiOAuth.connected')}</span>
          </div>
          {expiryLabel && (
            <p className="text-xs text-muted-foreground">
              {t('providers:xaiOAuth.expiresAt', { date: expiryLabel })}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={handleLogout}>
            <IconLogout size={14} />
            {t('providers:xaiOAuth.signOut')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            onClick={handleBrowserLogin}
            disabled={isLoading || status?.loginInProgress}
          >
            {isLoading || status?.loginInProgress ? (
              <>
                <IconLoader size={14} className="animate-spin" />
                {t('providers:xaiOAuth.signingIn')}
              </>
            ) : (
              t('providers:xaiOAuth.signIn')
            )}
          </Button>

          {(isLoading || status?.loginInProgress) && (
            <Button size="sm" variant="outline" onClick={handleCancel}>
              {t('providers:xaiOAuth.cancel')}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleDeviceLogin}
            disabled={isLoading}
          >
            {t('providers:xaiOAuth.deviceSignIn')}
          </Button>

          {deviceLogin?.userCode && (
            <p className="text-xs text-muted-foreground">
              {t('providers:xaiOAuth.deviceCode', {
                code: deviceLogin.userCode,
              })}
            </p>
          )}

          {(showManualCallback || oauthBackend === 'client') && (
            <div className="flex flex-col gap-2 rounded-md border border-main-view-fg/10 bg-background/40 px-3 py-3">
              <p className="text-xs text-muted-foreground leading-normal">
                {t('providers:xaiOAuth.pasteCodeHelp')}
              </p>
              <Input
                value={authCodeInput}
                onChange={(e) => setAuthCodeInput(e.target.value)}
                placeholder={t('providers:xaiOAuth.authCodePlaceholder')}
                className="font-mono text-xs"
                spellCheck={false}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleManualCallback}
                disabled={isLoading || !authCodeInput.trim()}
              >
                {t('providers:xaiOAuth.completeCallback')}
              </Button>
            </div>
          )}

          {oauthBackend === 'native' && !showManualCallback && (
            <button
              type="button"
              className={cn(
                'text-left text-xs text-muted-foreground underline-offset-2 hover:underline'
              )}
              onClick={() => setShowManualCallback(true)}
            >
              {t('providers:xaiOAuth.manualCallback')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}