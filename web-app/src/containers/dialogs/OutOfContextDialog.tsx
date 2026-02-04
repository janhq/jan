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
<<<<<<< HEAD
            variant="link"
            className="bg-transparent border border-main-view-fg/20 hover:bg-main-view-fg/4"
=======
            variant="ghost"
            size="sm"
            className="bg-transparent border"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            onClick={() => {
              handleContextShift()
            }}
          >
            {t('model-errors:truncateInput')}
          </Button>
          <Button
            autoFocus
<<<<<<< HEAD
=======
            size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            onClick={() => {
              handleContextLength()
            }}
          >
<<<<<<< HEAD
            <span className="text-main-view-fg/70">
=======
            <span className="text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              {t('model-errors:increaseContextSize')}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
