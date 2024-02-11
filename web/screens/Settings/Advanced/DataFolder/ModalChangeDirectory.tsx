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

import { atom, useAtom } from 'jotai'

export const showDirectoryConfirmModalAtom = atom(false)

type Props = {
  destinationPath: string
  onUserConfirmed: () => void
}

const ModalChangeDirectory: React.FC<Props> = ({
  destinationPath,
  onUserConfirmed,
}) => {
  const [show, setShow] = useAtom(showDirectoryConfirmModalAtom)

  return (
    <Modal open={show} onOpenChange={setShow}>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Relocate Jan Data Folder</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          Are you sure you want to relocate Jan data folder to{' '}
          <span className="font-medium text-foreground">{destinationPath}</span>
          ? A restart will be required afterward.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button onClick={onUserConfirmed} autoFocus>
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
