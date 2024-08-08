import { useQuery } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { threadsAtom } from '@/helpers/atoms/Thread.atom'

export const threadQueryKey = ['getThreads']

const useThreadQuery = () => {
  const { fetchThreads } = useCortex()
  const setThreads = useSetAtom(threadsAtom)

  return useQuery({
    queryKey: threadQueryKey,
    queryFn: async () => {
      const threads = await fetchThreads()
      setThreads(threads)
      return threads
    },
    staleTime: 30 * 1000,
  })
}

export default useThreadQuery
