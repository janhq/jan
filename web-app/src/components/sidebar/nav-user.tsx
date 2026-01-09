import { BlocksIcon, SettingsIcon } from 'lucide-react'

import {
  SidebarMenu,
  useSidebar,
} from '@/components/sidebar/sidebar'
import { AnimatedMenuItem, NavMainItem } from './items'
import { route } from '@/constants/routes'

export function NavUser() {
  const { isMobile, setOpenMobile } = useSidebar()

  const navFooterItems: NavMainItem[] = [
    {
      title: 'Models',
      url: route.hub.index,
      icon: BlocksIcon,
      isActive: false,
    },
    {
      title: 'Settings',
      url: route.settings.general,
      icon: SettingsIcon,
      isActive: false,
    },
  ]

  return (
    <SidebarMenu>
        {navFooterItems.map((item, index) => (
          <AnimatedMenuItem
            key={item.title}
            item={item}
            isMobile={isMobile}
            setOpenMobile={setOpenMobile}
            index={index}
          />
        ))}
    </SidebarMenu>
  )
}
