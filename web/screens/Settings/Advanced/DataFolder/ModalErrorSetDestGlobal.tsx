import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'

import { atom, useAtom } from 'jotai'

export const showChangeFolderErrorAtom = atom(false)

const ModalErrorSetDestGlobal = () => {
  const [show, setShow] = useAtom(showChangeFolderErrorAtom)
  return (
    <Modal
      open={show}
      onOpenChange={setShow}
      title="An Error Occurred"
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Oops! Something went wrong. Jan data folder remains the same. Please
            try again.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button theme="destructive" autoFocus>
                Got it
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ModalErrorSetDestGlobal
