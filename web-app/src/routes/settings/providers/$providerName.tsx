/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName, isLocalProvider } from '@/lib/utils'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { ImportLlamacppModelDialog } from '@/containers/dialogs/ImportLlamacppModelDialog'
import { ImportMlxModelDialog } from '@/containers/dialogs/ImportMlxModelDialog'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { DialogDeleteAllModels } from '@/containers/dialogs/DeleteAllModels'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { SecretInput } from '@/components/ui/secret-input'
import { Switch } from '@/components/ui/switch'
import {
  IconCircleCheck,
  IconCircle,
  IconFolderPlus,
  IconInfoCircle,
  IconLoader,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react'
import { useDefaultEmbeddingModel } from '@/hooks/useDefaultEmbeddingModel'
import { toast } from 'sonner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { predefinedProviders } from '@/constants/providers'
import { useModelLoad } from '@/hooks/useModelLoad'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { useBackendUpdater } from '@/hooks/useBackendUpdater'
import { basenameNoExt } from '@/lib/utils'
import { useAppState } from '@/hooks/useAppState'
import { useShallow } from 'zustand/shallow'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import {
  providerHasRemoteApiKeys,
  providerRemoteApiKeyChain,
  API_KEY_FALLBACKS_SETTING_KEY,
  serializeApiKeyFallbacks,
} from '@/lib/provider-api-keys'
import {
  supportsRemoteCatalog,
  fetchTopRemoteModels,
} from '@/lib/remoteModelCatalog'

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
  const [isCheckingBackendUpdate, setIsCheckingBackendUpdate] = useState(false)
  const [isInstallingBackend, setIsInstallingBackend] = useState(false)
  const [importingModel, setImportingModel] = useState<string | null>(null)
  const [apiKeysDraft, setApiKeysDraft] = useState('')
  const [showAdvancedApiKeys, setShowAdvancedApiKeys] = useState(false)
  const [isTestingKeys, setIsTestingKeys] = useState(false)
  const [keyCheckResults, setKeyCheckResults] = useState<
    { index: number; masked: string; status: string; detail: string }[]
  >([])
  const { checkForUpdate: checkForBackendUpdate, installBackend } =
    useBackendUpdater()
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, setProviders, updateProvider, addDeletedModels } =
    useModelProvider()
  const provider = getProviderByName(providerName)
  const isLlamacpp = provider?.provider === 'llamacpp'
  const isPredefinedProvider = useMemo(
    () => predefinedProviders.some((p) => p.provider === providerName),
    [providerName]
  )
  const allModels = useMemo(() => provider?.models ?? [], [provider?.models])
  const embeddingModels = useMemo(
    () =>
      isLlamacpp
        ? allModels.filter((m) => (m as any).embedding === true)
        : [],
    [isLlamacpp, allModels]
  )
  const chatModels = useMemo(
    () =>
      isLlamacpp
        ? allModels.filter((m) => (m as any).embedding !== true)
        : allModels,
    [isLlamacpp, allModels]
  )
  const defaultEmbeddingModelId = useDefaultEmbeddingModel((s) =>
    isLlamacpp ? s.getDefault('llamacpp') : undefined
  )
  const setDefaultEmbeddingModel = useDefaultEmbeddingModel((s) => s.setDefault)
  const clearDefaultEmbeddingModel = useDefaultEmbeddingModel(
    (s) => s.clearDefault
  )

  useEffect(() => {
    if (!isLlamacpp) return
    const hasMini = allModels.some(
      (m) => m.id === 'sentence-transformer-mini'
    )
    if (
      !defaultEmbeddingModelId &&
      embeddingModels.length === 1 &&
      !hasMini
    ) {
      setDefaultEmbeddingModel('llamacpp', embeddingModels[0].id)
      return
    }
    if (
      defaultEmbeddingModelId &&
      embeddingModels.length > 0 &&
      !embeddingModels.some((m) => m.id === defaultEmbeddingModelId)
    ) {
      clearDefaultEmbeddingModel('llamacpp')
      return
    }
    if (defaultEmbeddingModelId && embeddingModels.length === 0) {
      clearDefaultEmbeddingModel('llamacpp')
    }
  }, [
    isLlamacpp,
    defaultEmbeddingModelId,
    embeddingModels,
    allModels,
    setDefaultEmbeddingModel,
    clearDefaultEmbeddingModel,
  ])

  // Check if llamacpp/mlx provider needs backend configuration
  const isBackendKey = (k: string) =>
    k === 'llamacpp_version' || k === 'llamacpp_backend'
  const needsBackendConfig =
    (provider?.provider === 'llamacpp' || provider?.provider === 'mlx') &&
    provider.settings?.some(
      (setting) =>
        isBackendKey(setting.key) &&
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
    // Initial data fetch - load active models for the current provider
    if (provider?.provider) {
      serviceHub
        .models()
        .getActiveModels(provider.provider)
        .then((models) => setActiveModels(models || []))
    }
  }, [serviceHub, setActiveModels, provider?.provider])

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

  useEffect(() => {
    if (!provider) return
    if (provider.provider === 'llamacpp' || provider.provider === 'mlx') return
    setApiKeysDraft(providerRemoteApiKeyChain(provider).join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerName, provider?.api_key, JSON.stringify(provider?.api_key_fallbacks ?? [])])

  const autoCatalogAttempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!provider) return
    if (!supportsRemoteCatalog(provider.provider)) return
    if (provider.models.length > 0) return
    if (!providerHasRemoteApiKeys(provider)) return
    if (autoCatalogAttempted.current.has(provider.provider)) return
    autoCatalogAttempted.current.add(provider.provider)
    handleRefreshModels()
    // handleRefreshModels closes over the latest provider; only watch the
    // signals that decide whether auto-fetch should fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.provider, provider?.api_key, provider?.models.length])

  const commitApiKeysDraft = useCallback(() => {
    if (!provider) return
    const lines = apiKeysDraft
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    const nextPrimary = lines[0] ?? ''
    const nextFallbacks = lines.slice(1)

    const prevPrimary = provider.api_key ?? ''
    const prevFallbacks = provider.api_key_fallbacks ?? []
    const changed =
      nextPrimary !== prevPrimary ||
      JSON.stringify(nextFallbacks) !== JSON.stringify(prevFallbacks)
    if (!changed) return

    const newSettings = [...provider.settings]
    const apiKeySettingIndex = newSettings.findIndex((s) => s.key === 'api-key')
    if (apiKeySettingIndex !== -1) {
      const apiKeyProps = newSettings[apiKeySettingIndex].controller_props as {
        value: string | boolean | number
      }
      apiKeyProps.value = nextPrimary
    }

    const fallbacksValue = serializeApiKeyFallbacks(nextFallbacks)
    const fallbacksIndex = newSettings.findIndex(
      (s) => s.key === API_KEY_FALLBACKS_SETTING_KEY
    )
    if (fallbacksIndex !== -1) {
      const props = newSettings[fallbacksIndex].controller_props as {
        value: string | boolean | number
      }
      props.value = fallbacksValue
    } else if (fallbacksValue.length > 0) {
      newSettings.push({
        key: API_KEY_FALLBACKS_SETTING_KEY,
        title: 'API Key Fallbacks',
        description: '',
        controller_type: 'input',
        controller_props: {
          value: fallbacksValue,
          type: 'password',
          placeholder: '',
        },
      } as (typeof newSettings)[number])
    }

    serviceHub.providers().updateSettings(providerName, newSettings)
    updateProvider(providerName, {
      ...provider,
      settings: newSettings,
      api_key: nextPrimary,
      api_key_fallbacks: nextFallbacks,
    })
  }, [apiKeysDraft, provider, providerName, serviceHub, updateProvider])

  const rawApiKeyLines = apiKeysDraft.split(/\r?\n/)
  const primaryKeyDraft = (rawApiKeyLines[0] ?? '').trim()
  const setPrimaryKeyDraft = (nextPrimary: string) => {
    const rest = rawApiKeyLines.slice(1)
    setApiKeysDraft([nextPrimary, ...rest].join('\n'))
  }

  const advancedApiKeyLines = apiKeysDraft.split(/\r?\n/).map((l) => l.trim())
  const setKeyAtIndex = (index: number, nextValue: string) => {
    const next = [...advancedApiKeyLines]
    next[index] = nextValue.trim()
    setApiKeysDraft(next.join('\n'))
  }

  const addKeyLine = () => {
    setApiKeysDraft([...advancedApiKeyLines, ''].join('\n'))
  }

  const removeKeyLine = (index: number) => {
    if (index === 0) return
    const next = advancedApiKeyLines.filter((_, i) => i !== index)
    setApiKeysDraft((next.length > 0 ? next : ['']).join('\n'))
  }

  const maskApiKey = useCallback((value: string) => {
    if (value.length <= 8) return `${value.slice(0, 2)}***`
    return `${value.slice(0, 4)}***${value.slice(-4)}`
  }, [])

  const getStatusLabel = useCallback((status: string) => {
    switch (status) {
      case 'ok':
        return 'OK'
      case 'unauthorized':
        return 'Invalid / revoked key (401)'
      case 'forbidden':
        return 'Forbidden (403)'
      case 'rate_limited':
        return 'Rate limited / out of credit (429)'
      case 'network_error':
        return 'Network error'
      default:
        return 'Failed'
    }
  }, [])

  const getStatusClass = useCallback((status: string) => {
    switch (status) {
      case 'ok':
        return 'text-green-600'
      case 'unauthorized':
      case 'forbidden':
      case 'http_error':
      case 'network_error':
      case 'rate_limited':
        return 'text-yellow-600'
      default:
        return 'text-destructive'
    }
  }, [])

  const handleTestApiKeys = useCallback(async () => {
    if (!provider?.base_url) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    const keyDraftLines = apiKeysDraft.split(/\r?\n/).map((l) => l.trim())
    const nonEmptyKeyCount = keyDraftLines.filter((l) => l.length > 0).length
    if (nonEmptyKeyCount === 0) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setIsTestingKeys(true)
    try {
      const fetchImpl = serviceHub.providers().fetch()
      const results: { index: number; masked: string; status: string; detail: string }[] = []

      for (let i = 0; i < keyDraftLines.length; i++) {
        const key = keyDraftLines[i]
        const keyIndex = i + 1
        if (!key) continue
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': key,
          Authorization: `Bearer ${key}`,
        }
        if (
          provider.base_url.includes('localhost:') ||
          provider.base_url.includes('127.0.0.1:')
        ) {
          headers['Origin'] = 'tauri://localhost'
        }

        try {
          const response = await fetchImpl(`${provider.base_url}/models`, {
            method: 'GET',
            headers,
          })

          let status = 'http_error'
          if (response.ok) status = 'ok'
          else if (response.status === 401) status = 'unauthorized'
          else if (response.status === 403) status = 'forbidden'
          else if (response.status === 429) status = 'rate_limited'

          results.push({
            index: keyIndex,
            masked: maskApiKey(key),
            status,
            detail: `${response.status} ${response.statusText}`,
          })
        } catch (err) {
          results.push({
            index: keyIndex,
            masked: maskApiKey(key),
            status: 'network_error',
            detail: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      setKeyCheckResults(results)
    } finally {
      setIsTestingKeys(false)
    }
  }, [apiKeysDraft, maskApiKey, provider?.base_url, serviceHub, t])

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
    if (!provider || !provider.base_url || !providerHasRemoteApiKeys(provider)) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setRefreshingModels(true)
    try {
      let newModels: Model[]
      if (supportsRemoteCatalog(provider.provider)) {
        const catalog = await fetchTopRemoteModels(provider, serviceHub.providers().fetch())
        newModels = catalog.map((m) => ({
          id: m.id,
          model: m.id,
          name: m.id,
          capabilities: m.capabilities,
          version: '1.0',
        }))
      } else {
        const modelIds = await serviceHub
          .providers()
          .fetchModelsFromProvider(provider)
        newModels = modelIds.map((id) => ({
          id,
          model: id,
          name: id,
          capabilities: ['completion'],
          version: '1.0',
        }))
      }

      if (supportsRemoteCatalog(provider.provider)) {
        const importedModels = provider.models.filter((m) => m.imported)
        const importedIds = new Set(importedModels.map((m) => m.id))
        const fresh = newModels.filter((m) => !importedIds.has(m.id))
        if (fresh.length === 0) {
          toast.success(t('providers:models'), {
            description: t('providers:noNewModels'),
          })
          return
        }
        const updatedModels = [...importedModels, ...fresh]
        const keepIds = new Set(updatedModels.map((m) => m.id))
        const removedIds = provider.models
          .filter((m) => !m.imported && !keepIds.has(m.id))
          .map((m) => m.id)
        addDeletedModels(removedIds)
        updateProvider(providerName, {
          ...provider,
          models: updatedModels,
        })
        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: fresh.length,
            provider: provider.provider,
          }),
        })
        return
      }

      const existingModelIds = provider.models.map((m) => m.id)
      const modelsToAdd = newModels.filter(
        (model) => !existingModelIds.includes(model.id)
      )

      if (modelsToAdd.length > 0) {
        const updatedModels = [...provider.models, ...modelsToAdd]
        updateProvider(providerName, {
          ...provider,
          models: updatedModels,
        })

        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: modelsToAdd.length,
            provider: provider.provider,
          }),
        })
      } else {
        toast.success(t('providers:models'), {
          description: t('providers:noNewModels'),
        })
      }
    } catch (error) {
      console.error(
        t('providers:refreshModelsFailed', { provider: provider.provider }),
        error
      )
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsFailed', {
          provider: provider.provider,
        }),
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  const handleStartModel = async (modelId: string) => {
    // Add model to loading state
    setLoadingModels((prev) => [...prev, modelId])
    if (provider) {
      try {
        // Start the model with plan result
        await serviceHub.models().startModel(provider, modelId)

        // Refresh active models after starting (pass provider to get correct engine's loaded models)
        serviceHub
          .models()
          .getActiveModels(provider.provider)
          .then((models) => setActiveModels(models || []))
      } catch (error) {
        setModelLoadError(error as ErrorObject)
      } finally {
        // Remove model from loading state
        setLoadingModels((prev) => prev.filter((id) => id !== modelId))
      }
    }
  }

  const handleStopModel = (modelId: string) => {
    // Original: stopModel(modelId).then(() => { setActiveModels((prevModels) => prevModels.filter((model) => model !== modelId)) })
    serviceHub
      .models()
      .stopModel(modelId, provider?.provider)
      .then(() => {
        // Refresh active models after stopping (pass provider to get correct engine's loaded models)
        serviceHub
          .models()
          .getActiveModels(provider?.provider)
          .then((models) => setActiveModels(models || []))
      })
      .catch((error) => {
        console.error('Error stopping model:', error)
      })
  }

  const handleCheckForBackendUpdate = useCallback(async () => {
    if (provider?.provider !== 'llamacpp' && provider?.provider !== 'mlx')
      return

    setIsCheckingBackendUpdate(true)
    try {
      const update = await checkForBackendUpdate(true)
      if (!update) {
        toast.info(t('settings:noBackendUpdateAvailable'))
      }
      // If update is available, the BackendUpdater dialog will automatically show
    } catch (error) {
      console.error('Failed to check for backend updates:', error)
      toast.error(t('settings:backendUpdateError'))
    } finally {
      setIsCheckingBackendUpdate(false)
    }
  }, [provider, checkForBackendUpdate, t])

  const handleInstallBackendFromFile = useCallback(async () => {
    if (provider?.provider !== 'llamacpp' && provider?.provider !== 'mlx')
      return

    setIsInstallingBackend(true)
    try {
      // macOS NSOpenPanel maps filter strings to UTTypes via
      // typeWithFilenameExtension:, which only accepts single-component
      // extensions. `.tar.gz` resolves to org.gnu.gnu-zip-tar-archive,
      // which is a sibling — not a child — of `.gz`'s UTType, so neither
      // a `tar.gz` nor `gz` filter enables `.tar.gz` files in the picker.
      // Skip the filter on macOS and revalidate after the pick.
      const isMac =
        typeof navigator !== 'undefined' &&
        navigator.userAgent.toUpperCase().includes('MAC')
      const selectedFile = await serviceHub.dialog().open({
        multiple: false,
        directory: false,
        filters: isMac
          ? undefined
          : [
              {
                name: 'Backend Archives',
                extensions: ['tar.gz', 'zip'],
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
                onCheckedChange={(checked) => provider && updateProvider(providerName, { active: checked })}
              />
            </div>

            {provider &&
              !isLocalProvider(provider.provider) &&
              !supportsRemoteCatalog(provider.provider) && (
                <div className="flex items-start gap-2 rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-3 py-2 text-xs text-muted-foreground">
                  <IconInfoCircle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    {t('providers:limitedSupport', {
                      defaultValue:
                        'This provider may not be fully supported. Capabilities (tools, vision, audio) are not auto-detected - add models manually and configure capabilities per model.',
                    })}
                  </span>
                </div>
              )}

            {provider?.provider === 'mlx' && (
              <div className="flex items-start gap-2 rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-3 py-2 text-xs text-muted-foreground">
                <IconInfoCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {t('providers:mlxExperimental', {
                    defaultValue:
                      'MLX support is experimental. Embeddings are unavailable, the reasoning toggle is not yet wired through, and some newer model architectures may fail to load. Report issues on GitHub so we can prioritize them.',
                  })}
                </span>
              </div>
            )}

            <div
              className={cn(
                'flex flex-col gap-3',
                provider &&
                  (provider.provider === 'llamacpp' ||
                    provider.provider === 'mlx') &&
                  'flex-col-reverse'
              )}
            >
              {/* Settings — hidden for predefined remote providers since
                  api-key + base-url are both surfaced elsewhere / hidden. */}
              {!(
                isPredefinedProvider &&
                provider?.provider !== 'llamacpp' &&
                provider?.provider !== 'mlx'
              ) && (
              <Card>
                {provider?.settings.map((setting, settingIndex) => {
                  if (
                    setting.key === 'api-key' &&
                    provider?.provider !== 'llamacpp' &&
                    provider?.provider !== 'mlx'
                  ) {
                    return null
                  }

                  if (
                    provider?.provider === 'llamacpp' &&
                    setting.key === 'fit_ctx'
                  ) {
                    return null
                  }

                  // Use the DynamicController component
                  const actionComponent = (
                    <div className="mt-2">
                      {needsBackendConfig && isBackendKey(setting.key) ? (
                        <div className="flex items-center gap-1 text-sm">
                          <IconLoader size={16} className="animate-spin" />
                          <span>loading</span>
                        </div>
                      ) : (
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          className={cn(setting.key === 'device' && 'hidden')}
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

                              // Reset device setting to empty when backend or version changes
                              if (isBackendKey(settingKey)) {
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

                              // Refresh active models after stopping
                              serviceHub
                                .models()
                                .getActiveModels()
                                .then((models) => setActiveModels(models || []))
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
                      className={cn(setting.key === 'device' && 'hidden')}
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
                              // Make links open in a new tab
                              a: ({ ...props }) => {
                                return (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                )
                              },
                              p: ({ ...props }) => (
                                <p {...props} className="mb-0!" />
                              ),
                            }}
                          />
                          {setting.key === 'llamacpp_backend' &&
                            setting.controller_props?.recommended && (
                              <div className="mt-1 text-sm text-muted-foreground">
                                <span className="font-medium">
                                  {setting.controller_props.recommended}
                                </span>
                                <span> is the recommended backend.</span>
                              </div>
                            )}
                          {setting.key === 'llamacpp_backend' &&
                            (provider?.provider === 'llamacpp' ||
                              provider?.provider === 'mlx') && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={cn(
                                    isCheckingBackendUpdate &&
                                      'pointer-events-none'
                                  )}
                                  onClick={handleCheckForBackendUpdate}
                                >
                                  <IconRefresh
                                    size={12}
                                    className={cn(
                                      'text-muted-foreground',
                                      isCheckingBackendUpdate && 'animate-spin'
                                    )}
                                  />
                                  <span>
                                    {isCheckingBackendUpdate
                                      ? t('settings:checkingForBackendUpdates')
                                      : t('settings:checkForBackendUpdates')}
                                  </span>
                                </Button>
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
              )}

              {provider &&
                provider.provider !== 'llamacpp' &&
                provider.provider !== 'mlx' && (
                  <Card>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <h2 className="font-medium text-foreground text-base">
                          {t('providers:apiKeys.title')}
                        </h2>
                        <p className="text-sm text-muted-foreground leading-normal">
                          {t('providers:apiKeys.description')}
                        </p>
                      </div>
                      {!showAdvancedApiKeys && (
                        <div className="flex flex-col gap-2">
                          <SecretInput
                            className="font-mono"
                            placeholder={t('providers:apiKeys.primaryPlaceholder')}
                            value={primaryKeyDraft}
                            onChange={(e) => setPrimaryKeyDraft(e.target.value)}
                            onBlur={() => commitApiKeysDraft()}
                            spellCheck={false}
                            autoComplete="off"
                          />

                          <div className="flex items-center justify-between gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setShowAdvancedApiKeys(true)
                                setKeyCheckResults([])
                              }}
                            >
                              {t('providers:apiKeys.advanced')}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              {t('providers:apiKeys.oneKeyHint')}
                            </span>
                          </div>
                        </div>
                      )}

                      {showAdvancedApiKeys && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                              {t('providers:apiKeys.testHint')}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  commitApiKeysDraft()
                                  setShowAdvancedApiKeys(false)
                                  setKeyCheckResults([])
                                }}
                              >
                                {t('providers:apiKeys.hideAdvanced')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleTestApiKeys}
                                disabled={isTestingKeys}
                              >
                                {isTestingKeys ? (
                                  <>
                                    <IconLoader
                                      size={14}
                                      className="animate-spin"
                                    />
                                    {t('providers:apiKeys.testing')}
                                  </>
                                ) : (
                                  t('providers:apiKeys.test')
                                )}
                              </Button>
                            </div>
                          </div>

                          <div className="text-xs text-muted-foreground">
                            Primary key is <span className="font-medium">#1</span>. Jan
                            retries the next key only on{' '}
                            <span className="font-medium">401/403/429</span>.
                          </div>

                          <div className="space-y-2">
                            {advancedApiKeyLines.map((keyValue, idx) => {
                              const keyIndex = idx + 1
                              const rowResult = keyCheckResults.find(
                                (r) => r.index === keyIndex
                              )

                              return (
                                <div
                                  key={idx}
                                  className="grid grid-cols-[2.5rem_1fr_2rem] gap-x-2 gap-y-1 items-center"
                                >
                                  <div className="text-right text-xs font-mono text-muted-foreground">
                                    #{keyIndex}
                                  </div>

                                  <div className="min-w-0">
                                    <SecretInput
                                      className="font-mono w-full"
                                      placeholder={t('providers:apiKeys.keyPlaceholder')}
                                      value={keyValue}
                                      onChange={(e) => {
                                        setKeyAtIndex(idx, e.target.value)
                                      }}
                                      onBlur={commitApiKeysDraft}
                                      spellCheck={false}
                                      autoComplete="off"
                                    />
                                  </div>

                                  <div className="flex justify-end">
                                    {idx !== 0 ? (
                                      <Button
                                        size="icon-xs"
                                        variant="outline"
                                        onClick={() => {
                                          setKeyCheckResults([])
                                          removeKeyLine(idx)
                                        }}
                                        title={t('providers:apiKeys.removeKey')}
                                      >
                                        -
                                      </Button>
                                    ) : (
                                      <span aria-hidden>&nbsp;</span>
                                    )}
                                  </div>

                                  <div aria-hidden />
                                  <div className="min-w-0">
                                    {rowResult && (
                                      <div
                                        className={cn(
                                          'text-right text-xs font-medium',
                                          getStatusClass(rowResult.status)
                                        )}
                                        title={rowResult.detail}
                                      >
                                        {getStatusLabel(rowResult.status)}
                                      </div>
                                    )}
                                  </div>
                                  <div aria-hidden />
                                </div>
                              )
                            })}

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setKeyCheckResults([])
                                  addKeyLine()
                                }}
                              >
                                + {t('providers:apiKeys.addKey')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                )}

              {/* Models */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-foreground font-medium text-base">
                      {t('providers:models')}
                    </h1>
                    <div className="flex items-center gap-2">
                      {provider && provider.provider !== 'llamacpp' && provider.provider !== 'mlx' && (
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
                          provider.provider === 'mlx') && (
                          <DialogDeleteAllModels provider={provider} />
                        )}
                      {provider && provider.provider === 'llamacpp' && (
                        <ImportLlamacppModelDialog
                          provider={provider}
                          onSuccess={handleModelImportSuccess}
                          trigger={
                            <Button
                              variant="secondary"
                              size="sm"
                            >
                              <IconFolderPlus
                                size={18}
                                className="text-muted-foreground"
                              />
                              <span>
                                {t('providers:import')}
                              </span>
                            </Button>
                          }
                        />
                      )}
                      {provider && provider.provider === 'mlx' && (
                          <ImportMlxModelDialog
                            provider={provider}
                            onSuccess={handleModelImportSuccess}
                            trigger={
                              <Button variant="secondary" size="sm">
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
                {provider?.models.length ? (
                  <>
                  {isLlamacpp && embeddingModels.length > 0 && chatModels.length > 0 && (
                    <div
                      role="separator"
                      aria-label={t('providers:chatModels')}
                      className="mt-1 mb-3 flex items-center gap-3"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('providers:chatModels')}
                      </span>
                      <span className="h-0.5 flex-1 rounded-full bg-main-view-fg/15" />
                    </div>
                  )}
                  {(isLlamacpp ? chatModels : allModels).map((model, modelIndex) => {
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
                            {model.imported && (
                              <span
                                className="shrink-0 rounded-sm bg-main-view-fg/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                title={t('providers:importedTooltip')}
                              >
                                {t('providers:imported')}
                              </span>
                            )}
                          </div>
                        }
                        actions={
                          <div className="flex items-center gap-0.5">
                            <DialogEditModel
                              provider={provider}
                              modelId={model.id}
                            />
                            {model.settings && provider &&
                              provider.provider === 'llamacpp' && (
                              <ModelSetting provider={provider} model={model} />
                            )}
                            {((provider &&
                              !predefinedProviders.some(
                                (p) => p.provider === provider.provider
                              )) ||
                              (provider &&
                                predefinedProviders.some(
                                  (p) => p.provider === provider.provider
                                ) &&
                                providerHasRemoteApiKeys(provider))) && (
                              <FavoriteModelAction model={model} />
                            )}
                            <DialogDeleteModel
                              provider={provider}
                              modelId={model.id}
                            />
                            {provider &&
                              (provider.provider === 'llamacpp' ||
                                provider.provider === 'mlx') && (
                                <div className="ml-2">
                                  {activeModels.some(
                                    (activeModel) => activeModel === model.id
                                  ) ? (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => handleStopModel(model.id)}
                                    >
                                      {t('providers:stop')}
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      disabled={loadingModels.includes(
                                        model.id
                                      )}
                                      onClick={() => handleStartModel(model.id)}
                                    >
                                      {loadingModels.includes(model.id) ? (
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
                                  )}
                                </div>
                              )}
                          </div>
                        }
                      />
                    )
                  })}
                  </>
                ) : (
                  <div className="-mt-2">
                    <div className="flex items-center gap-2">
                      <h6 className="font-medium text-base">
                        {t('providers:noModelFound')}
                      </h6>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {provider && !isLocalProvider(provider.provider) ? (
                        t('providers:noModelFoundRemoteDesc')
                      ) : (
                        <>
                          {t('providers:noModelFoundDesc')}
                          &nbsp;
                          <Link to={route.hub.index}>{t('common:hub')}</Link>
                        </>
                      )}
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
                            <IconLoader
                              size={16}
                              className="animate-spin"
                            />
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

                {isLlamacpp && provider && embeddingModels.length > 0 && (
                  <>
                    <div
                      role="separator"
                      aria-label={t('providers:embeddingModels')}
                      className="mt-5 mb-3 flex items-center gap-3"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('providers:embeddingModels')}
                      </span>
                      <span className="h-0.5 flex-1 rounded-full bg-main-view-fg/15" />
                    </div>
                    {embeddingModels.map((model, modelIndex) => {
                      const isDefault = defaultEmbeddingModelId === model.id
                      return (
                        <CardItem
                          key={`embedding-${modelIndex}`}
                          title={
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setDefaultEmbeddingModel(
                                    'llamacpp',
                                    model.id
                                  )
                                }
                                aria-label={
                                  isDefault
                                    ? t('providers:embeddingModelIsDefault')
                                    : t('providers:embeddingModelSetDefault')
                                }
                                title={
                                  isDefault
                                    ? t('providers:embeddingModelIsDefault')
                                    : t('providers:embeddingModelSetDefault')
                                }
                                className="size-6 flex items-center justify-center rounded transition-all hover:bg-main-view-fg/8"
                              >
                                {isDefault ? (
                                  <IconCircleCheck
                                    size={18}
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <IconCircle
                                    size={18}
                                    className="text-muted-foreground"
                                  />
                                )}
                              </button>
                              <h1
                                className="font-medium line-clamp-1"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </h1>
                              <Capabilities
                                capabilities={model.capabilities || []}
                              />
                              {isDefault && (
                                <span className="shrink-0 rounded-sm bg-main-view-fg/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {t('providers:embeddingModelDefault')}
                                </span>
                              )}
                              {model.imported && (
                                <span
                                  className="shrink-0 rounded-sm bg-main-view-fg/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                  title={t('providers:importedTooltip')}
                                >
                                  {t('providers:imported')}
                                </span>
                              )}
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-0.5">
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
                            </div>
                          }
                        />
                      )
                    })}
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
