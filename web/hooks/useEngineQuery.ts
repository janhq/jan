import { useQuery } from '@tanstack/react-query'

import useCortex from './useCortex'

const engineQueryKey = ['getEngineStatuses']

const useEngineQuery = () => {
  const { getEngineStatuses } = useCortex()

  return useQuery({
    queryKey: engineQueryKey,
    queryFn: getEngineStatuses,
    staleTime: 30 * 1000,
  })
}

export default useEngineQuery
