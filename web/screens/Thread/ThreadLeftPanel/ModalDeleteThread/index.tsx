import { useCallback } from 'react'

import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { Trash2Icon } from 'lucide-react'

import { toaster } from '@/containers/Toast'

import useThreads from '@/hooks/useThreads'

type Props = {
  id: string
  title: string
  closeContextMenu?: () => void
}

const ModalDeleteThread: React.FC<Props> = ({
  id,
  title,
  closeContextMenu,
}) => {
  const { deleteThread } = useThreads()

  const onDeleteThreadClick = useCallback(async () => {
    try {
      await deleteThread(id)
      toaster({
        title: 'Thread successfully deleted.',
        description: `Thread ${title} has been successfully deleted.`,
        type: 'success',
      })
    } catch (err) {
      console.log(err)
    }
  }, [deleteThread, id, title])

  return (
    <Modal
      title="Delete Thread"
      onOpenChange={(open) => {
        if (open && closeContextMenu) {
          closeContextMenu()
        }
      }}
      trigger={
        <div
          className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2Icon
            size={16}
            className="text-[hsla(var(--destructive-bg))]"
          />
          <span className="text-bold text-[hsla(var(--destructive-bg))]">
            Delete thread
          </span>
        </div>
      }
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

export default React.memo(ModalDeleteThread)
