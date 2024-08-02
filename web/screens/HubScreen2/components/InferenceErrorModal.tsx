import { Fragment, useCallback } from 'react'

import { LlmEngine } from '@janhq/core'
import { Button, Modal, ModalClose } from '@janhq/joi'
import { atom, useAtom } from 'jotai'

export type InferenceError = {
  message: string
  engine?: LlmEngine
}

export const inferenceErrorAtom = atom<InferenceError | undefined>(undefined)

const InferenceErrorModal: React.FC = () => {
  const [inferenceError, setInferenceError] = useAtom(inferenceErrorAtom)

  const onClose = useCallback(() => {
    setInferenceError(undefined)
  }, [setInferenceError])

  return (
    <Modal
      hideClose
      open={inferenceError != null}
      onOpenChange={onClose}
      title={'Inference error'}
      content={
        <Fragment>
          <p className="text-[hsla(var(--text-secondary))]">
            {inferenceError?.message}
          </p>
          <div className="mt-4 flex justify-end">
            <ModalClose asChild>
              <Button onClick={onClose} autoFocus theme="destructive">
                OK
              </Button>
            </ModalClose>
          </div>
        </Fragment>
      }
    />
  )
}

export default InferenceErrorModal
