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
    resolveRef:
      | ((value: 'ctx_len' | 'context_shift' | undefined) => void)
      | null
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

    const handleContextLength = () => {
      setIsOpen(false)
      if (modalProps.resolveRef) {
        modalProps.resolveRef('ctx_len')
      }
    }

    const handleContextShift = () => {
      setIsOpen(false)
      if (modalProps.resolveRef) {
        modalProps.resolveRef('context_shift')
      }
    }
    const handleCancel = () => {
      setIsOpen(false)
      if (modalProps.resolveRef) {
        modalProps.resolveRef(undefined)
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
                setIsOpen(false)
              }}
            >
              {t('outOfContextError.truncateInput', 'Truncate Input')}
            </Button>
            <Button
              asChild
              onClick={() => {
                handleContextLength()
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
