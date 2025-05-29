import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { fetchMessages } from '@/services/messages'
import { fetchModels } from '@/services/models'
import { getProviders } from '@/services/providers'
import { fetchThreads } from '@/services/threads'
import { ModelManager } from '@janhq/core'
import { useEffect } from 'react'
import { useMCPServers } from '@/hooks/useMCPServers'
import { getMCPConfig } from '@/services/mcp'
import { useAssistant } from '@/hooks/useAssistant'
import { getAssistants } from '@/services/assistants'

export function DataProvider() {
  const { setProviders } = useModelProvider()
  const { setThreads } = useThreads()
  const { setMessages } = useMessages()
  const { checkForUpdate } = useAppUpdater()
  const { setServers } = useMCPServers()
  const { setAssistants } = useAssistant()

  useEffect(() => {
    fetchModels().then((models) => {
      models?.forEach((model) => ModelManager.instance().register(model))
      getProviders().then(setProviders)
    })
    getMCPConfig().then((data) => setServers(data.mcpServers ?? []))
    getAssistants().then((data) =>
      setAssistants((data as unknown as Assistant[]) ?? [])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchThreads().then((threads) => {
      // Sort threads by order if available, otherwise by updated time
      const sortedThreads = threads.sort((a, b) => {
        // If both have order, sort by order
        if (a.order != null && b.order != null) {
          return a.order - b.order
        }
        // If only one has order, prioritize the one with order
        if (a.order != null) return -1
        if (b.order != null) return 1
        // If neither has order, sort by updated time (newest first)
        return (b.updated || 0) - (a.updated || 0)
      })

      // Assign orders to threads that don't have them to ensure future drag operations work
      const threadsWithOrder = sortedThreads.map((thread, index) => ({
        ...thread,
        order: thread.order ?? index + 1,
      }))

      setThreads(threadsWithOrder)
      threads.forEach((thread) =>
        fetchMessages(thread.id).then((messages) =>
          setMessages(thread.id, messages)
        )
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check for app updates
  useEffect(() => {
    checkForUpdate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
