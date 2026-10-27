import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import {
  DevLoadError,
  loadUnpacked,
  readUnpacked,
  type UnpackedExtension,
} from '@/lib/extensions/dev-loader'
import { PermissionList } from './PermissionList'

function errorText(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown
): string {
  if (error instanceof DevLoadError)
    return t(`extensions:devLoad.${error.code}`, error.params)
  return error instanceof Error ? error.message : String(error)
}

/**
 * The dev-only "Load unpacked" button: picks an extension folder, shows
 * what it requests, and on confirmation runs it as a `dev` worker
 * extension. Errors are shown inline under the button.
 */
export function LoadUnpacked() {
  const { t } = useTranslation()
  const localize = useLocalize()
  const serviceHub = useServiceHub()
  const [pending, setPending] = useState<UnpackedExtension>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setError(undefined)
    const selection = await serviceHub.dialog().open({ directory: true })
    const dir = Array.isArray(selection) ? selection[0] : selection
    if (!dir) return
    try {
      setPending(await readUnpacked(dir))
    } catch (e) {
      setError(errorText(t, e))
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      // A failed activation stays listed with its reason, like a built-in.
      await loadUnpacked(pending)
      setPending(undefined)
    } catch (e) {
      setPending(undefined)
      setError(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  const manifest = pending?.manifest
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={pick}>
        {t('extensions:devLoad.button')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Dialog
        open={pending !== undefined}
        onOpenChange={(open) => !open && !busy && setPending(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('extensions:devLoad.title', {
                name: manifest && localize(manifest, manifest.displayName),
              })}
            </DialogTitle>
            <DialogDescription>
              {t('extensions:devLoad.description')}
            </DialogDescription>
          </DialogHeader>
          {manifest && <PermissionList permissions={manifest.permissions} />}
          {manifest?.proposals && manifest.proposals.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('extensions:devLoad.proposals', {
                proposals: manifest.proposals.join(', '),
              })}
            </p>
          )}
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPending(undefined)}
            >
              {t('extensions:cancel')}
            </Button>
            <Button size="sm" disabled={busy} onClick={confirm}>
              {t('extensions:devLoad.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
