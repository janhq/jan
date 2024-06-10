import { useCallback, useEffect } from 'react'

import { Thread } from '@janhq/core'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import {
  ModelParams,
  threadModelParamsAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const useThreads = () => {
  const setThreads = useSetAtom(threadsAtom)
  const setThreadModelRuntimeParams = useSetAtom(threadModelParamsAtom)
  const { fetchThreads } = useCortex()

  useEffect(() => {
    const getThreads = async () => {
      const threads = await fetchThreads()
      const threadModelParams: Record<string, ModelParams> = {}

      threads.forEach((thread) => {
        const modelParams = thread.assistants?.[0]?.model?.parameters
        const engineParams = thread.assistants?.[0]?.model?.settings
        threadModelParams[thread.id] = {
          ...modelParams,
          ...engineParams,
        }
      })

      setThreads(threads)
      setThreadModelRuntimeParams(threadModelParams)
    }

    getThreads()
  }, [setThreadModelRuntimeParams, setThreads, fetchThreads])
}

export default useThreads
