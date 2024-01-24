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

const ModalChangeDirectory = () => {
  const {
    isDirectoryConfirm,
    setIsDirectoryConfirm,
    applyNewDestination,
    newDestinationPath,
  } = useVaultDirectory()
  return (
    <Modal
      open={isDirectoryConfirm}
      onOpenChange={() => setIsDirectoryConfirm(false)}
    >
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Relocate Jan Data Folder</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          Are you sure you want to relocate Jan data folder to{' '}
          <span className="font-medium text-foreground">
            {newDestinationPath}
          </span>
          ? A restart will be required afterward.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setIsDirectoryConfirm(false)}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button onClick={applyNewDestination} autoFocus>
                Yes, Proceed
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalChangeDirectory
