import { memo, useCallback, useState } from 'react'

import { Button, Modal, ModalClose } from '@janhq/joi'
import { useSetAtom } from 'jotai'

import { approvedThreadToolsAtom } from '@/helpers/atoms/Thread.atom'

export function useTollCallPromiseModal() {
  const [isOpen, setIsOpen] = useState(false)
  const setApprovedToolsAtom = useSetAtom(approvedThreadToolsAtom)
  const [modalProps, setModalProps] = useState<{
    toolName: string
    threadId: string
    resolveRef: ((value: unknown) => void) | null
  }>({
    toolName: '',
    threadId: '',
    resolveRef: null,
  })

  // Function to open the modal and return a Promise
  const showModal = useCallback((toolName: string, threadId: string) => {
    return new Promise((resolve) => {
      setModalProps({
        toolName,
        threadId,
        resolveRef: resolve,
      })
      setIsOpen(true)
    })
  }, [])

  const PromiseModal = useCallback(() => {
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
      <Modal
        title={<span>Allow tool from {modalProps.toolName} (local)?</span>}
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(!isOpen)
          if (!open) handleCancel()
        }}
        content={
          <div>
            <p className="text-[hsla(var(--text-secondary))]">
              Malicious MCP servers or conversation content could potentially
              trick Jan into attempting harmful actions through your installed
              tools. Review each action carefully before approving.
            </p>
            <div className="mt-4 flex justify-end gap-x-2">
              <ModalClose asChild>
                <Button
                  theme="ghost"
                  variant="outline"
                  onClick={() => {
                    setApprovedToolsAtom((prev) => {
                      const newState = { ...prev }
                      if (!newState[modalProps.threadId]) {
                        newState[modalProps.threadId] = []
                      }
                      if (
                        !newState[modalProps.threadId].includes(
                          modalProps.toolName
                        )
                      ) {
                        newState[modalProps.threadId].push(modalProps.toolName)
                      }
                      return newState
                    })
                    handleConfirm()
                  }}
                  autoFocus
                >
                  Allow for this chat
                </Button>
              </ModalClose>
              <ModalClose asChild>
                <Button
                  theme="ghost"
                  variant="outline"
                  onClick={handleConfirm}
                  autoFocus
                >
                  Allow once
                </Button>
              </ModalClose>
              <ModalClose asChild onClick={handleCancel}>
                <Button theme="destructive">Deny</Button>
              </ModalClose>
            </div>
          </div>
        }
      />
    )
  }, [isOpen, modalProps])
  return { showModal, PromiseModal }
}
