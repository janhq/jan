import React from 'react'

import {
  Modal,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
} from '@janhq/uikit'

import { useVaultDirectory } from '@/hooks/useVaultDirectory'

const ModalSameDirectory = () => {
  const { isSameDirectory, setIsSameDirectory, setNewDestination } =
    useVaultDirectory()
  return (
    <Modal
      open={isSameDirectory}
      onOpenChange={() => setIsSameDirectory(false)}
    >
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Unable to move files</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          {`It seems like the folder you've chosen same with current directory`}
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setIsSameDirectory(false)}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button themes="danger" onClick={setNewDestination} autoFocus>
                Choose a different folder
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalSameDirectory
