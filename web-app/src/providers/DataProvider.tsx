import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@janhq/core'
import { localStorageKey } from '@/constants/localStorage'

export function DataProvider() {
  const { setProviders, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()

  const { setMessages } = useMessages()
  const { checkForUpdate } = useAppUpdater()
  const { setServers } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

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
    proxyTimeout,
  } = useLocalApiServer()
  const { setServerStatus } = useAppState()

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then(setProviders)
    serviceHub.mcp().getMCPConfig().then((data) => setServers(data.mcpServers ?? {}))
    serviceHub.assistants().getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
          initializeWithLastUsed()
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    serviceHub.deeplink().getCurrent().then(handleDeepLink)
    serviceHub.deeplink().onOpenUrl(handleDeepLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    serviceHub.threads().fetchThreads().then((threads) => {
      setThreads(threads)
      threads.forEach((thread) =>
        serviceHub.messages().fetchMessages(thread.id).then((messages) =>
          setMessages(thread.id, messages)
        )
      )
    })
  }, [serviceHub, setThreads, setMessages])

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
      serviceHub.providers().getProviders().then(setProviders)
    })
  }, [serviceHub, setProviders])

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
      serviceHub.models().startModel(modelToStart.provider, modelToStart.model)
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
            proxyTimeout: proxyTimeout,
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
  }, [serviceHub])

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
