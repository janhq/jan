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
  dialog: ReactNode
} {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending>()
  const [busy, setBusy] = useState(false)

  // A toast, like a failed confirm: staging starts from the Installed tab
  // (a file) and the Catalog tab (an install or update), and an inline
  // message in one of them is invisible from the other.
  const begin = async (
    stage: () => Promise<StagedInstall>,
    sourceName?: string
  ) => {
    try {
      setPending({ staged: await stage(), sourceName })
    } catch (e) {
      toast.error(t('extensions:errors.stage', { error: errorMessage(e) }))
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
      // Rust may have installed it before a later check failed; the host
      // then follows the registry whichever way it went.
      await reloadInstalled(manifest.id).catch(() => undefined)
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

  return { begin, dialog }
}
