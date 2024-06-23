import { useCallback, useState } from 'react'

export const useGetHFRepoData = () => {
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const getHfRepoData = useCallback(async (repoId: string) => {
    try {
      setError(undefined)
      setLoading(true)

      return undefined
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
