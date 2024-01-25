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

const ModalErrorSetDestGlobal = () => {
  const { isErrorSetNewDest, setIsErrorSetNewDest } = useVaultDirectory()
  return (
    <Modal
      open={isErrorSetNewDest}
      onOpenChange={() => setIsErrorSetNewDest(false)}
    >
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Error Occurred</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          Oops! Something went wrong. Jan data folder remains the same. Please
          try again.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setIsErrorSetNewDest(false)}>
              <Button themes="danger">Got it</Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalErrorSetDestGlobal
