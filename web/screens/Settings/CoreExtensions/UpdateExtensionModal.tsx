import React from 'react'

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

type Props = {
  onUpdateClick: () => void
}

const UpdateExtensionModal: React.FC<Props> = ({ onUpdateClick }) => {
  return (
    <Modal>
      <ModalTrigger asChild onClick={(e) => e.stopPropagation()}>
        <div className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary">
          <Paintbrush size={16} className="text-muted-foreground" />
          <span className="text-bold text-black dark:text-muted-foreground">
            Update extension
          </span>
        </div>
      </ModalTrigger>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Clean Thread</ModalTitle>
        </ModalHeader>
        <p>
          Updating this extension may result in the loss of any custom models or
          data associated with the current version. We recommend backing up any
          important data before proceeding with the update.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button themes="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button themes="danger" onClick={onUpdateClick} autoFocus>
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default React.memo(UpdateExtensionModal)
