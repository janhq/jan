import { useQuery } from '@tanstack/react-query'

import { fetchHuggingFaceRepoData } from '@/utils/huggingface'

const useHfRepoDataQuery = (repoId: string) =>
  useQuery({
    queryKey: ['fetchHuggingFaceRepoData', repoId],
    queryFn: () => fetchHuggingFaceRepoData(repoId),
  })

export default useHfRepoDataQuery
