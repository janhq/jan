import { useQuery } from '@tanstack/react-query'

import { getEngineAndBranches } from '@/utils/huggingface'

const useHfEngineToBranchesQuery = (modelHandle: string) =>
  useQuery({
    queryKey: ['useHfEngineToBranchesQuery', modelHandle],
    queryFn: () => getEngineAndBranches(modelHandle),
  })

export default useHfEngineToBranchesQuery
