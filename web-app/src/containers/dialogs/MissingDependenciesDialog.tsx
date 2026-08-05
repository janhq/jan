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
import { useIsOnboarding } from '@/hooks/useIsOnboarding'
import { DependencyAdvice } from './DependencyAdvice'
import { getBackendDisplayName } from '@/lib/backendDependencies'

type VerificationFailedPayload = {
  backend: string
  version: string
  missingLibraries: string[]
}

export default function MissingDependenciesDialog() {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<VerificationFailedPayload | undefined>()
  // During first-run setup the same missing libraries are already reported on
  // the setup checklist's engine row, with the install advice inline. A modal on
  // top of the wizard would be the same finding twice.
  const isOnboarding = useIsOnboarding()

  useEffect(() => {
    const handler = (data: VerificationFailedPayload) => {
      setPayload(data)
    }
    events.on(AppEvent.onBackendVerificationFailed, handler)
    return () => {
      events.off(AppEvent.onBackendVerificationFailed, handler)
    }
  }, [])

  const displayName = payload ? getBackendDisplayName(payload.backend) : ''
  const allRawLibs = payload?.missingLibraries ?? []

  return (
    <Dialog
      open={!!payload && !isOnboarding}
      onOpenChange={(open) => !open && setPayload(undefined)}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>
                {t('common:missingDependenciesDialog.title')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                {t('common:missingDependenciesDialog.description', {
                  backend: displayName,
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DependencyAdvice
          backend={payload?.backend ?? ''}
          missingLibraries={allRawLibs}
        />

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
