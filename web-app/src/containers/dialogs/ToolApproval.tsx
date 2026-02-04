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
<<<<<<< HEAD
            <div className="shrink-0">
=======
            <div className="shrink-0 text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>{t('tools:toolApproval.title')}</DialogTitle>
<<<<<<< HEAD
              <DialogDescription className="mt-1 text-main-view-fg/70">
=======
              <DialogDescription className="mt-1 text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
          <div className="bg-main-view-fg/4 p-2 border border-main-view-fg/5 rounded-lg overflow-x-scroll">
            <h4 className="text-sm font-medium text-main-view-fg mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <div className="relative bg-main-view-fg/6 rounded-md p-2 text-sm font-mono border border-main-view-fg/5 overflow-x-auto">
              <pre className="text-main-view-fg/80 whitespace-pre-wrap">
=======
          <div className="bg-background p-2 border rounded-lg overflow-x-scroll">
            <h4 className="text-sm font-medium mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <div className="relative bg-secondary rounded-md p-2 text-sm font-mono border overflow-x-auto">
              <pre className="whitespace-pre-wrap">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                {JSON.stringify(toolParameters, null, 2)}
              </pre>
            </div>
          </div>
        )}

<<<<<<< HEAD
        <div className="bg-main-view-fg/1 p-2 border border-main-view-fg/5 rounded-lg">
          <p className="text-sm text-main-view-fg/70 leading-relaxed">
=======
        <div className="p-2 border bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground leading-relaxed">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            {t('tools:toolApproval.securityNotice')}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
<<<<<<< HEAD
            variant="link"
=======
            variant="ghost"
            size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            onClick={handleDeny}
            className="flex-1 text-right sm:flex-none"
          >
            {t('tools:toolApproval.deny')}
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <Button
<<<<<<< HEAD
              variant="link"
              onClick={handleAllowOnce}
              className="border border-main-view-fg/20"
=======
              variant="ghost"
              size="sm"
              onClick={handleAllowOnce}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            >
              {t('tools:toolApproval.allowOnce')}
            </Button>
            <Button
              variant="default"
<<<<<<< HEAD
=======
              size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
