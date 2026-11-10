import { useEffect, useState } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import {
  getLoadedModels,
  unloadLlamaModel,
} from '@janhq/tauri-plugin-llamacpp-api'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * The gate in front of the full check.
 *
 * It exists for two costs the user cannot see from the menu: the run is 15
 * minutes or more per device at full load, and on Windows a long GPU kernel
 * can trip the display driver's watchdog, which resets the driver for every
 * process -- including whatever model they have loaded. Process isolation does
 * not prevent that, so the only honest mitigation is saying so first.
 */
export function LlamacppDiagnosticsFullConfirm({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<string[]>([])
  const [unloadFirst, setUnloadFirst] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!open || !isPlatformTauri()) return
    let cancelled = false
    getLoadedModels()
      .then((models) => {
        if (!cancelled) setLoaded(models ?? [])
      })
      .catch(() => {
        // A model list we cannot read is not a reason to block the run; the
        // duration and driver warnings stand on their own.
        if (!cancelled) setLoaded([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const confirm = async () => {
    if (unloadFirst && loaded.length > 0) {
      setWorking(true)
      // Best effort and sequential: a model that will not unload should not
      // stop the check the user asked for.
      for (const model of loaded) {
        try {
          await unloadLlamaModel(model)
        } catch (e) {
          console.warn('could not unload before the hardware check:', e)
        }
      }
      setWorking(false)
    }
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle
              size={18}
              className="shrink-0 text-amber-500"
            />
            {t('providers:diagnostics.fullConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('providers:diagnostics.fullConfirmBody')}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-normal text-muted-foreground">
          {t('providers:diagnostics.fullConfirmDriver')}
        </p>

        {loaded.length > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                {t('providers:diagnostics.fullConfirmLoaded', {
                  count: loaded.length,
                })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('providers:diagnostics.unloadFirst')}
              </p>
            </div>
            <Switch checked={unloadFirst} onCheckedChange={setUnloadFirst} />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t('common:cancel')}
          </Button>
          <Button size="sm" disabled={working} onClick={confirm}>
            {t('providers:diagnostics.fullConfirmRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
