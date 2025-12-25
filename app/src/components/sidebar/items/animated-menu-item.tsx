import { type LucideIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useStaggeredFadeIn } from '@/hooks/useStaggeredFadeIn'

type NavMainItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  badge?: string
  onClick?: () => void
}

export function AnimatedMenuItem({
  item,
  isMobile,
  setOpenMobile,
  index,
}: {
  item: NavMainItem
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  index: number
}) {
  const animation = useStaggeredFadeIn(index)

  return (
    <SidebarMenuItem className={animation.className} style={animation.style}>
      <SidebarMenuButton
        asChild={!item.onClick}
        isActive={item.isActive}
        onClick={() => {
          item.onClick?.()
          if (isMobile) {
            setOpenMobile(false)
          }
        }}
      >
        {item.onClick ? (
          <>
            <item.icon />
            <span>{item.title}</span>
          </>
        ) : (
          <Link to={item.url}>
            <item.icon />
            <span>{item.title}</span>
          </Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
