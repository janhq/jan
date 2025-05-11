import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { fetchMessages } from '@/services/messages'
import { getProviders } from '@/services/providers'
import { fetchThreads } from '@/services/threads'
import { useEffect } from 'react'

export function DataProvider() {
  const { setProviders } = useModelProvider()
  const { setThreads } = useThreads()
  const { setMessages } = useMessages()

  useEffect(() => {
    getProviders().then(setProviders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchThreads().then((threads) => {
      setThreads(threads)
      threads.forEach((thread) =>
        fetchMessages(thread.id).then((messages) =>
          setMessages(thread.id, messages)
        )
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
