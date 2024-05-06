import { Modal } from '@janhq/joi'
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
    <Modal
      title="Factory reset in progress.."
      open={visibility}
      hideClose
      content={<></>}
    />
  )
}

export default ResettingModal
