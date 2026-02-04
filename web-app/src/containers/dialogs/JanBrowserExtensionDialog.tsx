import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Button } from '@/components/ui/button'
import { IconExternalLink, IconLoader2 } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCallback } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPlatformTauri } from '@/lib/platform/utils'

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal'

export type JanBrowserExtensionDialogState =
  | 'closed'
  | 'checking'
  | 'not_installed'

interface JanBrowserExtensionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: JanBrowserExtensionDialogState
  onCancel?: () => void
}

export default function JanBrowserExtensionDialog({
  open,
  onOpenChange,
  state,
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

  const renderContent = () => {
    switch (state) {
      case 'checking':
        return (
          <>
            <VisuallyHidden>
              <DialogTitle>{t('mcp-servers:browserExtension.connecting.checking')}</DialogTitle>
            </VisuallyHidden>
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center justify-center gap-3">
<<<<<<< HEAD
                <IconLoader2 className="size-8 text-accent animate-spin origin-center" />
                <p className="text-sm text-main-view-fg/60">{t('mcp-servers:browserExtension.connecting.checking')}</p>
=======
                <IconLoader2 className="size-8 text-muted-foreground animate-spin origin-center" />
                <p className="text-sm text-muted-foreground">{t('mcp-servers:browserExtension.connecting.checking')}</p>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              </div>
            </div>
          </>
        )

      case 'not_installed':
        return (
          <>
            <DialogHeader>
              <DialogTitle>{t('mcp-servers:browserExtension.notInstalled.title')}</DialogTitle>
<<<<<<< HEAD
              <DialogDescription className="mt-1 text-main-view-fg/70">
=======
              <DialogDescription className="mt-1 text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                {t('mcp-servers:browserExtension.notInstalled.description')}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex gap-2 sm:justify-end">
              <Button
<<<<<<< HEAD
                variant="outline"
=======
                variant="ghost"
                size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                onClick={handleCancel}
              >
                {t('common:cancel')}
              </Button>
              <Button
<<<<<<< HEAD
=======
                size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                onClick={handleOpenChromeStore}
                className="gap-2"
              >
                <IconExternalLink className="size-4" />
                {t('mcp-servers:browserExtension.notInstalled.getExtension')}
              </Button>
            </DialogFooter>
          </>
        )

      default:
        return null
    }
  }

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      handleCancel()
    } else {
      onOpenChange(newOpen)
    }
  }, [handleCancel, onOpenChange])

  return (
    <Dialog open={open && state !== 'closed'} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  )
}
