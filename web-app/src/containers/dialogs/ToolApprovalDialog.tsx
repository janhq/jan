import type { ReactNode } from 'react'
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

// Imported rather than redeclared: the approval store owns the scopes, and a
// second copy here silently missed `allow-thread` when that was added.
import type { ApprovalDecision } from '@/hooks/useToolApprovalRequests'
export type { ApprovalDecision }

/**
 * Presentational approval dialog shared by the chat MCP tool-approval flow
 * (`ToolApproval`) and the code agent's permission prompt (`CodePermissionDialog`).
 *
 * It owns only the shell — the shared `tools:toolApproval.*` copy, the
 * deny / allow-once / allow-always footer, and close-as-deny semantics (Esc or
 * click-away resolves to `deny`, the safe default). Callers inject the
 * request-specific body (parameters, command, path, diff) as `children` and map
 * the returned decision onto their own plumbing.
 */
export function ToolApprovalDialog({
  open,
  toolName,
  description,
  offersAlways = true,
  showSecurityNotice = false,
  children,
  onDecision,
}: {
  open: boolean
  toolName: string
  /** Override the default "assistant wants to use {toolName}" description line. */
  description?: ReactNode
  /** Show the allow-always button (defaults to true, matching the chat flow). */
  offersAlways?: boolean
  showSecurityNotice?: boolean
  children?: ReactNode
  onDecision: (decision: ApprovalDecision) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDecision('deny')
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 text-muted-foreground">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>{t('tools:toolApproval.title')}</DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                {description ?? (
                  <>
                    {t('tools:toolApproval.description')}{' '}
                    <span className="font-semibold">{toolName}</span>.&nbsp;
                    <span className="text-sm">
                      {t('tools:toolApproval.permissionScope')}
                    </span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {children}

        {showSecurityNotice && (
          <div className="p-2 border bg-secondary rounded-lg">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('tools:toolApproval.securityNotice')}
            </p>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDecision('deny')}
            className="flex-1 text-right sm:flex-none"
          >
            {t('tools:toolApproval.deny')}
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <Button
              variant="ghost"
              size="sm"
              autoFocus={!offersAlways}
              onClick={() => onDecision('allow-once')}
            >
              {t('tools:toolApproval.allowOnce')}
            </Button>
            {offersAlways && (
              <Button
                variant="default"
                size="sm"
                autoFocus
                className="capitalize"
                onClick={() => onDecision('allow-always')}
              >
                {t('tools:toolApproval.alwaysAllow')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
