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
                <div className="shrink-0">
                  <IconLoader2 className="size-5 text-accent animate-spin" />
                </div>
                <div>
                  <DialogTitle>Connecting to Jan Browser Extension</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    Please wait while we check for the browser extension...
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3">
                <IconLoader2 className="size-8 text-accent animate-spin" />
                <p className="text-sm text-main-view-fg/60">Checking extension status...</p>
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
                  <DialogTitle>Install Jan Browser Extension</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    To use browser automation features, you need to install the Jan Browser Extension.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="bg-main-view-fg/2 p-4 border border-main-view-fg/5 rounded-lg space-y-3">
              <h4 className="font-medium text-sm">What can Jan Browser do?</h4>
              <ul className="text-sm text-main-view-fg/70 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Search the web and extract information from pages</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Navigate websites and take screenshots</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Click, type, and interact with web elements</span>
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
                  I've Installed It
                </Button>
                <Button
                  onClick={handleOpenChromeStore}
                  className="gap-2"
                >
                  <IconExternalLink className="size-4" />
                  Get Extension
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
                <div className="shrink-0">
                  <IconLoader2 className="size-5 text-accent animate-spin" />
                </div>
                <div>
                  <DialogTitle>Waiting for Extension Connection</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    The MCP server is running. Please open the Jan Browser Extension in your browser to connect.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="bg-main-view-fg/2 p-4 border border-main-view-fg/5 rounded-lg space-y-3">
              <h4 className="font-medium text-sm">How to connect:</h4>
              <ol className="text-sm text-main-view-fg/70 space-y-2 list-decimal list-inside">
                <li>Click the Jan Browser Extension icon in your browser toolbar</li>
                <li>Click "Connect" in the extension popup</li>
                <li>The extension will automatically connect to Jan</li>
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
                    Continue Anyway
                  </Button>
                )}
                <Button
                  onClick={onRetryConnection}
                  className="gap-2"
                >
                  <IconRefresh className="size-4" />
                  Check Again
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
                  <DialogTitle>Extension Connected!</DialogTitle>
                  <DialogDescription className="mt-1 text-main-view-fg/70">
                    The Jan Browser Extension is connected and ready to use.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex items-center justify-center py-6">
              <div className="flex flex-col items-center gap-3">
                <div className="bg-green-500/10 rounded-full p-4">
                  <IconCheck className="size-8 text-green-500" />
                </div>
                <p className="text-sm text-main-view-fg/60">Browser tools are now available</p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full sm:w-auto">
                Done
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
