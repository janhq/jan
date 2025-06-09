import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import ProvidersMenu from '@/containers/ProvidersMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { open } from '@tauri-apps/plugin-dialog'
import {
  getActiveModels,
  importModel,
  startModel,
  stopModel,
} from '@/services/models'
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import { t } from 'i18next'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import Joyride, { CallBackProps, STATUS } from 'react-joyride'
import { CustomTooltipJoyRide } from '@/containers/CustomeTooltipJoyRide'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { updateSettings, fetchModelsFromProvider } from '@/services/providers'
import { Button } from '@/components/ui/button'
import { IconFolderPlus, IconLoader, IconRefresh } from '@tabler/icons-react'
import { getProviders } from '@/services/providers'
import { toast } from 'sonner'
import { ActiveModel } from '@/types/models'
import { useEffect, useState } from 'react'
import { predefinedProviders } from '@/mock/data'

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

const steps = [
  {
    target: '.first-step-setup-remote-provider',
    title: 'Choose a Provider',
    disableBeacon: true,
    content:
      'Pick the provider you want to use, make sure you have access to an API key for it.',
  },
  {
    target: '.second-step-setup-remote-provider',
    title: 'Get Your API Key',
    disableBeacon: true,
    content:
      "Log into the provider's dashboard to find or generate your API key.",
  },
  {
    target: '.third-step-setup-remote-provider',
    title: 'Insert Your API Key',
    disableBeacon: true,
    content: 'Paste your API key here to connect and activate the provider.',
  },
]

