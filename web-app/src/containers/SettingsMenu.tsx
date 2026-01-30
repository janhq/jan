import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState, useEffect } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(true)
  const matches = useMatches()
  const navigate = useNavigate()

  const { providers } = useModelProvider()

  // Filter providers that have active API keys (or are llama.cpp which doesn't need one)
  // On web: exclude llamacpp provider as it's not available
  const activeProviders = providers.filter((provider) => {
    if (!provider.active) return false

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
      title: 'common:modelProviders',
      route: route.settings.model_providers,
      hasSubMenu: activeProviders.length > 0,
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
    // Hide Extension settings for now
    // {
    //   title: 'common:extensions',
    //   route: route.settings.extensions,
    //   hasSubMenu: false,
    //   isEnabled: true,
    // },
  ]

  const toggleProvidersExpansion = () => {
    setExpandedProviders(!expandedProviders)
  }

  return (
    <>
      <div
        className='h-full w-54 shrink-0 px-1.5 flex'
      >
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
                    <span>
                      {t(menu.title)}
                    </span>
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
        </div>
      </div>
    </>
  )
}

export default SettingsMenu
