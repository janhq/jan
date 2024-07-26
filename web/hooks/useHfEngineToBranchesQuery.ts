import { useQuery } from '@tanstack/react-query'

import { getEngineAndBranches } from '@/utils/huggingface'

const useHfEngineToBranchesQuery = (modelHandle: string) =>
  useQuery({
    queryKey: ['useHfEngineToBranchesQuery', modelHandle],
    queryFn: () => getEngineAndBranches(modelHandle),
    staleTime: 5 * 60 * 1000,
  })

export default useHfEngineToBranchesQuery
