import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState, useEffect } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconMenu2,
  IconX,
} from '@tabler/icons-react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const matches = useMatches()
  const navigate = useNavigate()

  const { providers } = useModelProvider()

  // Filter providers that have active API keys (or are llama.cpp which doesn't need one)
  // On web: exclude llamacpp provider as it's not available
  const activeProviders = providers.filter((provider) => {
    if (!provider.active) return false

    // On web version, hide llamacpp provider
    if (
      !PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] &&
      provider.provider === 'llama.cpp'
    ) {
      return false
    }

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
      isEnabled: PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS],
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
      isEnabled: PlatformFeatures[PlatformFeature.ANALYTICS],
    },
    {
      title: 'common:projects.settings',
      route: route.settings.projects,
      hasSubMenu: false,
      isEnabled:
        PlatformFeatures[PlatformFeature.PROJECTS] && !(IS_IOS || IS_ANDROID),
    },
    {
      title: 'common:modelProviders',
      route: route.settings.model_providers,
      hasSubMenu: activeProviders.length > 0,
      isEnabled: PlatformFeatures[PlatformFeature.MODEL_PROVIDER_SETTINGS],
    },
    {
      title: 'common:assistants',
      route: route.settings.assistant,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.ASSISTANTS],
    },
    {
      title: 'common:keyboardShortcuts',
      route: route.settings.shortcuts,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.SHORTCUT],
    },
    {
      title: 'common:hardware',
      route: route.settings.hardware,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.HARDWARE_MONITORING],
    },
    {
      title: 'common:mcp-servers',
      route: route.settings.mcp_servers,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.MCP_SERVERS_SETTINGS],
    },
    {
      title: 'Prompt Templates',
      route: route.settings.prompt_templates,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:local_api_server',
      route: route.settings.local_api_server,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.LOCAL_API_SERVER],
    },
    {
      title: 'common:https_proxy',
      route: route.settings.https_proxy,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.HTTPS_PROXY],
    },
    {
      title: 'common:extensions',
      route: route.settings.extensions,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.EXTENSIONS_SETTINGS],
    },
  ]

  const toggleProvidersExpansion = () => {
    setExpandedProviders(!expandedProviders)
  }

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen)
  }

  return (
    <>
      <button
        className="fixed top-[calc(10px+env(safe-area-inset-top))] right-4 sm:hidden size-5 cursor-pointer items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10 z-20"
        onClick={toggleMenu}
        aria-label="Toggle settings menu"
      >
        {isMenuOpen ? (
          <IconX size={18} className="text-main-view-fg relative z-20" />
        ) : (
          <IconMenu2 size={18} className="text-main-view-fg relative z-20" />
        )}
      </button>
      <div
        className={cn(
          'h-full w-44 shrink-0 px-1.5 pt-3 border-r border-main-view-fg/5 bg-main-view',
          'sm:flex',
          isMenuOpen
            ? 'flex fixed sm:hidden top-[calc(10px+env(safe-area-inset-top))] z-10 m-1 h-[calc(100%-8px)] border-r-0 border-l bg-main-view right-0 py-8 rounded-tr-lg rounded-br-lg'
            : 'hidden'
        )}
      >
        <div className="flex flex-col gap-1 w-full text-main-view-fg/90 font-medium">
          {menuSettings.map((menu) => {
            if (!menu.isEnabled) {
              return null
            }
            return (
              <div key={menu.title}>
                <Link
                  to={menu.route}
                  className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-main-view-fg/80">
                      {t(menu.title)}
                    </span>
                    {menu.hasSubMenu && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleProvidersExpansion()
                        }}
                        className="text-main-view-fg/60 hover:text-main-view-fg/80"
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
                              'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5 text-main-view-fg/80',
                              isActive && 'bg-main-view-fg/5',
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
