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

export const showDestNotEmptyConfirmAtom = atom(false)

type Props = {
  onUserConfirmed: () => void
}

const ModalChangeDestNotEmpty: React.FC<Props> = ({ onUserConfirmed }) => {
  const [show, setShow] = useAtom(showDestNotEmptyConfirmAtom)

  return (
    <Modal open={show} onOpenChange={setShow}>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <span className="block pr-8 leading-relaxed">
              This folder is not empty. Are you sure you want to relocate Jan
              Data Folder here?
            </span>
          </ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          You may accidentally delete your other personal data when uninstalling
          the app in the future. Are you sure you want to proceed with this
          folder? Please review your selection carefully.
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button onClick={onUserConfirmed} autoFocus themes="danger">
                Yes, Proceed
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalChangeDestNotEmpty
