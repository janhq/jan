import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import ProvidersMenu from '@/containers/ProvidersMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
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
import { DialoDeleteModel } from '@/containers/dialogs/DeleteModel'
import Joyride, { CallBackProps, STATUS } from 'react-joyride'
import { CustomTooltipJoyRide } from '@/containers/CustomeTooltipJoyRide'
import { route } from '@/constants/routes'

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
      'Log into the provider’s dashboard to find or generate your API key.',
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
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const isSetup = step === 'setup_remote_provider'
  const navigate = useNavigate()

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data

    if (status === STATUS.FINISHED) {
      navigate({
        to: route.home,
      })
    }
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
        showSkipButton={false}
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
              </Card>

              {/* Models */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-main-view-fg font-medium text-base">
                      Models
                    </h1>
                    <div className="flex items-center gap-2">
                      {provider && <DialogAddModel provider={provider} />}
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
                          <div className="flex items-center gap-2">
                            <DialogEditModel
                              provider={provider}
                              modelId={model.id}
                            />
                            {model.settings && (
                              <ModelSetting provider={provider} model={model} />
                            )}
                            <DialoDeleteModel
                              provider={provider}
                              modelId={model.id}
                            />
                          </div>
                        }
                      />
                    )
                  })
                ) : (
                  <div className="-mt-2">
                    <div className="flex items-center gap-2 text-left-panel-fg/80">
                      <h6 className="font-medium text-base">No model found</h6>
                    </div>
                    <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                      Available models will be listed here. If you don’t have
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
    </>
  )
}
