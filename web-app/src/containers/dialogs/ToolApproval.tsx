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
            <div className="shrink-0">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>{t('tools:toolApproval.title')}</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
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
          <div className="bg-main-view-fg/4 p-2 border border-main-view-fg/5 rounded-lg overflow-x-scroll">
            <h4 className="text-sm font-medium text-main-view-fg mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <div className="relative bg-main-view-fg/6 rounded-md p-2 text-sm font-mono border border-main-view-fg/5 overflow-x-auto">
              <pre className="text-main-view-fg/80 whitespace-pre-wrap">
                {JSON.stringify(toolParameters, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div className="bg-main-view-fg/1 p-2 border border-main-view-fg/5 rounded-lg">
          <p className="text-sm text-main-view-fg/70 leading-relaxed">
            {t('tools:toolApproval.securityNotice')}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="link"
            onClick={handleDeny}
            className="flex-1 text-right sm:flex-none"
          >
            {t('tools:toolApproval.deny')}
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <Button
              variant="link"
              onClick={handleAllowOnce}
              className="border border-main-view-fg/20"
            >
              {t('tools:toolApproval.allowOnce')}
            </Button>
            <Button
              variant="default"
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
