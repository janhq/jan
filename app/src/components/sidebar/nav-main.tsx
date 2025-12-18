import { type LucideIcon } from 'lucide-react'

import { MessageCirclePlusIcon, FolderPenIcon, Search } from 'lucide-react'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Link, useRouter } from '@tanstack/react-router'

type NavMainItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  badge?: string
  onClick?: () => void
}

export function NavMain() {
  const router = useRouter()

  const handleNewProject = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('projects', 'create')
    router.navigate({ to: url.pathname + url.search })
  }

  const handleSearch = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('search', 'open')
    router.navigate({ to: url.pathname + url.search })
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
      onClick: handleNewProject,
    },
    {
      title: 'Search',
      url: '#',
      icon: Search,
      onClick: handleSearch,
    },
  ]

  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      {navMain.map((item) => (
        <SidebarMenuItem key={item.title}>
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
      ))}
    </SidebarMenu>
  )
}
