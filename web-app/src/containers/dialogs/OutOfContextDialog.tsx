import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { Button } from '@/components/ui/button'
import { useContextSizeApproval } from '@/hooks/useModelContextApproval'
import { useTranslation } from '@/i18n'

export default function OutOfContextPromiseModal() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps, setModalOpen } = useContextSizeApproval()
  if (!modalProps) {
    return null
  }
  const { onApprove, onDeny } = modalProps

  const handleContextLength = () => {
    onApprove('ctx_len')
  }

  const handleContextShift = () => {
    onApprove('context_shift')
  }

  const handleDialogOpen = (open: boolean) => {
    setModalOpen(open)
    if (!open) {
      onDeny()
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleDialogOpen}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('model-errors:title')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('model-errors:description')}
          <br />
          <br />
          {t('model-errors:increaseContextSizeDescription')}
        </DialogDescription>
        <DialogFooter className="flex gap-2">
          <Button
            variant="link"
            className="bg-transparent border border-main-view-fg/20 hover:bg-main-view-fg/4"
            onClick={() => {
              handleContextShift()
            }}
          >
            {t('model-errors:truncateInput')}
          </Button>
          <Button
            autoFocus
            onClick={() => {
              handleContextLength()
            }}
          >
            <span className="text-main-view-fg/70">
              {t('model-errors:increaseContextSize')}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
