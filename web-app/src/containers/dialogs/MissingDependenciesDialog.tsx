import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { events, AppEvent } from '@janhq/core'
import { useEffect, useState } from 'react'

type VerificationFailedPayload = {
  backend: string
  version: string
  missingLibraries: string[]
}

export default function MissingDependenciesDialog() {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<VerificationFailedPayload | undefined>()

  useEffect(() => {
    const handler = (data: VerificationFailedPayload) => setPayload(data)
    events.on(AppEvent.onBackendVerificationFailed, handler)
    return () => {
      events.off(AppEvent.onBackendVerificationFailed, handler)
    }
  }, [])

  return (
    <Dialog open={!!payload} onOpenChange={(open) => !open && setPayload(undefined)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>
                {t('common:missingDependenciesDialog.title')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                {t('common:missingDependenciesDialog.description', {
                  backend: payload?.backend ?? '',
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/2 p-2 border border-main-view-fg/5 rounded-lg space-y-1">
          <p className="text-sm text-main-view-fg/60 mb-2">
            {t('common:missingDependenciesDialog.missingLibraries')}
          </p>
          <ul className="max-h-[180px] overflow-y-auto space-y-1">
            {payload?.missingLibraries.map((lib) => (
              <li
                key={lib}
                className="text-sm font-mono text-main-view-fg/80 bg-main-view-fg/10 px-2 py-1 rounded border border-main-view-fg/5 break-all"
              >
                {lib}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="link"
            onClick={() => setPayload(undefined)}
            autoFocus
            className="flex-1 text-right sm:flex-none border border-main-view-fg/20 !px-2"
          >
            {t('common:dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
