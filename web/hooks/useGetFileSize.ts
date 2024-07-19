import { useQuery } from '@tanstack/react-query'

import { getFileSize } from '@/utils/huggingface'

const useGetFileSize = (url: string) =>
  useQuery({
    queryKey: ['fileSize', url],
    queryFn: () => getFileSize(url),
  })

export default useGetFileSize
