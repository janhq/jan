import { useQuery } from '@tanstack/react-query'

import { getBranches } from '@/utils/huggingface'

const useHfRevisionQuery = (repoName: string) =>
  useQuery({
    queryKey: ['hfRevision', repoName],
    queryFn: () => getBranches(repoName),
  })

export default useHfRevisionQuery
