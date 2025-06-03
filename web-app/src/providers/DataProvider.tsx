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
import {
  useAssistant,
} from '@/hooks/useAssistant'
import { getAssistants } from '@/services/assistants'
import {
  onOpenUrl,
  getCurrent as getCurrentDeepLinkUrls,
} from '@tauri-apps/plugin-deep-link'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'

export function DataProvider() {
  const { setProviders } = useModelProvider()

  const { setMessages } = useMessages()
  const { checkForUpdate } = useAppUpdater()
  const { setServers } = useMCPServers()
  const { setAssistants } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()

  useEffect(() => {
    fetchModels().then((models) => {
      models?.forEach((model) => ModelManager.instance().register(model))
      getProviders().then(setProviders)
    })
    getMCPConfig().then((data) => setServers(data.mcpServers ?? []))
    getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    getCurrentDeepLinkUrls().then(handleDeepLink)
    onOpenUrl(handleDeepLink)
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

  // Check for app updates
  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

  const handleDeepLink = (urls: string[] | null) => {
    if (!urls) return
    console.log('Received deeplink:', urls)
    const deeplink = urls[0]
    if (deeplink) {
      const url = new URL(deeplink)
      const params = url.pathname.split('/').filter((str) => str.length > 0)

      if (params.length < 3) return undefined
      // const action = params[0]
      // const provider = params[1]
      const resource = params.slice(1).join('/')
      // return { action, provider, resource }
      navigate({
        to: route.hub,
        search: {
          repo: resource,
        },
      })
    }
  }

  return null
}
