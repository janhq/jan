import { useCallback, useState } from 'react'

import { HuggingFaceRepoData } from '@janhq/core'

import { fetchHuggingFaceRepoData } from '@/utils/huggingface'

export const useGetHFRepoData = () => {
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const getHfRepoData = useCallback(async (repoId: string) => {
    try {
      setError(undefined)
      setLoading(true)
      const data = await extensionGetHfRepoData(repoId)
      return data
    } catch (err) {
      console.error(err)
      if (err instanceof Error) {
        setError(err.message)
      }
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, getHfRepoData }
}

const extensionGetHfRepoData = async (
  repoId: string
): Promise<HuggingFaceRepoData | undefined> => {
  return fetchHuggingFaceRepoData(repoId)
}
