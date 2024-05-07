import { Button } from '@janhq/joi'

import { useSetAtom } from 'jotai'

import ModalValidation, { modalValidationAtom } from './ModalConfirmReset'
import ResettingModal from './ResettingModal'

const FactoryReset = () => {
  const setModalValidation = useSetAtom(modalValidationAtom)

  return (
    <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
      <div className="space-y-1">
        <div className="flex gap-x-2">
          <h6 className="text-sm font-semibold capitalize">
            Reset to Factory Default
          </h6>
        </div>
        <p className="whitespace-pre-wrap font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
          Reset the application to its original state, deleting all your usage
          data, including model customizations and conversation history. This
          action is irreversible and recommended only if the application is in a
          corrupted state.
        </p>
      </div>
      <Button
        size="small"
        theme="destructive"
        variant="soft"
        onClick={() => setModalValidation(true)}
      >
        Reset
      </Button>
      <ModalValidation />
      <ResettingModal />
    </div>
  )
}

export default FactoryReset
