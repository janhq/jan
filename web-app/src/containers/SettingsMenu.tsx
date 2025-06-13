import { Link, useMatches } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from 'react-i18next'
import { useModelProvider } from '@/hooks/useModelProvider'

const menuSettings = [
  {
    title: 'common.general',
    route: route.settings.general,
  },
  {
    title: 'common.appearance',
    route: route.settings.appearance,
  },
  {
    title: 'common.privacy',
    route: route.settings.privacy,
  },
  {
    title: 'common.keyboardShortcuts',
    route: route.settings.shortcuts,
  },
  {
    title: 'Hardware',
    route: route.settings.hardware,
  },
  {
    title: 'MCP Servers',
    route: route.settings.mcp_servers,
  },
  {
    title: 'Local API Server',
    route: route.settings.local_api_server,
  },
  {
    title: 'HTTPS Proxy',
    route: route.settings.https_proxy,
  },
  {
    title: 'Extensions',
    route: route.settings.extensions,
  },
]

const SettingsMenu = () => {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const firstItemProvider =
    providers.length > 0 ? providers[0].provider : 'llama.cpp'
  const matches = useMatches()
  const isActive = matches.some(
    (match) =>
      match.routeId === '/settings/providers/$providerName' &&
      'providerName' in match.params
  )

  return (
    <div className="flex h-full w-44 shrink-0 px-1.5 pt-3 border-r border-main-view-fg/5">
      <div className="flex flex-col gap-1 w-full text-main-view-fg/90 font-medium">
        {menuSettings.map((menu, index) => {
          // Render the menu item
          const menuItem = (
            <Link
              key={menu.title}
              to={menu.route}
              className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5"
            >
              <span className="text-main-view-fg/80">{t(menu.title)}</span>
            </Link>
          )

          if (index === 2) {
            return (
              <div key={menu.title}>
                <span className="mb-1 block">{menuItem}</span>

                {/* Model Providers Link with default parameter */}
                {isActive ? (
                  <div className="block px-2 mt-1 gap-1.5 py-1 w-full rounded bg-main-view-fg/5 cursor-pointer">
                    <span>{t('common.modelProviders')}</span>
                  </div>
                ) : (
                  <Link
                    key="common.modelProviders"
                    to={route.settings.providers}
                    params={{ providerName: firstItemProvider }}
                    className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded"
                  >
                    <span className="text-main-view-fg/80">
                      {t('common.modelProviders')}
                    </span>
                  </Link>
                )}
              </div>
            )
          }

          // For other menu items, just render them normally
          return menuItem
        })}
      </div>
    </div>
  )
}

export default SettingsMenu
