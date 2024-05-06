import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'

import { atom, useAtom } from 'jotai'

export const showSamePathModalAtom = atom(false)

type Props = {
  onChangeFolderClick: () => void
}

const ModalSameDirectory = ({ onChangeFolderClick }: Props) => {
  const [show, setShow] = useAtom(showSamePathModalAtom)

  return (
    <Modal
      open={show}
      onOpenChange={setShow}
      title="Unable to move files"
      content={
        <div>
          <p className="text-[hsla(var(--app-text-secondary))]">{`It seems like the folder you've chosen same with current directory`}</p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                theme="destructive"
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
        </div>
      }
    />
  )
}

export default ModalSameDirectory
