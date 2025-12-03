import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconWorld, IconExternalLink, IconLoader2, IconCheck, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCallback } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPlatformTauri } from '@/lib/platform/utils'

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal'

export type JanBrowserExtensionDialogState =
  | 'closed'
  | 'checking'
  | 'not_installed'
  | 'waiting_connection'
  | 'connected'

interface JanBrowserExtensionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: JanBrowserExtensionDialogState
  onRetryConnection: () => void
  onContinueAnyway?: () => void
  onCancel?: () => void
}

export default function JanBrowserExtensionDialog({
  open,
  onOpenChange,
  state,
  onRetryConnection,
  onContinueAnyway,
  onCancel,
}: JanBrowserExtensionDialogProps) {
  const { t } = useTranslation()

  const handleOpenChromeStore = useCallback(async () => {
    try {
      if (isPlatformTauri()) {
        await openUrl(CHROME_STORE_URL)
      } else {
        window.open(CHROME_STORE_URL, '_blank')
      }
    } catch (error) {
      console.error('Failed to open Chrome Store URL:', error)
      // Fallback to window.open
      window.open(CHROME_STORE_URL, '_blank')
    }
  }, [])

  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel()
    } else {
      onOpenChange(false)
    }
  }, [onCancel, onOpenChange])

  // Just close the dialog without deactivating (for success state)
  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const renderContent = () => {
    switch (state) {
      case 'checking':
        return (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="shrink-0 size-5 flex items-center justify-center">
                  <IconLoader2 className="size-5 text-accent animate-spin origin-center" />
                </div>
                <div>
                  <DialogTitle>{t('mcp-servers:browserExtension.connecting.title')}</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    {t('mcp-servers:browserExtension.connecting.description')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center justify-center gap-3">
                <IconLoader2 className="size-8 text-accent animate-spin origin-center" />
                <p className="text-sm text-main-view-fg/60">{t('mcp-servers:browserExtension.connecting.checking')}</p>
              </div>
            </div>
          </>
        )

      case 'not_installed':
        return (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="shrink-0">
                  <IconWorld className="size-5 text-accent" />
                </div>
                <div>
                  <DialogTitle>{t('mcp-servers:browserExtension.notInstalled.title')}</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    {t('mcp-servers:browserExtension.notInstalled.description')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="bg-main-view-fg/2 p-4 border border-main-view-fg/5 rounded-lg space-y-3">
              <h4 className="font-medium text-sm">{t('mcp-servers:browserExtension.notInstalled.whatCanDo')}</h4>
              <ul className="text-sm text-main-view-fg/70 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>{t('mcp-servers:browserExtension.notInstalled.feature1')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>{t('mcp-servers:browserExtension.notInstalled.feature2')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>{t('mcp-servers:browserExtension.notInstalled.feature3')}</span>
                </li>
              </ul>
            </div>

            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="link"
                onClick={handleCancel}
                className="sm:order-1"
              >
                {t('common:cancel')}
              </Button>
              <div className="flex gap-2 sm:order-2">
                <Button
                  onClick={onRetryConnection}
                  className="gap-2 bg-transparent border border-main-view-fg/20 text-main-view-fg hover:bg-main-view-fg/10"
                >
                  <IconRefresh className="size-4" />
                  {t('mcp-servers:browserExtension.notInstalled.installed')}
                </Button>
                <Button
                  onClick={handleOpenChromeStore}
                  className="gap-2"
                >
                  <IconExternalLink className="size-4" />
                  {t('mcp-servers:browserExtension.notInstalled.getExtension')}
                </Button>
              </div>
            </DialogFooter>
          </>
        )

      case 'waiting_connection':
        return (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="shrink-0 size-5 flex items-center justify-center">
                  <IconLoader2 className="size-5 text-accent animate-spin origin-center" />
                </div>
                <div>
                  <DialogTitle>{t('mcp-servers:browserExtension.waitingConnection.title')}</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    {t('mcp-servers:browserExtension.waitingConnection.description')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="bg-main-view-fg/2 p-4 border border-main-view-fg/5 rounded-lg space-y-3">
              <h4 className="font-medium text-sm">{t('mcp-servers:browserExtension.waitingConnection.howToConnect')}</h4>
              <ol className="text-sm text-main-view-fg/70 space-y-2 list-decimal list-inside">
                <li>{t('mcp-servers:browserExtension.waitingConnection.step1')}</li>
                <li>{t('mcp-servers:browserExtension.waitingConnection.step2')}</li>
                <li>{t('mcp-servers:browserExtension.waitingConnection.step3')}</li>
              </ol>
            </div>

            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="link"
                onClick={handleCancel}
                className="sm:order-1"
              >
                {t('common:cancel')}
              </Button>
              <div className="flex gap-2 sm:order-2">
                {onContinueAnyway && (
                  <Button
                    onClick={onContinueAnyway}
                    className="bg-transparent border border-main-view-fg/20 text-main-view-fg hover:bg-main-view-fg/10"
                  >
                    {t('mcp-servers:browserExtension.waitingConnection.continueAnyway')}
                  </Button>
                )}
                <Button
                  onClick={onRetryConnection}
                  className="gap-2"
                >
                  <IconRefresh className="size-4" />
                  {t('mcp-servers:browserExtension.waitingConnection.checkAgain')}
                </Button>
              </div>
            </DialogFooter>
          </>
        )

      case 'connected':
        return (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="shrink-0">
                  <IconCheck className="size-5 text-green-500" />
                </div>
                <div>
                  <DialogTitle>{t('mcp-servers:browserExtension.connected.title')}</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    {t('mcp-servers:browserExtension.connected.description')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex items-center justify-center py-6">
              <div className="flex flex-col items-center gap-3">
                <div className="bg-green-500/10 rounded-full p-4">
                  <IconCheck className="size-8 text-green-500" />
                </div>
                <p className="text-sm text-main-view-fg/60">{t('mcp-servers:browserExtension.connected.toolsAvailable')}</p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full sm:w-auto">
                {t('mcp-servers:browserExtension.connected.done')}
              </Button>
            </DialogFooter>
          </>
        )

      default:
        return null
    }
  }

  // Handle dialog open change - route close actions through cancel handler
  // except for 'connected' state where we just close without deactivating
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      if (state === 'connected') {
        // Successfully connected - just close without deactivating
        handleClose()
      } else {
        // User is trying to close/cancel - deactivate server
        handleCancel()
      }
    } else {
      onOpenChange(newOpen)
    }
  }, [state, handleCancel, handleClose, onOpenChange])

  return (
    <Dialog open={open && state !== 'closed'} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  )
}
