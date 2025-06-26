import { t } from 'i18next'
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

export default function OutOfContextPromiseModal() {
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('outOfContextError.title', 'Out of context error')}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t(
            'outOfContextError.description',
            'This chat is reaching the AI’s memory limit, like a whiteboard filling up. We can expand the memory window (called context size) so it remembers more, but it may use more of your computer’s memory. We can also truncate the input, which means it will forget some of the chat history to make room for new messages.'
          )}
          <br />
          <br />
          {t(
            'outOfContextError.increaseContextSizeDescription',
            'Do you want to increase the context size?'
          )}
        </DialogDescription>
        <DialogFooter className="flex gap-2">
          <Button
            variant="default"
            className="bg-transparent border border-main-view-fg/20 hover:bg-main-view-fg/4"
            onClick={() => {
              handleContextShift()
            }}
          >
            {t('outOfContextError.truncateInput', 'Truncate Input')}
          </Button>
          <Button
            asChild
            onClick={() => {
              handleContextLength()
            }}
          >
            <span className="text-main-view-fg/70">
              {t(
                'outOfContextError.increaseContextSize',
                'Increase Context Size'
              )}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
