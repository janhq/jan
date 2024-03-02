import React, { useCallback } from 'react'

import {
  Modal,
  ModalTrigger,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
} from '@janhq/uikit'
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
    <Modal>
      <ModalTrigger asChild onClick={(e) => e.stopPropagation()}>
        <div className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary">
          <Trash2Icon size={16} className="text-red-600" />
          <span className="text-bold text-red-600">Delete thread</span>
        </div>
      </ModalTrigger>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete Thread</ModalTitle>
        </ModalHeader>
        <p>
          Are you sure you want to delete this thread? This action cannot be
          undone.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button themes="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button autoFocus themes="danger" onClick={onDeleteThreadClick}>
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default React.memo(DeleteThreadModal)
