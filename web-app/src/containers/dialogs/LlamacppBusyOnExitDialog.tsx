import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { useAppState } from '@/hooks/useAppState'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

export default function LlamacppBusyOnExitDialog() {
  const { t } = useTranslation()
  const [busyModels, setBusyModels] = useState<string[] | null>(null)
  const [forcing, setForcing] = useState(false)

  useEffect(() => {
    if (!isPlatformTauri()) return
    const CLOSING_TOAST_ID = 'llamacpp-closing'
    const unlistenAttempt = listen('llamacpp-close-attempt', () => {
      toast.loading(t('common:llamacppBusyOnExit.shuttingDown'), {
        id: CLOSING_TOAST_ID,
        duration: Infinity,
      })
    }).catch((e) => {
      console.warn('listen llamacpp-close-attempt failed:', e)
      return () => {}
    })
    const unlistenBusy = listen<string[]>('llamacpp-busy-on-exit', (event) => {
      toast.dismiss(CLOSING_TOAST_ID)
      setBusyModels(event.payload ?? [])
    }).catch((e) => {
      console.warn('listen llamacpp-busy-on-exit failed:', e)
      return () => {}
    })
    return () => {
      void unlistenAttempt.then((fn) => fn?.())
      void unlistenBusy.then((fn) => fn?.())
      toast.dismiss(CLOSING_TOAST_ID)
    }
  }, [t])

  const handleForceQuit = async () => {
    setForcing(true)
    try {
      const state = useAppState.getState()
      Object.values(state.abortControllers).forEach((ctrl) => {
        try {
          ctrl.abort()
        } catch (e) {
          console.warn('abort controller threw on force-quit:', e)
        }
      })
      const threadIds = new Set<string>([
        ...Object.keys(state.busyThreads),
        ...Object.keys(state.streamingContents),
        ...Object.keys(state.loadingModels),
        ...Object.keys(state.abortControllers),
      ])
      threadIds.forEach((tid) => state.clearThreadState(tid))
      await invoke('plugin:llamacpp|force_kill_router_tree')
      await invoke('confirm_exit')
    } catch (e) {
      console.error('force-quit failed:', e)
      setForcing(false)
    }
  }

  const handleCancel = () => {
    setBusyModels(null)
    toast.dismiss('llamacpp-closing')
  }

  return (
    <Dialog open={busyModels !== null} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>{t('common:llamacppBusyOnExit.title')}</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                {t('common:llamacppBusyOnExit.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {busyModels && busyModels.length > 0 && (
          <div className="bg-main-view-fg/2 p-2 border border-main-view-fg/5 rounded-lg text-sm text-main-view-fg/70 max-h-[150px] overflow-y-auto">
            <ul className="list-disc pl-5 space-y-1 break-all">
              {busyModels.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="link"
            onClick={handleCancel}
            disabled={forcing}
            className="flex-1 text-right sm:flex-none"
          >
            {t('common:cancel')}
          </Button>
          <Button
            variant="link"
            onClick={() => void handleForceQuit()}
            disabled={forcing}
            autoFocus
            className="flex-1 text-right sm:flex-none border border-destructive/30 text-destructive !px-2"
          >
            {forcing
              ? t('common:llamacppBusyOnExit.forcing')
              : t('common:llamacppBusyOnExit.forceQuit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
