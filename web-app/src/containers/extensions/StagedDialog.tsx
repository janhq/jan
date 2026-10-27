import { useId, useState, type ReactNode } from 'react'
import type { PermissionString } from '@janhq/extension-api'
import { Checkbox } from 'radix-ui'
import { IconCheck } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import type { StagedInstall } from '@/services/extensions/types'
import { UnsignedSourceBadge, UnverifiedBadge } from './TrustBadge'

/**
 * Where a staged bundle came from, shared by the install and update
 * dialogs. Only a bundle verified by the key pinned for its source goes
 * through as is; a file from disk or an entry of an unsigned source shows
 * its hash and must be explicitly trusted (`trusted`/`onTrustedChange`)
 * before it can be installed.
 */
function StagedOrigin({
  staged,
  sourceName,
  trusted,
  onTrustedChange,
}: {
  staged: StagedInstall
  /** The index the bundle came from, for index installs. */
  sourceName?: string
  trusted: boolean
  onTrustedChange: (trusted: boolean) => void
}) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const source =
    staged.source.kind === 'index' ? staged.source.sourceName : sourceName
  if (staged.verified)
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        {source && (
          <span className="font-medium">
            {t('extensions:origin.verifiedBy', { source })}
          </span>
        )}
        <span className="text-muted-foreground">
          {t('extensions:origin.integrityChecked')}
        </span>
      </div>
    )
  const fromIndex = staged.integrityChecked
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
      {fromIndex && source && (
        <span className="text-xs font-medium">
          {t('extensions:origin.fromSource', { source })}
        </span>
      )}
      <div className="flex items-center gap-2">
        {fromIndex ? <UnsignedSourceBadge /> : <UnverifiedBadge />}
        <span className="text-xs text-muted-foreground">
          {t(
            fromIndex
              ? 'extensions:origin.unsignedSourceHint'
              : 'extensions:origin.unverifiedHint'
          )}
        </span>
      </div>
      <code className="text-xs break-all">
        {t('extensions:origin.sha512', { hash: staged.sha512 })}
      </code>
      <div className="flex items-center gap-2">
        <Checkbox.Root
          id={checkboxId}
          checked={trusted}
          onCheckedChange={(value) => onTrustedChange(value === true)}
          className="size-4 shrink-0 rounded border border-input flex items-center justify-center data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        >
          <Checkbox.Indicator>
            <IconCheck size={12} />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <Label htmlFor={checkboxId} className="text-xs">
          {t(
            fromIndex
              ? 'extensions:origin.trustSource'
              : 'extensions:origin.trustAuthor'
          )}
        </Label>
      </div>
    </div>
  )
}

/**
 * Warns when an update would replace the installed version with one from
 * another place, or drop the signature the installed version had: the
 * origin line alone says where the update is from, not that it changed.
 * A file replacing a file says nothing new; both are unverified already.
 */
function SourceChange({ staged }: { staged: StagedInstall }) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const from = staged.existing?.installedFrom
  if (!from) return null
  const name = localize(staged.manifest, staged.manifest.displayName)
  const next = staged.source
  const previous = from.source
  let warning: string | undefined
  if (next.kind === 'bundle' && previous.kind === 'index')
    warning = t('extensions:sourceChange.fileWasIndex', {
      name,
      previous: previous.sourceName,
    })
  else if (next.kind === 'index' && previous.kind === 'bundle')
    warning = t('extensions:sourceChange.indexWasFile', {
      name,
      next: next.sourceName,
      file: previous.fileName,
    })
  else if (next.kind === 'index' && previous.kind === 'index') {
    // By URL: removing and re-adding an index gives it a new id.
    if (next.url !== previous.url)
      warning = t('extensions:sourceChange.indexWasIndex', {
        name,
        next: next.sourceName,
        previous: previous.sourceName,
      })
    // Same index, but its key was dropped or the listing no longer verifies.
    else if (from.verified && !staged.verified)
      warning = t('extensions:sourceChange.unsigned', {
        name,
        previous: previous.sourceName,
      })
  }
  if (!warning) return null
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-500/40 p-2 text-xs text-amber-600 dark:text-amber-400"
    >
      {warning}
    </p>
  )
}

export interface StagedDialogProps {
  staged: StagedInstall
  /** The index the bundle came from, for index installs. */
  sourceName?: string
  /** Called with every permission the manifest requests. */
  onConfirm: (granted: PermissionString[]) => void
  onCancel: () => void
  /** While the confirmation is in flight, nothing can be clicked. */
  busy?: boolean
}

/**
 * The frame both consent dialogs share: title, origin and trust gate,
 * and the footer. Consent is all-or-nothing, so confirming always grants
 * exactly what the manifest requests; `confirm_install` refuses less.
 */
export function StagedDialog({
  staged,
  sourceName,
  onConfirm,
  onCancel,
  busy = false,
  title,
  description,
  confirmLabel,
  children,
}: StagedDialogProps & {
  title: string
  description: string
  confirmLabel: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [trusted, setTrusted] = useState(false)
  const canConfirm = !busy && (staged.verified || trusted)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <SourceChange staged={staged} />
        <StagedOrigin
          staged={staged}
          sourceName={sourceName}
          trusted={trusted}
          onTrustedChange={setTrusted}
        />
        {children}
        <DialogFooter>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            {t('extensions:cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!canConfirm}
            onClick={() => onConfirm([...staged.manifest.permissions])}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
