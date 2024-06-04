import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'

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
    <Modal
      open={show}
      title="Relocate Jan Data Folder"
      onOpenChange={setShow}
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to relocate Jan data folder to{' '}
            <span className="font-medium">{destinationPath}</span>
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
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setShow(false)}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button onClick={onUserConfirmed} autoFocus>
                Yes, Proceed
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ModalChangeDirectory
