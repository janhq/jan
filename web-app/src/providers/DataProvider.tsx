import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useEffect } from 'react'

export function DataProvider() {
  const { fetchModelProvider } = useModelProvider()
  const { fetchThreads } = useThreads()

  useEffect(() => {
    fetchModelProvider()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
