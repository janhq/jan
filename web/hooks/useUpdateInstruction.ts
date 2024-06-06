import { useCallback } from 'react'

import { useAtomValue } from 'jotai'

import useCortex from './useCortex'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const useUpdateInstruction = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { updateThread } = useCortex()

  const updateInstruction = useCallback(
    (instructions: string) => {
      if (!activeThread) return
      activeThread.assistants[0].instructions = instructions
      updateThread(activeThread)
    },
    [activeThread, updateThread]
  )

  return { updateInstruction }
}

export default useUpdateInstruction
