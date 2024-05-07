import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'

import { atom, useAtom } from 'jotai'

export const showDestNotEmptyConfirmAtom = atom(false)

type Props = {
  onUserConfirmed: () => void
}

const ModalChangeDestNotEmpty = ({ onUserConfirmed }: Props) => {
  const [show, setShow] = useAtom(showDestNotEmptyConfirmAtom)

  return (
    <Modal
      open={show}
      title="This folder is not empty. Are you sure you want to relocate Jan Data Folder here?"
      onOpenChange={setShow}
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            You may accidentally delete your other personal data when
            uninstalling the app in the future. Are you sure you want to proceed
            with this folder? Please review your selection carefully.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button onClick={onUserConfirmed} autoFocus theme="destructive">
                Yes, Proceed
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ModalChangeDestNotEmpty
