import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@janhq/core'
import { SystemEvent } from '@/types/events'
import { getModelToStart } from '@/utils/getModelToStart'
import { isDev } from '@/lib/utils'

export function DataProvider() {
  const { setProviders, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()

  const { checkForUpdate } = useAppUpdater()
  const { setServers, setSettings } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // Local API Server hooks
  const {
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
  } = useLocalApiServer()
  const setServerStatus = useAppState((state) => state.setServerStatus)

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then(setProviders)
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
        setSettings(data.mcpSettings ?? DEFAULT_MCP_SETTINGS)
      })
    serviceHub
      .assistants()
      .getAssistants()
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

    // Listen for deep link events
    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const deep_link = event.payload as string
        handleDeepLink([deep_link])
      })
      .then((unsub) => {
        unsubscribe = unsub
      })
    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    serviceHub
      .threads()
      .fetchThreads()
      .then((threads) => {
        setThreads(threads)
      })
  }, [serviceHub, setThreads])

  // Check for app updates - initial check and periodic interval
  useEffect(() => {
    // Only check for updates if the auto updater is not disabled
    // App might be distributed via other package managers
    // or methods that handle updates differently
    if (AUTO_UPDATER_DISABLED || isDev()) {
      return
    }

    // Initial check on mount
    checkForUpdate()

    // Set up periodic update checks (singleton - only runs in DataProvider)
    const intervalId = setInterval(() => {
      console.log('Periodic update check triggered')
      checkForUpdate()
    }, Number(UPDATE_CHECK_INTERVAL_MS))

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId)
    }
  }, [checkForUpdate])

  useEffect(() => {
    events.on(AppEvent.onModelImported, () => {
      serviceHub.providers().getProviders().then(setProviders)
    })
  }, [serviceHub, setProviders])

  // Auto-start Local API Server on app startup if enabled
  useEffect(() => {
    if (enableOnStartup) {
      // Validate API key before starting
      if (!apiKey || apiKey.toString().trim().length === 0) {
        console.warn('Cannot start Local API Server: API key is required')
        return
      }

      const modelToStart = getModelToStart({
        selectedModel,
        selectedProvider,
        getProviderByName,
      })

      // Only start server if we have a model to load
      if (!modelToStart) {
        console.warn(
          'Cannot start Local API Server: No model available to load'
        )
        return
      }

      setServerStatus('pending')

      // Start the model first
      serviceHub
        .models()
        .startModel(modelToStart.provider, modelToStart.model)
        .then(() => {
          console.log(`Model ${modelToStart.model} started successfully`)
          // Refresh active models after starting
          serviceHub
            .models()
            .getActiveModels()
            .then((models) => setActiveModels(models || []))

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
        .then((actualPort: number) => {
          // Store the actual port that was assigned (important for mobile with port 0)
          if (actualPort && actualPort !== serverPort) {
            setServerPort(actualPort)
          }
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
