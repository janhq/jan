'use client'

import React, { useCallback, useEffect } from 'react'

import { AppConfiguration } from '@janhq/core/.'
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
        <p className="mt-1 text-muted-foreground">{`To confirm, please enter the word "RESET" below:`}</p>
        <Input placeholder='Enter "RESET"' />
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setModalValidation(false)}>
              <Button themes="outline">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                themes="danger"
                disabled
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
