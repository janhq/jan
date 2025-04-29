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
]

const SettingsMenu = () => {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const firstItemProvider = providers[0][Object.keys(providers[0])[0]].provider
  const matches = useMatches()
  const isActive = matches.some(
    (match) =>
      match.routeId === '/settings/providers/$providerName' &&
      'providerName' in match.params
  )

  return (
    <div className="flex h-full w-44 shrink-0 px-1.5 pt-3 border-r border-main-view-fg/5">
      <div className="flex flex-col gap-1 w-full text-main-view-fg/90 font-medium">
        {menuSettings.map((menu) => {
          return (
            <Link
              key={menu.title}
              to={menu.route}
              className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5"
            >
              <span>{t(menu.title)}</span>
            </Link>
          )
        })}

        {/* Model Providers Link with default parameter */}
        {isActive ? (
          <div className="block px-2 gap-1.5 py-1 w-full rounded bg-main-view-fg/5 cursor-pointer">
            <span>{t('common.modelProviders')}</span>
          </div>
        ) : (
          <Link
            key="common.modelProviders"
            to={route.settings.providers}
            params={{ providerName: firstItemProvider }}
            className="block px-2 gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded"
          >
            <span>{t('common.modelProviders')}</span>
          </Link>
        )}
      </div>
    </div>
  )
}

export default SettingsMenu
