import { useCallback, memo } from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { Trash2Icon } from 'lucide-react'

import useDeleteThread from '@/hooks/useDeleteThread'

type Props = {
  threadId: string
}

const DeleteThreadModal: React.FC<Props> = ({ threadId }) => {
  const { deleteThread } = useDeleteThread()
  const onDeleteThreadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      deleteThread(threadId)
    },
    [deleteThread, threadId]
  )

  return (
    <Modal
      title="Delete Thread"
      trigger={
        <div
          className="flex cursor-pointer items-center space-x-2 px-4 py-2"
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
          <p className="text-[hsla(var(--app-text-secondary))]">
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

export default memo(DeleteThreadModal)
