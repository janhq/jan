import { Modal, ModalContent, ModalHeader, ModalTitle } from '@janhq/uikit'
import { atom, useAtomValue } from 'jotai'

import {
  FactoryResetState,
  factoryResetStateAtom,
} from '@/hooks/useFactoryReset'

const resetModalVisibilityAtom = atom((get) => {
  const visible = get(factoryResetStateAtom) !== FactoryResetState.Idle
  return visible
})

const ResettingModal: React.FC = () => {
  const visibility = useAtomValue(resetModalVisibilityAtom)

  return (
    <Modal open={visibility}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Factory reset in progress..</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">Resetting..</p>
      </ModalContent>
    </Modal>
  )
}

export default ResettingModal
