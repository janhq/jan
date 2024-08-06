import { useCallback, useEffect, useState } from 'react'

import { Modal } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import useCortex from '@/hooks/useCortex'

import Spinner from '../Loader/Spinner'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { hostAtom } from '@/helpers/atoms/AppConfig.atom'

const WaitingForCortexModal: React.FC = () => {
  const host = useAtomValue(hostAtom)
  const [waitingForCortex, setWaitingForCortex] = useAtom(waitingForCortexAtom)
  const [timedOut, setTimedOut] = useState(false)
  const { isSystemAlive } = useCortex()

  const checkSystemAlive = useCallback(async () => {
    setWaitingForCortex(!(await isSystemAlive()))
  }, [setWaitingForCortex, isSystemAlive])

  // Check health for the first time on mount
  useEffect(() => {
    checkSystemAlive()
  }, [checkSystemAlive])

  useEffect(() => {
    setTimeout(() => {
      if (waitingForCortex) setTimedOut(true)
    }, 5000)
  }, [waitingForCortex])

  return (
    <Modal
      hideClose
      open={waitingForCortex}
      title={'Loading dependencies'}
      content={
        <div className="flex gap-x-2">
          <p className="mt-[2px] text-[hsla(var(--text-secondary))]">
            Running API Server at{' '}
            <a
              href={`${host}/api`}
              target="_blank"
              className="text-[hsla(var(--app-link))] hover:underline"
            >
              {host}/api
            </a>
            , please wait for a moment...
            <br /> <br />
            {timedOut && (
              <span>
                The API server is taking longer than usual to start. If this
                process continues to run for a minute, please check the log file
                under the Jan Data Folder path or restart the application.
              </span>
            )}
          </p>
          <Spinner />
        </div>
      }
    />
  )
}

export default WaitingForCortexModal
