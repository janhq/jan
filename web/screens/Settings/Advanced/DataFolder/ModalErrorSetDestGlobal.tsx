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
import { atom, useAtom, useAtomValue } from 'jotai'

import { errorAtom } from '.'

export const showChangeFolderErrorAtom = atom(false)

const ModalErrorSetDestGlobal = () => {
  const [show, setShow] = useAtom(showChangeFolderErrorAtom)
  const error = useAtomValue(errorAtom)
  return (
    <Modal open={show} onOpenChange={setShow}>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Error Occurred</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          Oops! Something went wrong. Jan data folder remains the same. Please
          try again.
        </p>
        <p className="text-muted-foreground">{error}</p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button themes="danger">Got it</Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalErrorSetDestGlobal
