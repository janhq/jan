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

export const showSamePathModalAtom = atom(false)

type Props = {
  onChangeFolderClick: () => void
}

const ModalSameDirectory = ({ onChangeFolderClick }: Props) => {
  const [show, setShow] = useAtom(showSamePathModalAtom)

  return (
    <Modal open={show} onOpenChange={setShow}>
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
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                themes="danger"
                onClick={() => {
                  setShow(false)
                  onChangeFolderClick()
                }}
                autoFocus
              >
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
