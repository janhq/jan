import { useQuery } from '@tanstack/react-query'

import useCortex from './useCortex'

export const assistantQueryKey = ['assistants']

const useAssistantQuery = () => {
  const { fetchAssistants } = useCortex()

  return useQuery({
    queryKey: assistantQueryKey,
    queryFn: fetchAssistants,
    staleTime: Infinity,
  })
}

export default useAssistantQuery
