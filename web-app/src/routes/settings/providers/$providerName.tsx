/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { ImportVisionModelDialog } from '@/containers/dialogs/ImportVisionModelDialog'
import { ImportMlxModelDialog } from '@/containers/dialogs/ImportMlxModelDialog'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import {
  IconFolderPlus,
  IconLoader,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useCallback, useEffect, useState } from 'react'
import { predefinedProviders } from '@/constants/providers'
import { useModelLoad } from '@/hooks/useModelLoad'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { useBackendUpdater } from '@/hooks/useBackendUpdater'
import { basenameNoExt } from '@/lib/utils'
import { useAppState } from '@/hooks/useAppState'
import { useShallow } from 'zustand/shallow'
import { DialogAddModel } from '@/containers/dialogs/AddModel'

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
  const { checkForUpdate: checkForBackendUpdate, installBackend } =
    useBackendUpdater()
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, setProviders, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)

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
    if (!provider || !provider.base_url) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setRefreshingModels(true)
    try {
      const modelIds = await serviceHub
        .providers()
        .fetchModelsFromProvider(provider)

      // Create new models from the fetched IDs
      const newModels: Model[] = modelIds.map((id) => ({
        id,
        model: id,
        name: id,
        capabilities: ['completion'], // Default capability
        version: '1.0',
      }))

      // Filter out models that already exist
      const existingModelIds = provider.models.map((m) => m.id)
      const modelsToAdd = newModels.filter(
        (model) => !existingModelIds.includes(model.id)
      )

      if (modelsToAdd.length > 0) {
        // Update the provider with new models
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
                  // Use the DynamicController component
                  const actionComponent = (
                    <div className="mt-2">
                      {needsBackendConfig &&
                      setting.key === 'version_backend' ? (
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
                      {provider && provider.provider === 'llamacpp' && (
                        <ImportVisionModelDialog
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
                  provider?.models.map((model, modelIndex) => {
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
                            <DialogEditModel
                              provider={provider}
                              modelId={model.id}
                            />
                            {model.settings && (
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
                                Boolean(provider.api_key?.length))) && (
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
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
