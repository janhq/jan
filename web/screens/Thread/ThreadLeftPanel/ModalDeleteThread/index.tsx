import { useCallback, memo } from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { useAtom } from 'jotai'

import useDeleteThread from '@/hooks/useDeleteThread'

import {
  modalActionThreadAtom,
  ThreadModalAction,
} from '@/helpers/atoms/Thread.atom'

const ModalDeleteThread = () => {
  const { deleteThread } = useDeleteThread()
  const [modalActionThread, setModalActionThread] = useAtom(
    modalActionThreadAtom
  )

  const onDeleteThreadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      deleteThread(modalActionThread.thread?.id as string)
    },
    [deleteThread, modalActionThread.thread?.id]
  )

  const onCloseModal = useCallback(() => {
    setModalActionThread({
      showModal: undefined,
      thread: undefined,
    })
  }, [setModalActionThread])

  return (
    <Modal
      title="Delete Thread"
      onOpenChange={onCloseModal}
      open={modalActionThread.showModal === ThreadModalAction.Delete}
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to delete this thread? This action cannot be
            undone.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button theme="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                theme="destructive"
                onClick={onDeleteThreadClick}
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

export default memo(ModalDeleteThread)
