import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import HeaderPage from '@/containers/HeaderPage'
import ProvidersMenu from '@/containers/ProvidersMenu'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { t } from 'i18next'
import Capabilities from '@/containers/Capabilities'

// as route.threadsDetail
export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
})

function ProviderDetail() {
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName } = useModelProvider()
  const provider = getProviderByName(providerName)

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <div className="flex">
          <SettingsMenu />
          <ProvidersMenu />
        </div>
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <div className="flex items-center justify-between">
              <h1 className="font-medium text-base">
                {getProviderTitle(providerName)}
              </h1>
              <Switch checked={provider?.active} />
            </div>
            {/* Models */}
            <CardSetting title="Models">
              {provider?.models.map((model, modelIndex) => {
                const modelKey = Object.keys(model)[0]
                const modelData = model[modelKey]
                const capabilities = modelData.copabilities || []

                return (
                  <CardSettingItem
                    key={modelIndex}
                    title={modelKey}
                    actions={<Capabilities capabilities={capabilities} />}
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
