import React from 'react'

import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
} from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

const CancelModelImportModal: React.FC = () => {
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const onContinueClick = () => {
    setImportModelStage('IMPORTING_MODEL')
  }

  const onCancelAllClick = () => {
    setImportModelStage('NONE')
  }

  return (
    <Modal open={importModelStage === 'CONFIRM_CANCEL'}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Cancel Model Import?</ModalTitle>
        </ModalHeader>

        <p>
          The model import process is not complete. Are you sure you want to
          cancel all ongoing model imports? This action is irreversible and the
          progress will be lost.
        </p>

        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={onContinueClick}>
              <Button themes="ghost">Continue</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button autoFocus themes="danger" onClick={onCancelAllClick}>
                Cancel All
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default React.memo(CancelModelImportModal)
