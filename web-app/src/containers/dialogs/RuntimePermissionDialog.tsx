import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useRuntimePermission } from '@/stores/runtime-permission-store'

const riskClassName = {
  low: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-destructive',
}

export default function RuntimePermissionDialog() {
  const pending = useRuntimePermission((state) => state.pending)
  const resolvePermission = useRuntimePermission(
    (state) => state.resolvePermission
  )

  if (!pending) return null

  const risk = pending.risk ?? 'medium'
  const codexThreadId =
    typeof pending.details?.codexThreadId === 'string'
      ? pending.details.codexThreadId
      : undefined
  const janThreadId =
    typeof pending.details?.janThreadId === 'string'
      ? pending.details.janThreadId
      : typeof pending.details?.threadId === 'string'
        ? pending.details.threadId
        : undefined
  const isSubagentApproval =
    pending.details?.source === 'subagent' ||
    (codexThreadId && janThreadId && codexThreadId !== janThreadId)

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) resolvePermission('deny')
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn('shrink-0', riskClassName[risk])}>
              {risk === 'low' ? (
                <ShieldCheck className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
            </div>
            <div>
              <DialogTitle>Allow local runtime action?</DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                The app wants to run{' '}
                <span className="font-semibold text-foreground">
                  {pending.actionLabel}
                </span>
                {pending.resourceLabel ? (
                  <>
                    {' '}
                    against{' '}
                    <span className="font-semibold text-foreground">
                      {pending.resourceLabel}
                    </span>
                  </>
                ) : null}
                .
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-lg border bg-secondary p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Category: {pending.category}</span>
            <span>Risk: {risk}</span>
            {isSubagentApproval && codexThreadId ? (
              <span className="text-blue-600 dark:text-blue-400">
                Subagent thread: {codexThreadId.slice(0, 12)}…
              </span>
            ) : null}
          </div>
          {pending.details && Object.keys(pending.details).length > 0 && (
            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 font-mono text-[11px] text-foreground">
              {JSON.stringify(pending.details, null, 2)}
            </pre>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          This is the local desktop permission layer. Deny blocks this action;
          allow once runs only this request; always allow remembers this action
          type until permissions are reset.
        </p>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resolvePermission('deny')}
          >
            Deny
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resolvePermission('allow-once')}
            >
              Allow once
            </Button>
            <Button
              variant="default"
              size="sm"
              autoFocus
              onClick={() => resolvePermission('allow-always')}
            >
              Always allow
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
