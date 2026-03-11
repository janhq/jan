import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState, useEffect, useCallback } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
} from '@tabler/icons-react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { AddProviderDialog } from '@/containers/dialogs'
import { openAIProviderSettings } from '@/constants/providers'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(true)

  const matches = useMatches()
  const navigate = useNavigate()

  const { providers, addProvider } = useModelProvider()

  const createProvider = useCallback(
    (name: string) => {
      if (
        providers.some((e) => e.provider.toLowerCase() === name.toLowerCase())
      ) {
        toast.error(t('provider:providerAlreadyExists', { name }))
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
          params: { providerName: name },
        })
      }, 0)
    },
    [providers, addProvider, t, navigate]
  )

  const activeProviders = providers.filter((provider) => {
    if (!provider.active) return false
    if (!IS_MACOS && provider.provider === 'mlx') return false
    return true
  })

  const hiddenProviders = providers.filter((provider) => {
    if (provider.active) return false
    if (!IS_MACOS && provider.provider === 'mlx') return false
    return true
  })

  // Check if current route has a providerName parameter and expand providers submenu
  useEffect(() => {
    const hasProviderName = matches.some(
      (match) =>
        match.routeId === '/settings/providers/$providerName' &&
        'providerName' in match.params
    )
    const isProvidersRoute = matches.some(
      (match) => match.routeId === '/settings/providers/'
    )
    if (hasProviderName || isProvidersRoute) {
      setExpandedProviders(true)
    }
  }, [matches])

  // Check if we're in the setup remote provider step
  const stepSetupRemoteProvider = matches.some(
    (match) =>
      match.search &&
      typeof match.search === 'object' &&
      'step' in match.search &&
      match.search.step === 'setup_remote_provider'
  )

  const menuSettings = [
    {
      title: 'common:general',
      route: route.settings.general,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:attachments',
      route: route.settings.attachments,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:interface',
      route: route.settings.interface,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:privacy',
      route: route.settings.privacy,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:assistants',
      route: route.settings.assistant,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:keyboardShortcuts',
      route: route.settings.shortcuts,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:hardware',
      route: route.settings.hardware,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:mcp-servers',
      route: route.settings.mcp_servers,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:local_api_server',
      route: route.settings.local_api_server,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:https_proxy',
      route: route.settings.https_proxy,
      hasSubMenu: false,
      isEnabled: true,
    },
  ]

  const toggleProvidersExpansion = () => {
    setExpandedProviders(!expandedProviders)
  }

  return (
    <>
      <div className="h-full w-58 shrink-0 px-1.5 flex overflow-auto">
        <div className="flex flex-col gap-1 w-full font-medium">
          {menuSettings.map((menu) => {
            if (!menu.isEnabled) {
              return null
            }
            return (
              <div key={menu.title}>
                <Link
                  to={menu.route}
                  className="block px-2 gap-1.5 cursor-pointer hover:dark:bg-secondary/60 hover:bg-secondary py-1 w-full rounded-sm [&.active]:dark:bg-secondary/80 [&.active]:bg-secondary"
                >
                  <div className="flex items-center justify-between">
                    <span>{t(menu.title)}</span>
                    {menu.hasSubMenu && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleProvidersExpansion()
                        }}
                        className="text-muted-foreground/60 hover:text-muted-foreground/80"
                      >
                        {expandedProviders ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronRight size={16} />
                        )}
                      </button>
                    )}
                  </div>
                </Link>

                {/* Sub-menu for model providers */}
                {menu.hasSubMenu && expandedProviders && (
                  <div className="ml-2 mt-1 space-y-1">
                    {activeProviders.map((provider) => {
                      const isActive = matches.some(
                        (match) =>
                          match.routeId ===
                            '/settings/providers/$providerName' &&
                          'providerName' in match.params &&
                          match.params.providerName === provider.provider
                      )

                      return (
                        <div key={provider.provider}>
                          <div
                            className={cn(
                              'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-secondary/60 py-1 w-full rounded-sm [&.active]:bg-secondary/80 text-foreground',
                              isActive && 'bg-secondary',
                              // hidden for llama.cpp provider for setup remote provider
                              provider.provider === 'llama.cpp' &&
                                stepSetupRemoteProvider &&
                                'hidden'
                            )}
                            onClick={() =>
                              navigate({
                                to: route.settings.providers,
                                params: {
                                  providerName: provider.provider,
                                },
                                ...(stepSetupRemoteProvider
                                  ? {
                                      search: { step: 'setup_remote_provider' },
                                    }
                                  : {}),
                              })
                            }
                          >
                            <ProvidersAvatar provider={provider} />
                            <div className="truncate">
                              <span>{getProviderTitle(provider.provider)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Integrations section */}
          <div className="mt-4">
            <span className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('common:integrations')}
              <span className="text-[11px] capitalize ml-2 font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400">
                {t('common:experimental')}
              </span>
            </span>
            <div className="mt-1 flex flex-col gap-1">
              <Link
                to={route.settings.claude_code}
                className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:dark:bg-secondary/60 hover:bg-secondary rounded-sm [&.active]:dark:bg-secondary/80 [&.active]:bg-secondary"
              >
                <span>{t('common:claude_code')}</span>
              </Link>
              <Link
                to={route.settings.remote_access}
                className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:dark:bg-secondary/60 hover:bg-secondary rounded-sm [&.active]:dark:bg-secondary/80 [&.active]:bg-secondary"
              >
                <span>{t('common:openclaw')}</span>
              </Link>
            </div>
          </div>

          {/* Model Providers section */}
          <div className="mt-4">
            <div className="flex items-center justify-between pl-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('common:modelProviders')}
              </span>
              <AddProviderDialog onCreateProvider={createProvider}>
                <Button variant="ghost" size="icon-xs">
                  <IconPlus size={12} />
                </Button>
              </AddProviderDialog>
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {activeProviders.map((provider) => {
                const isRouteActive = matches.some(
                  (match) =>
                    match.routeId === '/settings/providers/$providerName' &&
                    'providerName' in match.params &&
                    match.params.providerName === provider.provider
                )
                return (
                  <div
                    key={provider.provider}
                    className={cn(
                      'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-secondary/60 py-1 w-full rounded-sm text-foreground',
                      isRouteActive && 'bg-secondary',
                      provider.provider === 'llama.cpp' &&
                        stepSetupRemoteProvider &&
                        'hidden'
                    )}
                    onClick={() =>
                      navigate({
                        to: route.settings.providers,
                        params: { providerName: provider.provider },
                        ...(stepSetupRemoteProvider
                          ? { search: { step: 'setup_remote_provider' } }
                          : {}),
                      })
                    }
                  >
                    <ProvidersAvatar provider={provider} />
                    <div className="truncate flex-1">
                      <span>{getProviderTitle(provider.provider)}</span>
                    </div>
                  </div>
                )
              })}

              {hiddenProviders.length > 0 && (
                <>
                  <button
                    className="flex items-center justify-between px-2 py-1 w-full rounded-sm text-muted-foreground hover:bg-secondary/60"
                    onClick={() => setExpandedProviders(!expandedProviders)}
                  >
                    <span className="text-sm">
                      {t('common:hiddenProviders', {
                        count: hiddenProviders.length,
                      })}
                    </span>
                    {expandedProviders ? (
                      <IconChevronDown size={14} />
                    ) : (
                      <IconChevronRight size={14} />
                    )}
                  </button>
                  {expandedProviders &&
                    hiddenProviders.map((provider) => {
                      const isRouteActive = matches.some(
                        (match) =>
                          match.routeId ===
                            '/settings/providers/$providerName' &&
                          'providerName' in match.params &&
                          match.params.providerName === provider.provider
                      )
                      return (
                        <div
                          key={provider.provider}
                          className={cn(
                            'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-secondary/60 py-1 w-full rounded-sm text-muted-foreground',
                            isRouteActive && 'bg-secondary'
                          )}
                          onClick={() =>
                            navigate({
                              to: route.settings.providers,
                              params: { providerName: provider.provider },
                            })
                          }
                        >
                          <ProvidersAvatar provider={provider} />
                          <div className="truncate flex-1">
                            <span>{getProviderTitle(provider.provider)}</span>
                          </div>
                        </div>
                      )
                    })}
                </>
              )}
            </div>
            <div className="m-3" />
          </div>
        </div>
      </div>
    </>
  )
}

export default SettingsMenu
