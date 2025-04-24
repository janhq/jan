import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from 'react-i18next'

const menuSettings = [
  {
    title: 'common.modelProviders',
    route: route.settings.modelProviders,
  },
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
  return (
    <div className="flex h-full w-48 shrink-0 px-1.5 pt-3 border-r border-main-view-fg/5">
      <div className="flex flex-col gap-1 w-full text-main-view-fg/90 font-medium">
        {menuSettings.map((menu) => {
          return (
            <Link
              key={menu.title}
              to={menu.route}
              className="block px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5"
            >
              <span>{t(menu.title)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default SettingsMenu
