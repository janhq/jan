/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { ImportVisionModelDialog } from '@/containers/dialogs/ImportVisionModelDialog'
import { ImportMlxModelDialog } from '@/containers/dialogs/ImportMlxModelDialog'
import { DflashUnsupportedDialog } from '@/containers/dialogs/DflashUnsupportedDialog'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  isLocalProvider,
  unregisterRemoteProvider,
} from '@/utils/registerRemoteProvider'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'
import {
  IconFolderPlus,
  IconLoader,
  IconRefresh,
  IconRocket,
  IconSearch,
  IconUpload,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isKnownProvider,
  useProviderRegistryStore,
} from '@/stores/provider-registry-store'
import { EMBEDDING_MODEL_ID } from '@/constants/models'
import { useModelLoad } from '@/hooks/useModelLoad'
import { switchToModel } from '@/utils/switchModel'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { useBackendUpdater } from '@/hooks/useBackendUpdater'
import { basenameNoExt } from '@/lib/utils'
import { useAppState } from '@/hooks/useAppState'
import { useShallow } from 'zustand/shallow'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import { AppEvent, EngineManager, events } from '@janhq/core'

// as route.threadsDetail
export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
  validateSearch: (search: Record<string, unknown>): { step?: string } => {
    // validate and parse the search params into a typed state
    return {
      step: String(search?.step),
    }
  },
})

