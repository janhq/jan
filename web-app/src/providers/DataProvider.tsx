import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'

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
import { migrateData } from '@/utils/migration'

export function DataProvider() {
  const { setProviders } = useModelProvider()

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
    migrateData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchThreads().then((threads) => {
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
