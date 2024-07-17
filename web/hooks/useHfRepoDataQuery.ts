import { useQuery } from '@tanstack/react-query'

import { fetchHuggingFaceRepoData } from '@/utils/huggingface'

export const fetchHuggingFaceRepoDataQueryKey = ['fetchHuggingFaceRepoData']

const useHfRepoDataQuery = (repoId: string) =>
  useQuery({
    queryKey: [...fetchHuggingFaceRepoDataQueryKey, repoId],
    queryFn: () => fetchHuggingFaceRepoData(repoId),
    staleTime: 5 * 60 * 1000,
  })

export default useHfRepoDataQuery
