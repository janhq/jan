import { memo } from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

const CancelModelImportModal = () => {
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const onContinueClick = () => {
    setImportModelStage('IMPORTING_MODEL')
  }

  const onCancelAllClick = () => {
    setImportModelStage('NONE')
  }

  return (
    <Modal
      open={importModelStage === 'CONFIRM_CANCEL'}
      title="Cancel Model Import?"
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            The model import process is not complete. Are you sure you want to
            cancel all ongoing model imports? This action is irreversible and
            the progress will be lost.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={onContinueClick}>
              <Button theme="ghost">Continue</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button autoFocus theme="destructive" onClick={onCancelAllClick}>
                Cancel All
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default memo(CancelModelImportModal)
