import { useModelProvider } from '@/hooks/useModelProvider'
import { localStorageKey } from '@/constants/localStorage'
import { EMBEDDING_MODEL_ID } from '@/constants/models'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant, defaultAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { switchToModel } from '@/utils/switchModel'
import { isDev } from '@/lib/utils'
import { AppEvent, events, ModelEvent } from '@janhq/core'
import { SystemEvent } from '@/types/events'
import {
  parseAtomicChatDeepLink,
  type AtomicChatDeepLinkTarget,
} from '@/services/deeplink/parse'
import {
  registerRemoteProvider,
  unregisterRemoteProvider,
} from '@/utils/registerRemoteProvider'
import { hydrateActiveModelsForRunningServer } from '@/utils/activeModelsSync'

const safeRegisterRemoteProvider = async (provider: ModelProvider) => {
  try {
    await registerRemoteProvider(provider)
  } catch (error) {
    console.error(`Failed to register provider ${provider.provider}:`, error)
  }
}

// Track which providers have been registered so we can unregister stale ones
let registeredProviderNames = new Set<string>()

// Effect to sync remote providers when providers change
const syncRemoteProviders = () => {
  const providers = useModelProvider.getState().providers
  const currentActive = new Set<string>()

  providers.forEach((provider) => {
    if (
      provider.active &&
      provider.provider !== 'llamacpp' &&
      provider.api_key
    ) {
      safeRegisterRemoteProvider(provider)
      currentActive.add(provider.provider)
    }
  })

  // Unregister providers that were previously registered but are now inactive/removed
  for (const name of registeredProviderNames) {
    if (!currentActive.has(name)) {
      unregisterRemoteProvider(name)
    }
  }

  registeredProviderNames = currentActive
}

