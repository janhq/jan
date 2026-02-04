import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState, useEffect } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
<<<<<<< HEAD
  IconMenu2,
  IconX,
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
} from '@tabler/icons-react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
<<<<<<< HEAD
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
=======

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const matches = useMatches()
  const navigate = useNavigate()

  const { providers } = useModelProvider()

  // Filter providers that have active API keys (or are llama.cpp which doesn't need one)
  // On web: exclude llamacpp provider as it's not available
  const activeProviders = providers.filter((provider) => {
    if (!provider.active) return false

<<<<<<< HEAD
    // On web version, hide llamacpp provider
    if (
      !PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] &&
      provider.provider === 'llama.cpp'
    ) {
      return false
    }

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.ANALYTICS],
    },
    {
      title: 'common:projects.settings',
      route: route.settings.projects,
      hasSubMenu: false,
      isEnabled:
        PlatformFeatures[PlatformFeature.PROJECTS] && !(IS_IOS || IS_ANDROID),
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:modelProviders',
      route: route.settings.model_providers,
      hasSubMenu: activeProviders.length > 0,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.MODEL_PROVIDER_SETTINGS],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:assistants',
      route: route.settings.assistant,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.ASSISTANTS],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:keyboardShortcuts',
      route: route.settings.shortcuts,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.SHORTCUT],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:hardware',
      route: route.settings.hardware,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.HARDWARE_MONITORING],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:mcp-servers',
      route: route.settings.mcp_servers,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.MCP_SERVERS_SETTINGS],
    },
    {
      title: 'Prompt Templates',
      route: route.settings.prompt_templates,
      hasSubMenu: false,
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      isEnabled: true,
    },
    {
      title: 'common:local_api_server',
      route: route.settings.local_api_server,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.LOCAL_API_SERVER],
=======
      isEnabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    },
    {
      title: 'common:https_proxy',
      route: route.settings.https_proxy,
      hasSubMenu: false,
<<<<<<< HEAD
      isEnabled: PlatformFeatures[PlatformFeature.HTTPS_PROXY],
    },
    {
      title: 'common:extensions',
      route: route.settings.extensions,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.EXTENSIONS_SETTINGS],
    },
=======
      isEnabled: true,
    },
    // Hide Extension settings for now
    // {
    //   title: 'common:extensions',
    //   route: route.settings.extensions,
    //   hasSubMenu: false,
    //   isEnabled: true,
    // },
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  ]

  const toggleProvidersExpansion = () => {
    setExpandedProviders(!expandedProviders)
  }

<<<<<<< HEAD
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
=======
  return (
    <>
      <div
        className='h-full w-54 shrink-0 px-1.5 flex'
      >
        <div className="flex flex-col gap-1 w-full font-medium">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          {menuSettings.map((menu) => {
            if (!menu.isEnabled) {
              return null
            }
            return (
              <div key={menu.title}>
                <Link
                  to={menu.route}
<<<<<<< HEAD
                  className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-main-view-fg/80">
=======
                  className="block px-2 gap-1.5 cursor-pointer hover:dark:bg-secondary/60 hover:bg-secondary py-1 w-full rounded-sm [&.active]:dark:bg-secondary/80 [&.active]:bg-secondary"
                >
                  <div className="flex items-center justify-between">
                    <span>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      {t(menu.title)}
                    </span>
                    {menu.hasSubMenu && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleProvidersExpansion()
                        }}
<<<<<<< HEAD
                        className="text-main-view-fg/60 hover:text-main-view-fg/80"
=======
                        className="text-muted-foreground/60 hover:text-muted-foreground/80"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
                              'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5 text-main-view-fg/80',
                              isActive && 'bg-main-view-fg/5',
=======
                              'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-secondary/60 py-1 w-full rounded-sm [&.active]:bg-secondary/80 text-foreground',
                              isActive && 'bg-secondary',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
