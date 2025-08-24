import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppUpdater } from '@/hooks/useAppUpdater'
import { fetchMessages } from '@/services/messages'
import { getProviders } from '@/services/providers'
import { fetchThreads } from '@/services/threads'
import { useEffect } from 'react'
import { useMCPServers } from '@/hooks/useMCPServers'
import { getMCPConfig } from '@/services/mcp'
import { useAssistant } from '@/hooks/useAssistant'
import { getAssistants } from '@/services/assistants'
import { isPlatformTauri } from '@/lib/platform'
import { Assistant as CoreAssistant } from '@janhq/core'

// Dynamic import for Tauri deep link plugin
let onOpenUrl: ((handler: (urls: string[]) => void) => Promise<unknown>) | null = null
let getCurrentDeepLinkUrls: (() => Promise<string[] | null>) | null = null

if (isPlatformTauri()) {
  import('@tauri-apps/plugin-deep-link').then(module => {
    onOpenUrl = module.onOpenUrl
    getCurrentDeepLinkUrls = module.getCurrent
  }).catch(() => {
    console.warn('Failed to load Tauri deep link module')
  })
}
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@janhq/core'
import { startModel } from '@/services/models'
import { localStorageKey } from '@/constants/localStorage'

export function DataProvider() {
  const { setProviders, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()

  const { setMessages } = useMessages()
  const { checkForUpdate } = useAppUpdater()
  const { setServers } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  
  // Type adapter to convert CoreAssistant to local Assistant type
  const adaptCoreAssistant = (coreAssistant: CoreAssistant): Assistant => ({
    avatar: coreAssistant.avatar,
    id: coreAssistant.id,
    name: coreAssistant.name,
    created_at: coreAssistant.created_at || Date.now(),
    description: coreAssistant.description,
    instructions: coreAssistant.instructions || '',
    parameters: (coreAssistant as Record<string, unknown>).parameters as Record<string, unknown> || {}
  })
  const { setThreads } = useThreads()
  const navigate = useNavigate()

  // Local API Server hooks
  const {
    enableOnStartup,
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
  } = useLocalApiServer()
  const { setServerStatus } = useAppState()

  useEffect(() => {
    console.log('Initializing DataProvider...')
    getProviders().then(setProviders)
    getMCPConfig().then((data) => setServers(data.mcpServers ?? []))
    getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          const adaptedAssistants = data.map(adaptCoreAssistant)
          setAssistants(adaptedAssistants)
          initializeWithLastUsed()
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    
    // Set up deep link handling only on Tauri platform
    if (getCurrentDeepLinkUrls && onOpenUrl) {
      getCurrentDeepLinkUrls().then((urls) => handleDeepLink(urls || [])).catch((error: unknown) => {
        console.warn('Failed to get current deep link URLs:', error)
      })
      onOpenUrl(handleDeepLink).catch((error: unknown) => {
        console.warn('Failed to set up deep link listener:', error)
      })
    }
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
    // Only check for updates if the auto updater is not disabled
    // App might be distributed via other package managers
    // or methods that handle updates differently
    if (!AUTO_UPDATER_DISABLED) {
      checkForUpdate()
    }
  }, [checkForUpdate])

  useEffect(() => {
    events.on(AppEvent.onModelImported, () => {
      getProviders().then(setProviders)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getLastUsedModel = (): { provider: string; model: string } | null => {
    try {
      const stored = localStorage.getItem(localStorageKey.lastUsedModel)
      return stored ? JSON.parse(stored) : null
    } catch (error) {
      console.debug('Failed to get last used model from localStorage:', error)
      return null
    }
  }

  // Helper function to determine which model to start
  const getModelToStart = () => {
    // Use last used model if available
    const lastUsedModel = getLastUsedModel()
    if (lastUsedModel) {
      const provider = getProviderByName(lastUsedModel.provider)
      if (
        provider &&
        provider.models.some((m) => m.id === lastUsedModel.model)
      ) {
        return { model: lastUsedModel.model, provider }
      }
    }

    // Use selected model if available
    if (selectedModel && selectedProvider) {
      const provider = getProviderByName(selectedProvider)
      if (provider) {
        return { model: selectedModel.id, provider }
      }
    }

    // Use first model from llamacpp provider
    const llamacppProvider = getProviderByName('llamacpp')
    if (
      llamacppProvider &&
      llamacppProvider.models &&
      llamacppProvider.models.length > 0
    ) {
      return {
        model: llamacppProvider.models[0].id,
        provider: llamacppProvider,
      }
    }

    return null
  }

  // Auto-start Local API Server on app startup if enabled
  useEffect(() => {
    if (enableOnStartup) {
      // Validate API key before starting
      if (!apiKey || apiKey.toString().trim().length === 0) {
        console.warn('Cannot start Local API Server: API key is required')
        return
      }

      const modelToStart = getModelToStart()

      // Only start server if we have a model to load
      if (!modelToStart) {
        console.warn(
          'Cannot start Local API Server: No model available to load'
        )
        return
      }

      setServerStatus('pending')

      // Start the model first
      startModel(modelToStart.provider, modelToStart.model)
        .then(() => {
          console.log(`Model ${modelToStart.model} started successfully`)

          // Then start the server
          return window.core?.api?.startServer({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
          })
        })
        .then(() => {
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Failed to start Local API Server on startup:', error)
          setServerStatus('stopped')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        to: route.hub.model,
        search: {
          repo: resource,
        },
      })
    }
  }

  return null
}
