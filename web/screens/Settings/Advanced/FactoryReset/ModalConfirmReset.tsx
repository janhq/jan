'use client'

import React, { useCallback, useState } from 'react'

import {
  Modal,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
  Input,
} from '@janhq/uikit'
import { atom, useAtom } from 'jotai'

import useFactoryReset from '@/hooks/useFactoryReset'

export const modalValidationAtom = atom(true)

const ModalConfirmReset = () => {
  const [modalValidation, setModalValidation] = useAtom(modalValidationAtom)
  const { resetAll } = useFactoryReset()
  const onFactoryResetClick = useCallback(() => resetAll(), [])
  const [inputValue, setInputValue] = useState('')

  return (
    <Modal
      open={modalValidation}
      onOpenChange={() => setModalValidation(false)}
    >
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Are you sure you want to reset to default settings?
          </ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
          It will reset the application to its original state, deleting all your
          usage data, including model customizations and conversation history.
          This action is irreversible.
        </p>
        <div>
          <p className="mb-2 mt-1 text-muted-foreground">{`To confirm, please enter the word "RESET" below:`}</p>
          <Input
            placeholder='Enter "RESET"'
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
        <div>
          <input type="checkbox" />
        </div>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setModalValidation(false)}>
              <Button themes="outline">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                themes="danger"
                disabled={inputValue !== 'RESET'}
                onClick={onFactoryResetClick}
              >
                Reset Now
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalConfirmReset
