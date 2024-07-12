import { useQuery } from '@tanstack/react-query'

import { fetchHuggingFaceRepoData } from '@/utils/huggingface'

const useHfRepoDataQuery = (repoId: string) =>
  useQuery({
    queryKey: ['fetchHuggingFaceRepoData', repoId],
    queryFn: () => fetchHuggingFaceRepoData(repoId),
    staleTime: 5 * 60 * 1000,
  })

export default useHfRepoDataQuery
