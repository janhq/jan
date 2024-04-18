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
          ? <br /> A restart is required afterward, and the original folder
          remains intact.
          <br />
          {isWindows && (
            <span>
              Note that Jan will not erase the new Jan data folder upon future
              uninstallation.
            </span>
          )}
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
