import React, { useCallback } from 'react'

import {
  Button,
  Modal,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalPortal,
  ModalTitle,
  ModalTrigger,
} from '@janhq/uikit'
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
    <Modal>
      <ModalTrigger asChild onClick={(e) => e.stopPropagation()}>
        <div className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary">
          <Paintbrush size={16} className="text-muted-foreground" />
          <span className="text-bold text-black">Clean thread</span>
        </div>
      </ModalTrigger>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Clean Thread</ModalTitle>
        </ModalHeader>
        <p>Are you sure you want to clean this thread?</p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button themes="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button themes="danger" onClick={onCleanThreadClick} autoFocus>
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default React.memo(CleanThreadModal)
