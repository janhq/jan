import { useQuery } from '@tanstack/react-query'

import { tryGettingReadMeFile } from '@/utils/huggingface'

const useGetReadMeContent = (repoName: string) =>
  useQuery({
    queryKey: ['useGetReadMeContent', repoName],
    queryFn: () => tryGettingReadMeFile(repoName),
  })

export default useGetReadMeContent
