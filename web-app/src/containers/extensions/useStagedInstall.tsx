import { useState, type ReactNode } from 'react'
import type { PermissionString } from '@janhq/extension-api'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { reloadInstalled } from '@/lib/extensions/installed-reload'
import type { StagedInstall } from '@/services/extensions/types'
import { ConsentDialog } from './ConsentDialog'
import { PermissionDiffDialog } from './PermissionDiffDialog'
import { errorMessage, type InstalledRegistry } from './useExtensions'

interface Pending {
  staged: StagedInstall
  sourceName?: string
}

/**
 * Stage, consent, confirm: the one install path for files and indexes.
 * A first install asks for every permission; an update only for what it
 * adds. Whatever is not confirmed is discarded from staging.
 */
export function useStagedInstall({ service, refresh }: InstalledRegistry): {
  /** Stages with `stage` and opens the matching consent dialog. */
  begin: (stage: () => Promise<StagedInstall>, sourceName?: string) => Promise<void>
  /** Why the last staging failed, translated. */
  error?: string
  dialog: ReactNode
} {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const begin = async (
    stage: () => Promise<StagedInstall>,
    sourceName?: string
  ) => {
    setError(undefined)
    try {
      setPending({ staged: await stage(), sourceName })
    } catch (e) {
      setError(t('extensions:errors.stage', { error: errorMessage(e) }))
    }
  }

  const cancel = () => {
    if (!pending) return
    setPending(undefined)
    service.discardStage(pending.staged.stageId).catch(() => undefined)
  }

  const confirm = async (granted: PermissionString[]) => {
    if (!pending) return
    const { manifest, stageId } = pending.staged
    setBusy(true)
    try {
      const entry = await service.confirmInstall(stageId, granted)
      toast.success(
        t('extensions:install.done', {
          name: entry.manifest.displayName,
          version: entry.version,
        })
      )
      await reloadInstalled(entry.id)
    } catch (e) {
      // A refused confirm leaves a stage nothing can use; free its disk.
      service.discardStage(stageId).catch(() => undefined)
      toast.error(
        t('extensions:errors.install', {
          name: manifest.displayName,
          error: errorMessage(e),
        })
      )
    } finally {
      setBusy(false)
      setPending(undefined)
      await refresh()
    }
  }

  const props = pending && {
    staged: pending.staged,
    sourceName: pending.sourceName,
    onConfirm: confirm,
    onCancel: cancel,
    busy,
  }
  const dialog = props ? (
    props.staged.existing ? (
      <PermissionDiffDialog {...props} />
    ) : (
      <ConsentDialog {...props} />
    )
  ) : null

  return { begin, error, dialog }
}
