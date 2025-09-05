import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle } from '@/lib/utils'
import {
  createFileRoute,
  Link,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import Joyride, { CallBackProps, STATUS } from 'react-joyride'
import { CustomTooltipJoyRide } from '@/containers/CustomeTooltipJoyRide'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { localStorageKey } from '@/constants/localStorage'
import { Button } from '@/components/ui/button'
import { IconFolderPlus, IconLoader, IconRefresh } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useCallback, useEffect, useState } from 'react'
import { predefinedProviders } from '@/consts/providers'
import { useModelLoad } from '@/hooks/useModelLoad'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

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
  const steps = [
    {
      target: '.first-step-setup-remote-provider',
      title: t('providers:joyride.chooseProviderTitle'),
      disableBeacon: true,
      content: t('providers:joyride.chooseProviderContent'),
    },
    {
      target: '.second-step-setup-remote-provider',
      title: t('providers:joyride.getApiKeyTitle'),
      disableBeacon: true,
      content: t('providers:joyride.getApiKeyContent'),
    },
    {
      target: '.third-step-setup-remote-provider',
      title: t('providers:joyride.insertApiKeyTitle'),
      disableBeacon: true,
      content: t('providers:joyride.insertApiKeyContent'),
    },
  ]
  const { step } = useSearch({ from: Route.id })
  const [activeModels, setActiveModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState<string[]>([])
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [importingModel, setImportingModel] = useState(false)
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, setProviders, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const isSetup = step === 'setup_remote_provider'

  // Check if llamacpp provider needs backend configuration
  const needsBackendConfig =
    provider?.provider === 'llamacpp' &&
    provider.settings?.some(
      (setting) =>
        setting.key === 'version_backend' &&
        (setting.controller_props.value === 'none' ||
          setting.controller_props.value === '' ||
          !setting.controller_props.value)
    )

  const handleImportModel = async () => {
    if (!provider) {
      return
    }

    setImportingModel(true)
    const selectedFile = await serviceHub.dialog().open({
      multiple: false,
      directory: false,
    })
    // If the dialog returns a file path, extract just the file name
    const fileName =
      typeof selectedFile === 'string'
        ? selectedFile.split(/[\\/]/).pop()?.replace(/\s/g, '-')
        : undefined

    if (selectedFile && fileName) {
      // Check if model already exists
      const modelExists = provider.models.some(
        (model) => model.name === fileName
      )

      if (modelExists) {
        toast.error('Model already exists', {
          description: `${fileName} already imported`,
        })
        setImportingModel(false)
        return
      }

      try {
        await serviceHub.models().pullModel(fileName, typeof selectedFile === 'string' ? selectedFile : selectedFile?.[0])
        // Refresh the provider to update the models list
        await serviceHub.providers().getProviders().then(setProviders)
        toast.success(t('providers:import'), {
          id: `import-model-${provider.provider}`,
          description: t('providers:importModelSuccess', {
            provider: fileName,
          }),
        })
      } catch (error) {
        console.error(t('providers:importModelError'), error)
        toast.error(t('providers:importModelError'), {
          description:
            error instanceof Error ? error.message : 'Unknown error occurred',
        })
      } finally {
        setImportingModel(false)
      }
    } else {
      setImportingModel(false)
    }
  }

  useEffect(() => {
    // Initial data fetch
    serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))

    // Set up interval for real-time updates
    const intervalId = setInterval(() => {
      serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))
    }, 5000)

    return () => clearInterval(intervalId)
  }, [serviceHub, setActiveModels])

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

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data

    if (status === STATUS.FINISHED) {
      localStorage.setItem(localStorageKey.setupCompleted, 'true')
    }
  }

  const handleRefreshModels = async () => {
    if (!provider || !provider.base_url) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setRefreshingModels(true)
    try {
      const modelIds = await serviceHub.providers().fetchModelsFromProvider(provider)

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

  const handleStartModel = (modelId: string) => {
    // Add model to loading state
    setLoadingModels((prev) => [...prev, modelId])
    if (provider)
      // Original: startModel(provider, modelId).then(() => { setActiveModels((prevModels) => [...prevModels, modelId]) })
      serviceHub.models().startModel(provider, modelId)
        .then(() => {
          // Refresh active models after starting
          serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))
        })
        .catch((error) => {
          console.error('Error starting model:', error)
          if (error && typeof error === 'object' && 'message' in error) {
            setModelLoadError(error)
          } else {
            setModelLoadError(`${error}`)
          }
        })
        .finally(() => {
          // Remove model from loading state
          setLoadingModels((prev) => prev.filter((id) => id !== modelId))
        })
  }

  const handleStopModel = (modelId: string) => {
    // Original: stopModel(modelId).then(() => { setActiveModels((prevModels) => prevModels.filter((model) => model !== modelId)) })
    serviceHub.models().stopModel(modelId)
      .then(() => {
        // Refresh active models after stopping
        serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))
      })
      .catch((error) => {
        console.error('Error stopping model:', error)
      })
  }

  // Check if model provider settings are enabled for this platform
  if (!PlatformFeatures[PlatformFeature.MODEL_PROVIDER_SETTINGS]) {
    return (
      <div className="flex flex-col h-full">
        <HeaderPage>
          <h1 className="font-medium">{t('common:settings')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-lg font-medium text-main-view-fg/80 mb-2">
                {t('common:notAvailable')}
              </h2>
              <p className="text-main-view-fg/60">
                Provider settings are not available on the web platform.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <Joyride
        run={isSetup}
        floaterProps={{
          hideArrow: true,
        }}
        steps={steps}
        tooltipComponent={CustomTooltipJoyRide}
        spotlightPadding={0}
        continuous={true}
        showSkipButton={true}
        hideCloseButton={true}
        spotlightClicks={true}
        disableOverlay={IS_LINUX}
        disableOverlayClose={true}
        callback={handleJoyrideCallback}
        locale={{
          back: t('providers:joyride.back'),
          close: t('providers:joyride.close'),
          last: t('providers:joyride.last'),
          next: t('providers:joyride.next'),
          skip: t('providers:joyride.skip'),
        }}
      />
      <div className="flex flex-col h-full">
        <HeaderPage>
          <h1 className="font-medium">{t('common:settings')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
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
                    provider.provider === 'llamacpp' &&
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
                          <div className="flex items-center gap-1 text-sm text-main-view-fg/70">
                            <IconLoader size={16} className="animate-spin" />
                            <span>loading</span>
                          </div>
                        ) : (
                          <DynamicControllerSetting
                            controllerType={setting.controller_type}
                            controllerProps={setting.controller_props}
                            className={cn(
                              setting.key === 'api-key' &&
                                'third-step-setup-remote-provider',
                              setting.key === 'device' && 'hidden'
                            )}
                            onChange={(newValue) => {
                              if (provider) {
                                const newSettings = [...provider.settings]
                                // Handle different value types by forcing the type
                                // Use type assertion to bypass type checking

                                ;(
                                  newSettings[settingIndex]
                                    .controller_props as {
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
                                    ;(
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

                                serviceHub.providers().updateSettings(
                                  providerName,
                                  updateObj.settings ?? []
                                )
                                updateProvider(providerName, {
                                  ...provider,
                                  ...updateObj,
                                })

                                serviceHub.models().stopAllModels()
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
                              className="![>p]:text-main-view-fg/70 select-none"
                              content={setting.description}
                              components={{
                                // Make links open in a new tab
                                a: ({ ...props }) => {
                                  return (
                                    <a
                                      {...props}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn(
                                        setting.key === 'api-key' &&
                                          'second-step-setup-remote-provider'
                                      )}
                                    />
                                  )
                                },
                                p: ({ ...props }) => (
                                  <p {...props} className="!mb-0" />
                                ),
                              }}
                            />
                            {setting.key === 'version_backend' &&
                              setting.controller_props?.recommended && (
                                <div className="mt-1 text-sm text-main-view-fg/60">
                                  <span className="font-medium">
                                    {setting.controller_props.recommended
                                      ?.split('/')
                                      .pop() ||
                                      setting.controller_props.recommended}
                                  </span>
                                  <span> is the recommended backend.</span>
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
                      <h1 className="text-main-view-fg font-medium text-base">
                        {t('providers:models')}
                      </h1>
                      <div className="flex items-center gap-2">
                        {provider && provider.provider !== 'llamacpp' && (
                          <>
                            {!predefinedProviders.some(
                              (p) => p.provider === provider.provider
                            ) && (
                              <Button
                                variant="link"
                                size="sm"
                                className="hover:no-underline"
                                onClick={handleRefreshModels}
                                disabled={refreshingModels}
                              >
                                <div className="cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-1.5 py-1 gap-1">
                                  {refreshingModels ? (
                                    <IconLoader
                                      size={18}
                                      className="text-main-view-fg/50 animate-spin"
                                    />
                                  ) : (
                                    <IconRefresh
                                      size={18}
                                      className="text-main-view-fg/50"
                                    />
                                  )}
                                  <span className="text-main-view-fg/70">
                                    {refreshingModels
                                      ? t('providers:refreshing')
                                      : t('providers:refresh')}
                                  </span>
                                </div>
                              </Button>
                            )}
                            <DialogAddModel provider={provider} />
                          </>
                        )}
                        {provider && provider.provider === 'llamacpp' && (
                          <Button
                            variant="link"
                            size="sm"
                            className="hover:no-underline"
                            disabled={importingModel}
                            onClick={handleImportModel}
                          >
                            <div className="cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out p-1.5 py-1 gap-1 -mr-2">
                              {importingModel ? (
                                <IconLoader
                                  size={18}
                                  className="text-main-view-fg/50 animate-spin"
                                />
                              ) : (
                                <IconFolderPlus
                                  size={18}
                                  className="text-main-view-fg/50"
                                />
                              )}
                              <span className="text-main-view-fg/70">
                                {importingModel
                                  ? 'Importing...'
                                  : t('providers:import')}
                              </span>
                            </div>
                          </Button>
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
                                {model.id}
                              </h1>
                              <Capabilities capabilities={capabilities} />
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-0.5">
                              {provider && provider.provider !== 'llamacpp' && (
                                <DialogEditModel
                                  provider={provider}
                                  modelId={model.id}
                                />
                              )}
                              {model.settings && (
                                <ModelSetting
                                  provider={provider}
                                  model={model}
                                />
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
                              {provider && provider.provider === 'llamacpp' && (
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
                      <div className="flex items-center gap-2 text-main-view-fg/80">
                        <h6 className="font-medium text-base">
                          {t('providers:noModelFound')}
                        </h6>
                      </div>
                      <p className="text-main-view-fg/70 mt-1 text-xs leading-relaxed">
                        {t('providers:noModelFoundDesc')}
                        &nbsp;
                        <Link to={route.hub.index}>{t('common:hub')}</Link>
                      </p>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
