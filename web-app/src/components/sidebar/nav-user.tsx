import { BlocksIcon, SettingsIcon } from 'lucide-react'

import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from '@/components/sidebar/sidebar'
import { useRouter } from '@tanstack/react-router'
import { AnimatedMenuItem, NavMainItem } from './items'
import { route } from '@/constants/routes'

export function NavUser() {
  const router = useRouter()
  const { isMobile, setOpenMobile } = useSidebar()

  const navFooterItems: NavMainItem[] = [
    {
      title: 'Models',
      url: route.hub.index,
      icon: BlocksIcon,
      isActive: false,
      onClick: () => router.navigate({ to: route.hub.index }),
    },
    {
      title: 'Settings',
      url: route.settings.general,
      icon: SettingsIcon,
      isActive: false,
      onClick: () => router.navigate({ to: route.settings.general }),
    },
  ]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {navFooterItems.map((item, index) => (
          <AnimatedMenuItem
            key={item.title}
            item={item}
            isMobile={isMobile}
            setOpenMobile={setOpenMobile}
            index={index}
          />
        ))}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
