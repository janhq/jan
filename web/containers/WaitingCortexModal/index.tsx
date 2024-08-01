import { Modal } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import Spinner from '../Loader/Spinner'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { hostAtom } from '@/helpers/atoms/AppConfig.atom'
import { useCallback, useEffect } from 'react'
import useCortex from '@/hooks/useCortex'

const WaitingForCortexModal: React.FC = () => {
  const host = useAtomValue(hostAtom)
  const [waitingForCortex, setWaitingForCortex] = useAtom(waitingForCortexAtom)
  const { isSystemAlive } = useCortex()
  
  const checkSystemAlive = useCallback(async () => {
    setWaitingForCortex(!(await isSystemAlive()))
  }, [])
  
  // Check health for the first time on mount
  useEffect(() => {
    checkSystemAlive()
  }, [])

  return (
    <Modal
      hideClose
      open={waitingForCortex}
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
