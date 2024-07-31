import { Fragment, useCallback, useMemo } from 'react'

import { Button, Modal, ModalClose } from '@janhq/joi'
import { atom, useAtom, useAtomValue } from 'jotai'

import { activeModelsAtom } from '@/helpers/atoms/Model.atom'

export const showWarningMultipleModelModalAtom = atom<boolean>(false)

const WarningMultipleModelModal: React.FC = () => {
  const [showWarningMultipleModelModal, setShowWarningMultipleModelModal] =
    useAtom(showWarningMultipleModelModalAtom)
  const activeModels = useAtomValue(activeModelsAtom)

  const onClose = useCallback(() => {
    setShowWarningMultipleModelModal(false)
  }, [setShowWarningMultipleModelModal])

  const title = useMemo(
    () => `${activeModels.length} models is running`,
    [activeModels]
  )

  return (
    <Modal
      hideClose
      open={showWarningMultipleModelModal}
      onOpenChange={onClose}
      title={title}
      content={
        <Fragment>
          <p className="text-[hsla(var(--text-secondary))]">
            This may affect performance. Please review them via System Monitor
            in the lower right conner of Jan app.
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

export default WarningMultipleModelModal
