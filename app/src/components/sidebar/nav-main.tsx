import { type LucideIcon } from 'lucide-react'

import { MessageCirclePlusIcon, FolderPenIcon, Search } from 'lucide-react'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Link } from '@tanstack/react-router'

type NavMainItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  badge?: string
}

const navMain: NavMainItem[] = [
  {
    title: 'New Chat',
    url: '/',
    icon: MessageCirclePlusIcon,
    isActive: false,
  },
  {
    title: 'New Project',
    url: '#',
    icon: FolderPenIcon,
  },
  {
    title: 'Search',
    url: '#',
    icon: Search,
  },
]

export function NavMain() {
  return (
    <SidebarMenu>
      {navMain.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild isActive={item.isActive}>
            <Link to={item.url}>
              <item.icon />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}
