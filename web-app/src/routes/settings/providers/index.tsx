import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { IconCirclePlus, IconSettings } from '@tabler/icons-react'
import { cn, getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { AddProviderDialog } from '@/containers/dialogs'
import { Switch } from '@/components/ui/switch'
import { useCallback } from 'react'
import { openAIProviderSettings } from '@/constants/providers'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.model_providers as any)({
  component: ModelProviders,
})

function ModelProviders() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { providers, addProvider, updateProvider } = useModelProvider()
  const navigate = useNavigate()

  const createProvider = useCallback(
    (name: string) => {
      if (
        providers.some((e) => e.provider.toLowerCase() === name.toLowerCase())
      ) {
        toast.error(t('providerAlreadyExists', { name }))
        return
      }
      const newProvider: ProviderObject = {
        provider: name,
        active: true,
        models: [],
        settings: cloneDeep(openAIProviderSettings) as ProviderSetting[],
        api_key: '',
        base_url: 'https://api.openai.com/v1',
      }
      addProvider(newProvider)
      setTimeout(() => {
        navigate({
          to: route.settings.providers,
          params: {
            providerName: name,
          },
        })
      }, 0)
    },
    [providers, addProvider, t, navigate]
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
          <AddProviderDialog onCreateProvider={createProvider}>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 relative z-20"
            >
              <IconCirclePlus size={16} />
              <span>{t('provider:addProvider')}</span>
            </Button>
          </AddProviderDialog>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Model Providers */}
            <Card
              header={
                <div className="flex items-center justify-between w-full mb-6">
                  <span className="font-medium text-base font-studio text-foreground">
                    {t('common:modelProviders')}
                  </span>
                </div>
              }
            >
              {providers.map((provider, index) => (
                <CardItem
                  key={index}
                  title={
                    <div className="flex items-center gap-3">
                      <ProvidersAvatar provider={provider} />
                      <div>
                        <h3 className="font-medium">
                          {getProviderTitle(provider.provider)}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {provider.models.length} Models
                        </p>
                      </div>
                    </div>
                  }
                  actions={
                    <div className="flex items-center gap-2">
                      {provider.active && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            navigate({
                              to: route.settings.providers,
                              params: {
                                providerName: provider.provider,
                              },
                            })
                          }}
                        >
                          <IconSettings
                            className="text-muted-foreground"
                            size={16}
                          />
                        </Button>
                      )}
                      <Switch
                        checked={provider.active}
                        onCheckedChange={async (e) => {
                          if (
                            !e &&
                            provider.provider.toLowerCase() === 'llamacpp'
                          ) {
                            await serviceHub.models().stopAllModels()
                          }
                          updateProvider(provider.provider, {
                            ...provider,
                            active: e,
                          })
                        }}
                      />
                    </div>
                  }
                />
              ))}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