function ProviderDetail() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { setModelLoadError } = useModelLoad()
  const [activeModels, setActiveModels] = useAppState(
    useShallow((state) => [state.activeModels, state.setActiveModels])
  )
  const [loadingModels, setLoadingModels] = useState<string[]>([])
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [isInstallingBackend, setIsInstallingBackend] = useState(false)
  const [isRecheckingBackend, setIsRecheckingBackend] = useState(false)
  /// Mirrors `localStorage.llama_cpp_pending_backend` so the provider
  /// settings page can surface a "restart to activate" pill next to
  /// the (still-old) `version_backend` value once a recommended GPU
  /// backend has finished downloading. Updated reactively via
  /// `AppEvent.onBackendDownloadFinished` so the user gets feedback
  /// without having to refresh.
  const [pendingBackend, setPendingBackend] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem('llama_cpp_pending_backend')
    return raw ? raw.replace(/\uFEFF/g, '').trim() : null
  })

  useEffect(() => {
    const refresh = () => {
      const raw = localStorage.getItem('llama_cpp_pending_backend')
      setPendingBackend(raw ? raw.replace(/\uFEFF/g, '').trim() : null)
    }
    const onFinished = (payload: { status: string }) => {
      if (payload?.status === 'completed') refresh()
    }
    /// Hot-swap path: the extension already cleared
    /// `llama_cpp_pending_backend` and updated `version_backend` settings.
    /// Drop the pill immediately and pull fresh provider settings so the
    /// `version_backend` row reflects the new value without a tab refresh.
    ///
    /// We deliberately read `setProviders` from the Zustand store via
    /// `getState()` instead of capturing the destructured binding from
    /// `useModelProvider()` — that destructuring happens later in the
    /// component body, so referencing it here would hit a TDZ
    /// `ReferenceError` on the very first render.
    const onHotswapped = () => {
      setPendingBackend(null)
      void serviceHub
        .providers()
        .getProviders()
        .then((providers) => {
          useModelProvider.getState().setProviders(providers)
        })
        .catch((err) => {
          console.warn('Failed to refresh providers after hot-swap:', err)
        })
    }
    events.on(AppEvent.onBackendDownloadFinished, onFinished)
    window.addEventListener('storage', refresh)
    window.addEventListener('app:backend-hotswapped', onHotswapped)
    return () => {
      events.off(AppEvent.onBackendDownloadFinished, onFinished)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('app:backend-hotswapped', onHotswapped)
    }
  }, [serviceHub])

  const handleRestartForPendingBackend = useCallback(async () => {
    try {
      await window.core?.api?.relaunch()
    } catch (err) {
      console.error('Failed to relaunch for pending backend:', err)
    }
  }, [])
  const [importingModel, setImportingModel] = useState<string | null>(null)
  const [isTogglingDflash, setIsTogglingDflash] = useState(false)
  /// `isTogglingDflash` covers fast operations (lookup + MLX reload) and
  /// drives the inline spinner next to the Switch. The HF download leg
  /// is much longer and has its own progress UI in the left panel, so
  /// we track it separately: the Switch stays disabled (avoids racy
  /// re-entry) but the redundant spinner is hidden.
  const [isDflashDownloading, setIsDflashDownloading] = useState(false)
  const [dflashUnsupportedModel, setDflashUnsupportedModel] = useState<
    string | null
  >(null)
  const {
    installBackend,
    recheckOptimalBackend,
    downloadRecommendedBackend,
    recommendationPhase,
  } = useBackendUpdater()
  const { providerName } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const { getProviderByName, setProviders, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const hasDownloadedModels =
    (provider?.models.filter((m) => m.id !== EMBEDDING_MODEL_ID).length ?? 0) >
    0

  // Check if llamacpp/mlx provider needs backend configuration
  const needsBackendConfig =
    (provider?.provider === 'llamacpp' || provider?.provider === 'mlx') &&
    provider.settings?.some(
      (setting) =>
        setting.key === 'version_backend' &&
        (setting.controller_props.value === 'none' ||
          setting.controller_props.value === '' ||
          !setting.controller_props.value)
    )

  const handleModelImportSuccess = async (importedModelName?: string) => {
    if (importedModelName) {
      setImportingModel(importedModelName)
    }

    try {
      // Refresh the provider to update the models list
      await serviceHub.providers().getProviders().then(setProviders)

      // If a model was imported and it might have vision capabilities, check and update
      if (importedModelName && providerName === 'llamacpp') {
        try {
          const mmprojExists = await serviceHub
            .models()
            .checkMmprojExists(importedModelName)
          if (mmprojExists) {
            // Get the updated provider after refresh
            const { getProviderByName, updateProvider: updateProviderState } =
              useModelProvider.getState()
            const llamacppProvider = getProviderByName('llamacpp')

            if (llamacppProvider) {
              const modelIndex = llamacppProvider.models.findIndex(
                (m: Model) => m.id === importedModelName
              )
              if (modelIndex !== -1) {
                const model = llamacppProvider.models[modelIndex]
                const capabilities = model.capabilities || []

                // Add 'vision' capability if not already present AND if user hasn't manually configured capabilities
                // Check if model has a custom capabilities config flag

                const hasUserConfiguredCapabilities =
                  (model as any)._userConfiguredCapabilities === true

                if (
                  !capabilities.includes('vision') &&
                  !hasUserConfiguredCapabilities
                ) {
                  const updatedModels = [...llamacppProvider.models]
                  updatedModels[modelIndex] = {
                    ...model,
                    capabilities: [...capabilities, 'vision'],
                    // Mark this as auto-detected, not user-configured
                    _autoDetectedVision: true,
                  } as any

                  updateProviderState('llamacpp', { models: updatedModels })
                  console.log(
                    `Vision capability added to model after provider refresh: ${importedModelName}`
                  )
                }
              }
            }
          }
        } catch (error) {
          console.error('Error checking mmproj existence after import:', error)
        }
      }
    } finally {
      // The importing state will be cleared by the useEffect when model appears in list
    }
  }

  useEffect(() => {
    // Refresh local-engine-backed active models when entering this provider's
    // settings screen. Cloud models live only in frontend state (the Local API
    // Server proxy tracks them via register_provider_config), so we must
    // preserve any cloud entries instead of blindly overwriting.
    if (provider?.provider) {
      serviceHub
        .models()
        .getActiveModels(provider.provider)
        .then((models) => syncActiveModelsFromEngines(models || []))
    }
  }, [serviceHub, provider?.provider])

  // Clear importing state when model appears in the provider's model list
  useEffect(() => {
    if (importingModel && provider?.models) {
      const modelExists = provider.models.some(
        (model) => model.id === importingModel
      )
      if (modelExists) {
        setImportingModel(null)
      }
    }
  }, [importingModel, provider?.models])

  // Fallback: Clear importing state after 10 seconds to prevent infinite loading
  useEffect(() => {
    if (importingModel) {
      const timeoutId = setTimeout(() => {
        setImportingModel(null)
      }, 10000) // 10 seconds fallback

      return () => clearTimeout(timeoutId)
    }
  }, [importingModel])

  /// Track the currently-running MLX model id (if this provider is `mlx`).
  /// Whenever it changes we reset `dflash_enabled` to `false` because:
  ///   1. The new session was just started fresh without `--draft-model`,
  ///      so the UI flag would otherwise lie about the server state.
  ///   2. The previous draft repo is almost certainly wrong for the new
  ///      target — DFlash drafts are paired 1:1 with a base model and
  ///      the new model may not even be on the supported list.
  /// The user can opt back in explicitly after the new session is up.
  const activeMlxModelId = useMemo(() => {
    if (provider?.provider !== 'mlx') return undefined
    const mlxIds = new Set(provider.models.map((m) => m.id))
    return activeModels.find((id) => mlxIds.has(id))
  }, [activeModels, provider])

  const prevActiveMlxModelRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (provider?.provider !== 'mlx' || !provider) {
      prevActiveMlxModelRef.current = undefined
      return
    }

    const prev = prevActiveMlxModelRef.current
    prevActiveMlxModelRef.current = activeMlxModelId

    /// Skip the very first render (when `prev` is still `undefined`):
    /// we don't want to nuke the user's choice just because we mounted.
    if (prev === undefined) return
    if (prev === activeMlxModelId) return

    const dflashSetting = provider.settings.find(
      (s) => s.key === 'dflash_enabled'
    )
    const isOn = !!(
      dflashSetting?.controller_props as { value?: boolean } | undefined
    )?.value
    if (!isOn) return

    const next = provider.settings.map((s) =>
      s.key === 'dflash_enabled'
        ? {
            ...s,
            controller_props: {
              ...s.controller_props,
              value: false as never,
            },
          }
        : s
    )
    serviceHub.providers().updateSettings(providerName, next)
    updateProvider(providerName, { ...provider, settings: next })
  }, [
    activeMlxModelId,
    provider,
    providerName,
    serviceHub,
    updateProvider,
  ])

  // Auto-refresh provider settings to get updated backend configuration
  const refreshSettings = useCallback(async () => {
    if (!provider) return

    try {
      // Refresh providers to get updated settings from the extension
      const updatedProviders = await serviceHub.providers().getProviders()
      setProviders(updatedProviders)
    } catch (error) {
      console.error('Failed to refresh settings:', error)
    }
  }, [provider, serviceHub, setProviders])

  // Auto-refresh settings when provider changes or when llamacpp needs backend config
  useEffect(() => {
    if (provider && needsBackendConfig) {
      // Auto-refresh every 3 seconds when backend is being configured
      const intervalId = setInterval(refreshSettings, 3000)
      return () => clearInterval(intervalId)
    }
  }, [provider, needsBackendConfig, refreshSettings])

  // Note: settingsChanged event is now handled globally in GlobalEventHandler
  // This ensures all screens receive the event intermediately

  const handleRefreshModels = async () => {
    if (!provider) return

    setRefreshingModels(true)
    try {
      // Pull the latest manifest from our remote registry on GitHub. We
      // intentionally do NOT hit the provider's own `/models` endpoint here
      // — that path is unreliable across providers and runtimes (some hang,
      // some require an API key the user hasn't entered yet, etc.). The
      // registry is the canonical, curated source.
      try {
        await useProviderRegistryStore.getState().refresh({ force: true })
      } catch (err) {
        console.warn(
          `[providers:${provider.provider}] registry refresh failed:`,
          err
        )
      }

      const state = useProviderRegistryStore.getState()
      if (state.error) {
        toast.error(t('providers:models'), {
          description: state.error,
        })
        return
      }

      // Count models that will newly appear on this provider after the
      // registry merge — for the success toast.
      const fresh = await serviceHub.providers().getProviders()
      const registryProvider = fresh.find(
        (p) => p.provider === provider.provider
      )
      const existingIds = new Set(provider.models.map((m) => m.id))
      const newCount = registryProvider
        ? registryProvider.models.filter((m) => !existingIds.has(m.id)).length
        : 0

      // `setProviders` merges new models from registry into useModelProvider
      // while preserving API keys, base URLs, and user-tweaked settings on
      // a per-provider basis. Existing models are NEVER removed.
      setProviders(fresh)

      if (newCount > 0) {
        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: newCount,
            provider: provider.provider,
          }),
        })
      } else {
        toast.success(t('providers:models'), {
          description: t('providers:noNewModels'),
        })
      }
    } catch (err) {
      console.error(
        `[providers:${provider.provider}] refresh failed:`,
        err
      )
      const detail =
        err instanceof Error && err.message
          ? err.message
          : t('providers:refreshModelsFailed', { provider: provider.provider })
      toast.error(t('providers:models'), {
        description: detail,
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  const handleStartModel = async (modelId: string) => {
    if (!provider) return
    setLoadingModels((prev) => [...prev, modelId])
    try {
      // switchToModel stops all other models, starts this one, restarts the
      // server, and updates activeModels / loadingModel globally.
      await switchToModel({
        modelId,
        providerName: provider.provider,
        serviceHub,
      })
    } catch (error) {
      setModelLoadError(error as ErrorObject)
    } finally {
      setLoadingModels((prev) => prev.filter((id) => id !== modelId))
    }
  }

  const handleStopModel = async () => {
    if (!provider) return
    try {
      const isLocalEngine = isLocalProvider(provider.provider)
      if (isLocalEngine) {
        await serviceHub.models().stopAllModels()
      } else {
        // Cloud "stop": drop the proxy registration so incoming chat requests
        // for this provider's models stop being routed upstream. Local engines
        // are untouched; they can't be active for a cloud provider anyway.
        await unregisterRemoteProvider(provider.provider)
      }
      await window.core?.api?.stopServer()
      useAppState.getState().setServerStatus('stopped')
      if (isLocalEngine) {
        const models = await serviceHub
          .models()
          .getActiveModels(provider.provider)
        syncActiveModelsFromEngines(models || [])
      } else {
        // Remove any of this cloud provider's models from the active list
        // while leaving other providers' active entries intact.
        const providerModelIds = new Set(provider.models.map((m) => m.id))
        const remaining = useAppState
          .getState()
          .activeModels.filter((id) => !providerModelIds.has(id))
        setActiveModels(remaining)
      }
    } catch (error) {
      console.error('Error stopping model:', error)
    }
  }

  /// Toggle the DFlash speculative-decoding flag on the MLX provider.
  ///
  /// The toggle is a no-op metadata flip unless an MLX model is currently
  /// running: in that case we resolve the matching `z-lab/*-DFlash*` repo
  /// (auto-downloading it if needed) and restart the live session with
  /// the right CLI flags. Unsupported base models surface a modal popup.
  const handleToggleDflash = useCallback(
    async (nextEnabled: boolean) => {
      if (provider?.provider !== 'mlx' || !provider) return
      if (isTogglingDflash || isDflashDownloading) return

      const writeSetting = (key: string, value: unknown) => {
        const next = provider.settings.map((s) =>
          s.key === key
            ? {
                ...s,
                controller_props: {
                  ...s.controller_props,
                  value: value as never,
                },
              }
            : s
        )
        serviceHub.providers().updateSettings(providerName, next)
        updateProvider(providerName, { ...provider, settings: next })
      }

      const currentBlockSizeRaw = provider.settings.find(
        (s) => s.key === 'block_size'
      )?.controller_props?.value
      const currentBlockSize = Number(currentBlockSizeRaw) || 16

      const errTitle = t('settings:dflashEnableFailed', {
        defaultValue: 'Failed to toggle DFlash',
      })
      const noActive = t('settings:dflashNoActiveModel', {
        defaultValue: 'Start an MLX model first.',
      })

      const mlxEngine: any = EngineManager.instance().get('mlx')
      if (!mlxEngine) {
        toast.error(errTitle, { description: noActive })
        return
      }

      const loadedModels: string[] =
        (await mlxEngine.getLoadedModels?.()) ?? []
      const activeMlxModel = loadedModels[0]

      setIsTogglingDflash(true)
      try {
        if (nextEnabled) {
          if (!activeMlxModel) {
            toast.error(errTitle, { description: noActive })
            return
          }

          const support = await mlxEngine.checkDflashSupport(activeMlxModel)
          if (!support?.supported) {
            setDflashUnsupportedModel(activeMlxModel)
            return
          }

          /// When the draft is already cached on disk the MLX server can
          /// pick it up instantly — surface that as "Loading…" instead
          /// of misleading the user with "Downloading…".
          toast.info(
            support.local
              ? t('settings:dflashLoadingDraft', {
                  defaultValue: 'Loading DFlash draft for {{modelId}}...',
                  modelId: activeMlxModel,
                })
              : t('settings:dflashDownloadingDraft', {
                  defaultValue:
                    'Downloading DFlash draft for {{modelId}}...',
                  modelId: activeMlxModel,
                })
          )

          /// Hand off the long HF download to the dedicated state so the
          /// inline spinner disappears and the global DownloadManagement
          /// panel becomes the single source of truth for progress. The
          /// MLX reload that happens after the download still runs under
          /// `isTogglingDflash` (re-set in `finally`) and re-shows the
          /// spinner for the brief reload window.
          if (!support.local) {
            setIsDflashDownloading(true)
            setIsTogglingDflash(false)
          }

          try {
            /// Reuse the manifest from `checkDflashSupport` so the
            /// extension can skip the static lookup. The extension owns
            /// local-first resolution and direct-download fallback from
            /// here on.
            await mlxEngine.enableDflash(activeMlxModel, currentBlockSize, {
              repo: support.repo,
              required: support.required,
              optional: support.optional,
            })
          } finally {
            if (!support.local) setIsDflashDownloading(false)
          }
          writeSetting('dflash_enabled', true)

          toast.success(
            t('settings:dflashEnableSuccess', {
              defaultValue: 'DFlash enabled',
            })
          )
        } else {
          if (activeMlxModel) {
            await mlxEngine.disableDflash(activeMlxModel)
          }
          writeSetting('dflash_enabled', false)

          toast.success(
            t('settings:dflashDisableSuccess', {
              defaultValue: 'DFlash disabled',
            })
          )
        }
      } catch (error) {
        console.error('Failed to toggle DFlash:', error)
        toast.error(errTitle, {
          description:
            error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsTogglingDflash(false)
      }
    },
    [
      provider,
      providerName,
      serviceHub,
      updateProvider,
      t,
      isTogglingDflash,
      isDflashDownloading,
    ]
  )

  const handleInstallBackendFromFile = useCallback(async () => {
    if (provider?.provider !== 'llamacpp' && provider?.provider !== 'mlx')
      return

    setIsInstallingBackend(true)
    try {
      // Open file dialog with filter for .tar.gz and .zip files
      const selectedFile = await serviceHub.dialog().open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Backend Archives',
            extensions: ['tar.gz', 'zip', 'gz'],
          },
        ],
      })

      if (selectedFile && typeof selectedFile === 'string') {
        // Process the file path: replace spaces with dashes and convert to lowercase

        // Install the backend using the llamacpp extension
        await installBackend(selectedFile)

        // Extract filename from the selected file path and replace spaces with dashes
        const fileName = basenameNoExt(selectedFile).replace(/\s+/g, '-')

        // Capitalize provider name for display
        const providerDisplayName =
          provider?.provider === 'llamacpp' ? 'Llamacpp' : 'MLX'

        toast.success(t('settings:backendInstallSuccess'), {
          description: `${providerDisplayName} ${fileName} installed`,
        })

        // Refresh settings to update backend configuration
        await refreshSettings()
      }
    } catch (error) {
      console.error('Failed to install backend from file:', error)
      toast.error(t('settings:backendInstallError'), {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setIsInstallingBackend(false)
    }
  }, [provider, serviceHub, refreshSettings, t, installBackend])

  /// Manual replacement for the legacy auto-popup: re-runs hardware
  /// detection on demand and, when a better backend is available,
  /// immediately kicks off the download. The user explicitly asked
  /// to find AND install — surfacing an extra confirmation dialog
  /// would just add a wasted click.
  ///
  /// UI surfaces:
  ///   - `Checking…` spinner replaces the button label only during
  ///     the (fast) detection phase. Once detection resolves we
  ///     return the button to idle and let the global
  ///     `<BackendUpdater />` dialog (mounted in `__root.tsx`) show
  ///     `downloading` → `restart-required` progress via the shared
  ///     `useBackendUpdater` event-driven state.
  ///
  /// Only meaningful for the llama.cpp provider on Windows / Linux —
  /// the macOS turboquant pipeline doesn't expose alternate backend
  /// types here.
  const handleFindOptimalBackend = useCallback(async () => {
    if (provider?.provider !== 'llamacpp') return
    setIsRecheckingBackend(true)
    try {
      const result = await recheckOptimalBackend()
      if (!result) {
        toast.success(t('settings:backendUpdater.alreadyOptimal'))
        return
      }
      // Pass the freshly-detected backend explicitly: the hook's
      // internal `recommendation` state has been queued via
      // `setRecommendation(result)` inside `recheckOptimalBackend`
      // but React has not committed the re-render yet, so a
      // `downloadRecommendedBackend()` call without an argument
      // would still see the previous (often null) closure value and
      // silently bail.
      void downloadRecommendedBackend(result.recommendedBackend).catch(
        (err) => {
          console.error('Optimal backend download failed:', err)
          toast.error(t('settings:backendUpdater.downloadFailed'))
        }
      )
    } catch (error) {
      console.error('Failed to recheck optimal backend:', error)
      toast.error(t('settings:backendUpdater.findOptimalFailed'))
    } finally {
      setIsRecheckingBackend(false)
    }
  }, [provider, recheckOptimalBackend, downloadRecommendedBackend, t])

  /// "Find optimal backend" stays busy until the whole pipeline is done:
  /// detection → download → hot-swap. Without this, the local
  /// `isRecheckingBackend` flips back to false the moment detection
  /// resolves (a few ms), so the spinner appears to flicker even though
  /// the heavy lifting is still going on inside `useBackendUpdater`.
  const isOptimalBackendBusy =
    isRecheckingBackend ||
    recommendationPhase === 'downloading' ||
    recommendationPhase === 'hotswapping'

  const optimalBackendLabel = isRecheckingBackend
    ? t('settings:backendUpdater.findOptimalChecking')
    : recommendationPhase === 'downloading'
      ? t('settings:backendUpdater.findOptimalDownloading')
      : recommendationPhase === 'hotswapping'
        ? t('settings:backendUpdater.findOptimalSwitching')
        : t('settings:backendUpdater.findOptimalAction')

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <div className="flex items-center justify-between">
              <h1 className="font-medium text-base">
                {getProviderTitle(providerName)}
              </h1>
              <Switch
                checked={provider?.active ?? false}
                onCheckedChange={(checked) =>
                  provider && updateProvider(providerName, { active: checked })
                }
              />
            </div>

            <div
              className={cn(
                'flex flex-col gap-3',
                provider &&
                  (provider.provider === 'llamacpp' ||
                    provider.provider === 'mlx') &&
                  'flex-col-reverse'
              )}
            >
              {/* Settings */}
              <Card>
                {provider?.settings.map((setting, settingIndex) => {
                  // Concurrent Mode acts as a master toggle over `parallel`,
                  // `cont_batching` and `expose_metrics`. When it's on, those
                  // rows are visually dimmed to signal they're managed.
                  const concurrentModeOn = !!(
                    provider?.settings.find(
                      (s) => s.key === 'concurrent_mode'
                    )?.controller_props as { value?: boolean } | undefined
                  )?.value
                  const isManagedByConcurrentMode =
                    concurrentModeOn &&
                    (setting.key === 'parallel' ||
                      setting.key === 'cont_batching' ||
                      setting.key === 'expose_metrics')
                  // Concurrent Slots only makes sense when Concurrent Mode is
                  // on; hide the row entirely otherwise to reduce clutter.
                  const isHiddenByConcurrentMode =
                    !concurrentModeOn && setting.key === 'concurrent_slots'

                  // The DFlash speculative-decoding toggle is the master
                  // switch over `block_size`: hide that field when DFlash
                  // is off so the panel stays uncluttered.
                  const dflashEnabledOn = !!(
                    provider?.settings.find(
                      (s) => s.key === 'dflash_enabled'
                    )?.controller_props as { value?: boolean } | undefined
                  )?.value
                  const isHiddenByDflash =
                    !dflashEnabledOn && setting.key === 'block_size'

                  // The dflash_enabled checkbox is rendered as a Switch with
                  // a custom side-effecting handler that reloads the live
                  // MLX session, so we short-circuit the generic
                  // DynamicControllerSetting path for it.
                  const isDflashToggle = setting.key === 'dflash_enabled'

                  // Use the DynamicController component
                  const actionComponent = (
                    <div className="mt-2">
                      {needsBackendConfig &&
                      setting.key === 'version_backend' ? (
                        <div className="flex items-center gap-1 text-sm">
                          <IconLoader size={16} className="animate-spin" />
                          <span>loading</span>
                        </div>
                      ) : isDflashToggle ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!(
                              setting.controller_props as {
                                value?: boolean
                              }
                            ).value}
                            disabled={
                              isTogglingDflash || isDflashDownloading
                            }
                            onCheckedChange={(checked) => {
                              handleToggleDflash(checked)
                            }}
                          />
                          {/* Inline spinner is intentionally hidden while a
                              HF download is in flight — the left-panel
                              DownloadManagement widget owns that progress
                              UX. The spinner only covers the short MLX
                              reload window after the download. */}
                          {isTogglingDflash && (
                            <IconLoader
                              size={14}
                              className="animate-spin text-muted-foreground"
                            />
                          )}
                        </div>
                      ) : (
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          className={cn(
                            setting.key === 'device' && 'hidden',
                            isHiddenByConcurrentMode && 'hidden',
                            isHiddenByDflash && 'hidden'
                          )}
                          onChange={(newValue) => {
                            if (provider) {
                              const newSettings = [...provider.settings]
                              // Handle different value types by forcing the type
                              // Use type assertion to bypass type checking

                              ;(
                                newSettings[settingIndex].controller_props as {
                                  value: string | boolean | number
                                }
                              ).value = newValue

                              // Concurrent Mode implies Prometheus /metrics:
                              // when the user turns the master toggle on,
                              // reflect the implicit expose_metrics=true in
                              // the UI so the Prometheus checkbox matches the
                              // server-side behaviour enforced in args.rs.
                              if (
                                setting.key === 'concurrent_mode' &&
                                newValue === true
                              ) {
                                const metricsIdx = newSettings.findIndex(
                                  (s) => s.key === 'expose_metrics'
                                )
                                if (metricsIdx !== -1) {
                                  ;(
                                    newSettings[metricsIdx]
                                      .controller_props as {
                                      value: boolean
                                    }
                                  ).value = true
                                }
                              }

                              // Create update object with updated settings
                              const updateObj: Partial<ModelProvider> = {
                                settings: newSettings,
                              }
                              // Check if this is an API key or base URL setting and update the corresponding top-level field
                              const settingKey = setting.key
                              if (
                                settingKey === 'api-key' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.api_key = newValue
                              } else if (
                                settingKey === 'base-url' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.base_url = newValue
                              }

                              // Reset device setting to empty when backend version changes
                              if (settingKey === 'version_backend') {
                                const deviceSettingIndex =
                                  newSettings.findIndex(
                                    (s) => s.key === 'device'
                                  )

                                if (deviceSettingIndex !== -1) {
                                  (
                                    newSettings[deviceSettingIndex]
                                      .controller_props as {
                                      value: string
                                    }
                                  ).value = ''
                                }

                                // Reset llamacpp device activations when backend version changes
                                if (providerName === 'llamacpp') {
                                  // Refresh devices to update activation status from provider settings
                                  const { fetchDevices } =
                                    useLlamacppDevices.getState()
                                  fetchDevices()
                                }
                              }

                              serviceHub
                                .providers()
                                .updateSettings(
                                  providerName,
                                  updateObj.settings ?? []
                                )
                              updateProvider(providerName, {
                                ...provider,
                                ...updateObj,
                              })

                              serviceHub.models().stopAllModels()

                              // Refresh active models after stopping. Use
                              // the shared helper so cloud models tracked
                              // only in UI state aren't wiped.
                              serviceHub
                                .models()
                                .getActiveModels()
                                .then((models) =>
                                  syncActiveModelsFromEngines(models || [])
                                )
                            }
                          }}
                        />
                      )}
                    </div>
                  )

                  return (
                    <CardItem
                      key={settingIndex}
                      title={setting.title}
                      className={cn(
                        setting.key === 'device' && 'hidden',
                        isHiddenByConcurrentMode && 'hidden',
                        isHiddenByDflash && 'hidden',
                        isManagedByConcurrentMode &&
                          'opacity-60 pointer-events-none'
                      )}
                      column={
                        setting.controller_type === 'input' &&
                        setting.controller_props.type !== 'number'
                          ? true
                          : false
                      }
                      description={
                        <>
                          <RenderMarkdown
                            className="![>p]:text-muted-foreground select-none"
                            content={setting.description}
                            components={{
                              // Make links open in a new tab, with the
                              // product brand colour #1F7CFF.
                              a: ({ style, ...props }) => {
                                return (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#1F7CFF', ...style }}
                                  />
                                )
                              },
                              p: ({ ...props }) => (
                                <p {...props} className="mb-0!" />
                              ),
                            }}
                          />
                          {setting.key === 'concurrent_slots' &&
                            concurrentModeOn && (
                              <div className="mt-1 text-sm text-muted-foreground">
                                {t(
                                  'providers:llamacpp.concurrentMode.perSlotContextWarning'
                                )}
                              </div>
                            )}
                          {setting.key === 'version_backend' &&
                            setting.controller_props?.recommended && (
                              <div className="mt-1 text-sm text-muted-foreground">
                                <span className="font-medium">
                                  {setting.controller_props.recommended
                                    ?.split('/')
                                    .pop() ||
                                    setting.controller_props.recommended}
                                </span>
                                <span> is the recommended backend.</span>
                              </div>
                            )}
                          {setting.key === 'version_backend' &&
                            (provider?.provider === 'llamacpp' ||
                              provider?.provider === 'mlx') && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleInstallBackendFromFile}
                                  disabled={isInstallingBackend}
                                >
                                  <IconUpload
                                    size={12}
                                    className={cn(
                                      'text-muted-foreground',
                                      isInstallingBackend && 'animate-pulse'
                                    )}
                                  />
                                  <span>
                                    {isInstallingBackend
                                      ? 'Installing Backend...'
                                      : 'Install Backend from File'}
                                  </span>
                                </Button>
                                {/* "Find optimal backend" replaces the
                                    legacy auto-popup nag — it runs the
                                    same hardware detection on demand and
                                    immediately starts the download when
                                    a better backend is available. The
                                    explicit min-width keeps layout
                                    stable when the label flips between
                                    "Find optimal backend" and the
                                    shorter "Checking…" loading state.
                                    Hidden on macOS because that platform
                                    uses the separate turboquant
                                    pipeline with no alternate backend
                                    matrix. */}
                                {provider?.provider === 'llamacpp' &&
                                  (IS_WINDOWS || IS_LINUX) && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={handleFindOptimalBackend}
                                      disabled={isOptimalBackendBusy}
                                      className="min-w-[12rem] justify-start"
                                    >
                                      {isOptimalBackendBusy ? (
                                        <IconLoader
                                          size={12}
                                          className="animate-spin text-muted-foreground"
                                        />
                                      ) : (
                                        <IconRocket
                                          size={12}
                                          className="text-muted-foreground"
                                        />
                                      )}
                                      <span>{optimalBackendLabel}</span>
                                    </Button>
                                  )}
                              </div>
                            )}
                          {/* Pending-backend banner: appears as soon as
                              the just-downloaded backend is sitting in
                              `llama_cpp_pending_backend` and waiting
                              for `activatePendingBackend()` on the
                              next launch. The `version_backend`
                              setting itself can't be hot-swapped while
                              the llama-server is running, so without
                              this pill the user sees no change
                              between "I clicked Find optimal" and "I
                              restarted the app". */}
                          {setting.key === 'version_backend' &&
                            provider?.provider === 'llamacpp' &&
                            pendingBackend && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  {t(
                                    'settings:backendUpdater.pendingBackendLabel'
                                  )}
                                </span>
                                <code className="font-mono text-foreground/80">
                                  {pendingBackend}
                                </code>
                                <span className="text-muted-foreground">
                                  {t(
                                    'settings:backendUpdater.pendingBackendHint'
                                  )}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="ml-auto"
                                  onClick={handleRestartForPendingBackend}
                                >
                                  <IconRefresh
                                    size={12}
                                    className="text-muted-foreground"
                                  />
                                  <span>
                                    {t('settings:backendUpdater.restartNow')}
                                  </span>
                                </Button>
                              </div>
                            )}
                        </>
                      }
                      actions={actionComponent}
                    />
                  )
                })}

                <DeleteProvider provider={provider} />
              </Card>

              {/* Models */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-foreground font-medium text-base">
                      {t('providers:models')}
                    </h1>
                    <div className="flex items-center gap-2">
                      {provider &&
                        provider.provider !== 'llamacpp' &&
                        provider.provider !== 'mlx' && (
                          <>
                            <Button
                              variant="secondary"
                              size="icon-xs"
                              onClick={handleRefreshModels}
                              disabled={refreshingModels}
                            >
                              {refreshingModels ? (
                                <IconLoader
                                  size={18}
                                  className="text-muted-foreground animate-spin"
                                />
                              ) : (
                                <IconRefresh
                                  size={18}
                                  className="text-muted-foreground"
                                />
                              )}
                            </Button>
                            <DialogAddModel provider={provider} />
                          </>
                        )}
                      {provider &&
                        (provider.provider === 'llamacpp' ||
                          provider.provider === 'mlx') &&
                        !hasDownloadedModels && (
                          <Button
                            variant="default"
                            size="sm"
                            className="min-w-[8rem] justify-center"
                            onClick={() =>
                              navigate({
                                to: route.hub.index,
                                search: {
                                  engine:
                                    provider.provider === 'mlx'
                                      ? 'mlx'
                                      : 'gguf',
                                },
                              })
                            }
                          >
                            <IconSearch size={18} />
                            <span>{t('providers:findModel')}</span>
                          </Button>
                        )}
                      {provider && provider.provider === 'llamacpp' && (
                        <ImportVisionModelDialog
                          provider={provider}
                          onSuccess={handleModelImportSuccess}
                          trigger={
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-w-[8rem] justify-center"
                            >
                              <IconFolderPlus
                                size={18}
                                className="text-muted-foreground"
                              />
                              <span>{t('providers:import')}</span>
                            </Button>
                          }
                        />
                      )}
                      {provider && provider.provider === 'mlx' && (
                        <ImportMlxModelDialog
                          provider={provider}
                          onSuccess={handleModelImportSuccess}
                          trigger={
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-w-[8rem] justify-center"
                            >
                              <IconFolderPlus
                                size={18}
                                className="text-muted-foreground"
                              />
                              <span>{t('providers:import')}</span>
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </div>
                }
              >
                {provider?.models.filter((m) => m.id !== EMBEDDING_MODEL_ID)
                  .length ? (
                  provider?.models
                    .filter((m) => m.id !== EMBEDDING_MODEL_ID)
                    .map((model, modelIndex) => {
                      const capabilities = model.capabilities || []
                      return (
                        <CardItem
                          key={modelIndex}
                          title={
                            <div className="flex items-center gap-2">
                              <h1
                                className="font-medium line-clamp-1"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </h1>
                              <Capabilities capabilities={capabilities} />
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-0.5">
                              {(() => {
                                // Favorite star sits on the far left of the
                                // action row, before the edit icon. The slot
                                // is always reserved so that toggling
                                // visibility (e.g. after entering an API key
                                // for a predefined cloud provider) doesn't
                                // shift the surrounding icons. For custom
                                // providers the star is always visible; for
                                // predefined providers it's only visible once
                                // an API key has been set.
                                if (!provider) return null
                                const isPredefined = isKnownProvider(
                                  provider.provider
                                )
                                const showFavorite =
                                  !isPredefined ||
                                  Boolean(provider.api_key?.length)
                                return (
                                  <div
                                    aria-hidden={!showFavorite}
                                    className={
                                      showFavorite
                                        ? undefined
                                        : 'invisible pointer-events-none'
                                    }
                                  >
                                    <FavoriteModelAction model={model} />
                                  </div>
                                )
                              })()}
                              <DialogEditModel
                                provider={provider}
                                modelId={model.id}
                              />
                              {model.settings && (
                                <ModelSetting
                                  provider={provider}
                                  model={model}
                                />
                              )}
                              <DialogDeleteModel
                                provider={provider}
                                modelId={model.id}
                              />
                              {provider &&
                                (() => {
                                  const isLocalEngine =
                                    provider.provider === 'llamacpp' ||
                                    provider.provider === 'mlx'
                                  // Cloud providers need an API key before
                                  // they can be "started" (registered with the
                                  // proxy). Local engines don't.
                                  const needsApiKey =
                                    !isLocalProvider(provider.provider) &&
                                    !provider.api_key
                                  const isActive = activeModels.some(
                                    (activeModel) => activeModel === model.id
                                  )
                                  const isLoading = loadingModels.includes(
                                    model.id
                                  )

                                  if (isActive) {
                                    return (
                                      <div className="ml-2">
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => handleStopModel()}
                                        >
                                          {t('providers:stop')}
                                        </Button>
                                      </div>
                                    )
                                  }

                                  const startButton = (
                                    <Button
                                      size="sm"
                                      disabled={isLoading || needsApiKey}
                                      onClick={() =>
                                        handleStartModel(model.id)
                                      }
                                    >
                                      {isLoading ? (
                                        <div className="flex items-center gap-2">
                                          <IconLoader
                                            size={16}
                                            className="animate-spin"
                                          />
                                        </div>
                                      ) : (
                                        t('providers:start')
                                      )}
                                    </Button>
                                  )

                                  return (
                                    <div className="ml-2">
                                      {needsApiKey && !isLocalEngine ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>{startButton}</span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            Add API key first
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        startButton
                                      )}
                                    </div>
                                  )
                                })()}
                            </div>
                          }
                        />
                      )
                    })
                ) : (
                  <div className="-mt-2">
                    <div className="flex items-center gap-2">
                      <h6 className="font-medium text-base">
                        {t('providers:noModelFound')}
                      </h6>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {t('providers:noModelFoundDesc')}
                      &nbsp;
                      <Link to={route.hub.index}>{t('common:hub')}</Link>
                    </p>
                  </div>
                )}
                {/* Show importing skeleton first if there's one */}
                {importingModel && (
                  <CardItem
                    key="importing-skeleton"
                    title={
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 animate-pulse">
                          <div className="flex gap-2 px-2 py-1 rounded-full text-xs">
                            <IconLoader size={16} className="animate-spin" />
                            Importing...
                          </div>
                          <h1 className="font-medium line-clamp-1">
                            {importingModel}
                          </h1>
                        </div>
                      </div>
                    }
                  />
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
      <DflashUnsupportedDialog
        open={dflashUnsupportedModel !== null}
        onOpenChange={(open) => {
          if (!open) setDflashUnsupportedModel(null)
        }}
        modelId={dflashUnsupportedModel ?? ''}
      />
    </div>
  )
}
