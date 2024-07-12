import { useQuery } from '@tanstack/react-query'

import useCortex from './useCortex'

export const cortexConfigQueryKey = ['cortexConfig']

const useConfigQuery = () => {
  const { getCortexConfigs } = useCortex()

  return useQuery({
    queryKey: cortexConfigQueryKey,
    queryFn: getCortexConfigs,
    staleTime: 5 * 60 * 1000,
  })
}

export default useConfigQuery
