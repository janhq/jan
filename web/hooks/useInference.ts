import { useAtomValue } from 'jotai'

import { threadStatesAtom } from '@/helpers/atoms/Thread.atom'

export default function useInference() {
  const threadStates = useAtomValue(threadStatesAtom)

  const isGeneratingResponse = Object.values(threadStates).some(
    (threadState) => threadState.waitingForResponse
  )

  return {
    isGeneratingResponse,
  }
}
