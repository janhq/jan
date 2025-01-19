import React, { useCallback, useState } from 'react'

import { Modal, ModalClose, Button, Input, Checkbox } from '@janhq/joi'

import { atom, useAtom } from 'jotai'

import useFactoryReset from '@/hooks/useFactoryReset'

export const modalValidationAtom = atom(false)

const ModalConfirmReset = () => {
  const [modalValidation, setModalValidation] = useAtom(modalValidationAtom)
  const { resetAll } = useFactoryReset()
  const [inputValue, setInputValue] = useState('')

  const onFactoryResetClick = useCallback(() => {
    setModalValidation(false)
    resetAll()
  }, [resetAll, setModalValidation])

  return (
    <Modal
      open={modalValidation}
      onOpenChange={() => setModalValidation(false)}
      title="Are you sure you want to reset to default settings?"
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Restore appplication to its initial state, erasing all models and
            chat history. This action is irreversible and recommended only if
            the application is corrupted.
          </p>

          <div className="my-4">
            <p className="text-[hsla(var(--text-secondary)] mb-2 mt-1">{`To confirm, please enter the word "RESET" below:`}</p>
            <Input
              placeholder='Enter "RESET"'
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>

          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setModalValidation(false)}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                theme="destructive"
                disabled={inputValue !== 'RESET'}
                onClick={onFactoryResetClick}
              >
                Reset Now
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ModalConfirmReset
