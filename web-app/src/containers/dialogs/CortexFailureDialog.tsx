import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { t } from 'i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function CortexFailureDialog() {
  const [showDialog, setShowDialog] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    const setupListener = async () => {
      unlisten = await listen<null>('cortex_max_restarts_reached', (event) => {
        console.log('Cortex max restarts reached event received:', event)
        setShowDialog(true)
      })
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const handleRestartJan = async () => {
    try {
      await invoke('relaunch')
    } catch (error) {
      console.error('Failed to relaunch app:', error)
      alert(
        'Failed to automatically restart. Please close and reopen Jan manually.'
      )
    }
  }

  if (!showDialog) {
    return null
  }

  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('cortexFailureDialog.title', 'Local AI Engine Issue')}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t(
            'cortexFailureDialog.description',
            'The local AI engine (Cortex) failed to start after multiple attempts. This might prevent some features from working correctly.'
          )}
        </DialogDescription>
        <DialogFooter className="flex gap-2">
          <Button
            asChild
            variant="default"
            className="bg-transparent border border-main-view-fg/20 hover:bg-main-view-fg/4"
            onClick={() => {
              setShowDialog(false)
            }}
          >
            <a
              href="https://jan.ai/support"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="text-main-view-fg/70">
                {t('cortexFailureDialog.contactSupport', 'Contact Support')}
              </span>
            </a>
          </Button>
          <Button onClick={handleRestartJan}>
            {t('cortexFailureDialog.restartJan', 'Restart Jan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
