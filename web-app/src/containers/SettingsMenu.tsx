import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'

const menuSettings = [
  {
    title: 'Model Providers',
    route: route.settings.modelProviders,
  },
  {
    title: 'General',
    route: route.settings.general,
  },
  {
    title: 'Appearance',
    route: route.settings.appearance,
  },
  {
    title: 'Privacy',
    route: route.settings.privacy,
  },
  {
    title: 'Keyboard Shortcuts',
    route: route.settings.shortcuts,
  },
]

const SettingsMenu = () => {
  return (
    <div className="flex flex-col gap-1 w-full text-white">
      {menuSettings.map((menu) => {
        return (
          <Link
            key={menu.title}
            to={menu.route}
            className="block px-2 items-center gap-1.5 cursor-pointer hover:bg-neutral-800/50 py-1 w-full rounded [&.active]:bg-neutral-800/50"
          >
            <span>{menu.title}</span>
          </Link>
        )
      })}
    </div>
  )
}

export default SettingsMenu
