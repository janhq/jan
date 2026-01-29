import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToolApproval } from '@/hooks/useToolApproval'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

export default function ToolApproval() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps, setModalOpen } = useToolApproval()

  if (!modalProps) {
    return null
  }

  const { toolName, toolParameters, onApprove, onDeny } = modalProps

  const handleAllowOnce = () => {
    onApprove(true) // true = allow once only
  }

  const handleAllow = () => {
    onApprove(false) // false = remember for this thread
  }

  const handleDeny = () => {
    onDeny()
  }

  const handleDialogOpen = (open: boolean) => {
    setModalOpen(open)
    if (!open) {
      onDeny()
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleDialogOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 text-muted-foreground">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>{t('tools:toolApproval.title')}</DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                {t('tools:toolApproval.description')}{' '}
                <span className="font-semibold">{toolName}</span>.&nbsp;
                <span className="text-sm">
                  {t('tools:toolApproval.permissionScope')}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {toolParameters && Object.keys(toolParameters).length > 0 && (
          <div className="bg-background p-2 border rounded-lg overflow-x-scroll">
            <h4 className="text-sm font-medium mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <div className="relative bg-secondary rounded-md p-2 text-sm font-mono border overflow-x-auto">
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(toolParameters, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div className="p-2 border bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('tools:toolApproval.securityNotice')}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeny}
            className="flex-1 text-right sm:flex-none"
          >
            {t('tools:toolApproval.deny')}
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAllowOnce}
            >
              {t('tools:toolApproval.allowOnce')}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleAllow}
              autoFocus
              className="capitalize"
            >
              {t('tools:toolApproval.alwaysAllow')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
