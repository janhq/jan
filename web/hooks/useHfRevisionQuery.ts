import { useQuery } from '@tanstack/react-query'

import { getBranches } from '@/utils/huggingface'

const useHfRevisionQuery = (repoName: string) =>
  useQuery({
    queryKey: ['hfRevision', repoName],
    queryFn: () => getBranches(repoName),
    staleTime: 5 * 60 * 1000,
  })

export default useHfRevisionQuery