export function DataProvider() {
  const { setProviders } = useModelProvider()

  const { setServers, setSettings } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const { checkForUpdate } = useAppUpdater()

  const setServerStatus = useAppState((state) => state.setServerStatus)

  useEffect(() => {
    if (localStorage.getItem(localStorageKey.factoryResetPending) === 'true') {
      const backendType = localStorage.getItem('llama_cpp_backend_type')

      localStorage.clear()

      if (backendType) {
        localStorage.setItem('llama_cpp_backend_type', backendType)
      }

      console.log(
        'Factory reset detected — localStorage force-cleared on startup (backend preserved)'
      )
    }
  }, [])

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub
      .providers()
      .getProviders()
      .then((providers) => {
        setProviders(providers)
        // Register active remote providers with the backend
        providers.forEach((provider) => {
          if (provider.active) {
            safeRegisterRemoteProvider(provider)
            registeredProviderNames.add(provider.provider)
          }
        })
      })
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
        if (data && Array.isArray(data) && data.length > 0) {
          //? Миграция: ассистент с id 'jan' всегда подменяем на дефолт Atomic Chat (name/description/avatar)
          const migrated = (data as unknown as Assistant[]).map((a) =>
            a.id === 'jan'
              ? { ...defaultAssistant, id: 'jan', created_at: a.created_at }
              : a
          )
          setAssistants(migrated)
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

  // Sync remote providers with backend when providers change
  const providers = useModelProvider.getState().providers
  useEffect(() => {
    syncRemoteProviders()
  }, [providers])

  useEffect(() => {
    if (isDev()) {
      return
    }
    checkForUpdate()
    const intervalId = setInterval(() => {
      console.log('Periodic update check triggered')
      checkForUpdate()
    }, Number(UPDATE_CHECK_INTERVAL_MS))
    return () => {
      clearInterval(intervalId)
    }
  }, [checkForUpdate])

  useEffect(() => {
    const handleModelImported = async (eventData?: Record<string, unknown>) => {
      console.log('[LocalAPI] onModelImported fired, eventData:', eventData)

      let newProviders: ModelProvider[]
      try {
        newProviders = await serviceHub.providers().getProviders()
        setProviders(newProviders)
        syncRemoteProviders()
      } catch (err) {
        console.error(
          '[LocalAPI] Failed to refresh providers after model import:',
          err
        )
        return
      }

      const modelId = eventData?.modelId as string | undefined
      if (!modelId) {
        console.warn(
          '[LocalAPI] onModelImported: no modelId in event data, skipping'
        )
        return
      }

      if (modelId === EMBEDDING_MODEL_ID) {
        console.log(
          '[LocalAPI] onModelImported: embedding model imported, skipping server switch'
        )
        return
      }

      // Find provider — try exact match first, then with normalized separators
      let provider = newProviders.find((p) =>
        p?.models?.some((m: { id: string }) => m.id === modelId)
      )
      if (!provider) {
        const altId = modelId.replace(/\//g, '\\')
        provider = newProviders.find((p) =>
          p?.models?.some((m: { id: string }) => m.id === altId)
        )
      }
      if (!provider) {
        // Fallback: assume llamacpp provider
        provider =
          newProviders.find((p) => p?.provider === 'llamacpp') ?? undefined
        console.warn(
          '[LocalAPI] Could not find provider for model',
          modelId,
          '— falling back to llamacpp'
        )
      }
      const providerName = provider?.provider ?? 'llamacpp'
      console.log('[LocalAPI] Provider for model:', providerName)

      const currentStatus = useAppState.getState().serverStatus
      console.log('[LocalAPI] Current server status:', currentStatus)

      if (currentStatus === 'pending') {
        console.log('[LocalAPI] Server status is pending — skipping auto-start')
        return
      }

      // switchToModel handles stopAllModels, start the new model, start/restart
      // the Local API Server, and syncs all global state.
      try {
        await switchToModel({
          modelId,
          providerName,
          serviceHub,
        })
        console.log('[LocalAPI] Model imported and switched to:', modelId)
      } catch (error) {
        console.error('[LocalAPI] Failed to switch to imported model:', error)
      }
    }

    events.on(AppEvent.onModelImported, handleModelImported)
    console.log('[LocalAPI] Registered onModelImported handler')
    return () => {
      events.off(AppEvent.onModelImported, handleModelImported)
      console.log('[LocalAPI] Unregistered onModelImported handler')
    }
  }, [serviceHub, setProviders, setServerStatus])

  // Mirror any auto-increase of ctx_len performed by a backend extension
  // (triggered by the Local API Server proxy detecting a context-limit error)
  // into the persisted Zustand provider store so the UI stays in sync with
  // the live backend session.
  //
  // We subscribe on TWO redundant channels to guarantee delivery:
  //   1) `ModelEvent.OnAutoIncreasedCtxLen` on `@janhq/core::events`
  //      (in-process EventEmitter singleton hanging off `window.core.events`).
  //   2) `local_backend://auto_increase_ctx_notify` on the native Tauri
  //      event bus (bypasses any @janhq/core bundling quirks).
  //
  // The handler is idempotent: applying the same `newCtxLen` twice simply
  // writes the same value back, so double-delivery is harmless.
  useEffect(() => {
    const applyNewCtxLen = (
      providerName: string,
      modelId: string,
      newCtxLen: number,
      source: string
    ) => {
      const { providers, updateProvider } = useModelProvider.getState()
      const provider = providers.find((p) => p.provider === providerName)
      if (!provider) {
        console.warn(
          `[LocalAPI] OnAutoIncreasedCtxLen (${source}): provider "${providerName}" not found in store`
        )
        return
      }

      const modelIndex = provider.models.findIndex((m) => m.id === modelId)
      if (modelIndex === -1) {
        console.warn(
          `[LocalAPI] OnAutoIncreasedCtxLen (${source}): model "${modelId}" not found in provider "${providerName}"`
        )
        return
      }

      const model = provider.models[modelIndex]
      const currentValue =
        (model.settings?.ctx_len?.controller_props?.value as number | undefined) ??
        null
      if (currentValue === newCtxLen) {
        console.log(
          `[LocalAPI] OnAutoIncreasedCtxLen (${source}): ctx_len for ${providerName}/${modelId} already = ${newCtxLen}, no-op`
        )
        return
      }

      const updatedModel = {
        ...model,
        settings: {
          ...model.settings,
          ctx_len: {
            ...(model.settings?.ctx_len ?? {}),
            controller_props: {
              ...(model.settings?.ctx_len?.controller_props ?? {}),
              value: newCtxLen,
            },
          },
        },
      }

      const updatedModels = [...provider.models]
      updatedModels[modelIndex] = updatedModel as Model

      updateProvider(provider.provider, { models: updatedModels })
      console.log(
        `[LocalAPI] Mirrored auto-increased ctx_len for ${providerName}/${modelId} → ${newCtxLen} (via ${source})`
      )
    }

    const handleFromEvents = (eventData?: Record<string, unknown>) => {
      const providerName = eventData?.provider as string | undefined
      const modelId = eventData?.modelId as string | undefined
      const newCtxLen = eventData?.newCtxLen as number | undefined
      console.log(
        '[LocalAPI] OnAutoIncreasedCtxLen received (core/events)',
        eventData
      )
      if (!providerName || !modelId || typeof newCtxLen !== 'number') {
        console.warn(
          '[LocalAPI] OnAutoIncreasedCtxLen (core/events): invalid payload',
          eventData
        )
        return
      }
      applyNewCtxLen(providerName, modelId, newCtxLen, 'core/events')
    }

    events.on(ModelEvent.OnAutoIncreasedCtxLen, handleFromEvents)

    // Parallel native Tauri bus listener (extensions emit both channels).
    let unlistenTauri: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        if (cancelled) return
        const unsub = await listen<{
          provider?: string
          modelId?: string
          newCtxLen?: number
        }>('local_backend://auto_increase_ctx_notify', (event) => {
          const { provider, modelId, newCtxLen } = event.payload ?? {}
          console.log(
            '[LocalAPI] auto_increase_ctx_notify received (tauri)',
            event.payload
          )
          if (!provider || !modelId || typeof newCtxLen !== 'number') {
            console.warn(
              '[LocalAPI] auto_increase_ctx_notify (tauri): invalid payload',
              event.payload
            )
            return
          }
          applyNewCtxLen(provider, modelId, newCtxLen, 'tauri')
        })
        if (cancelled) {
          unsub()
          return
        }
        unlistenTauri = unsub
        console.log(
          '[LocalAPI] Subscribed to Tauri event: local_backend://auto_increase_ctx_notify'
        )
      } catch (e) {
        console.warn(
          '[LocalAPI] Failed to subscribe to Tauri auto_increase_ctx_notify:',
          e
        )
      }
    })()

    return () => {
      cancelled = true
      events.off(ModelEvent.OnAutoIncreasedCtxLen, handleFromEvents)
      if (unlistenTauri) unlistenTauri()
    }
  }, [])

  // Auto-start Local API Server on app startup. Works for both local engines
  // (llamacpp/mlx) and cloud providers: when the last-used model is cloud we
  // just raise the proxy and register the provider config so it can route
  // inference requests by model name.
  useEffect(() => {
    const autoStartServer = async () => {
      try {
        const isRunning = await serviceHub.app().getServerStatus()
        if (isRunning) {
          console.log('[LocalAPI:startup] Server already running')
          setServerStatus('running')
          // `activeModels` is in-memory only; without this the provider UI
          // would render "Start" for the cloud model the proxy is already
          // routing, until the user manually re-selects it. See issue where
          // navigating between tabs appears to "forget" the running model.
          await hydrateActiveModelsForRunningServer(serviceHub.models())
          return
        }

        // Reuse the merged store state so persisted model settings like ctx_len
        // are applied before the startup path launches local models.
        const fetchedProviders = await serviceHub.providers().getProviders()
        setProviders(fetchedProviders)
        const allProviders = useModelProvider.getState().providers
        const localModels = allProviders
          .filter((p) => p.provider === 'llamacpp' || p.provider === 'mlx')
          .flatMap((p) => p.models)
          .filter((m) => m.id !== EMBEDDING_MODEL_ID)

        const serverState = useLocalApiServer.getState()

        type CandidateModel = { model: string; provider: string }

        const isLocalProviderName = (name: string) =>
          name === 'llamacpp' || name === 'mlx'

        const readLastUsedFromStorage = (): CandidateModel | null => {
          try {
            const stored = localStorage.getItem(localStorageKey.lastUsedModel)
            if (!stored) return null
            const parsed = JSON.parse(stored) as CandidateModel
            if (!parsed?.model || !parsed?.provider) return null
            return parsed
          } catch {
            return null
          }
        }

        const validateCandidate = (
          candidate: CandidateModel | null | undefined
        ): CandidateModel | null => {
          if (!candidate) return null
          const p = allProviders.find((pr) => pr.provider === candidate.provider)
          if (!p) return null
          if (!p.models.some((m) => m.id === candidate.model)) return null
          return candidate
        }

        // Priority: explicit UI selection > last-used-model (localStorage) >
        // saved default > last running server model > first available local.
        const modelToStart: CandidateModel | null = (() => {
          const { selectedProvider, selectedModel } = useModelProvider.getState()
          if (selectedModel && selectedProvider) {
            const candidate = validateCandidate({
              model: selectedModel.id,
              provider: selectedProvider,
            })
            if (candidate) return candidate
          }

          const lastUsed = validateCandidate(readLastUsedFromStorage())
          if (lastUsed) return lastUsed

          const savedDefault = validateCandidate(
            serverState.defaultModelLocalApiServer
          )
          if (savedDefault) return savedDefault

          if (serverState.lastServerModels.length > 0) {
            const lastServer = validateCandidate(serverState.lastServerModels[0])
            if (lastServer) return lastServer
          }

          if (localModels.length > 0) {
            const firstLocal = localModels[0]
            const providerName =
              allProviders.find((p) =>
                p.models.some((m) => m.id === firstLocal.id)
              )?.provider ?? 'llamacpp'
            return { model: firstLocal.id, provider: providerName }
          }

          return null
        })()

        if (!modelToStart) {
          console.log(
            '[LocalAPI:startup] No usable model found, skipping auto-start'
          )
          return
        }

        const candidateProvider = allProviders.find(
          (p) => p.provider === modelToStart.provider
        )
        const isCloud =
          candidateProvider !== undefined &&
          !isLocalProviderName(candidateProvider.provider)

        // Cloud provider without an API key cannot be registered with the
        // proxy, so we just bring the server up bare and leave the UI to
        // show "no active model". The user must add an API key in Settings.
        if (isCloud && !candidateProvider?.api_key) {
          console.log(
            '[LocalAPI:startup] Cloud provider selected without API key, raising bare server:',
            modelToStart.provider
          )
          setServerStatus('pending')
          try {
            const actualPort = await window.core?.api?.startServer({
              host: serverState.serverHost,
              port: serverState.serverPort,
              prefix: serverState.apiPrefix,
              apiKey: serverState.apiKey,
              trustedHosts: serverState.trustedHosts,
              isCorsEnabled: serverState.corsEnabled,
              isVerboseEnabled: serverState.verboseLogs,
              proxyTimeout: serverState.proxyTimeout,
            })
            if (actualPort && actualPort !== serverState.serverPort) {
              serverState.setServerPort(actualPort)
            }
            setServerStatus('running')
          } catch (err) {
            console.error('[LocalAPI:startup] Bare server start failed:', err)
            setServerStatus('stopped')
          }
          return
        }

        setServerStatus('pending')
        console.log(
          '[LocalAPI:startup] Auto-starting, target model:',
          modelToStart
        )

        // switchToModel handles stopAllModels, startModel/registerProvider,
        // startServer, and syncs global state (selectModelProvider,
        // last-used-model, thread model, etc.) for both local and cloud.
        await switchToModel({
          modelId: modelToStart.model,
          providerName: modelToStart.provider,
          serviceHub,
        })
      } catch (error) {
        console.error('[LocalAPI:startup] Failed to auto-start server:', error)
        setServerStatus('stopped')
      }
    }

    autoStartServer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  const handleDeepLink = (urls: string[] | null) => {
    if (!urls?.length) return
    console.log('Received deeplink:', urls)
    const target = urls
      .map(parseAtomicChatDeepLink)
      .find((value): value is AtomicChatDeepLinkTarget => value !== null)
    if (!target) {
      return
    }

    navigate({
      to: route.hub.model,
      params: {
        modelId: target.modelId,
      },
      search: {
        repo: target.repo,
      },
    })
  }

  return null
}
