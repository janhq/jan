import { Modal } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import Spinner from '../Loader/Spinner'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { hostAtom } from '@/helpers/atoms/AppConfig.atom'

const WaitingForCortexModal: React.FC = () => {
  const host = useAtomValue(hostAtom)
  const open = useAtomValue(waitingForCortexAtom)

  return (
    <Modal
      hideClose
      open={open}
      title={'Waiting for cortex'}
      content={
        <div className="flex gap-x-2">
          <p className="mt-[2px] text-[hsla(var(--text-secondary))]">
            Please ensure that cortex is up and running at {host}
          </p>

          <Spinner />
        </div>
      }
    />
  )
}

export default WaitingForCortexModal
