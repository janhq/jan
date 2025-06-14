import { t } from 'i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { ReactNode, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'

export function useOutOfContextPromiseModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [modalProps, setModalProps] = useState<{
    resolveRef: ((value: unknown) => void) | null
  }>({
    resolveRef: null,
  })
  // Function to open the modal and return a Promise
  const showModal = useCallback(() => {
    return new Promise((resolve) => {
      setModalProps({
        resolveRef: resolve,
      })
      setIsOpen(true)
    })
  }, [])

  const PromiseModal = useCallback((): ReactNode => {
    if (!isOpen) {
      return null
    }

    const handleConfirm = () => {
      setIsOpen(false)
      if (modalProps.resolveRef) {
        modalProps.resolveRef(true)
      }
    }

    const handleCancel = () => {
      setIsOpen(false)
      if (modalProps.resolveRef) {
        modalProps.resolveRef(false)
      }
    }

    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open)
          if (!open) handleCancel()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('outOfContextError.title', 'Out of context error')}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            {t(
              'outOfContextError.description',
              'This chat is reaching the AI’s memory limit, like a whiteboard filling up. We can expand the memory window (called context size) so it remembers more, but it may use more of your computer’s memory.'
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
              onClick={() => setIsOpen(false)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              asChild
              onClick={() => {
                handleConfirm()
                setIsOpen(false)
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
  }, [isOpen, modalProps])
  return { showModal, PromiseModal }
}
