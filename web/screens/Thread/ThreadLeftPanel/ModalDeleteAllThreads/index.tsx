import { useCallback, memo } from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'

import { useAtom, useAtomValue } from 'jotai'

import useDeleteThread from '@/hooks/useDeleteThread'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

import {
  modalActionThreadAtom,
  ThreadModalAction,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const ModalDeleteAllThreads = () => {
  const { deleteAllThreads } = useDeleteThread()
  const [modalActionThread, setModalActionThread] = useAtom(
    modalActionThreadAtom
  )
  const [threads] = useAtom(threadsAtom)
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)

  const onDeleteAllThreads = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      deleteAllThreads(threads)
    },
    [deleteAllThreads, threads]
  )

  const onCloseModal = useCallback(() => {
    setModalActionThread({
      showModal: undefined,
      thread: undefined,
    })
  }, [setModalActionThread])

  return (
    <Modal
      title="Delete All Threads"
      onOpenChange={onCloseModal}
      open={modalActionThread.showModal === ThreadModalAction.DeleteAll}
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to delete all chat history? This will remove{' '}
            all {threads.length} conversation threads in{' '}
            <span className="font-mono">{janDataFolderPath}\threads</span> and
            cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                theme="destructive"
                onClick={onDeleteAllThreads}
              >
                Delete
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default memo(ModalDeleteAllThreads)
