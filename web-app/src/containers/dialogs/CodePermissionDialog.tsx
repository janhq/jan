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
import { DiffView } from '@/components/DiffView'

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny'

/** A gated tool call awaiting the user's approval, mirrors the Rust
 * `permission_request` StreamEvent (see events.rs). */
export type PendingPermission = {
  requestId: string
  toolName: string
  capability: string
  path?: string
  command?: string
  diff?: string
  promptKind: string
  offersAlways: boolean
}

/**
 * Approval dialog for a single gated agent tool call. Renders the head of the
 * pending-permission queue; closing the dialog (Esc / click-away) counts as a
 * deny so the agent never proceeds without an explicit allow.
 */
export default function CodePermissionDialog({
  request,
  onRespond,
}: {
  request: PendingPermission | null
  onRespond: (requestId: string, decision: PermissionDecision) => void
}) {
  const { t } = useTranslation()
  if (!request) return null

  const { requestId, toolName, capability, path, command, diff, offersAlways } =
    request

  const handleOpenChange = (open: boolean) => {
    if (!open) onRespond(requestId, 'deny')
  }

  return (
    <Dialog open={!!request} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('common:permissionTitle')}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="space-y-2">
            <p>
              {t('common:permissionBody', {
                tool: toolName,
                capability,
              })}
            </p>
            {command && (
              <pre className="rounded-md bg-sidebar-foreground/5 px-2 py-1.5 text-xs font-mono break-all whitespace-pre-wrap">
                {command}
              </pre>
            )}
            {path && !command && (
              <pre className="rounded-md bg-sidebar-foreground/5 px-2 py-1.5 text-xs font-mono break-all">
                {path}
              </pre>
            )}
            {diff && <DiffView diff={diff} className="mt-2" />}
          </div>
        </DialogDescription>
        <DialogFooter className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="bg-transparent border"
            onClick={() => onRespond(requestId, 'deny')}
          >
            {t('common:permissionDeny')}
          </Button>
          {offersAlways && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRespond(requestId, 'allow_always')}
            >
              {t('common:permissionAllowAlways')}
            </Button>
          )}
          <Button
            autoFocus
            size="sm"
            onClick={() => onRespond(requestId, 'allow_once')}
          >
            {t('common:permissionAllowOnce')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
