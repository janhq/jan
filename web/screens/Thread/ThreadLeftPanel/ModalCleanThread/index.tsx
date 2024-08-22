import { useCallback, memo } from 'react'

import { Button, Modal, ModalClose } from '@janhq/joi'
import { useAtom } from 'jotai'

import useDeleteThread from '@/hooks/useDeleteThread'

import {
  modalActionThreadAtom,
  ThreadModalAction,
} from '@/helpers/atoms/Thread.atom'

const ModalCleanThread = () => {
  const { cleanThread } = useDeleteThread()
  const [modalActionThread, setModalActionThread] = useAtom(
    modalActionThreadAtom
  )

  const onCleanThreadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      cleanThread(modalActionThread.thread?.id as string)
    },
    [cleanThread, modalActionThread.thread?.id]
  )

  const onCloseModal = useCallback(() => {
    setModalActionThread({
      showModal: undefined,
      thread: undefined,
    })
  }, [setModalActionThread])

  return (
    <Modal
      title="Clean Thread"
      open={modalActionThread.showModal === ThreadModalAction.Clean}
      onOpenChange={onCloseModal}
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to clean this thread?
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose
              asChild
              onClick={(e) => {
                onCloseModal()
                e.stopPropagation()
              }}
            >
              <Button theme="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                theme="destructive"
                onClick={onCleanThreadClick}
                autoFocus
              >
                Yes
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default memo(ModalCleanThread)
