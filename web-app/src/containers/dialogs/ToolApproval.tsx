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

  const { toolName, onApprove, onDeny } = modalProps

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
                <span
                  dangerouslySetInnerHTML={{
                    __html: t('tools:toolApproval.description', { toolName }),
                  }}
                />
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/8 p-2 border border-main-view-fg/5 rounded-lg">
          <p className="text-sm text-main-view-fg/70 leading-relaxed">
            <span
              dangerouslySetInnerHTML={{
                __html: t('tools:toolApproval.securityNotice'),
              }}
            />
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="link" onClick={handleDeny} className="w-full">
            {t('tools:toolApproval.deny')}
          </Button>
          <Button
            variant="link"
            onClick={handleAllowOnce}
            className="border border-main-view-fg/20"
          >
            {t('tools:toolApproval.allowOnce')}
          </Button>
          <Button variant="default" onClick={handleAllow}>
            {t('tools:toolApproval.alwaysAllow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
