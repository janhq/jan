import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import HeaderPage from '@/containers/HeaderPage'
import ProvidersMenu from '@/containers/ProvidersMenu'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { t } from 'i18next'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/DynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { IconPlus } from '@tabler/icons-react'
import { DialogEditModelCapabilities } from '@/containers/dialogs/EditModel'

// as route.threadsDetail
export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
})

function ProviderDetail() {
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <div className="flex">
          <ProvidersMenu />
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
            <CardSetting>
              {provider?.settings.map((setting, settingIndex) => {
                // Use the DynamicController component
                const actionComponent = (
                  <DynamicControllerSetting
                    controllerType={setting.controller_type}
                    controllerProps={setting.controller_props}
                    onChange={(newValue) => {
                      if (provider) {
                        const newSettings = [...provider.settings]
                        newSettings[settingIndex].controller_props.value =
                          newValue
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
                )

                return (
                  <CardSettingItem
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
                        className="![>p]:text-main-view-fg/70"
                        content={setting.description}
                        components={{
                          // Make links open in a new tab
                          a: ({ ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                        }}
                      />
                    }
                    actions={actionComponent}
                  />
                )
              })}
            </CardSetting>

            {/* Models */}
            <CardSetting
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-main-view-fg font-medium text-base">
                    Models
                  </h1>
                  <div className="flex items-center gap-2">
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconPlus size={18} className="text-main-view-fg/50" />
                    </div>
                  </div>
                </div>
              }
            >
              {provider?.models.map((model, modelIndex) => {
                const capabilities = model.capabilities || []
                return (
                  <CardSettingItem
                    key={modelIndex}
                    title={
                      <div className="flex items-center gap-2">
                        <h1 className="font-medium">{model.id}</h1>
                        <Capabilities capabilities={capabilities} />
                      </div>
                    }
                    actions={
                      <div className="flex items-center gap-2">
                        <DialogEditModelCapabilities
                          provider={provider}
                          modelId={model.id}
                        />
                      </div>
                    }
                  />
                )
              })}
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
