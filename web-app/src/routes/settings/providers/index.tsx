import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import {
  IconCirclePlus,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react'
import { cn, getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { AddProviderDialog } from '@/containers/dialogs'
import { Switch } from '@/components/ui/switch'
import { useCallback, useMemo } from 'react'
import { openAIProviderSettings } from '@/constants/providers'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useProviderRegistryStore } from '@/stores/provider-registry-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.model_providers as any)({
  component: ModelProviders,
})

function ModelProviders() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { providers, addProvider, updateProvider, setProviders } =
    useModelProvider()
  const navigate = useNavigate()

  const registryStatus = useProviderRegistryStore((s) => s.status)
  const registryFetchedAt = useProviderRegistryStore((s) => s.fetchedAt)
  const refreshRegistry = useProviderRegistryStore((s) => s.refresh)
  const isRegistryLoading = registryStatus === 'loading'

  const lastUpdatedLabel = useMemo(() => {
    if (!registryFetchedAt) {
      return t('provider:registry.neverUpdated', {
        defaultValue: 'Not yet loaded',
      })
    }
    try {
      const formatted = new Date(registryFetchedAt).toLocaleString()
      return t('provider:registry.lastUpdated', {
        when: formatted,
        defaultValue: `Last updated: ${formatted}`,
      })
    } catch {
      return ''
    }
  }, [registryFetchedAt, t])

  const handleRefreshRegistry = useCallback(async () => {
    const errorMessage = t('provider:registry.errorDescription', {
      defaultValue:
        'Could not refresh provider catalog. Using cached or built-in providers.',
    })
    console.info('[providers] manual refresh requested')
    try {
      await refreshRegistry({ force: true })
    } catch (err) {
      // Defensive — `refresh` is implemented to never throw, but if a future
      // change regresses that we still want to surface a clean error toast.
      console.warn('[providers] refresh threw unexpectedly:', err)
      toast.error(errorMessage)
      return
    }

    const state = useProviderRegistryStore.getState()
    if (state.error) {
      console.warn('[providers] refresh resolved with error:', state.error)
      toast.error(errorMessage)
      return
    }

    toast.success(
      t('provider:registry.successDescription', {
        defaultValue: 'Provider catalog updated.',
      })
    )

    // Re-pull providers through the service in the background so the visible
    // list (driven by `useModelProvider`) picks up newly added entries and
    // models. `setProviders` preserves API keys, base URLs, and user-tweaked
    // settings per provider. Doing this off the await chain ensures the
    // toast appears immediately and the button never stays disabled if
    // `getProviders()` is slow (e.g. while runtime engines enumerate models).
    void (async () => {
      try {
        const fresh = await serviceHub.providers().getProviders()
        setProviders(fresh)
      } catch (err) {
        console.warn('[providers] failed to apply refreshed registry:', err)
      }
    })()
  }, [refreshRegistry, serviceHub, setProviders, t])

  const sortedProviders = useMemo(() => {
    const providerPriority: Record<string, number> = {
      'jan': 0,
      'llamacpp': 1,
      'mlx': 2,
      'foundation-models': 3,
    }

    return providers
      .filter((provider) => IS_MACOS || provider.provider !== 'mlx')
      .slice()
      .sort((a, b) => {
        const aPriority =
          providerPriority[a.provider] ?? Number.MAX_SAFE_INTEGER
        const bPriority =
          providerPriority[b.provider] ?? Number.MAX_SAFE_INTEGER

        if (aPriority !== bPriority) {
          return aPriority - bPriority
        }

        return getProviderTitle(a.provider).localeCompare(
          getProviderTitle(b.provider)
        )
      })
  }, [providers])

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
        <div
          className={cn(
            'flex items-center justify-between w-full mr-2 pr-3',
            !IS_MACOS && 'pr-30'
          )}
        >
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 relative z-20"
              onClick={handleRefreshRegistry}
              disabled={isRegistryLoading}
              title={lastUpdatedLabel}
            >
              <IconRefresh
                size={16}
                className={cn(isRegistryLoading && 'animate-spin')}
              />
              <span>
                {isRegistryLoading
                  ? t('provider:registry.refreshing', {
                      defaultValue: 'Refreshing...',
                    })
                  : t('provider:registry.refresh', {
                      defaultValue: 'Refresh catalog',
                    })}
              </span>
            </Button>
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
              {sortedProviders.map((provider, index) => (
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
