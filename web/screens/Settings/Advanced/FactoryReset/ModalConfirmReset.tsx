import React, { useCallback, useState } from 'react'

import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
  Checkbox,
  Input,
} from '@janhq/uikit'
import { atom, useAtom } from 'jotai'

import useFactoryReset from '@/hooks/useFactoryReset'

export const modalValidationAtom = atom(false)

const ModalConfirmReset = () => {
  const [modalValidation, setModalValidation] = useAtom(modalValidationAtom)
  const { resetAll, defaultJanDataFolder } = useFactoryReset()
  const [inputValue, setInputValue] = useState('')
  const [currentDirectoryChecked, setCurrentDirectoryChecked] = useState(true)
  const onFactoryResetClick = useCallback(
    () => resetAll(currentDirectoryChecked),
    [currentDirectoryChecked, resetAll]
  )

  return (
    <Modal
      open={modalValidation}
      onOpenChange={() => setModalValidation(false)}
    >
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
        <div className="flex flex-shrink-0 items-start space-x-2">
          <Checkbox
            id="currentDirectory"
            checked={currentDirectoryChecked}
            onCheckedChange={(e) => setCurrentDirectoryChecked(Boolean(e))}
          />
          <div className="mt-0.5 flex flex-col">
            <label
              htmlFor="currentDirectory"
              className="cursor-pointer text-sm font-medium leading-none"
            >
              Keep the current app data location
            </label>
            <p className="mt-2 leading-relaxed">
              Otherwise it will reset back to its original location at:{' '}
              {/* TODO should be from system */}
              <span className="font-medium">{defaultJanDataFolder}</span>
            </p>
          </div>
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
