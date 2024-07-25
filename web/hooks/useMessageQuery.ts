import { useQuery } from '@tanstack/react-query'

import useCortex from './useCortex'

export const messageQueryKey = ['getMessages']

const useMessageQuery = (threadId: string) => {
  const { fetchMessages } = useCortex()

  return useQuery({
    queryKey: [...messageQueryKey, threadId],
    queryFn: () => fetchMessages(threadId),
    staleTime: 30 * 1000,
  })
}

export default useMessageQuery
