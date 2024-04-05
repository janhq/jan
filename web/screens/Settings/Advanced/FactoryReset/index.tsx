import { Button } from '@janhq/uikit'

import { useSetAtom } from 'jotai'

import ModalValidation, { modalValidationAtom } from './ModalConfirmReset'

const FactoryReset = () => {
  const setModalValidation = useSetAtom(modalValidationAtom)

  return (
    <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
      <div className="w-4/5 flex-shrink-0 space-y-1.5">
        <div className="flex gap-x-2">
          <h6 className="text-sm font-semibold capitalize">
            Reset to Factory Default
          </h6>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">
          Reset the application to its original state, deleting all your usage
          data, including model customizations and conversation history. This
          action is irreversible and recommended only if the application is in a
          corrupted state.
        </p>
      </div>
      <Button
        size="sm"
        themes="secondaryDanger"
        onClick={() => setModalValidation(true)}
      >
        Reset
      </Button>
      <ModalValidation />
    </div>
  )
}

export default FactoryReset
