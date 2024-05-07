import { useCallback, memo } from 'react'

import { Button, Modal, ModalClose } from '@janhq/joi'
import { Paintbrush } from 'lucide-react'

import useDeleteThread from '@/hooks/useDeleteThread'

type Props = {
  threadId: string
}

const CleanThreadModal: React.FC<Props> = ({ threadId }) => {
  const { cleanThread } = useDeleteThread()
  const onCleanThreadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      cleanThread(threadId)
    },
    [cleanThread, threadId]
  )

  return (
    <Modal
      title="Clean Thread"
      trigger={
        <div
          className="flex cursor-pointer items-center space-x-2 px-4 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Paintbrush
            size={16}
            className="text-[hsla(var(--text-secondary))]"
          />
          <span className="text-bold text-[hsla(var(--app-text-primary))]">
            Clean thread
          </span>
        </div>
      }
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to clean this thread?
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
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

export default memo(CleanThreadModal)
