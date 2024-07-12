import { useQuery } from '@tanstack/react-query'

import useCortex from './useCortex'

const useAssistantQuery = () => {
  const { fetchAssistants } = useCortex()

  return useQuery({
    queryKey: ['assistant'],
    queryFn: fetchAssistants,
    staleTime: 5 * 60 * 1000,
  })
}

export default useAssistantQuery