function ProviderDetail() {
  const { step } = useSearch({ from: Route.id })
  const [activeModels, setActiveModels] = useState<ActiveModel[]>([])
  const [loadingModels, setLoadingModels] = useState<string[]>([])
  const [refreshingModels, setRefreshingModels] = useState(false)
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, setProviders, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const isSetup = step === 'setup_remote_provider'
  const navigate = useNavigate()

  useEffect(() => {
    // Initial data fetch
    getActiveModels().then(setActiveModels)

    // Set up interval for real-time updates
    const intervalId = setInterval(() => {
      getActiveModels().then(setActiveModels)
    }, 5000)

    return () => clearInterval(intervalId)
  }, [setActiveModels])

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data

    if (status === STATUS.FINISHED) {
      navigate({
        to: route.home,
      })
    }
  }

  const handleRefreshModels = async () => {
    if (!provider || !provider.base_url) {
      toast.error('Refresh Models', {
        description:
          'Provider must have base URL and API key configured to fetch models.',
      })
      return
    }

    setRefreshingModels(true)
    try {
      const modelIds = await fetchModelsFromProvider(provider)

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

        toast.success('Refresh Models', {
          description: `Added ${modelsToAdd.length} new model(s) from ${provider.provider}.`,
        })
      } else {
        toast.success('Refresh Models', {
          description:
            'No new models found. All available models are already added.',
        })
      }
    } catch (error) {
      console.error('Failed to refresh models:', error)
      toast.error('Refresh Models', {
        description: `Failed to fetch models from ${provider.provider}. Please check your API key and base URL.`,
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  const handleStartModel = (modelId: string) => {
    // Add model to loading state
    setLoadingModels((prev) => [...prev, modelId])
    if (provider)
      startModel(provider, modelId)
        .then(() => {
          setActiveModels((prevModels) => [
            ...prevModels,
            { id: modelId } as ActiveModel,
          ])
        })
        .catch((error) => {
          console.error('Error starting model:', error)
        })
        .finally(() => {
          // Remove model from loading state
          setLoadingModels((prev) => prev.filter((id) => id !== modelId))
        })
  }

  const handleStopModel = (modelId: string) => {
    stopModel(modelId)
      .then(() => {
        setActiveModels((prevModels) =>
          prevModels.filter((model) => model.id !== modelId)
        )
      })
      .catch((error) => {
        console.error('Error stopping model:', error)
      })
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
        disableOverlayClose={true}
        callback={handleJoyrideCallback}
        locale={{
          back: 'Back',
          close: 'Close',
          last: 'Finish',
          next: 'Next',
          skip: 'Skip',
        }}
      />
      <div className="flex flex-col h-full">
        <HeaderPage>
          <h1 className="font-medium">{t('common.settings')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full">
          <div className="flex">
            <ProvidersMenu stepSetupRemoteProvider={isSetup} />
          </div>
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              <div className="flex items-center justify-between">
                <h1 className="font-medium text-base">
                  {getProviderTitle(providerName)}
                </h1>
                <Switch
                  checked={provider?.active}
                  onCheckedChange={(e) => {
                    if (provider) {
                      updateProvider(providerName, { ...provider, active: e })
                    }
                  }}
                />
              </div>

              <div
                className={cn(
                  'flex flex-col gap-3',
                  provider &&
                    provider.provider === 'llama.cpp' &&
                    'flex-col-reverse'
                )}
              >
                {/* Settings */}
                <Card>
                  {provider?.settings.map((setting, settingIndex) => {
                    // Use the DynamicController component
                    const actionComponent = (
                      <div className="mt-2">
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          className={cn(
                            setting.key === 'api-key' &&
                              'third-step-setup-remote-provider'
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
                              updateSettings(
                                providerName,
                                updateObj.settings ?? []
                              )
                              updateProvider(providerName, {
                                ...provider,
                                ...updateObj,
                              })
                            }
                          }}
                        />
                      </div>
                    )

                    return (
                      <CardItem
                        key={settingIndex}
                        title={setting.title}
                        column={
                          setting.controller_type === 'input' &&
                          setting.controller_props.type !== 'number'
                            ? true
                            : false
                        }
                        description={
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
                        Models
                      </h1>
                      <div className="flex items-center gap-2">
                        {provider && provider.provider !== 'llama.cpp' && (
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
                                      ? 'Refreshing...'
                                      : 'Refresh'}
                                  </span>
                                </div>
                              </Button>
                            )}
                            <DialogAddModel provider={provider} />
                          </>
                        )}
                        {provider && provider.provider === 'llama.cpp' && (
                          <Button
                            variant="link"
                            size="sm"
                            className="hover:no-underline"
                            onClick={async () => {
                              const selectedFile = await open({
                                multiple: false,
                                directory: false,
                                filters: [
                                  {
                                    name: 'GGUF',
                                    extensions: ['gguf'],
                                  },
                                ],
                              })

                              if (selectedFile) {
                                try {
                                  await importModel(selectedFile)
                                } catch (error) {
                                  console.error(
                                    'Failed to import model:',
                                    error
                                  )
                                } finally {
                                  // Refresh the provider to update the models list
                                  getProviders().then(setProviders)
                                  toast.success('Import Model', {
                                    id: `import-model-${provider.provider}`,
                                    description: `Model ${provider.provider} has been imported successfully.`,
                                  })
                                }
                              }
                            }}
                          >
                            <div className="cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out p-1.5 py-1 gap-1 -mr-2">
                              <IconFolderPlus
                                size={18}
                                className="text-main-view-fg/50"
                              />
                              <span className="text-main-view-fg/70">
                                Import
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
                              <h1 className="font-medium">{model.id}</h1>
                              <Capabilities capabilities={capabilities} />
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-1">
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
                                provider.provider === 'llama.cpp' && (
                                  <div className="ml-2">
                                    {activeModels.some(
                                      (activeModel) =>
                                        activeModel.id === model.id
                                    ) ? (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() =>
                                          handleStopModel(model.id)
                                        }
                                      >
                                        Stop
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        disabled={loadingModels.includes(
                                          model.id
                                        )}
                                        onClick={() =>
                                          handleStartModel(model.id)
                                        }
                                      >
                                        {loadingModels.includes(model.id) ? (
                                          <div className="flex items-center gap-2">
                                            <IconLoader
                                              size={16}
                                              className="animate-spin"
                                            />
                                          </div>
                                        ) : (
                                          'Start'
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
                      <div className="flex items-center gap-2 text-left-panel-fg/80">
                        <h6 className="font-medium text-base">
                          No model found
                        </h6>
                      </div>
                      <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                        Available models will be listed here. If you don't have
                        any models yet, visit the&nbsp;
                        <Link to={route.hub}>Hub</Link>
                        &nbsp;to download.
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
