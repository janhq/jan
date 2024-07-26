import { useCallback } from 'react'

import useCortex from './useCortex'

const useAbortDownload = () => {
  const { abortDownload: cancelDownload } = useCortex()

  const abortDownload = useCallback(
    (downloadId: string) => {
      cancelDownload(downloadId)
    },
    [cancelDownload]
  )

  return { abortDownload }
}

export default useAbortDownload
