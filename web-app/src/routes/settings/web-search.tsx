import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Input } from '@/components/ui/input'
import { EyeOff, Eye, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  useWebSearchConfig,
  WEB_SEARCH_PROVIDERS,
  getProviderMeta,
  providerFavicon,
} from '@/hooks/useWebSearchConfig'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.web_search as any)({
  component: WebSearchContent,
})

const ProviderFavicon = ({ src }: { src: string }) => (
  <img
    src={src}
    alt=""
    className="size-4 shrink-0 rounded-full border border-border/50 bg-white object-contain"
  />
)

function WebSearchContent() {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  const {
    webSearchEnabled,
    searchProvider,
    apiKeys,
    endpoints,
    setWebSearchEnabled,
    setSearchProvider,
    setApiKey,
    setEndpoint,
  } = useWebSearchConfig()

  const provider = getProviderMeta(searchProvider)
  const apiKey = apiKeys[provider.id] ?? ''
  const endpoint = endpoints[provider.id] ?? ''

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
            <Card
              header={
                <div className="flex items-center justify-between">
                  <h1 className="text-foreground font-studio font-medium text-base mb-2">
                    {t('settings:webSearch.title')}
                  </h1>
                  <Switch
                    checked={webSearchEnabled}
                    onCheckedChange={setWebSearchEnabled}
                  />
                </div>
              }
            >
              <CardItem
                title={t('settings:webSearch.enable')}
                description={t('settings:webSearch.enableDesc')}
              />
              <CardItem
                title={t('settings:webSearch.provider')}
                description={t('settings:webSearch.providerDesc')}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-between gap-2"
                      >
                        <ProviderFavicon src={providerFavicon(provider)} />
                        <span className="truncate">{provider.label}</span>
                        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {WEB_SEARCH_PROVIDERS.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          className={cn(
                            'cursor-pointer my-0.5 gap-2',
                            searchProvider === p.id && 'bg-secondary-foreground/8'
                          )}
                          onClick={() => setSearchProvider(p.id)}
                        >
                          <ProviderFavicon src={providerFavicon(p)} />
                          <span className="truncate">{p.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              {provider.requiresEndpoint ? (
                <CardItem
                  title={t('settings:webSearch.endpoint', {
                    provider: provider.label,
                  })}
                  className="block"
                  description={
                    <div className="space-y-2">
                      <p>
                        {t('settings:webSearch.endpointDesc', {
                          provider: provider.label,
                        })}
                      </p>
                      <Input
                        type="text"
                        className="w-full"
                        placeholder={t('settings:webSearch.endpointPlaceholder')}
                        value={endpoint}
                        onChange={(e) =>
                          setEndpoint(provider.id, e.target.value)
                        }
                      />
                    </div>
                  }
                />
              ) : (
                <CardItem
                  title={t('settings:webSearch.apiKey', {
                    provider: provider.label,
                  })}
                  className="block"
                  description={
                    <div className="space-y-2">
                      <p>
                        {t(
                          provider.keyless
                            ? 'settings:webSearch.apiKeyOptional'
                            : 'settings:webSearch.apiKeyRequired',
                          { provider: provider.label }
                        )}
                      </p>
                      <div className="relative">
                        <Input
                          type={showKey ? 'text' : 'password'}
                          className="w-full pr-16"
                          placeholder={t(
                            'settings:webSearch.apiKeyPlaceholder',
                            { provider: provider.label }
                          )}
                          value={apiKey}
                          onChange={(e) =>
                            setApiKey(provider.id, e.target.value)
                          }
                        />
                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                          <button
                            onClick={() => setShowKey(!showKey)}
                            className="p-1 rounded hover:bg-foreground/5 text-foreground/70"
                          >
                            {showKey ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
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
  )
}
