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
import type { StagedInstall } from '@/services/extensions/types'
import { UnverifiedBadge } from './UnverifiedBadge'

/**
 * Where a staged bundle came from, shared by the install and update
 * dialogs. An unverified bundle shows its hash and must be explicitly
 * trusted (`trusted`/`onTrustedChange`) before it can be installed.
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
  if (staged.verified)
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        {sourceName && (
          <span className="font-medium">
            {t('extensions:origin.fromSource', { source: sourceName })}
          </span>
        )}
        <span className="text-muted-foreground">
          {t('extensions:origin.integrityChecked')}
        </span>
      </div>
    )
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
      <div className="flex items-center gap-2">
        <UnverifiedBadge />
        <span className="text-xs text-muted-foreground">
          {t('extensions:origin.unverifiedHint')}
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
          {t('extensions:origin.trustAuthor')}
        </Label>
      </div>
    </div>
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
